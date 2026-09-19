# SPROUT family toolkit film

40-second, 1080p/30fps walkthrough of the redesigned functional workspaces. Uses actual browser recordings, original SPROUT assets, Satoshi/Georgia, and an original stereo score with synchronized UI sounds. The direction and shot list are in `direction.md`.

Recordings use the isolated local QA API on 4331 and frontend on 5197 with the public server test wallet. Start `output/sprout-family-update/preview.ts` first. The capture expects an ETH ledger entry from the workspace QA fixture. Reward API responses are browser fixtures; no live purchase or payout occurs. Brokerage remains unavailable. The Intelligence shot shows a context handoff, not a generated answer.

```sh
bun run scripts/family-film/capture.ts
FFMPEG_PATH=/path/to/ffmpeg python3 scripts/family-film/trim-recordings.py
node scripts/family-film/prepare.mjs
python3 scripts/family-film/score.py
cd output/sprout-family-film
npm install
node render-family.mjs --stills
node render-family.mjs
```

Python score generation requires numpy. From the repo root, run `FFMPEG_PATH=/path/to/full/ffmpeg node scripts/family-film/verify.mjs` for metadata, audio checks, overview and transition strips. Inspect those and listen to the audio before delivery.

Output: `output/sprout-family-film/out/SPROUT-Family-Toolkit.mp4`. Capture sources and generated media stay outside the production app. No live deployment is performed by these scripts.
