import { zkEnvelopeSchema, type ZkEnvelope, type ZkIssuance, type ZkCertificate } from '@sprout/shared/zk';
export type ProofStage = 'certifying' | 'loading' | 'proving' | 'verifying' | 'checking';
export const MAX_PROOF_BYTES = 16_384;
export function proofTask(
  input: { kind: 'prove'; issuance: ZkIssuance } | { kind: 'verify'; envelope: ZkEnvelope },
  signal: AbortSignal,
  onStage: (stage: ProofStage) => void,
): Promise<ZkEnvelope> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(new Error('Proof cancelled.'));
      return;
    }
    const worker = new Worker(new URL('./zk.worker.ts', import.meta.url), { type: 'module' });
    const stop = () => {
      clearTimeout(timeout);
      worker.terminate();
      signal.removeEventListener('abort', abort);
    };
    const abort = () => {
      stop();
      reject(new Error('Proof cancelled.'));
    };
    const timeout = setTimeout(() => {
      stop();
      reject(new Error('Proof generation timed out. Please try again.'));
    }, 120_000);
    signal.addEventListener('abort', abort, { once: true });
    worker.onmessage = (event: MessageEvent<{ stage?: ProofStage; error?: string; envelope?: ZkEnvelope }>) => {
      if (event.data.stage) onStage(event.data.stage);
      else if (event.data.envelope) {
        stop();
        const parsed = zkEnvelopeSchema.safeParse(event.data.envelope);
        if (parsed.success) resolve(parsed.data);
        else reject(new Error('The proof engine returned an invalid proof.'));
      } else {
        stop();
        reject(new Error(event.data.error ?? 'Proof failed.'));
      }
    };
    worker.onerror = () => {
      stop();
      reject(new Error('The proof engine could not start. Please try again.'));
    };
    worker.postMessage(input);
  });
}
export async function checkCertificate(certificate: ZkCertificate, signal?: AbortSignal) {
  const res = await fetch('/api/zk/status', {
    method: 'POST',
    cache: 'no-store',
    signal,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(certificate),
  });
  if (!res.ok) throw new Error('Certificate status could not be checked.');
  const result: unknown = await res.json();
  if (!result || typeof result !== 'object' || !('active' in result) || result.active !== true) {
    throw new Error('This certificate has expired or was revoked. Ask for a fresh proof.');
  }
}
export function parseProof(text: string): ZkEnvelope {
  if (text.length > MAX_PROOF_BYTES) throw new Error('This proof file is too large.');
  return zkEnvelopeSchema.parse(JSON.parse(text));
}
export function proofLink(envelope: ZkEnvelope): string {
  const encoded = btoa(JSON.stringify(zkEnvelopeSchema.parse(envelope)))
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replace(/=+$/, '');
  return `${location.origin}/verify#proof=${encoded}`;
}
export function proofFromHash(hash: string): ZkEnvelope {
  const encoded = hash.replace(/^#proof=/, '');
  if (encoded.length > MAX_PROOF_BYTES * 1.4 || !/^[A-Za-z0-9_-]+$/.test(encoded))
    throw new Error('Invalid proof link.');
  return parseProof(atob(encoded.replaceAll('-', '+').replaceAll('_', '/')));
}
export function downloadProof(envelope: ZkEnvelope) {
  const data = JSON.stringify(zkEnvelopeSchema.parse(envelope), null, 2);
  const url = URL.createObjectURL(new Blob([data], { type: 'application/json' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = 'sprout-private-milestone.json';
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Present API messages without exposing HTTP/JSON wrappers in the family UI. */
export function proofError(error: unknown, fallback = 'Please try again.'): string {
  if (!(error instanceof Error)) return fallback;
  const payload = error.message.match(/^\d{3}\s+(\{.*\})$/s)?.[1];
  if (payload) {
    try {
      const parsed: unknown = JSON.parse(payload);
      if (parsed && typeof parsed === 'object' && 'error' in parsed && typeof parsed.error === 'string')
        return parsed.error;
    } catch {
      /* Keep the original message for errors without a JSON response. */
    }
  }
  return error.message;
}
