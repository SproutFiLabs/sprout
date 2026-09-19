import { describe, expect, test } from 'bun:test';
import type { PublicClient } from 'viem';
import { createHolderChecker, loadPerksConfig, requiredHoldSeconds, sampleBlocks, tierAtLeast, tierFor, type PerksConfig } from '../src/holders';

const TOKEN = '0x5ec27c931fb49911128dddf7d914c1754da9f49f';
const WALLET = '0x00000000000000000000000000000000000000aa';
const E18 = 10n ** 18n;

describe('perks config', () => {
  test('defaults: four tiers, a 7-day hold, nothing in early access, auto-invest for everyone', () => {
    const c = loadPerksConfig({ SPROUT_HOLDER_TOKEN: TOKEN });
    expect(c.token?.toLowerCase()).toBe(TOKEN);
    expect(c.tiers.map((t) => `${t.id}:${t.min}`)).toEqual(['seedling:100000', 'sapling:1000000', 'bloom:5000000', 'grove:10000000']);
    expect(c.holdDays).toBe(7);
    expect(c.earlyAccess).toEqual({ symbols: [], until: null, tier: 'sapling' });
    expect(c.autoInvestTier).toBeNull();
  });

  test('perks are off until SPROUT_HOLDER_TOKEN is set (the site\'s public CA is not assumed)', () => {
    expect(loadPerksConfig({}).token).toBeNull();
    expect(loadPerksConfig({ SPROUT_PUBLIC_CA: TOKEN }).token).toBeNull();
  });

  test('bad settings fail loudly', () => {
    expect(() => loadPerksConfig({ SPROUT_HOLDER_TOKEN: TOKEN, SPROUT_HOLDER_TIERS: 'seedling:5,sapling:1' })).toThrow();
    expect(() => loadPerksConfig({ SPROUT_HOLDER_TOKEN: TOKEN, SPROUT_HOLDER_TIERS: 'oak:5' })).toThrow();
    expect(() => loadPerksConfig({ SPROUT_HOLDER_TOKEN: TOKEN, SPROUT_EARLY_ACCESS_SYMBOLS: 'COIN' })).toThrow();
    expect(() => loadPerksConfig({ SPROUT_HOLDER_TOKEN: TOKEN, SPROUT_AUTOINVEST_TIER: 'gold' })).toThrow();
    expect(() => loadPerksConfig({ SPROUT_HOLDER_TOKEN: 'nope' })).toThrow();
  });

  test('early access reads symbols and a date', () => {
    const c = loadPerksConfig({ SPROUT_HOLDER_TOKEN: TOKEN, SPROUT_EARLY_ACCESS_SYMBOLS: 'coin, orcl', SPROUT_EARLY_ACCESS_UNTIL: '2026-10-01T00:00:00Z', SPROUT_EARLY_ACCESS_TIER: 'bloom' });
    expect(c.earlyAccess).toEqual({ symbols: ['COIN', 'ORCL'], until: Math.floor(Date.parse('2026-10-01T00:00:00Z') / 1000), tier: 'bloom' });
  });
});

describe('tiers', () => {
  const tiers = loadPerksConfig({ SPROUT_HOLDER_TOKEN: TOKEN }).tiers;
  test('the highest tier the amount reaches', () => {
    expect(tierFor(99_999n * E18, 18, tiers)).toBeNull();
    expect(tierFor(100_000n * E18, 18, tiers)).toBe('seedling');
    expect(tierFor(4_999_999n * E18, 18, tiers)).toBe('sapling');
    expect(tierFor(50_000_000n * E18, 18, tiers)).toBe('grove');
  });
  test('tierAtLeast', () => {
    expect(tierAtLeast('bloom', 'sapling')).toBe(true);
    expect(tierAtLeast('seedling', 'sapling')).toBe(false);
    expect(tierAtLeast(null, 'seedling')).toBe(false);
  });
  test('samples run from the head back to the window start', () => {
    expect(sampleBlocks(1000n, 700n, 100n)).toEqual([1000n, 900n, 800n, 700n]);
    expect(sampleBlocks(1000n, 1000n, 100n)).toEqual([1000n]);
  });
});

/** A chain where the token launched at block 500 and the wallet's balance changes over time. */
function fakeClient(balanceAt: (block: bigint) => bigint, calls: { n: number } = { n: 0 }): PublicClient {
  const head = 10_000_000n;
  return {
    async readContract(args: { functionName: string; blockNumber?: bigint }) {
      calls.n++;
      if (args.functionName === 'decimals') return 18;
      return balanceAt(args.blockNumber ?? head);
    },
    async getCode({ blockNumber }: { blockNumber: bigint }) {
      return blockNumber >= 500n ? '0x60' : undefined;
    },
    async getBlock(args?: { blockNumber?: bigint }) {
      const n = args?.blockNumber ?? head;
      return { number: n, timestamp: n / 10n }; // 10 blocks a second
    },
  } as unknown as PublicClient;
}

describe('holder checker', () => {
  const config: PerksConfig = loadPerksConfig({ SPROUT_HOLDER_TOKEN: TOKEN });

  test('a balance held all week earns its tier', async () => {
    const s = await createHolderChecker(fakeClient(() => 2_000_000n * E18), config).status(WALLET);
    expect(s.tier).toBe('sapling');
    expect(s.currentTier).toBe('sapling');
  });

  test('a balance bought an hour ago only shows what it will unlock', async () => {
    const head = 10_000_000n;
    const s = await createHolderChecker(fakeClient((b) => (b > head - 36_000n ? 20_000_000n * E18 : 0n)), config).status(WALLET);
    expect(s.tier).toBeNull();
    expect(s.currentTier).toBe('grove');
  });

  test('selling part-way through the week counts the lowest balance', async () => {
    const head = 10_000_000n;
    const s = await createHolderChecker(fakeClient((b) => (b > head - 2_000_000n ? 6_000_000n * E18 : 200_000n * E18)), config).status(WALLET);
    expect(s.tier).toBe('seedling');
    expect(s.currentTier).toBe('bloom');
  });

  test('while the token is younger than the hold, 24 hours of holding is enough', async () => {
    // Head is 1,000,000 s after launch (about 11.5 days): younger than a 30-day hold.
    const head = 10_000_000n;
    const young = { ...config, holdDays: 30 };
    const boughtTwoDaysAgo = (b: bigint) => (b > head - 1_728_000n ? 1_000_000n * E18 : 0n);
    const s = await createHolderChecker(fakeClient(boughtTwoDaysAgo), young).status(WALLET);
    expect(s.holdSeconds).toBe(86_400);
    expect(s.tier).toBe('sapling');
    const boughtAnHourAgo = (b: bigint) => (b > head - 36_000n ? 1_000_000n * E18 : 0n);
    expect((await createHolderChecker(fakeClient(boughtAnHourAgo), young).status(WALLET)).tier).toBeNull();
  });

  test('the hold is the full period once the token is old enough', () => {
    expect(requiredHoldSeconds(7, 3 * 86_400)).toBe(86_400);
    expect(requiredHoldSeconds(7, 8 * 86_400)).toBe(7 * 86_400);
    expect(requiredHoldSeconds(0, 0)).toBe(0);
  });

  test('results are cached for ten minutes', async () => {
    const calls = { n: 0 };
    let now = 1_000_000;
    const checker = createHolderChecker(fakeClient(() => 1n, calls), config, () => now);
    await checker.status(WALLET);
    const first = calls.n;
    await checker.status(WALLET);
    expect(calls.n).toBe(first);
    now += 11 * 60 * 1000;
    await checker.status(WALLET);
    expect(calls.n).toBeGreaterThan(first);
  });

  test('off without a token', async () => {
    const s = await createHolderChecker(null, loadPerksConfig({})).status(WALLET);
    expect(s.enabled).toBe(false);
    expect(s.tier).toBeNull();
  });
});
