import { describe, expect, test } from 'bun:test';
import { loadChainConfig } from '@sprout/shared';
import type { ChainContext } from '../src/chain';
import { cachedHoldings, chainClock, invalidateChainReads, isGraduated, readHoldings } from '../src/chain';
import { createReadCache } from '../src/readCache';

describe('read cache', () => {
  test('concurrent callers share one load', async () => {
    const cache = createReadCache();
    let loads = 0;
    const load = async () => {
      loads += 1;
      await Bun.sleep(5);
      return 7;
    };
    const values = await Promise.all(Array.from({ length: 50 }, () => cache.get('k', 1_000, load)));
    expect(values.every((v) => v === 7)).toBe(true);
    expect(loads).toBe(1);
  });

  test('serves the stored value until it expires', async () => {
    let clock = 0;
    const cache = createReadCache(() => clock);
    let loads = 0;
    const load = async () => ++loads;
    expect(await cache.get('k', 100, load)).toBe(1);
    clock = 99;
    expect(await cache.get('k', 100, load)).toBe(1);
    clock = 100;
    expect(await cache.get('k', 100, load)).toBe(2);
  });

  test('a failed load is not cached', async () => {
    const cache = createReadCache();
    let calls = 0;
    const load = async () => {
      calls += 1;
      if (calls === 1) throw new Error('rate limited');
      return 'ok';
    };
    await expect(cache.get('k', 1_000, load)).rejects.toThrow('rate limited');
    expect(await cache.get('k', 1_000, load)).toBe('ok');
    expect(calls).toBe(2);
  });

  test('invalidate by prefix leaves other keys alone', async () => {
    const cache = createReadCache();
    cache.set('holdings:0xa', 1, 1_000);
    cache.set('holdings:0xb', 2, 1_000);
    cache.set('token:0xa', 3, 1_000);
    cache.invalidate('holdings:0xa');
    expect(cache.peek('holdings:0xa')).toBeUndefined();
    expect(cache.peek<number>('holdings:0xb')).toBe(2);
    expect(cache.peek<number>('token:0xa')).toBe(3);
    cache.invalidate();
    expect(cache.peek('token:0xa')).toBeUndefined();
  });

  test('a load finishing after invalidate is returned but not stored', async () => {
    const cache = createReadCache();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    const pending = cache.get('k', 1_000, async () => {
      await gate;
      return 'old';
    });
    cache.invalidate('k');
    release();
    expect(await pending).toBe('old');
    expect(cache.peek('k')).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------

const VAULT = '0x00000000000000000000000000000000000000a1';
const SETTLEMENT = '0x00000000000000000000000000000000000000b2';
const STOCKS = ['0x00000000000000000000000000000000000000a3', '0x00000000000000000000000000000000000000a4'];
const FEEDS = ['0x00000000000000000000000000000000000000f1', '0x00000000000000000000000000000000000000f2'];
const CHAIN_NOW = 2_000_000_000;

function countingCtx() {
  const calls: Record<string, number> = {};
  let block = 100n;
  let settlementBalance = 5_000_000n; // 5.00 at 6 decimals
  const chain = loadChainConfig({
    SPROUT_CHAIN_ID: '31337',
    SPROUT_RPC_URL: 'http://127.0.0.1:18545',
    SPROUT_FACTORY_ADDRESS: '0x00000000000000000000000000000000000000aa',
    SPROUT_SETTLEMENT_TOKEN: SETTLEMENT,
    SPROUT_VENUE_ADDRESS: '0x00000000000000000000000000000000000000bb',
    SPROUT_STOCK_TOKENS: STOCKS.map((a, i) => `S${i}:${a}:18:1000000000000000000:${FEEDS[i]}:86400`).join(','),
  });
  const count = (name: string) => {
    calls[name] = (calls[name] ?? 0) + 1;
  };
  const publicClient = {
    getBlock: async () => {
      count('getBlock');
      return { number: block, timestamp: BigInt(CHAIN_NOW) };
    },
    readContract: async ({ address, functionName }: { address: string; functionName: string }) => {
      count(functionName);
      const a = address.toLowerCase();
      switch (functionName) {
        case 'settlementToken':
          return SETTLEMENT;
        case 'decimals':
          return a === SETTLEMENT ? 6 : FEEDS.includes(a) ? 8 : 18;
        case 'balanceOf':
          return a === SETTLEMENT ? settlementBalance : 0n;
        case 'uiMultiplier':
          return 10n ** 18n;
        case 'oraclePaused':
          return false;
        case 'latestRoundData':
          return [1n, 100n * 10n ** 8n, BigInt(CHAIN_NOW), BigInt(CHAIN_NOW), 1n];
        default:
          throw new Error(`unexpected readContract ${functionName}`);
      }
    },
  };
  const ctx = {
    config: { chain, dbPath: ':memory:', port: 0, allowFixtures: true, useLocalKeys: true },
    publicClient,
    walletClient: null,
    walletAddress: null,
    walletIsAnvilDev: false,
  } as unknown as ChainContext;
  return {
    ctx,
    calls,
    total: () => Object.values(calls).reduce((a, b) => a + b, 0),
    mine: (balance: bigint) => {
      block += 1n;
      settlementBalance = balance;
    },
  };
}

describe('cached holdings', () => {
  test('a burst of requests for one vault costs one chain read', async () => {
    const t = countingCtx();
    const results = await Promise.all(Array.from({ length: 100 }, () => cachedHoldings(t.ctx, VAULT)));
    expect(results.every((r) => r.totalValueUsd === '500000000')).toBe(true);
    expect(t.calls.balanceOf).toBe(3); // settlement + two stocks, once
    expect(t.calls.getBlock).toBe(1);
  });

  test('token-level reads are shared and immutable ones are kept', async () => {
    const t = countingCtx();
    await readHoldings(t.ctx, VAULT);
    const first = t.total();
    await readHoldings(t.ctx, VAULT);
    // Second read: only the three balances are fetched again.
    expect(t.total() - first).toBe(3);
    expect(t.calls.settlementToken).toBe(1);
    // Settlement, the two stock tokens (valued by their own decimals) and the two feeds, once each.
    expect(t.calls.decimals).toBe(5);
  });

  test('afterBlock skips a cached response from an earlier block', async () => {
    const t = countingCtx();
    const before = await cachedHoldings(t.ctx, VAULT);
    expect(before.totalValueUsd).toBe('500000000');
    t.mine(15_000_000n); // a deposit confirms in block 101
    // Without afterBlock the cached response is still served...
    expect((await cachedHoldings(t.ctx, VAULT)).totalValueUsd).toBe('500000000');
    // ...with it, the new balance is read even though the TTL has not passed.
    const after = await cachedHoldings(t.ctx, VAULT, { afterBlock: 101 });
    expect(after.blockNumber).toBe(101);
    expect(after.totalValueUsd).toBe('1500000000');
  });

  test('an unreachable afterBlock cannot force a read on every request', async () => {
    const t = countingCtx();
    await cachedHoldings(t.ctx, VAULT);
    const baseline = t.calls.balanceOf!;
    await Promise.all(Array.from({ length: 20 }, () => cachedHoldings(t.ctx, VAULT, { afterBlock: 999_999 })));
    await cachedHoldings(t.ctx, VAULT, { afterBlock: 999_999 });
    // One forced re-read (three balances) for the whole burst.
    expect(t.calls.balanceOf! - baseline).toBe(3);
  });

  test('invalidation drops cached balances', async () => {
    const t = countingCtx();
    await cachedHoldings(t.ctx, VAULT);
    t.mine(0n);
    invalidateChainReads(t.ctx);
    expect((await cachedHoldings(t.ctx, VAULT)).totalValueUsd).toBe('0');
  });

  test('graduation is answered from the shared chain clock', async () => {
    const t = countingCtx();
    const results = await Promise.all([
      isGraduated(t.ctx, CHAIN_NOW - 1, 0),
      isGraduated(t.ctx, CHAIN_NOW, 0),
      isGraduated(t.ctx, CHAIN_NOW + 1, 0),
    ]);
    expect(results).toEqual([true, true, false]);
    expect(t.calls.getBlock).toBe(1);
    expect((await chainClock(t.ctx)).timestamp).toBe(CHAIN_NOW);
  });
});
