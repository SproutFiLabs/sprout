import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { TIER_ORDER, tierAtLeast, tierLabel, wholeTokens, type Holder, type PerksInfo, type TierId } from '../src/perks/holder';
import { HOLDER_BOUQUETS, bouquetCount, bouquetTier, bouquetsByTier, holderBouquets, stockLockFor } from '../src/perks/locks';
import { MAX_STOCKS } from '../src/stocks';
import { ZH } from '../src/i18n/zh';

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
  // The stocks the factory admits: every bouquet must be pickable from these.
  const all = (JSON.parse(readFileSync(join(import.meta.dir, '..', '..', 'config', 'stocks.json'), 'utf8')) as { stocks: Array<{ symbol: string }> }).stocks.map((s) => s.symbol);
  const key = (w: Record<string, number> | null) => JSON.stringify(Object.entries(w ?? {}).sort());
  const byId = new Map(HOLDER_BOUQUETS.map((b) => [`bouquet-${b.id}`, b]));

  test('the admitted list is the 25 assets of the third factory', () => {
    expect(all.length).toBe(25);
  });

  test('bouquets are not copies of the free starter mixes, or of each other', async () => {
    const { STARTER_MIXES } = await import('../src/components/StarterMixes');
    const free = new Set(STARTER_MIXES.map((m) => key(m.weights)));
    for (const b of HOLDER_BOUQUETS) expect(free.has(key(b.weights))).toBe(false);
    expect(new Set(HOLDER_BOUQUETS.map((b) => key(b.weights))).size).toBe(HOLDER_BOUQUETS.length);
    expect(new Set(HOLDER_BOUQUETS.map((b) => b.id)).size).toBe(HOLDER_BOUQUETS.length);
    expect(new Set(HOLDER_BOUQUETS.map((b) => b.label)).size).toBe(HOLDER_BOUQUETS.length);
  });

  test('each bouquet holds at most five admitted stocks in whole percentages adding up to 100', () => {
    for (const b of HOLDER_BOUQUETS) {
      const weights = Object.values(b.weights);
      expect([b.id, Object.keys(b.weights).length <= MAX_STOCKS]).toEqual([b.id, true]);
      expect([b.id, weights.reduce((a, x) => a + x, 0)]).toEqual([b.id, 100]);
      expect([b.id, weights.every((w) => Number.isInteger(w) && w > 0)]).toEqual([b.id, true]);
      expect([b.id, Object.keys(b.weights).filter((s) => !all.includes(s))]).toEqual([b.id, []]);
    }
  });

  test('every tier unlocks bouquets of its own, and keeps the ones below', () => {
    const groups = bouquetsByTier(TIER_ORDER);
    expect(groups.map((g) => g.tier)).toEqual([...TIER_ORDER]);
    expect(groups.flatMap((g) => g.bouquets).length).toBe(HOLDER_BOUQUETS.length);
    const counts = TIER_ORDER.map((tier) => bouquetCount(tier, TIER_ORDER));
    for (let i = 1; i < counts.length; i++) expect(counts[i]!).toBeGreaterThan(counts[i - 1]!);
    expect(counts.at(-1)).toBe(HOLDER_BOUQUETS.length);
  });

  test('every bouquet name and note has Chinese, and a note never promises a return', () => {
    for (const b of HOLDER_BOUQUETS) {
      expect([b.label, ZH[b.label] !== undefined]).toEqual([b.label, true]);
      expect([b.note, ZH[b.note] !== undefined]).toEqual([b.note, true]);
      expect(b.note).not.toMatch(/guarantee|safe|can’t lose|will grow|always/i);
    }
  });

  test('every basket, public or holder, has a unique id, a unique SPRT- code and a theme with Chinese', async () => {
    const { STARTER_MIXES, basketHref } = await import('../src/components/StarterMixes');
    const baskets = [...STARTER_MIXES.filter((m) => m.weights !== null), ...HOLDER_BOUQUETS];
    // The even split is not a fixed basket, so it has no code.
    expect(STARTER_MIXES.find((m) => m.weights === null)!.code).toBeUndefined();
    const ids = [...STARTER_MIXES, ...HOLDER_BOUQUETS].map((b) => b.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const b of baskets) {
      expect([b.id, b.code]).toEqual([b.id, expect.stringMatching(/^SPRT-[A-Z0-9]+$/)]);
      expect([b.id, b.code!.length <= 10]).toEqual([b.id, true]);
      expect([b.id, b.theme !== undefined && ZH[b.theme] !== undefined]).toEqual([b.id, true]);
      expect(basketHref(b.id)).toBe(`/stocks/basket/${b.id}`);
    }
    expect(new Set(baskets.map((b) => b.code)).size).toBe(baskets.length);
  });

  test('the picker gets each holder basket’s code, theme and own id for its factsheet', () => {
    for (const b of holderBouquets(holder('grove'), all)) {
      const source = byId.get(b.id)!;
      expect(b).toMatchObject({ code: source.code, theme: source.theme, basketId: source.id });
    }
  });

  test('only bouquets whose stocks are on this chain appear', () => {
    expect(holderBouquets(holder('seedling'), ['AAPL', 'NVDA', 'MSFT', 'SPY'])).toEqual([]);
    expect(holderBouquets(holder('seedling'), all).length).toBe(HOLDER_BOUQUETS.length);
  });

  test('each bouquet is locked below its tier, with a note that names that tier', () => {
    for (const tier of [null, ...TIER_ORDER] as Array<TierId | null>) {
      for (const b of holderBouquets(holder(tier), all)) {
        const need = byId.get(b.id)!.tier;
        const open = tierAtLeast(tier, need);
        expect([b.id, tier, b.locked]).toEqual([b.id, tier, !open]);
        expect([b.id, tier, b.lockNote]).toEqual([b.id, tier, open ? undefined : `For SPROUT holders (${tierLabel(need)} and up).`]);
      }
    }
    // A Seedling holder has the first five and sees the rest locked at Sapling, Bloom and Grove.
    const seedling = holderBouquets(holder('seedling'), all);
    expect(seedling.filter((b) => !b.locked).map((b) => b.id)).toEqual(['bouquet-moonshots', 'bouquet-ai-builders', 'bouquet-brands', 'bouquet-crypto-circle', 'bouquet-silver-lining']);
    expect(new Set(seedling.filter((b) => b.locked).map((b) => b.lockNote))).toEqual(
      new Set((['sapling', 'bloom', 'grove'] as const).map((x) => `For SPROUT holders (${tierLabel(x)} and up).`)),
    );
    expect(holderBouquets(holder('grove'), all).every((b) => !b.locked && !b.lockNote)).toBe(true);
    expect(holderBouquets(holder('bloom', perks({ enabled: false })), all)).toEqual([]);
  });

  test('a tier the server leaves out passes its bouquets up, or hides them when nothing is above', () => {
    const noSapling = perks({ tiers: [{ id: 'seedling', min: '100000' }, { id: 'bloom', min: '5000000' }, { id: 'grove', min: '10000000' }] });
    const chips = HOLDER_BOUQUETS.find((b) => b.tier === 'sapling')!;
    expect(bouquetTier(chips, ['seedling', 'bloom', 'grove'])).toBe('bloom');
    const seen = holderBouquets(holder('seedling', noSapling), all).find((b) => b.id === `bouquet-${chips.id}`)!;
    expect(seen.lockNote).toBe(`For SPROUT holders (${tierLabel('bloom')} and up).`);

    const noGrove = perks({ tiers: [{ id: 'seedling', min: '100000' }, { id: 'sapling', min: '1000000' }, { id: 'bloom', min: '5000000' }] });
    const shown = holderBouquets(holder('bloom', noGrove), all);
    expect(shown.every((b) => !b.locked)).toBe(true);
    expect(shown.some((b) => byId.get(b.id)!.tier === 'grove')).toBe(false);
    expect(bouquetsByTier(['seedling', 'sapling', 'bloom']).map((g) => g.tier)).toEqual(['seedling', 'sapling', 'bloom']);
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
