import { describe, expect, test } from 'bun:test';
import { decodeFunctionData, encodeFunctionResult, type Address, type Hex } from 'viem';
import { loadChainConfig } from '@sprout/shared';
import type { ChainContext } from '../src/chain';
import { createApp } from '../src/app';
import { openDb } from '../src/db';
import {
  HISTORY_TTL_MS,
  dailyCloses,
  feedRoundAbi,
  joinRoundId,
  roundsBeforeScaleBreak,
  splitRoundId,
  stockHistory,
} from '../src/stockPrices';

const STOCK = '0x00000000000000000000000000000000000000a3';
const FEED = '0x00000000000000000000000000000000000000f1';
const MULTICALL = '0xcA11bde05977b3631167028862bE2a173976CA11';
const DAY = 86_400;
const START = Date.UTC(2026, 5, 22) / 1000; // 2026-06-22 00:00 UTC

interface FakeRound {
  answer: bigint;
  updatedAt: number;
}

/**
 * A Chainlink-shaped feed: rounds 1..n of one phase, `latestRoundData` is the
 * last one, and `getRoundData` answers any stored round (or nothing, for a
 * mock feed without history). Every read is counted.
 */
function fakeFeed(opts: { rounds: FakeRound[]; phase?: number; history?: boolean; multicall?: boolean }) {
  const phase = opts.phase ?? 1;
  const reads = { latest: 0, round: 0, aggregate: 0 };
  const tuple = (i: number) => {
    const r = opts.rounds[i - 1]!;
    const id = joinRoundId(phase, i);
    return [id, r.answer, BigInt(r.updatedAt), BigInt(r.updatedAt), id] as const;
  };
  const getRound = (id: bigint) => {
    const { phase: p, round } = splitRoundId(id);
    if (opts.history === false || p !== phase || round < 1 || round > opts.rounds.length) throw new Error('execution reverted');
    return tuple(round);
  };
  const publicClient = {
    getBlock: async () => ({ number: 1n, timestamp: BigInt(START + 100 * DAY) }),
    readContract: async ({ address, functionName, args }: { address: string; functionName: string; args?: unknown[] }) => {
      if (functionName === 'decimals') return 8;
      if (functionName === 'latestRoundData') {
        reads.latest += 1;
        return tuple(opts.rounds.length);
      }
      if (functionName === 'getRoundData') {
        reads.round += 1;
        return getRound(args![0] as bigint);
      }
      if (functionName === 'aggregate3' && address === MULTICALL) {
        reads.aggregate += 1;
        return (args![0] as Array<{ target: Address; callData: Hex }>).map((call) => {
          const { args: callArgs } = decodeFunctionData({ abi: feedRoundAbi, data: call.callData });
          try {
            const data = getRound(callArgs[0] as bigint);
            return { success: true, returnData: encodeFunctionResult({ abi: feedRoundAbi, functionName: 'getRoundData', result: data }) };
          } catch {
            return { success: false, returnData: '0x' as Hex };
          }
        });
      }
      throw new Error(`unexpected readContract ${functionName}`);
    },
  };
  const chain = loadChainConfig({
    SPROUT_CHAIN_ID: '4663',
    SPROUT_RPC_URL: 'http://127.0.0.1:1',
    SPROUT_STOCK_TOKENS: `AAPL:${STOCK}:18:1000000000000000000:${FEED}:86400`,
    ...(opts.multicall === false ? { SPROUT_MULTICALL3_ADDRESS: 'off' } : {}),
  });
  const ctx = {
    config: { chain, dbPath: ':memory:', port: 0, allowFixtures: false, useLocalKeys: false },
    publicClient,
    walletClient: null,
    walletAddress: null,
    walletIsAnvilDev: false,
  } as unknown as ChainContext;
  return { ctx, reads, token: chain.contracts.stockTokens[0]!, rounds: opts.rounds };
}

/** `perDay` rounds a day for `days` days, price climbing a dollar a day from $100 (8 decimals). */
function steadyRounds(days: number, perDay = 3): FakeRound[] {
  const out: FakeRound[] = [];
  for (let d = 0; d < days; d++) {
    for (let k = 0; k < perDay; k++) out.push({ answer: BigInt(100 + d) * 10n ** 8n + BigInt(k), updatedAt: START + d * DAY + 3600 * (k + 13) });
  }
  return out;
}

describe('round ids', () => {
  test('split and join a Chainlink proxy round id', () => {
    const id = joinRoundId(1, 645);
    expect(id).toBe(18446744073709552261n); // AAPL's latest round on 2026-09-19
    expect(splitRoundId(id)).toEqual({ phase: 1, round: 645 });
    expect(splitRoundId(7n)).toEqual({ phase: 0, round: 7 }); // a mock feed's plain counter
  });
});

describe('daily closes', () => {
  test('keep the last price of each UTC day', () => {
    const days = dailyCloses(
      [
        { answer: '10000000000', updated_at: START + 3600 },
        { answer: '10100000000', updated_at: START + 20 * 3600 },
        { answer: '10200000000', updated_at: START + DAY + 60 },
      ],
      8,
    );
    expect(days).toEqual([
      { date: '2026-06-22', price: 101, at: START + 20 * 3600 },
      { date: '2026-06-23', price: 102, at: START + DAY + 60 },
    ]);
  });

  test('rounds written in another unit before a scale change are left out', () => {
    // The Robinhood Chain stock feeds' first rounds were 10^8 times larger than today's 8-decimal prices.
    const rows = [{ answer: '2962899999900000000' }, { answer: '2947843500000000000' }, { answer: '29908000000' }, { answer: '30059500000' }];
    expect(roundsBeforeScaleBreak(rows)).toBe(2);
    // An ordinary big move is not a scale change.
    expect(roundsBeforeScaleBreak([{ answer: '100' }, { answer: '40' }, { answer: '300' }])).toBe(0);
    expect(roundsBeforeScaleBreak([])).toBe(0);
  });
});

describe('stock price history', () => {
  test('reads every round once, through Multicall3, and builds daily closes', async () => {
    const feed = fakeFeed({ rounds: steadyRounds(30) });
    const db = openDb(':memory:');
    const h = await stockHistory(feed.ctx, db, feed.token);
    expect(h.complete).toBe(true);
    expect(h.rounds).toBe(90);
    expect(h.days).toHaveLength(30);
    expect(h.days[0]).toEqual({ date: '2026-06-22', price: 100.00000002, at: START + 15 * 3600 });
    expect(h.days[29]!.date).toBe('2026-07-21');
    expect(h.latest).toEqual({ price: 129.00000002, updatedAt: START + 29 * DAY + 15 * 3600 });
    expect(h.feed).toBe(FEED);
    expect(h.source).toBe('price-feed-rounds');
    expect(feed.reads.aggregate).toBe(1);
    expect(feed.reads.round).toBe(0);

    // Served from memory until the TTL passes: no further chain reads.
    await stockHistory(feed.ctx, db, feed.token);
    expect(feed.reads.aggregate).toBe(1);
    expect(HISTORY_TTL_MS).toBeGreaterThanOrEqual(60_000);
  });

  test('later loads only read rounds published since the last one stored', async () => {
    const rounds = steadyRounds(10);
    const feed = fakeFeed({ rounds });
    const db = openDb(':memory:');
    await stockHistory(feed.ctx, db, feed.token);
    expect(feed.reads.aggregate).toBe(1);

    // Two new rounds, and a fresh process (new cache) over the same database.
    rounds.push({ answer: 200n * 10n ** 8n, updatedAt: START + 10 * DAY + 3600 }, { answer: 201n * 10n ** 8n, updatedAt: START + 10 * DAY + 7200 });
    const again = fakeFeed({ rounds });
    const h = await stockHistory(again.ctx, db, again.token);
    expect(h.rounds).toBe(32);
    expect(h.days).toHaveLength(11);
    expect(h.days[10]!.price).toBe(201);
    // One multicall for the single new round below the latest; nothing older is re-read.
    expect(again.reads.aggregate).toBe(1);
  });

  test('works without Multicall3, one round per request', async () => {
    const feed = fakeFeed({ rounds: steadyRounds(5, 2), multicall: false });
    const h = await stockHistory(feed.ctx, openDb(':memory:'), feed.token);
    expect(h.rounds).toBe(10);
    expect(h.days).toHaveLength(5);
    expect(feed.reads.round).toBe(9);
    expect(feed.reads.aggregate).toBe(0);
  });

  test('a feed without round history (the local mock) keeps only what it has seen as latest', async () => {
    const feed = fakeFeed({ rounds: steadyRounds(3), phase: 0, history: false });
    const h = await stockHistory(feed.ctx, openDb(':memory:'), feed.token);
    expect(h.rounds).toBe(1);
    expect(h.days).toHaveLength(1);
    expect(h.complete).toBe(true);
  });

  test('the first rounds in the old unit never reach the chart', async () => {
    const rounds = steadyRounds(4);
    rounds[0] = { answer: rounds[0]!.answer * 10n ** 8n, updatedAt: rounds[0]!.updatedAt };
    rounds[1] = { answer: rounds[1]!.answer * 10n ** 8n, updatedAt: rounds[1]!.updatedAt };
    const feed = fakeFeed({ rounds });
    const h = await stockHistory(feed.ctx, openDb(':memory:'), feed.token);
    expect(h.otherUnitRounds).toBe(2);
    expect(h.rounds).toBe(10);
    expect(Math.max(...h.days.map((d) => d.price))).toBeLessThan(1000);
  });
});

describe('GET /api/stocks/:symbol/history', () => {
  const app = (ctx: ChainContext) => createApp({ db: openDb(':memory:'), chain: ctx, localDemo: false }, { info() {}, warn() {}, error() {} });

  test('returns the history of a configured stock', async () => {
    const feed = fakeFeed({ rounds: steadyRounds(3) });
    const res = await app(feed.ctx).request('/api/stocks/aapl/history');
    expect(res.status).toBe(200);
    const body = (await res.json()) as { symbol: string; available: boolean; days: unknown[] };
    expect(body.symbol).toBe('AAPL');
    expect(body.available).toBe(true);
    expect(body.days).toHaveLength(3);
  });

  test('a stock this server has no feed for is simply unavailable; nonsense is a 400', async () => {
    const feed = fakeFeed({ rounds: steadyRounds(1) });
    const res = await app(feed.ctx).request('/api/stocks/NVDA/history');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ symbol: 'NVDA', available: false, reason: 'no price feed for this stock here' });
    expect((await app(feed.ctx).request('/api/stocks/%3Cscript%3E/history')).status).toBe(400);
  });
});

describe('when the feed cannot be read', () => {
  test('stored rounds are still served, marked incomplete; with nothing stored it is an error', async () => {
    const feed = fakeFeed({ rounds: steadyRounds(4) });
    const db = openDb(':memory:');
    await stockHistory(feed.ctx, db, feed.token);
    const pausedFeed = () => {
      const paused = fakeFeed({ rounds: steadyRounds(4) });
      const client = paused.ctx.publicClient as unknown as { readContract: (a: { functionName: string }) => Promise<unknown> };
      const read = client.readContract;
      client.readContract = async (a) => (a.functionName === 'latestRoundData' ? Promise.reject(new Error('PAUSED')) : read(a as never));
      return paused;
    };
    const paused = pausedFeed();
    const h = await stockHistory(paused.ctx, db, paused.token);
    expect(h.days).toHaveLength(4);
    expect(h.latest).toBeNull();
    expect(h.complete).toBe(false);
    const empty = pausedFeed();
    await expect(stockHistory(empty.ctx, openDb(':memory:'), empty.token)).rejects.toThrow();
  });
});
