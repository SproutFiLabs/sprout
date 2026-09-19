/// <reference lib="webworker" />
import { plonk } from 'snarkjs';
import { zkEnvelopeSchema, ZK_CIRCUIT, type ZkEnvelope, type ZkIssuance } from '@sprout/shared/zk';
import verificationKey from '../../public/zk/milestone-v1/verification_key.json';
import manifest from '../../public/zk/milestone-v1/manifest.json';

const log = { info() {}, warn() {}, debug() {}, error() {} };
async function artifact(name: 'milestone.wasm' | 'milestone.zkey') {
  const res = await fetch(`/zk/milestone-v1/${name}`);
  if (!res.ok) throw new Error('The proof engine could not load. Please try again.');
  const buffer = await res.arrayBuffer();
  const digest = [...new Uint8Array(await crypto.subtle.digest('SHA-256', buffer))]
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
  if (digest !== manifest.files[name]) throw new Error('Proof engine integrity check failed.');
  return new Uint8Array(buffer);
}
self.onmessage = async (
  event: MessageEvent<{ kind: 'prove'; issuance: ZkIssuance } | { kind: 'verify'; envelope: ZkEnvelope }>,
) => {
  try {
    let envelope: ZkEnvelope;
    if (event.data.kind === 'prove') {
      self.postMessage({ stage: 'loading' });
      const [wasm, zkey] = await Promise.all([artifact('milestone.wasm'), artifact('milestone.zkey')]);
      self.postMessage({ stage: 'proving' });
      const { certificate, witness } = event.data.issuance;
      const result = await plonk.fullProve({ ...witness }, wasm, zkey, log, { memorySize: 0 }, { singleThread: true });
      // Keep no witness copy after the prover completes. It is never sent back to the UI.
      for (const key of Object.keys(witness) as (keyof typeof witness)[]) witness[key] = '';
      envelope = zkEnvelopeSchema.parse({ version: 1, circuit: ZK_CIRCUIT, certificate, ...result });
    } else {
      envelope = zkEnvelopeSchema.parse(event.data.envelope);
    }
    self.postMessage({ stage: 'verifying' });
    const valid = await plonk.verify(verificationKey, envelope.publicSignals, envelope.proof, log);
    if (!valid) throw new Error('The cryptographic proof is invalid.');
    self.postMessage({ envelope });
  } catch {
    self.postMessage({ error: 'The proof could not be verified. Check the file or try creating a new proof.' });
  }
};
