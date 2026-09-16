import { describe, expect, test } from 'bun:test';
import { loadChainConfig } from '@sprout/shared';
import type { ChainContext } from '../src/chain';
import { invalidateChainReads } from '../src/chain';
import { createApp } from '../src/app';
import { blockTimestamps } from '../src/blockTimes';
import { contributionHistory, type IndexedVaultEvent } from '../src/contributions';
import { insertChainEvent, insertSnapshot, upsertSprout, type GrowthSnapshotRecord } from '../src/repo';
import { memoryDb, testApp } from './helpers';

const VAULT = '0x00000000000000000000000000000000000000a1';
const SETTLEMENT = '0x00000000000000000000000000000000000000b2';
const STOCK = '0x00000000000000000000000000000000000000a3';
const UNPRICED = '0x00000000000000000000000000000000000000a4';
const FEED = '0x00000000000000000000000000000000000000f1';
const GIFTER = '0x00000000000000000000000000000000000000c3';

const USD = (dollars: number) => (BigInt(Math.round(dollars * 100)) * 10n ** 6n).toString(); // 8-decimal USD
const USDG = (tokens: number) => (BigInt(Math.round(tokens * 100)) * 10n ** 4n).toString(); // 6-decimal settlement
const SHARES = (tokens: number) => (BigInt(Math.round(tokens * 100)) * 10n ** 16n).toString(); // 18-decimal stock

/** A hand-built chain context whose blocks have the given timestamps. */
function mockCtx(blockTimes: Record<number, number>, opts: { failBlocks?: boolean } = {}) {
  const chain = loadChainConfig({
    SPROUT_CHAIN_ID: '31337',
    SPROUT_RPC_URL: 'http://127.0.0.1:18545',
    SPROUT_FACTORY_ADDRESS: '0x00000000000000000000000000000000000000aa',
    SPROUT_SETTLEMENT_TOKEN: SETTLEMENT,
    SPROUT_VENUE_ADDRESS: '0x00000000000000000000000000000000000000bb',
    SPROUT_STOCK_TOKENS: `AAA:${STOCK}:18:1000000000000000000:${FEED}:86400`,
  });
  const blockReads: number[] = [];
  let inFlight = 0;
  let maxInFlight = 0;
  const publicClient = {
    getBlock: async ({ blockNumber }: { blockNumber: bigint }) => {
      const n = Number(blockNumber);
      blockReads.push(n);
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      try {
        await Bun.sleep(2);
        if (opts.failBlocks) throw new Error('rate limited');
        const timestamp = blockTimes[n];
        if (timestamp === undefined) throw new Error(`unknown block ${n}`);
        return { number: blockNumber, timestamp: BigInt(timestamp) };
      } finally {
        inFlight -= 1;
      }
    },
    readContract: async ({ address, functionName }: { address: string; functionName: string }) => {
      if (functionName === 'decimals' && address.toLowerCase() === SETTLEMENT.toLowerCase()) return 6;
      throw new Error(`unexpected readContract ${functionName}`);
    },
  };
  const ctx = {
    config: { chain, dbPath: ':memory:', port: 0, allowFixtures: false, useLocalKeys: false },
    publicClient,
    walletClient: null,
    walletAddress: null,
    walletIsAnvilDev: false,
  } as unknown as ChainContext;
  return { ctx, blockReads, maxInFlight: () => maxInFlight };
}

function event(eventName: string, blockNumber: number, logIndex: number, token: string, amount: string, extra: Record<string, unknown> = {}): IndexedVaultEvent {
  return { eventName, blockNumber, logIndex, payload: { token, amount, ...extra } };
}

/** A stored snapshot with a price for AAA (8-decimal feed); null means no price. */
function snapshot(takenAt: number, aaaPrice: number | null, status = 'ok'): GrowthSnapshotRecord {
  return {
    id: takenAt,
    vaultId: VAULT,
    chainId: 31337,
    takenAt,
    blockNumber: null,
    valueUsd: '0',
    feedDecimals: 8,
    source: 'chain',
    note: null,
    holdings: [
      { symbol: 'SETTLEMENT', address: SETTLEMENT, kind: 'settlement', rawBalance: '0', decimals: 6, multiplier: '1', price: '100000000', feedDecimals: 8, valueUsd: '0', shareEquivalent: '0', status: 'ok' },
      { symbol: 'AAA', address: STOCK, kind: 'stock', rawBalance: '0', decimals: 18, multiplier: '1', price: aaaPrice === null ? null : USD(aaaPrice), feedDecimals: 8, valueUsd: null, shareEquivalent: '0', status },
    ],
  };
}

describe('contribution history', () => {
  test('settlement deposits count at $1 and claims and withdrawals come out', async () => {
    const { ctx } = mockCtx({ 10: 1_000, 20: 2_000, 30: 3_000 });
    const history = await contributionHistory(ctx, {
      events: [
        event('Funded', 10, 0, SETTLEMENT, USDG(1000), { from: GIFTER }),
        event('AllowanceClaimed', 20, 0, SETTLEMENT, USDG(10)),
        event('Withdrawn', 30, 1, SETTLEMENT, USDG(90), { to: GIFTER }),
      ],
      snapshots: [],
    });
    expect(history.contributions).toEqual([
      { at: 1_000, netUsd: USD(1000) },
      { at: 2_000, netUsd: USD(990) },
      { at: 3_000, netUsd: USD(900) },
    ]);
    expect(history.totals).toEqual({ inUsd: USD(1000), outUsd: USD(100), netUsd: USD(900) });
    expect(history.note).toBeUndefined();
  });

  test('a gift is money in, and the settlement token matches case-insensitively', async () => {
    const { ctx } = mockCtx({ 5: 500, 6: 600 });
    const history = await contributionHistory(ctx, {
      events: [
        event('Funded', 5, 0, SETTLEMENT.toUpperCase().replace('0X', '0x'), USDG(100)),
        event('GiftReceived', 6, 3, SETTLEMENT, USDG(25.5), { gifter: GIFTER, giftRef: `0x${'ab'.repeat(32)}` }),
      ],
      snapshots: [],
    });
    expect(history.contributions).toEqual([
      { at: 500, netUsd: USD(100) },
      { at: 600, netUsd: USD(125.5) },
    ]);
    expect(history.totals).toEqual({ inUsd: USD(125.5), outUsd: '0', netUsd: USD(125.5) });
  });

  test('a stock deposit is valued at the nearest recorded price at or before it', async () => {
    const { ctx } = mockCtx({ 1: 100, 2: 2_000, 3: 2_600 });
    const snapshots = [
      snapshot(500, 100),
      snapshot(1_500, 120),
      snapshot(1_800, 999, 'stale'), // a stale price is never used
      snapshot(1_900, null, 'paused'),
      snapshot(2_500, 150),
    ];
    const history = await contributionHistory(ctx, {
      events: [
        // Before any snapshot: the earliest later price ($100) is used.
        event('Funded', 1, 0, STOCK, SHARES(1)),
        // At t=2000: the $120 price from t=1500, not the stale or later ones.
        event('GiftReceived', 2, 0, STOCK, SHARES(2), { gifter: GIFTER }),
        // A stock allowance claim at t=2600 is valued at $150.
        event('AllowanceClaimed', 3, 0, STOCK, SHARES(0.5)),
      ],
      snapshots,
    });
    expect(history.contributions).toEqual([
      { at: 100, netUsd: USD(100) },
      { at: 2_000, netUsd: USD(340) },
      { at: 2_600, netUsd: USD(265) },
    ]);
    expect(history.totals).toEqual({ inUsd: USD(340), outUsd: USD(75), netUsd: USD(265) });
    expect(history.note).toBeUndefined();
  });

  test('a stock deposit with no recorded price is left out and noted', async () => {
    const { ctx } = mockCtx({ 1: 100, 2: 200 });
    const history = await contributionHistory(ctx, {
      events: [
        event('Funded', 1, 0, SETTLEMENT, USDG(50)),
        event('Funded', 2, 0, UNPRICED, SHARES(3)),
      ],
      snapshots: [snapshot(150, 100)],
    });
    expect(history.contributions).toEqual([{ at: 100, netUsd: USD(50) }]);
    expect(history.totals).toEqual({ inUsd: USD(50), outUsd: '0', netUsd: USD(50) });
    expect(history.note).toContain('Some stock deposits could not be valued');
  });

  test('the series is in chain order and events in the same second share one point', async () => {
    const { ctx } = mockCtx({ 10: 1_000, 11: 1_000, 20: 2_000, 30: 3_000 });
    const history = await contributionHistory(ctx, {
      // Deliberately shuffled, with non-money events mixed in.
      events: [
        event('Withdrawn', 30, 0, SETTLEMENT, USDG(5)),
        event('InvestmentExecuted', 20, 1, STOCK, SHARES(1)),
        event('GiftReceived', 20, 2, SETTLEMENT, USDG(20)),
        event('Funded', 10, 1, SETTLEMENT, USDG(7)),
        event('Funded', 10, 0, SETTLEMENT, USDG(3)),
        event('Funded', 11, 0, SETTLEMENT, USDG(10)), // same second as block 10
        event('MilestoneReleased', 30, 1, SETTLEMENT, USDG(2)),
      ],
      snapshots: [],
    });
    expect(history.contributions).toEqual([
      { at: 1_000, netUsd: USD(20) },
      { at: 2_000, netUsd: USD(40) },
      { at: 3_000, netUsd: USD(35) },
    ]);
    const times = history.contributions.map((p) => p.at);
    expect(times).toEqual([...times].sort((a, b) => a - b));
  });

  test('no money events means no totals and no chain reads', async () => {
    const { ctx, blockReads } = mockCtx({});
    const history = await contributionHistory(ctx, {
      events: [event('InvestmentScheduled', 4, 0, SETTLEMENT, USDG(25))],
      snapshots: [snapshot(100, 100)],
    });
    expect(history).toEqual({ contributions: [], totals: null });
    expect(blockReads).toHaveLength(0);
  });
});

describe('block timestamps', () => {
  test('each block is read once and kept, even when the chain clock is dropped', async () => {
    const { ctx, blockReads } = mockCtx({ 10: 1_000, 20: 2_000 });
    const events = [
      event('Funded', 10, 0, SETTLEMENT, USDG(1)),
      event('Funded', 10, 1, SETTLEMENT, USDG(2)),
      event('GiftReceived', 20, 0, SETTLEMENT, USDG(3)),
    ];
    await Promise.all([
      contributionHistory(ctx, { events, snapshots: [] }),
      contributionHistory(ctx, { events, snapshots: [] }),
    ]);
    await contributionHistory(ctx, { events, snapshots: [] });
    // The shared chain clock is invalidated by prefix 'block'; block times survive it.
    invalidateChainReads(ctx, 'block');
    await contributionHistory(ctx, { events, snapshots: [] });
    expect(blockReads.sort((a, b) => a - b)).toEqual([10, 20]);
  });

  test('uncached reads run with limited concurrency', async () => {
    const times: Record<number, number> = {};
    for (let n = 1; n <= 12; n++) times[n] = n * 100;
    const t = mockCtx(times);
    const result = await blockTimestamps(t.ctx, Object.keys(times).map(Number), 3);
    expect(result.size).toBe(12);
    expect(result.get(7)).toBe(700);
    expect(t.maxInFlight()).toBeLessThanOrEqual(3);
    expect(t.maxInFlight()).toBeGreaterThan(1);
  });

  test('a failed read is not cached', async () => {
    const failing = mockCtx({ 1: 100 }, { failBlocks: true });
    await expect(blockTimestamps(failing.ctx, [1])).rejects.toThrow('rate limited');
    await expect(blockTimestamps(failing.ctx, [1])).rejects.toThrow('rate limited');
    expect(failing.blockReads).toEqual([1, 1]);
  });
});

describe('growth endpoint', () => {
  function seed(db: ReturnType<typeof memoryDb>, withSnapshots: boolean) {
    upsertSprout(db, {
      id: VAULT,
      chainId: 31337,
      parent: GIFTER,
      beneficiary: '0x00000000000000000000000000000000000000e5',
      settlementToken: SETTLEMENT,
      graduationTimestamp: 2_000_000_000,
      assets: [STOCK],
      weights: [10_000],
      createdTxHash: null,
      createdBlock: null,
    });
    insertChainEvent(db, {
      chainId: 31337,
      txHash: `0x${'01'.repeat(32)}`,
      logIndex: 0,
      blockNumber: 10,
      address: VAULT,
      eventName: 'Funded',
      vaultId: VAULT,
      payload: { from: GIFTER, token: SETTLEMENT, amount: USDG(1000) },
    });
    if (withSnapshots) {
      for (const takenAt of [1_100, 1_200]) {
        insertSnapshot(db, {
          vaultId: VAULT,
          chainId: 31337,
          takenAt,
          blockNumber: 11,
          valueUsd: USD(1000),
          feedDecimals: 8,
          holdings: snapshot(takenAt, 100).holdings,
          source: 'chain',
          note: 'Settlement token is treated as $1.00',
        });
      }
    }
  }

  test('without snapshots it stays unavailable but still carries what was put in', async () => {
    const db = memoryDb();
    seed(db, false);
    const app = testApp(db, mockCtx({ 10: 1_000 }).ctx, { localDemo: false });
    const body = (await (await app.request(`/api/sprouts/${VAULT}/growth`)).json()) as Record<string, unknown>;
    expect(body.available).toBe(false);
    expect(body.reason).toContain('no verified growth history');
    expect(body.snapshots).toEqual([]);
    expect(body.contributions).toEqual([{ at: 1_000, netUsd: USD(1000) }]);
    expect(body.totals).toEqual({ inUsd: USD(1000), outUsd: '0', netUsd: USD(1000) });
  });

  test('with snapshots the existing fields are unchanged and the new ones are added', async () => {
    const db = memoryDb();
    seed(db, true);
    const app = testApp(db, mockCtx({ 10: 1_000 }).ctx, { localDemo: false });
    const body = (await (await app.request(`/api/sprouts/${VAULT}/growth`)).json()) as {
      available: boolean;
      snapshots: Array<{ takenAt: number; valueUsd: string; feedDecimals: number; source: string }>;
      contributions: unknown[];
      totals: unknown;
    };
    expect(body.available).toBe(true);
    expect(body.snapshots.map((s) => [s.takenAt, s.valueUsd, s.feedDecimals, s.source])).toEqual([
      [1_100, USD(1000), 8, 'chain'],
      [1_200, USD(1000), 8, 'chain'],
    ]);
    expect(body.contributions).toEqual([{ at: 1_000, netUsd: USD(1000) }]);
    expect(body.totals).toEqual({ inUsd: USD(1000), outUsd: '0', netUsd: USD(1000) });
  });

  test('a failed block read keeps the recorded values and explains the gap', async () => {
    const db = memoryDb();
    seed(db, true);
    const warnings: string[] = [];
    const app = createApp(
      { db, chain: mockCtx({}, { failBlocks: true }).ctx, localDemo: false },
      { info: () => undefined, warn: (msg) => warnings.push(msg), error: () => undefined },
    );
    const res = await app.request(`/api/sprouts/${VAULT}/growth`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { available: boolean; snapshots: unknown[]; contributions: unknown[]; totals: unknown; note?: string };
    expect(body.available).toBe(true);
    expect(body.snapshots).toHaveLength(2);
    expect(body.contributions).toEqual([]);
    expect(body.totals).toBeNull();
    expect(body.note).toContain('cannot be shown right now');
    expect(warnings).toEqual(['contribution history unavailable']);
  });
});
