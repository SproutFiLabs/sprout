# Harvest product preview

Open `/harvest` in the web app. This implements the selected white, serif and cut-paper-flower design as an interactive preview. It is not a live rewards distribution service.

## Implemented

- Rewards, history and explanation views; keyboard-operated tabs and native modal dialogs.
- Allocation breakdown, claim review, acknowledgement, cancellable pending state, completion and receipts.
- Integer-cent demo accounting with duplicate-claim protection. Completing a demo claim clears the example balance and adds one receipt.
- Searchable claim history and CSV export, explicitly marked simulated.
- Empty, ineligible, network-unavailable and claim-failure scenarios, plus reset.
- Responsive layout and existing site theme support.
- Optional read-only SPROUT balance lookup using an injected wallet and Robinhood Chain RPC. The RPC chain ID and block freshness are checked. Account or network changes invalidate the result. This does not establish a reward entitlement and never signs or sends a transaction.

All allocations are examples. Preview state is held in memory and resets on page refresh. The example 0.50% share is manually supplied, not derived from the connected wallet. This introduces no monthly subscription or payout promise.

## Required before real payouts

1. Select and fund a reward source; publish which proceeds are available for distribution. Family savings remain separate.
2. Define eligibility, snapshot timing, allocation formula, claim periods, rounding and treatment of unclaimed funds. The Intelligence access threshold does not automatically establish Harvest eligibility.
3. Confirm the distribution network and payout asset contract, and implement a reviewed distribution contract with replay protection and funded allocation proofs.
4. Implement verified entitlements, authenticated wallet ownership where needed, durable claims/indexing, transaction reconciliation and operational monitoring.
5. Connect the interface to live proofs, contract reads, network checks, fee estimates, signing, submission, confirmations and explorer receipts. A pending transaction must survive refresh and cannot be treated as completed before chain confirmation.
6. Test the actual wallet/network/asset flow and failure/recovery paths before enabling transfers.

## Validation and walkthrough

`bun test web/test/harvest.test.ts`, `bun run typecheck` and `bun run build:web` passed. Browser QA covered desktop and 390px mobile, light/dark mode, claim completion/failure/cancellation, empty and unavailable states, history search, receipt details and missing-wallet fallback. An injected real wallet was not available for an end-to-end balance lookup.

Local evidence: `output/harvest-qa/`. Video source and final MP4: `output/sprout-harvest-film/`. The 35-second film uses actual screenshots from the working demo, original music and synchronized cues; it identifies the experience as simulated throughout. These generated outputs are intentionally ignored by Git.
