import { describe, expect, test } from 'bun:test';
import { tierAtLeast, wholeTokens, type Holder, type PerksInfo } from '../src/perks/holder';
import { HOLDER_BOUQUETS, holderBouquets, stockLockFor } from '../src/perks/locks';

const perks = (over: Partial<PerksInfo> = {}): PerksInfo => ({
  enabled: true,
  token: '0x5ec27c931fb49911128dddf7d914c1754da9f49f',
  tiers: [
    { id: 'seedling', min: '100000' },
    { id: 'sapling', min: '1000000' },
    { id: 'bloom', min: '5000000' },
    { id: 'grove', min: '10000000' },
  ],
  holdDays: 7,
  earlyAccess: { symbols: ['COIN', 'ORCL'], until: 2_000_000_000, tier: 'sapling' },
  autoInvestTier: 'bloom',
  ...over,
});
const holder = (tier: Holder['status'] extends infer S ? (S extends { tier: infer T } ? T : never) : never, p = perks()): Holder => ({
  perks: p,
  status: { address: '0x1', enabled: true, decimals: 18, balance: '0', heldBalance: '0', tier, currentTier: tier, holdDays: 7, holdSeconds: 604800, windowStart: 0, checkedAt: 0 },
});
const NOW = 1_900_000_000_000; // before the early-access date

describe('first dibs', () => {
  test('stocks in early access are locked below the tier, with a note', () => {
    const lock = stockLockFor(holder('seedling'), NOW)('coin');
    expect(lock.locked).toBe(true);
    expect(lock.note).toContain('COIN');
  });
  test('holders at the tier get them', () => {
    expect(stockLockFor(holder('sapling'), NOW)('COIN').locked).toBe(false);
    expect(stockLockFor(holder('grove'), NOW)('ORCL').locked).toBe(false);
  });
  test('stocks outside early access are never locked', () => {
    expect(stockLockFor(holder(null), NOW)('AAPL').locked).toBe(false);
  });
  test('everything opens after the date, or when perks are off', () => {
    expect(stockLockFor(holder(null), 2_000_000_001_000)('COIN').locked).toBe(false);
    expect(stockLockFor(holder(null, perks({ enabled: false })), NOW)('COIN').locked).toBe(false);
    expect(stockLockFor({ perks: null, status: null }, NOW)('COIN').locked).toBe(false);
  });
});

describe('holder bouquets', () => {
  const all = ['AAPL', 'NVDA', 'MSFT', 'SPY', 'TSLA', 'SPCX', 'AMZN', 'GOOGL', 'META', 'PLTR', 'AMD', 'TSM', 'MU', 'ASML', 'INTC', 'SNDK', 'BABA', 'QQQ', 'GME', 'SLV', 'USO'];
  test('bouquets are not copies of the free starter mixes', async () => {
    const { STARTER_MIXES } = await import('../src/components/StarterMixes');
    const key = (w: Record<string, number> | null) => JSON.stringify(Object.entries(w ?? {}).sort());
    const free = new Set(STARTER_MIXES.map((m) => key(m.weights)));
    for (const b of HOLDER_BOUQUETS) expect(free.has(key(b.weights))).toBe(false);
  });
  test('each bouquet has at most five stocks and adds up to 100', () => {
    for (const b of HOLDER_BOUQUETS) {
      expect(Object.keys(b.weights).length).toBeLessThanOrEqual(5);
      expect(Object.values(b.weights).reduce((a, x) => a + x, 0)).toBe(100);
      expect(Object.keys(b.weights).every((s) => all.includes(s))).toBe(true);
    }
  });
  test('only bouquets whose stocks are on this chain appear', () => {
    expect(holderBouquets(holder('seedling'), ['AAPL', 'NVDA', 'MSFT', 'SPY'])).toEqual([]);
    expect(holderBouquets(holder('seedling'), all).length).toBe(HOLDER_BOUQUETS.length);
  });
  test('locked for non-holders, open for holders, hidden when perks are off', () => {
    const locked = holderBouquets(holder(null), all);
    expect(locked.every((b) => b.locked)).toBe(true);
    expect(locked.filter((b) => b.lockNote).length).toBe(1);
    expect(holderBouquets(holder('seedling'), all).every((b) => !b.locked && !b.lockNote)).toBe(true);
    expect(holderBouquets(holder('bloom', perks({ enabled: false })), all)).toEqual([]);
  });
});

describe('helpers', () => {
  test('tier order', () => {
    expect(tierAtLeast('grove', 'bloom')).toBe(true);
    expect(tierAtLeast('seedling', 'sapling')).toBe(false);
    expect(tierAtLeast(null, 'seedling')).toBe(false);
  });
  test('whole tokens', () => {
    expect(wholeTokens((1_234_567n * 10n ** 18n + 5n).toString(), 18)).toBe('1,234,567');
  });
});
