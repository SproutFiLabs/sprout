# Daily project buy & burn

The project can spend exactly 5 USDG at most once per 24 hours to buy SPROUT through
USDG → WETH → native ETH → SPROUT, with purchased SPROUT sent directly to the dead
address. This is a scheduled project expense, separate from the optional one-time
visitor burns. It never calls a family vault or uses a visitor's funds.

A dedicated wallet funds both USDG spending and native gas. The server uses its own
persistent `recurring-burn.sqlite` ledger alongside the main database. Signed
transactions are stored before broadcast. A restart reconciles the same transaction
hash and records completed swaps before preparing another. Failed or expired runs
wait 24 hours; missing funding does not create backlogged purchases. Successful
runs wait 24 hours from verification/chain time. A fresh quote and minimum SPROUT
output apply to each swap. Exact amount approvals expire or are consumed.

Enable only with these operator settings:

- `SPROUT_RECURRING_BURN_ENABLED=true`
- `SPROUT_RECURRING_BURN_PRIVATE_KEY`: dedicated signing secret, never committed
- `SPROUT_RECURRING_BURN_WALLET`: the matching public address
- `SPROUT_RECURRING_BURN_MAX_FEE_WEI`: gas-price ceiling
- `SPROUT_RECURRING_BURN_PRIORITY_FEE_WEI`: priority-fee ceiling
- `SPROUT_RECURRING_BURN_GAS_LIMIT`: per-transaction gas ceiling
- `SPROUT_RECURRING_BURN_DAILY_GAS_WEI`: rolling 24-hour native-gas budget

Buy & burn itself must also be enabled. Missing or inconsistent enabled configuration
fails startup. Setting the recurring feature to false stops new signing and
rebroadcasts; already broadcast transactions may still settle. Preserve the ledger
when restarting or deploying. Do not run another service or manually send transactions
from this dedicated wallet while automation is enabled.

`GET /api/burns/recurring` exposes only public status, cadence, wallet and transaction
references. The /perks burn panel shows the schedule and keeps individual visitor
burns separate. The counter verifies actual receipts; an attempted or quoted burn is
not counted. Tokens at the dead address leave accessible circulation; this feature
does not invoke the token's totalSupply reduction and promises no price effect.

Validation: scheduler unit tests cover duplicate ticks, unknown broadcast results,
restart after mining, exact approvals, expired approvals, gas limits, funding pauses
and no catch-up spending. `scripts/fork-recurring-burn.ts` exercises the scheduler
against a local mainnet fork for two daily $5 burns and verifies dead-address delivery.
