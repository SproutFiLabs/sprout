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

# Private milestone proof studio

The ZK extension follows the existing Family Privacy typography and botanical palette. A forest-green studio holds milestone controls beside an ivory proof receipt; it becomes a single column at narrow widths. The proof seal and status animation follow real worker stages and respect reduced motion. No artificial percentage or success timer is used.

Browser checks passed at 1280px desktop and 390px mobile: real PLONK creation, certificate/receipt success, independent verification in a separate page, fragment removal, parent revocation followed by recipient rejection, and refusal of a $5,000 milestone against a $1,250 local mock balance. Production-bundled WASM/worker proof generation also passed. A raw HTTP/JSON error wrapper found during the mobile check was replaced with the server's readable message. Screens use labeled inputs, live status and error announcements, and an explicit source-certification/public-chain boundary.

React review: generation and verification use dedicated abortable workers; closing the view, changing wallet/vault, cancellation and timeout terminate outstanding work. Async results are guarded against stale instances and uploaded-file races. Certificate polling is cleaned up on unmount. Proof JSON is allowlisted and never contains the balance, salt, wallet or child name.

Validation: 124 server tests, 78 web tests and 48 contract tests pass; real PLONK witness/tamper tests, TypeScript checks, artifact checksum gate, full local-chain smoke and production web build pass. The pre-existing Vite main-chunk size advisory remains. Cryptographic audit and production deployment are outside this validation; see `docs/private-milestone-proofs.md`.
