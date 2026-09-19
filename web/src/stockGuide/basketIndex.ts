/**
 * A basket's combined index, built only from its holdings' real daily closes.
 *
 * Method: buy and hold. On the first day every holding has a price, $100 is
 * split by the basket's target weights; each part then moves with its own
 * holding's price and is never rebalanced. That is how a sprout behaves too:
 * new money is split by the target weights, but what is already held is not
 * traded back to them.
 *
 * The window is the overlap: from the latest first day to the earliest last
 * day among the holdings, counting only days on which every holding has a
 * close. When one holding's history is shorter, the chart starts where it does.
 */

import type { ClosePoint } from './bumpiness';

export interface HoldingSeries {
  symbol: string;
  weight: number;
  closes: readonly ClosePoint[];
}

export interface BasketIndex {
  points: ClosePoint[];
  from: string;
  to: string;
  /** Holdings whose history starts later than the longest one, which set where the chart starts. */
  shorter: string[];
  /** Days inside the window left out because a holding had no close that day. */
  skippedDays: number;
}

export const INDEX_START = 100;

export function basketIndex(holdings: readonly HoldingSeries[]): BasketIndex | null {
  const live = holdings.filter((h) => h.weight > 0);
  if (live.length === 0 || live.some((h) => h.closes.length === 0)) return null;
  const total = live.reduce((n, h) => n + h.weight, 0);
  const maps = live.map((h) => new Map(h.closes.filter((c) => c.value > 0).map((c) => [c.date, c.value])));
  const firsts = live.map((h) => h.closes[0]!.date);
  const lasts = live.map((h) => h.closes[h.closes.length - 1]!.date);
  const from = firsts.reduce((a, b) => (b > a ? b : a));
  const to = lasts.reduce((a, b) => (b < a ? b : a));
  if (from > to) return null;

  const inWindow = new Set<string>();
  for (const h of live) for (const c of h.closes) if (c.date >= from && c.date <= to) inWindow.add(c.date);
  const dates = [...inWindow].filter((d) => maps.every((m) => m.has(d))).sort();
  if (dates.length < 2) return null;

  const base = maps.map((m) => m.get(dates[0]!)!);
  const points = dates.map((date) => ({
    date,
    value: INDEX_START * live.reduce((n, h, i) => n + (h.weight / total) * (maps[i]!.get(date)! / base[i]!), 0),
  }));
  const earliest = firsts.reduce((a, b) => (b < a ? b : a));
  return {
    points,
    from: dates[0]!,
    to: dates[dates.length - 1]!,
    shorter: from > earliest ? live.filter((_, i) => firsts[i] === from).map((h) => h.symbol) : [],
    skippedDays: inWindow.size - dates.length,
  };
}
