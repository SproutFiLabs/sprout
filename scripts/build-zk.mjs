import { createHash } from 'node:crypto';
import { readFile, mkdir, writeFile, copyFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
const root = fileURLToPath(new URL('../', import.meta.url));
const build = path.join(root, 'tmp/zk-milestone-v1');
const output = path.join(root, 'web/public/zk/milestone-v1');
await mkdir(build, { recursive: true });
await mkdir(output, { recursive: true });
const ptau = path.join(build, 'powersOfTau28_hez_final_12.ptau');
// Published by iden3/snarkjs. Verify the canonical Perpetual Powers of Tau transcript.
const ptauHash =
  'ded2694169b7b08e898f736d5de95af87c3f1a64594013351b1a796dbee393bd825f88f9468c84505ddd11eb0b1465ac9b43b9064aa8ec97f2b73e04758b8a4a';
const digest = (bytes, algorithm = 'sha256') => createHash(algorithm).update(bytes).digest('hex');
let bytes;
try {
  bytes = await readFile(ptau);
} catch {}
if (!bytes || digest(bytes, 'blake2b512') !== ptauHash) {
  let response;
  for (const url of [
    'https://storage.googleapis.com/zkevm/ptau/powersOfTau28_hez_final_12.ptau',
    'https://hermez.s3-eu-west-1.amazonaws.com/powersOfTau28_hez_final_12.ptau',
    'https://raw.githubusercontent.com/advaita-saha/create-circom-project/ea1345335e1d64468b8fc55490063ba1fb1174d3/powersOfTau28_hez_final_12.ptau',
  ]) {
    response = await fetch(url, { signal: AbortSignal.timeout(120_000) });
    if (response.ok) break;
  }
  if (!response?.ok) throw new Error('Unable to download the universal ceremony transcript.');
  bytes = Buffer.from(await response.arrayBuffer());
  if (digest(bytes, 'blake2b512') !== ptauHash) throw new Error('Ceremony transcript checksum mismatch.');
  await writeFile(ptau, bytes);
}
const run = (tool, args) =>
  execFileSync(
    process.execPath,
    [path.join(root, tool.startsWith('snarkjs/') ? 'shared/node_modules' : 'node_modules', tool), ...args],
    { cwd: root, stdio: 'inherit' },
  );
run('circom2/cli.js', [
  'circuits/milestone-v1/milestone.circom',
  '--r1cs',
  '--wasm',
  '--sym',
  '--O1',
  '-l',
  'node_modules',
  '-o',
  build,
]);
// A complete 2^28 ceremony audit is intentionally opt-in; every build pins its published BLAKE2b hash.
if (process.argv.includes('--verify-ceremony')) run('snarkjs/cli.js', ['powersoftau', 'verify', ptau]);
run('snarkjs/cli.js', [
  'plonk',
  'setup',
  path.join(build, 'milestone.r1cs'),
  ptau,
  path.join(output, 'milestone.zkey'),
]);
run('snarkjs/cli.js', [
  'zkey',
  'export',
  'verificationkey',
  path.join(output, 'milestone.zkey'),
  path.join(output, 'verification_key.json'),
]);
await copyFile(path.join(build, 'milestone_js/milestone.wasm'), path.join(output, 'milestone.wasm'));
await mkdir(path.join(root, 'contracts/src/privacy'), { recursive: true });
run('snarkjs/cli.js', [
  'zkey',
  'export',
  'solidityverifier',
  path.join(output, 'milestone.zkey'),
  'contracts/src/privacy/PrivateMilestoneVerifier.sol',
]);
const solidityFile = path.join(root, 'contracts/src/privacy/PrivateMilestoneVerifier.sol');
await writeFile(solidityFile, (await readFile(solidityFile, 'utf8')).replace(/[ \t]+$/gm, ''));
const files = {};
for (const name of ['milestone.zkey', 'milestone.wasm', 'verification_key.json'])
  files[name] = digest(await readFile(path.join(output, name)));
const manifest = {
  circuit: 'sprout-milestone-v1',
  protocol: 'plonk',
  curve: 'bn128',
  publicSignals: ['commitment', 'thresholdCents', 'scope'],
  circuitSha256: digest(await readFile(path.join(root, 'circuits/milestone-v1/milestone.circom'))),
  ceremonyBlake2b512: ptauHash,
  files,
};
await writeFile(path.join(output, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
console.log('ZK milestone artifacts built from the hash-verified published universal transcript.');
