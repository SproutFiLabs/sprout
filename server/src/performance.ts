import type { HoldingsSnapshot } from './chain';
import type { listChainEvents } from './repo';

export type PortfolioPerformance =
  | { available: false; reason: string }
  | {
      available: true;
      contributedUsd: string;
      withdrawnUsd: string;
      gainUsd: string;
      feedDecimals: number;
    };

/**
 * Lifetime change in value after external cash flows. Purchases inside the
 * vault move balances but do not count as contributions or withdrawals.
 * Settlement is valued at $1, matching holdings. Stock cash flows need their
 * historical price, which the index does not yet store: never use today's price
 * to invent a cost basis. Untracked transfers also make performance unknown.
 */
export function portfolioPerformance(
  holdings: HoldingsSnapshot,
  events: ReturnType<typeof listChainEvents>,
  indexedThrough: number,
): PortfolioPerformance {
  const unavailable = (reason: string): PortfolioPerformance => ({ available: false, reason });
  if (!holdings.available || holdings.totalValueUsd === null || holdings.blockNumber === null) {
    return unavailable('A verified current value is needed to calculate gain or loss.');
  }
  if (indexedThrough < holdings.blockNumber) {
    return unavailable('Contribution history is catching up.');
  }
  const history = events.filter((event) => event.blockNumber <= holdings.blockNumber!);
  if (!history.some((event) => event.eventName === 'SproutInitialized')) {
    return unavailable('Complete contribution history is not available yet.');
  }
  const settlement = holdings.holdings.find((holding) => holding.kind === 'settlement');
  if (!settlement) return unavailable('Settlement token details are unavailable.');
  const settlementAddress = settlement.address.toLowerCase();
  const balances = new Map(holdings.holdings.map((holding) => [holding.address.toLowerCase(), 0n]));
  let contributed = 0n;
  let withdrawn = 0n;
  const adjust = (token: string, amount: bigint) => {
    if (!balances.has(token)) throw new Error('unknown token');
    const next = balances.get(token)! + amount;
    if (next < 0n) throw new Error('incomplete history');
    balances.set(token, next);
  };
  const amount = (value: unknown): bigint => {
    if (typeof value !== 'string' || !/^\d+$/.test(value)) throw new Error('invalid amount');
    return BigInt(value);
  };
  try {
    for (const event of history) {
      if (!['Funded', 'GiftReceived', 'Withdrawn', 'AllowanceClaimed', 'InvestmentExecuted'].includes(event.eventName)) continue;
      const payload = event.payload as Record<string, unknown>;
      if (typeof payload?.token !== 'string') throw new Error('missing token');
      const token = payload.token.toLowerCase();
      if (event.eventName === 'InvestmentExecuted') {
        adjust(settlementAddress, -amount(payload.amountIn));
        adjust(token, amount(payload.amountOut));
        continue;
      }
      if (token !== settlementAddress) {
        return unavailable('Stock-token deposits or withdrawals need historical prices before gain or loss can be shown.');
      }
      const rawAmount = amount(payload.amount);
      if (event.eventName === 'Funded' || event.eventName === 'GiftReceived') {
        contributed += rawAmount;
        adjust(token, rawAmount);
      } else {
        withdrawn += rawAmount;
        adjust(token, -rawAmount);
      }
    }
    // Balance matching catches direct ERC-20 transfers and incomplete records;
    // neither should be silently reported as an investment gain or loss.
    if (holdings.holdings.some((holding) => balances.get(holding.address.toLowerCase()) !== BigInt(holding.rawBalance))) {
      return unavailable('Recorded activity does not yet match the current balances. Gain or loss is unavailable.');
    }
  } catch {
    return unavailable('Complete, valid contribution history is needed to calculate gain or loss.');
  }
  const usd = (raw: bigint) => raw * 10n ** BigInt(holdings.feedDecimals) / 10n ** BigInt(settlement.decimals);
  const contributedUsd = usd(contributed);
  const withdrawnUsd = usd(withdrawn);
  const gainUsd = BigInt(holdings.totalValueUsd) + withdrawnUsd - contributedUsd;
  return {
    available: true,
    contributedUsd: contributedUsd.toString(),
    withdrawnUsd: withdrawnUsd.toString(),
    gainUsd: gainUsd.toString(),
    feedDecimals: holdings.feedDecimals,
  };
}
