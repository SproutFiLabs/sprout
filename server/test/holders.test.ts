import { describe, expect, test } from 'bun:test';
import type { PublicClient } from 'viem';
import { createHolderChecker, loadPerksConfig, sampleBlocks, tierAtLeast, tierFor, type PerksConfig } from '../src/holders';

const TOKEN = '0x5ec27c931fb49911128dddf7d914c1754da9f49f';
const WALLET = '0x00000000000000000000000000000000000000aa';
const E18 = 10n ** 18n;

describe('perks config', () => {
  test('defaults: four tiers, a 7-day hold, nothing in early access, auto-invest for everyone', () => {
    const c = loadPerksConfig({}, TOKEN);
    expect(c.token?.toLowerCase()).toBe(TOKEN);
    expect(c.tiers.map((t) => `${t.id}:${t.min}`)).toEqual(['seedling:100000', 'sapling:1000000', 'bloom:5000000', 'grove:10000000']);
    expect(c.holdDays).toBe(7);
    expect(c.earlyAccess).toEqual({ symbols: [], until: null, tier: 'sapling' });
    expect(c.autoInvestTier).toBeNull();
  });

  test('perks are off without a 0x token (a base58 CA does not count)', () => {
    expect(loadPerksConfig({}, undefined).token).toBeNull();
    expect(loadPerksConfig({}, '7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU').token).toBeNull();
  });

  test('bad settings fail loudly', () => {
    expect(() => loadPerksConfig({ SPROUT_HOLDER_TIERS: 'seedling:5,sapling:1' }, TOKEN)).toThrow();
    expect(() => loadPerksConfig({ SPROUT_HOLDER_TIERS: 'oak:5' }, TOKEN)).toThrow();
    expect(() => loadPerksConfig({ SPROUT_EARLY_ACCESS_SYMBOLS: 'COIN' }, TOKEN)).toThrow();
    expect(() => loadPerksConfig({ SPROUT_AUTOINVEST_TIER: 'gold' }, TOKEN)).toThrow();
    expect(() => loadPerksConfig({ SPROUT_HOLDER_TOKEN: 'nope' }, TOKEN)).toThrow();
  });

  test('early access reads symbols and a date', () => {
    const c = loadPerksConfig({ SPROUT_EARLY_ACCESS_SYMBOLS: 'coin, orcl', SPROUT_EARLY_ACCESS_UNTIL: '2026-10-01T00:00:00Z', SPROUT_EARLY_ACCESS_TIER: 'bloom' }, TOKEN);
    expect(c.earlyAccess).toEqual({ symbols: ['COIN', 'ORCL'], until: Math.floor(Date.parse('2026-10-01T00:00:00Z') / 1000), tier: 'bloom' });
  });
});

describe('tiers', () => {
  const tiers = loadPerksConfig({}, TOKEN).tiers;
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
  const config: PerksConfig = loadPerksConfig({}, TOKEN);

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

  test('a token younger than the hold window counts from launch', async () => {
    const young = { ...config, holdDays: 30 };
    const client = fakeClient(() => 1_000_000n * E18);
    const s = await createHolderChecker(client, young).status(WALLET);
    expect(s.tier).toBe('sapling');
    expect(s.windowStart).toBe(50); // block 500 at 10 blocks a second
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
    const s = await createHolderChecker(null, loadPerksConfig({}, undefined)).status(WALLET);
    expect(s.enabled).toBe(false);
    expect(s.tier).toBeNull();
  });
});
