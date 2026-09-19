// Download once at build/dev startup, then serve locally. No browser request to a font CDN.
import { createHash } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
const target = new URL('../web/public/fonts/satoshi/Satoshi-Variable.woff2', import.meta.url);
const sha256 = 'e739aff9b4d02c264341d6d4872edcda28e79373aeda936f659566a1cd3eb47f';
const source =
  'https://cdn.fontshare.com/wf/NWBQYJIM7GCZ5XWD7D26ARB3VDY55ZRT/K63EV2KZIGKLE7RANQ2U42S6SVHU5RJ7/X6XYTKIVDUW7GZTZPZNN4EUM5KH54KHF.woff2';
const digest = (bytes) => createHash('sha256').update(bytes).digest('hex');
let valid = false;
try {
  valid = digest(await readFile(target)) === sha256;
} catch (error) {
  if (error.code !== 'ENOENT') throw error;
}
if (!valid) {
  const response = await fetch(source, { signal: AbortSignal.timeout(30_000) });
  if (!response.ok) throw new Error(`Font download failed: ${response.status}`);
  const bytes = Buffer.from(await response.arrayBuffer());
  if (digest(bytes) !== sha256) throw new Error('Satoshi checksum mismatch; refusing to replace the font.');
  await mkdir(new URL('.', target), { recursive: true });
  const temporary = new URL(`./Satoshi-${process.pid}.tmp`, target);
  await writeFile(temporary, bytes);
  await rename(temporary, target);
  console.log('Satoshi installed for local serving. License: web/public/fonts/satoshi/FFL.txt');
}
