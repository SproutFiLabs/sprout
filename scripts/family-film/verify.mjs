import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '../..');
const dir = path.join(root, 'output/sprout-family-film');
const lib = path.join(dir, 'node_modules/@remotion/compositor-darwin-arm64');
const movie = path.join(dir, 'out/SPROUT-Family-Toolkit.mp4');
const qa = path.join(dir, 'out/qa');
fs.mkdirSync(qa, { recursive: true });
const env = { ...process.env, DYLD_LIBRARY_PATH: lib };
// Remotion's minimal ffmpeg omits the overview filters and PCM muxer.
// Supply a full ffmpeg build through FFMPEG_PATH, or install it on PATH.
const ffmpeg = process.env.FFMPEG_PATH || 'ffmpeg';
const run = (exe, args) => execFileSync(exe, args, { env, encoding: 'utf8' });
const meta = JSON.parse(run(path.join(lib, 'ffprobe'), ['-v', 'error', '-show_entries', 'format=duration,size:stream=codec_name,width,height,r_frame_rate,sample_rate,channels', '-of', 'json', movie]));
fs.writeFileSync(path.join(qa, 'metadata.json'), JSON.stringify(meta, null, 2));
run(ffmpeg, ['-v', 'error', '-y', '-i', movie, '-vf', 'fps=1,scale=320:180,tile=8x5', '-frames:v', '1', path.join(qa, 'overview.jpg')]);
for (const cut of [4, 10, 17, 24, 30, 36]) {
  run(ffmpeg, ['-v', 'error', '-y', '-ss', String(cut - .25), '-i', movie, '-t', '0.5', '-vf', 'fps=12,scale=480:270,tile=6x1', '-frames:v', '1', path.join(qa, `transition-${cut}.jpg`)]);
}
const pcm = path.join(qa, 'audio.pcm');
run(ffmpeg, ['-v', 'error', '-y', '-i', movie, '-vn', '-ac', '2', '-ar', '48000', '-acodec', 'pcm_s16le', '-f', 's16le', pcm]);
const bytes = fs.readFileSync(pcm);
let peak = 0, square = 0, clipped = 0;
const seconds = [];
for (let offset = 0; offset < bytes.length; offset += 192000) {
  let energy = 0, count = 0;
  for (let i = offset; i < Math.min(offset + 192000, bytes.length); i += 2) {
    const sample = bytes.readInt16LE(i) / 32768;
    peak = Math.max(peak, Math.abs(sample));
    if (Math.abs(sample) >= .999) clipped++;
    energy += sample * sample;
    count++;
  }
  square += energy;
  seconds.push(Math.sqrt(energy / count));
}
const audio = { peakDbFS: 20 * Math.log10(peak), rmsDbFS: 20 * Math.log10(Math.sqrt(square / (bytes.length / 2))), clippedSamples: clipped, rmsBySecond: seconds };
fs.writeFileSync(path.join(qa, 'audio-quality.json'), JSON.stringify(audio, null, 2));
fs.unlinkSync(pcm);
console.log(JSON.stringify({ metadata: meta, audio }, null, 2));
if (clipped || seconds.slice(1, 39).some(level => level < .001)) throw new Error('Check clipping or unexpected silence.');
