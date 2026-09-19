import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
const root = new URL('../', import.meta.url);
const base = new URL('web/public/zk/milestone-v1/', root);
const manifest = JSON.parse(await readFile(new URL('manifest.json', base), 'utf8'));
const hash = (value) => createHash('sha256').update(value).digest('hex');
if (manifest.circuit !== 'sprout-milestone-v1' || manifest.protocol !== 'plonk')
  throw new Error('Unsupported proof artifacts.');
if (hash(await readFile(new URL('circuits/milestone-v1/milestone.circom', root))) !== manifest.circuitSha256) {
  throw new Error('Circuit changed. Rebuild artifacts with bun run build:zk and run the proof tests.');
}
for (const file of ['milestone.wasm', 'milestone.zkey', 'verification_key.json']) {
  if (hash(await readFile(new URL(file, base))) !== manifest.files[file])
    throw new Error(`ZK artifact checksum mismatch: ${file}`);
}
console.log('ZK circuit and artifact checksums match.');
