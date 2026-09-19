# Family toolkit

Routes: `/family-tools`, `/asset-passports`, `/rewards`, `/tax-garden`, `/family-investing`, `/family-tools/operator`. All fit the existing SPROUT design. The video is a staged walkthrough; it is not evidence of live rewards, purchases or broker execution.

## Availability

- Asset Passports show configured contracts and reviewed issuer terms, sources and dates. Robinhood stock tokens are unavailable to US persons. Passports have no purchase action. These notices do not retrofit jurisdiction enforcement into existing onchain vault contracts or other app routes; a complete US investment launch still requires review and execution integration.
- Rewards implement budgeted purchase offers, holder eligibility, checkout reservations, delivery confirmation and verification of manually sent Base USDC payouts. Off by default. There are no merchant agreements or funded offers included in this release.
- Tax Garden has wallet-authenticated persistent records, a strict JSON import template, duplicate-reference detection, manual corrections, basic and holder accountant CSV exports, filters and SPROUT activity sync. It does not automatically discover every external wallet transaction, compute tax lots, prepare IRS forms, or submit a return. Imports from brokers must first be mapped to the template. Synced orders/payouts retain unknown USD values/basis; users must review timestamps and historical values. USD calculations use integer cents. The estimate covers only entered complete disposals. Gifts and reward tax treatment remain unclassified.
- Family Investing saves and exports adult family plans, records an ownership preference and state, and supports a reviewed provider website handoff. It does not open/link brokerage accounts or trade. Actual brokerage integration cannot be completed until an authorized partner and its API agreement are supplied. No partner endorsement is implied.
- Intelligence accepts an optional context reference `{kind: 'asset'|'ledger'|'reward', id}`. The server resolves facts, authenticates private-record ownership against the Intelligence wallet, strips wallet/hash fields, includes dated source links, and retains existing eligibility and fair-use limits. It does not fetch or independently verify current law. Clicking Explain only prefills the question; sending it shares the selected record with OpenAI. No API key is embedded in browser code.

## Rewards configuration

Use the existing admin token and database. No additional hosting or database subscription is needed.

```
SPROUT_REWARDS_ENABLED=true
SPROUT_REWARDS_TREASURY=0x...public Base treasury address...
SPROUT_REWARDS_RPC_URL=https://mainnet.base.org
```

Only canonical Base USDC is supported (`0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913`, 6 decimals). The service is read-only onchain and never accepts a treasury private key.

1. Complete the Spend provider activation documented in `spend.md`.
2. Fund the treasury yourself, then open `/family-tools/operator` with `SPROUT_ADMIN_TOKEN`.
3. Enter the exact enabled Spend product ID, purchase rebate (up to 20%), total USD budget, deadline within 90 days and full offer/funding/payout terms. Creating an offer verifies finalized treasury holdings cover active unused budgets plus unpaid claims. Funds are NOT escrowed and can be moved by the treasury owner; balance checks are not a payment guarantee.
4. Eligible users follow an offer into Spend. The signed checkout purpose binds the offer ID. The server checks the existing held balance (at least 1M actual SPROUT, not lock weighting), product, budget and treasury. Budget reservation and order insertion share one SQLite transaction. Duplicate order keys cannot allocate twice. A user never earns rewards merely for holding tokens.
5. After provider-confirmed delivery, the user confirms their reward in Rewards.
6. Send the exact USDC amount manually on Base. Record the transaction and log index in the operator desk. Only a successful canonical finalized transfer, after reward confirmation, from the configured treasury to the claimant for the exact amount marks it paid. A transfer event cannot satisfy two claims.

Failed/ambiguous purchases retain reward reservations conservatively. Do not reset them to create an unsupported second payment; reconcile order state and obligations before any manual data repair. This release does not automate refunds or reward reversals.

## Provider handoff configuration

`SPROUT_US_PROVIDER_JSON` is an operator-reviewed configuration, not a license check. Format:

```
{"name":"Your reviewed provider","url":"https://provider.example/account-opening","disclosureUrl":"https://provider.example/disclosures","states":["NY"],"reviewedAt":"2026-09-19T00:00:00Z","validUntil":"2026-10-19T00:00:00Z","approved":true}
```

Use a real, reviewed provider only. HTTPS, valid states and unexpired approval are required; invalid config fails closed. The server requires a saved adult plan and a supported state before returning the URL. No family data is placed in the handoff URL. Recheck the arrangement and applicable obligations before enabling this in production. Nothing in the UI claims a brokerage account is connected.

## Privacy and limits

Family records/plans use existing expiring wallet-signature sessions and owner-scoped SQLite queries. Wallet changes wipe the private UI. No records are stored in browser localStorage. Up to 500 records per import, 5,000 records per family and 1 MB per API request. Basic exports are always available to the signed-in owner; advanced exports independently recheck held-token eligibility. Family erasure deletes ledger and plan records. Purchase/reward financial records remain for reconciliation; do not claim that deleting family notes deletes public onchain transfers or financial audit history.

## Validation

`bun run typecheck`, `bun run test:server`, `bun run test:web`, `bun run build:web`. Targeted tests cover owner isolation, import validation/deduplication, source forgery, unknown/zero basis, CSV injection, holder-gated exports, provider fail-closed behavior, funded offer limits, signature-bound offer IDs, budget rollback, delivery authorization and receipt uniqueness. Browser verification covers wallet sign-in, record creation/correction/export, saving a plan, disconnect privacy, absent-provider controls and mobile overflow.

### Verified build and showcase

September 19, 2026: full server and web suites passed (278 server / 200 web before the final additional erasure regression); the final targeted toolkit/privacy run and subsequent toolkit regression run also passed. TypeScript and the production web build passed. Eleven desktop interaction checks and five 390px mobile layouts passed without page errors. A real Intelligence model response was checked with a synthetic record; production holder eligibility and partner transactions were not exercised with real funds.

The editable showcase lives in `scripts/family-film/`. The 40-second H.264/AAC export includes original music/SFX, explicit illustrative-data notices, and a real AI answer excerpt. Final encoded metadata, one-second overview frames, all six transition strips and decoded audio were inspected. Audio peak was −5.27 dBFS with no clipped samples or unexpected silent seconds. No production deployment or provider activation is included in this local build.
