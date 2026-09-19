# What you put in, and what it is worth

Your sprout shows **Put in** beside **Worth now**, with a signed lifetime gain or
loss beneath them. Adding money does not count as investment growth.

The calculation in [`portfolioPerformance`](../server/src/performance.ts) is:

```ts
const gainUsd = BigInt(holdings.totalValueUsd) + withdrawnUsd - contributedUsd;
```

For example: put in $100, buy stock that becomes worth $120, then add another
$50. The dashboard shows **$150 put in**, **$170 worth now**, and **+$20 gain**.
If the stock falls to $80 instead, it shows **$130 worth now** and **−$20 loss**.
Taking $20 out reduces the current value but does not change that gain or loss.

`Funded` and `GiftReceived` events add contributions. `Withdrawn` and
`AllowanceClaimed` events add withdrawals. `InvestmentExecuted` changes token
balances within the sprout; it does not add contributions. Reserving or releasing
a reward is not a withdrawal until it is claimed.

The [holdings endpoint](../server/src/app.ts) includes this calculation with its
current valuation. The [dashboard](../web/src/DashboardShell.tsx) displays the
comparison and signed result. Chart period buttons still control the portfolio
value chart; the gain/loss figure is explicitly labeled **since planting**.
The chart includes deposits and withdrawals and is labeled accordingly.

## When a result is available

The index must cover the holdings snapshot and include the sprout's initialization.
Replaying recorded token movements must reproduce every reported token balance.
Otherwise, the display explains why gain or loss is unavailable. This also prevents
unrecorded direct token transfers from being reported as investment gains.

Settlement-token contributions and withdrawals use the same $1 assumption as
the holdings valuation. Network fees are excluded. Stock-token deposits, gifts,
or withdrawals need historical prices, which this index does not yet store;
those accounts show an unavailable result rather than a made-up cost basis.
There is no annualized or time-weighted return percentage.

Run the accounting regression checks with:

```sh
bun test server/test/performance.test.ts
```
