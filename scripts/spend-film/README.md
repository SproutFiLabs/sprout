# Sprout Spend film

30-second 1920×1080/30fps product walkthrough, using the actual SpendView component and CSS. All purchase data in SpendFilm.tsx is staged. Nothing here creates a real invoice, pays a wallet or delivers a redeemable code. No fixtures enter the web production build.

Run from this directory:

```sh
npm install
node prepare.mjs
python3 score.py # requires numpy; writes an original stereo score
node render-spend.mjs --stills
node render-spend.mjs
```

Output: `out/SPROUT-Spend.mp4`. Inspect every still before rendering, especially the approval and redemption controls. Source product artwork and Satoshi font are copied from the web workspace (run its font setup first). The font’s Fontshare license remains in web/public/fonts/satoshi. Georgia uses the system font; Linux rendering requires an appropriate licensed equivalent and visual recheck.

The MP4 intentionally contains no demo/simulation labels at the user's request. Describe it as a staged walkthrough when delivering or posting. Fulfillment account approval and live checkout validation are separate, unfinished dependencies.
