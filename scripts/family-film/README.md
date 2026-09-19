# SPROUT family toolkit film

40 seconds, 1920×1080, 30 fps, H.264/AAC. Directed with the user's Brand Motion Film skill. Actual ToolsView component and CSS are copied at preparation time. Financial offers, reward states and ledger records are explicitly illustrative. The Intelligence paragraph is an actual gpt-4.1-mini response to an illustrative record, checked September 19, 2026. No real purchase or payout is claimed. Brokerage execution is shown as unavailable.

Story: know the asset → review an offer → organize the record → save a family goal → understand it → return to the SPROUT garden. Real logo, Satoshi/Georgia type and the existing floral artwork. Original synthesized stereo music with matching sound-effect cues, written by `score.py`.

From the repository root:

```
node scripts/family-film/prepare.mjs
npm install --prefix output/sprout-family-film
python3 scripts/family-film/score.py
cd output/sprout-family-film
node render-family.mjs --stills
node render-family.mjs
```

Python requires numpy. Node requires Remotion's supported runtime/browser. Run `node scripts/family-film/verify.mjs` from the repo root with a full ffmpeg on PATH, or set `FFMPEG_PATH` to its executable. Metadata uses the bundled Remotion ffprobe (macOS ARM build); adjust the compositor package name for other platforms. Verification writes MP4 metadata, a one-frame-per-second overview, transition strips and decoded-audio level checks. The brand font comes from `web/public/fonts/satoshi`; its Fontshare license remains there.

Output: `output/sprout-family-film/out/SPROUT-Family-Toolkit.mp4`. Inspect full-resolution stills, the final overview, transitions and audio before sharing. The editable film source is in this directory; all financial fixtures remain outside the production app bundle.
