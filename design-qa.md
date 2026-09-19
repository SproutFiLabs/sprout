# Family Privacy presentation refinement

Scope: existing Family Privacy and invited child screens. Match Sprout's existing botanical art, pale surfaces, green palette and Georgia display type; improve control legibility and remove development-style wording from the family experience.

Sources: existing app captures at 1440×900 and the same revised states at the same CSS viewport, captured at 2× density. Combined side-by-side images are in the local film project at `output/sprout-privacy-product/out/comparison-gifts.jpg` and `comparison-child.jpg` in the main workspace. Narrow layout was also inspected in the Codex in-app browser at 721px.

- Typography: body copy increased to 15px; controls to 13px; restore the already-specified Satoshi font using a checksum-verified local download during dev/build. Existing Georgia display hierarchy retained.
- Spacing: action rows wrap with a 12px gap; primary actions and Revoke have practical targets. Two-column desktop and stacked narrow layouts remain coherent.
- Assets and colors: existing bouquet, garden animation, logo and icon library preserved; no replacement illustrations. Original green/cream surfaces retained.
- Content: replace read-only jargon with family language; remove unavailable-feature status inventory. Explicit public blockchain relationships, balances and transfers remain described accurately.
- States: recording exercised lock/unlock, private invitation creation/redemption, default hidden amount, enabling gift encryption, and server revocation followed by the denied child screen. No JS page errors.
- Accessibility: labeled forms, visible focus, semantic buttons, reduced-motion handling and contrast preserved. Added hover motion respects reduced motion.
- React review: copy/CSS changes introduce no new hooks, effects, fetches or state dependencies.

Build and full TypeScript checks passed. Missing-font and cached-font setup paths were exercised; downloaded SHA-256 matches the recorded original. Existing Vite large-chunk advisory remains unrelated.

Result: passed
