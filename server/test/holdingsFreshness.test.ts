import { describe, expect, test } from 'bun:test';
import { loadChainConfig } from '@sprout/shared';
import type { ChainContext } from '../src/chain';
import { readHoldings } from '../src/chain';

const VAULT = '0x00000000000000000000000000000000000000a1';
const SETTLEMENT = '0x00000000000000000000000000000000000000b2';
const STOCK = '0x00000000000000000000000000000000000000a3';
const FEED = '0x00000000000000000000000000000000000000f1';

// A chain clock far ahead of wall time, as happens after the local demo advances
// time. The feed is refreshed against this clock, so valuation must use it too.
const CHAIN_NOW = 2_000_000_000; // ~2033, well beyond Date.now()

function freshCtx(opts: { feedUpdatedAt: number; feedAnswer?: bigint }): ChainContext {
  const chain = loadChainConfig({
    SPROUT_CHAIN_ID: '31337',
    SPROUT_RPC_URL: 'http://127.0.0.1:18545',
    SPROUT_FACTORY_ADDRESS: '0x00000000000000000000000000000000000000aa',
    SPROUT_SETTLEMENT_TOKEN: SETTLEMENT,
    SPROUT_VENUE_ADDRESS: '0x00000000000000000000000000000000000000bb',
    SPROUT_STOCK_TOKENS: `AAA:${STOCK}:18:1000000000000000000:${FEED}:86400`,
  });
  const publicClient = {
    getBlock: async () => ({ number: 42n, timestamp: BigInt(CHAIN_NOW) }),
    getBlockNumber: async () => 42n,
    readContract: async ({ address, functionName }: { address: string; functionName: string }) => {
      const a = address.toLowerCase();
      switch (functionName) {
        case 'parent':
          return '0x00000000000000000000000000000000000000c1';
        case 'beneficiary':
          return '0x00000000000000000000000000000000000000c2';
        case 'settlementToken':
          return SETTLEMENT;
        case 'graduationTimestamp':
          return 2_100_000_000n;
        case 'assets':
          return [STOCK];
        case 'weights':
          return [10000];
        case 'graduated':
          return false;
        case 'decimals':
          return a === SETTLEMENT.toLowerCase() ? 6 : a === FEED.toLowerCase() ? 8 : 18;
        case 'balanceOf':
          return a === SETTLEMENT.toLowerCase() ? 0n : 1_000_000_000_000_000_000n; // 1.0 stock
        case 'uiMultiplier':
          return 10n ** 18n;
        case 'oraclePaused':
          throw new Error('oraclePaused not exposed');
        case 'latestRoundData':
          return [1n, opts.feedAnswer ?? 100n * 10n ** 8n, BigInt(CHAIN_NOW), BigInt(opts.feedUpdatedAt), 1n];
        default:
          throw new Error(`unexpected readContract ${functionName}`);
      }
    },
  };
  return {
    config: {
      chain,
      dbPath: ':memory:',
      port: 0,
      allowFixtures: true,
      useLocalKeys: true,
    },
    publicClient,
    walletClient: null,
    walletAddress: null,
    walletIsAnvilDev: false,
  } as unknown as ChainContext;
}

describe('valuation freshness uses the chain clock', () => {
  test('refreshed feed stays valued after advancing past wall time', async () => {
    const snapshot = await readHoldings(freshCtx({ feedUpdatedAt: CHAIN_NOW }), VAULT as `0x${string}`);
    expect(snapshot.available).toBe(true);
    expect(snapshot.totalValueUsd).toBe('10000000000'); // 1.0 AAA at $100, 8-decimal USD
    expect(snapshot.holdings.find((h) => h.symbol === 'AAA')?.status).toBe('ok');
  });

  test('a genuinely stale feed stays unavailable', async () => {
    const snapshot = await readHoldings(freshCtx({ feedUpdatedAt: CHAIN_NOW - 10 * 86400 }), VAULT as `0x${string}`);
    expect(snapshot.available).toBe(false);
    expect(snapshot.totalValueUsd).toBeNull();
    expect(snapshot.reason).toContain('AAA (stale)');
  });

  test('a feed timestamped in the future is rejected', async () => {
    const snapshot = await readHoldings(freshCtx({ feedUpdatedAt: CHAIN_NOW + 60 }), VAULT as `0x${string}`);
    expect(snapshot.available).toBe(false);
    expect(snapshot.holdings.find((h) => h.symbol === 'AAA')?.status).toBe('stale');
  });

  test('a nonpositive price fails closed', async () => {
    const snapshot = await readHoldings(freshCtx({ feedUpdatedAt: CHAIN_NOW, feedAnswer: 0n }), VAULT as `0x${string}`);
    expect(snapshot.available).toBe(false);
    expect(snapshot.holdings.find((h) => h.symbol === 'AAA')?.status).toBe('missing-feed');
  });
});
