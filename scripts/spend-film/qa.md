# Sprout Spend film QA

- Final export: H.264 1920×1080, 30 fps, AAC stereo; 30.06 seconds including audio padding.
- Inspected nine rendered scene stills, then 30 frames extracted from the final MP4 and four frames around each of five cuts.
- Corrected the approval close-up so both checkbox and approval button remain in frame; corrected pointer positions for amount, approval, reveal and copy.
- Final frames show the actual SpendView product UI: browse, amount/parent approval, USDC Base quote, masked redemption, reveal/copy.
- Landing-page assets, Satoshi, serif headings, muted cards and botanical artwork retained. No demo/simulation labels in the video.
- Music is an original locally synthesized score. No stock music or third-party soundtrack.
- Purchase data is staged. No money sent; the code shown is not redeemable. This is not evidence of live fulfillment.
- Overview and transition sheets are in output/sprout-spend-film/out/qa/video/overview.jpg and transitions.jpg locally.

## Feedback carried forward

User asks for the website itself in motion, matching the landing page. Use real product components and art-directed close-ups rather than generic slides. Keep short copy, readable controls and a concrete browse-to-reveal story. No approval inferred from silence.

## Content ledger

- Brand: existing Sprout logo and harvest bouquet from web/public.
- Type: existing Satoshi font (Fontshare license retained in source tree); system Georgia.
- Product: web/src/spend/SpendView.tsx and spend.css copied by prepare.mjs.
- Fixtures: isolated in scripts/spend-film/src/SpendFilm.tsx; sample merchant denominations and quote are not a confirmed live catalog or merchant partnership.
- Audio: scripts/spend-film/score.py.
- CTA: sproutfy.tech/spend is the intended route; publishing this branch and activating fulfillment are outstanding.
