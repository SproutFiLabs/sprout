/**
 * Price history for the stock guide. Mirrors server/src/stockPrices.ts: the
 * daily closes of a stock's own on-chain price feed.
 */

export interface DailyClose {
  date: string;
  price: number;
  at: number;
}

export interface StockHistory {
  symbol: string;
  feed: string;
  feedDecimals: number;
  source: 'price-feed-rounds';
  rounds: number;
  otherUnitRounds: number;
  firstAt: number | null;
  lastAt: number | null;
  days: DailyClose[];
  latest: { price: number; updatedAt: number } | null;
  complete: boolean;
}

export type HistoryResult =
  | { status: 'ok'; history: StockHistory }
  /** This server has no price feed for the stock (the local demo has only mock tokens): `available: false`. */
  | { status: 'none' }
  | { status: 'error' };

const cache = new Map<string, Promise<HistoryResult>>();

/** One request per stock per page visit; a failed one is retried on the next call. */
export function fetchHistory(symbol: string): Promise<HistoryResult> {
  const key = symbol.toUpperCase();
  const hit = cache.get(key);
  if (hit) return hit;
  const request = (async (): Promise<HistoryResult> => {
    try {
      const res = await fetch(`/api/stocks/${encodeURIComponent(key)}/history`, { cache: 'no-store' });
      if (!res.ok) return { status: 'error' };
      const body = (await res.json()) as (StockHistory & { available: true }) | { available: false };
      if (body.available === false) return { status: 'none' };
      return Array.isArray(body.days) ? { status: 'ok', history: body } : { status: 'error' };
    } catch {
      return { status: 'error' };
    }
  })();
  cache.set(key, request);
  void request.then((r) => {
    if (r.status === 'error') cache.delete(key);
  });
  return request;
}
