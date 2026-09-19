# Harvest — manual holder payouts

`/harvest` is the real registration and payment-tracking interface. `/harvest/operator` is the operator desk. The simulated design is explicitly separated at `/harvest?demo=1`.

No distribution contract, staking, token approval, automatic monthly payout or subscription is used. The operator sends token transfers from its own wallet. The application never holds a treasury key or sends these payments.

## Allocation rule

- Robinhood Chain, chain ID 4663; eligibility token `0x5ec27c931fb49911128dddf7d914c1754da9f49f`.
- A wallet must hold at least **1,000,000 SPROUT** at the published finalized snapshot block and register before the deadline.
- Ownership is proved with a signed, expiring, single-use challenge bound to that round. Registration is unique per wallet and round.
- After registration closes, the announced budget is divided proportionally by snapshot balance among eligible registered wallets. Base-unit integer arithmetic rounds down; remaining units stay in the treasury. Snapshot balances and locked allocations cannot be edited.
- Each round has its own announced budget. Registration and allocation do not mean payment has occurred. Funds remain in the treasury, not escrow. Family savings stay separate; there is no recurring payout promise.
- A round supports 10,000 registrations. The snapshot is selected when the round is created; acquiring tokens afterward does not qualify a wallet for that round.

## Operator workflow

1. Open `/harvest/operator` over HTTPS and enter the existing `SPROUT_ADMIN_TOKEN`. It stays in page memory. Never share it with holders or embed it in a URL.
2. Supply a title, exact payout-token contract, sending treasury wallet, token-denominated budget and deadline (one hour to 30 days ahead). Independently verify the canonical asset address. A matching symbol alone does not prove a token is genuine USDC. The app does not assume that a Robinhood Chain token named USDC is Circle-issued USDC.
3. Publishing reads a finalized snapshot and token metadata. The treasury must cover this budget and its other announced unpaid budgets. This balance check does not reserve funds or prevent later spending. Deployment never creates a round automatically.
4. After registration closes, **Lock allocations** rechecks the treasury and freezes the calculation. Locked rounds cannot be cancelled or reallocated through the API. Empty rounds allocate nothing.
5. Export unpaid recipients. The CSV includes chain, asset, treasury, recipient, exact base-unit amount and decimals. Convert base units correctly if your wallet expects whole tokens. Send the exact amounts from the published treasury, on the published chain and asset. A standard ERC-20 Transfer event is required; do not use fee-on-transfer or rebasing tokens.
6. Enter the transaction hash and Transfer log index in **Verify a manual payment**. The submission is saved before the lookup and excluded from unpaid exports while pending. Do not resend pending payments. Use **Retry verification** after finality.
7. A verified receipt requires a successful canonical finalized transaction, correct token, exact sender/recipient/amount, and a block/time after allocation locking. A transfer event cannot settle two allocations. Wrong or unfinalized transfers never appear as paid.
8. If a submitted hash/log is incorrect, inspect it first, then **Clear submission** with an explanation. This restores the unpaid export row and creates an audit entry. Verified payments cannot be cleared. Clearing a record does not cancel or reverse a transfer.

## Persistence and readiness

Rounds, registrations, allocations, submissions, verified receipts and audit entries use the existing SQLite database and persistent volume. Additive migrations preserve prior data. No extra paid service is added.

`SPROUT_HARVEST_RPC_URL` optionally overrides the read-only Robinhood Chain RPC. Chain ID and head freshness are checked. Historical snapshot reads and finalized receipt reads fail closed. The RPC must support historical ERC-20 reads and the `finalized` tag. The default public RPC was verified for finalized blocks and SPROUT decimals.

The browser polls every 30 seconds. Public listings show the latest 100 rounds. Registration records contain public wallets, snapshot balances, amounts and transaction references; they are publicly queryable by wallet. No family/child information or private keys are collected. Account/network changes clear the connected browser state. Operator credentials are not persisted or logged.

**The first real round requires an actual treasury, payout asset, budget and deadline.** Publishing software does not create funding or send money. Operator payouts remain manual actions.

## Validation

- `bun run typecheck`
- `bun test server/test web/test`
- `bun run build:web`
- `bun scripts/harvest-chain-check.ts` (local Anvil and compiled MockERC20 artifact; optional `ANVIL_BIN` override)

The isolated local-chain check funds a test treasury, verifies historical holdings and a signed registration, locks an allocation, transfers test tokens and verifies the receipt through the API. Wrong sender, recipient, token, amount, old block and log are rejected. It never connects a signer to a public network. Unit tests also cover deadline races, replay, duplicate registrations/payments, precision, overlapping budgets, rounding, pending exports and audited clearing.

Browser QA covered empty and announced-round holder views, rules, missing-wallet fallback, operator login and local round publication, mobile overflow and dark mode. Real production transfers are operator-owned actions, not deployment tests.
