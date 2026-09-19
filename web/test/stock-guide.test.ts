import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { KNOWN_SYMBOLS } from '../src/stocks';
import { STARTER_MIXES } from '../src/components/StarterMixes';
import { HOLDER_BOUQUETS } from '../src/perks/locks';
import { ZH } from '../src/i18n/zh';
import { zh as guideZh } from '../src/i18n/zh/stocks-guide';
import { KIND_HEADING, KIND_INTRO, KIND_LABEL, PROFILES, THEMES, profileOf } from '../src/stockGuide/profiles';
import { GUIDE, guideStrings } from '../src/stockGuide/content';
import { SPREAD_LABELS, SPREAD_REASONS, spreadReading, spreadText, type MixPick } from '../src/stockGuide/diversification';
import { BUMPINESS_LABEL, MIN_MOVES, bumpiness, levelFor, type ClosePoint } from '../src/stockGuide/bumpiness';
import { basketIndex } from '../src/stockGuide/basketIndex';
import { allBaskets, basketFromMix, basketTheme, basketsWith, findBasket } from '../src/stockGuide/baskets';
import { parseGuidePath } from '../src/stockGuide/routes';
import { prefillQuestion } from '../src/intelligence/prefill';

const config = JSON.parse(readFileSync(join(import.meta.dir, '..', '..', 'config', 'stocks.json'), 'utf8')) as {
  stocks: Array<{ symbol: string; registryName: string }>;
};
const configured = config.stocks.map((s) => s.symbol).sort();
const mix = (weights: Record<string, number>): MixPick[] => Object.entries(weights).map(([symbol, weight]) => ({ symbol, weight }));

describe('theme data', () => {
  test('every configured stock has exactly one profile and one guide entry', () => {
    expect(Object.keys(PROFILES).sort()).toEqual(configured);
    expect(Object.keys(GUIDE).sort()).toEqual(configured);
    expect([...KNOWN_SYMBOLS].sort()).toEqual(configured);
  });

  test('funds are the funds, and say what is inside', () => {
    const byKind = (kind: string) => Object.entries(PROFILES).filter(([, p]) => p.kind === kind).map(([s]) => s).sort();
    expect(byKind('index-fund')).toEqual(['QQQ', 'SPY']);
    expect(byKind('commodity-fund')).toEqual(['SLV', 'USO']);
    expect(byKind('company')).toHaveLength(configured.length - 4);
    for (const s of ['SPY', 'QQQ', 'SLV', 'USO']) expect(GUIDE[s]!.inside?.length).toBeGreaterThan(10);
    expect(PROFILES.SPY!.companies).toBe(500);
    expect(PROFILES.QQQ!.companies).toBe(100);
    for (const [symbol, p] of Object.entries(PROFILES)) if (p.kind !== 'index-fund') expect([symbol, p.companies]).toEqual([symbol, 1]);
  });

  test('themes group the stocks the way the guide describes them', () => {
    const inTheme = (theme: string) => Object.entries(PROFILES).filter(([, p]) => p.theme === theme).map(([s]) => s).sort();
    expect(inTheme('chips')).toEqual(['AMD', 'ASML', 'INTC', 'MU', 'NVDA', 'SNDK', 'TSM']);
    expect(inTheme('big-tech')).toEqual(['AAPL', 'AMZN', 'GOOGL', 'META', 'MSFT']);
    expect(inTheme('space-ev')).toEqual(['SPCX', 'TSLA']);
    expect(inTheme('commodities')).toEqual(['SLV', 'USO']);
    expect(inTheme('broad-market')).toEqual(['SPY']);
    expect(profileOf('baba')?.theme).toBe('china');
    expect(profileOf('AAA')).toBeNull();
  });

  test('every guide entry has a kids line and what moves it', () => {
    for (const [symbol, e] of Object.entries(GUIDE)) {
      expect([symbol, e.what.length > 60]).toEqual([symbol, true]);
      expect([symbol, e.kids.length > 10]).toEqual([symbol, true]);
      expect([symbol, e.drivers.length >= 3]).toEqual([symbol, true]);
    }
  });

  test('SPCX quotes the registry’s own name for what the token follows', () => {
    const spcx = config.stocks.find((s) => s.symbol === 'SPCX')!;
    expect(GUIDE.SPCX!.registry).toBe(spcx.registryName);
    expect(GUIDE.SPCX!.note).toContain('{registry}');
  });

  test('the guide makes no predictions or recommendations', () => {
    // "buy" alone is fine ("how many iPhones people buy"); telling a parent what to do is not.
    const banned = /\b(you should|should buy|buy now|a good buy|will (rise|grow|go up|double)|guaranteed?|safe bet|best (stock|investment|pick)|good investment|bad investment|can[’']?t lose)\b/i;
    const texts = [...guideStrings(), ...Object.values(SPREAD_REASONS), ...Object.keys(guideZh)];
    expect(texts.filter((s) => banned.test(s))).toEqual([]);
  });
});

describe('Chinese for the stock guide', () => {
  test('every guide string has a translation that keeps its placeholders', () => {
    const texts = [
      ...guideStrings(),
      ...Object.values(THEMES).flatMap((th) => [th.label, th.lower]),
      ...Object.values(KIND_LABEL),
      ...Object.values(KIND_HEADING),
      ...Object.values(KIND_INTRO),
      ...SPREAD_LABELS,
      ...Object.values(SPREAD_REASONS),
      ...Object.values(BUMPINESS_LABEL),
    ];
    expect(texts.filter((text) => ZH[text] === undefined)).toEqual([]);
    const holes = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join(',');
    expect(texts.filter((text) => holes(text) !== holes(ZH[text]!))).toEqual([]);
  });

  test('the new dictionary does not quietly change another area’s translation', () => {
    const clashes = Object.keys(guideZh).filter((k) => ZH[k] !== guideZh[k]);
    expect(clashes).toEqual([]);
  });
});

describe('diversification meter', () => {
  const read = (weights: Record<string, number>) => {
    const r = spreadReading(mix(weights))!;
    return { level: r.level, ...spreadText(r) };
  };

  test('a broad index fund at half or more reads Spread out', () => {
    expect(read({ SPY: 100 })).toEqual({ level: 3, label: 'Spread out', sentence: 'SPY alone holds about 500 large US companies.' });
    expect(read({ SPY: 60, QQQ: 40 })).toEqual({ level: 3, label: 'Spread out', sentence: '60% is in SPY, which holds about 500 large US companies.' });
  });

  test('one company, or one commodity, is Concentrated', () => {
    expect(read({ NVDA: 100 })).toMatchObject({ level: 0, label: 'Concentrated', sentence: 'Everything is in one company.' });
    expect(read({ USO: 100 })).toMatchObject({ level: 0, sentence: 'Everything follows the price of one commodity.' });
    expect(read({ QQQ: 100 })).toMatchObject({ level: 2, sentence: 'QQQ alone holds about 100 companies, many of them in tech.' });
  });

  test('theme concentration', () => {
    expect(read({ NVDA: 20, TSM: 20, AMD: 20, ASML: 20, MU: 20 })).toMatchObject({ level: 0, sentence: 'All in one theme: chips.' });
    expect(read({ AAPL: 20, MSFT: 20, NVDA: 20, GOOGL: 20, AMZN: 20 })).toMatchObject({ level: 0, sentence: '80% is in one theme: big tech.' });
    expect(read({ TSLA: 25, SPCX: 25, PLTR: 20, AMD: 15, MU: 15 })).toMatchObject({ level: 1, label: 'Fairly concentrated', sentence: '50% is in one theme: space and electric cars.' });
    expect(read({ NVDA: 30, PLTR: 20, MSFT: 20, META: 15, TSM: 15 })).toMatchObject({ level: 1, sentence: 'All in tech companies: chips, software or big tech.' });
  });

  test('some SPY, or many themes, reads Fairly spread', () => {
    expect(read({ SLV: 40, SPY: 40, QQQ: 20 })).toMatchObject({ level: 2, label: 'Fairly spread', sentence: '40% is in SPY, which holds about 500 large US companies.' });
    expect(read({ QQQ: 60, SLV: 40 })).toMatchObject({ level: 2, sentence: '60% is in QQQ, which holds about 100 companies, many of them in tech.' });
    expect(read({ AAPL: 25, TSLA: 25, GME: 25, SLV: 25 })).toMatchObject({ level: 2, sentence: '4 holdings across 4 themes.' });
    expect(read({ AAPL: 34, TSLA: 33, SLV: 33 })).toMatchObject({ level: 1, sentence: '3 holdings across 3 themes.' });
  });

  test('before any percentage is typed, each pick counts equally; unknown tickers get no reading', () => {
    expect(spreadReading(mix({ SPY: 0, NVDA: 0 }))!.level).toBe(3);
    expect(spreadReading(mix({ NVDA: 0, AMD: 0 }))!.reason).toBe(SPREAD_REASONS.allOneTheme);
    expect(spreadReading(mix({ AAA: 60, BBB: 40 }))).toBeNull();
    expect(spreadReading([])).toBeNull();
  });

  test('every starter mix and bouquet gets a reading', () => {
    for (const b of allBaskets()) expect([b.id, spreadReading(b.weights) !== null]).toEqual([b.id, true]);
  });
});

describe('bumpiness', () => {
  const series = (values: number[]): ClosePoint[] => values.map((value, i) => ({ date: `2026-07-${String(i + 1).padStart(2, '0')}`, value }));

  test('typical daily move is the median size of the day-to-day changes', () => {
    const b = bumpiness(series([100, 101, 99.99, 100.99, 100]))!;
    // moves: +1%, -1%, +1%, -0.98...%: median of the sizes is ~1%
    expect(b.moves).toBe(4);
    expect(b.typicalMove).toBeCloseTo(0.01, 3);
    expect(b.change).toBeCloseTo(0, 6);
    expect(b.level).toBeNull(); // fewer than MIN_MOVES
  });

  test('biggest fall from a high has its dates', () => {
    const b = bumpiness(series([100, 120, 90, 110, 60, 80]))!;
    expect(b.biggestFall).toEqual({ fraction: 0.5, from: '2026-07-02', to: '2026-07-05' });
    expect(bumpiness(series([1, 2, 3]))!.biggestFall).toBeNull();
  });

  test('labels: under 1% Calm, 1% to 2% Bumpy, 2% or more Very bumpy', () => {
    expect(levelFor(0.005)).toBe('calm');
    expect(levelFor(0.0099)).toBe('calm');
    expect(levelFor(0.01)).toBe('bumpy');
    expect(levelFor(0.0199)).toBe('bumpy');
    expect(levelFor(0.02)).toBe('very-bumpy');
    const calm = Array.from({ length: MIN_MOVES + 1 }, (_, i) => 100 * (i % 2 ? 1.004 : 1));
    expect(bumpiness(series(calm))!.level).toBe('calm');
  });

  test('too little data is no reading at all', () => {
    expect(bumpiness(series([100]))).toBeNull();
    expect(bumpiness([])).toBeNull();
  });
});

describe('basket index', () => {
  const closes = (from: number, values: number[]): ClosePoint[] => values.map((value, i) => ({ date: `2026-07-${String(from + i).padStart(2, '0')}`, value }));

  test('buy and hold from 100, weighted by target weights, never rebalanced', () => {
    const idx = basketIndex([
      { symbol: 'AAA', weight: 60, closes: closes(1, [10, 20, 10]) },
      { symbol: 'BBB', weight: 40, closes: closes(1, [50, 50, 100]) },
    ])!;
    expect(idx.points.map((p) => p.value)).toEqual([100, 160, 140]);
    expect([idx.from, idx.to, idx.shorter, idx.skippedDays]).toEqual(['2026-07-01', '2026-07-03', [], 0]);
  });

  test('charts only the overlap, and names the holding that starts later', () => {
    const idx = basketIndex([
      { symbol: 'OLD', weight: 50, closes: closes(1, [10, 11, 12, 13, 14]) },
      { symbol: 'NEW', weight: 50, closes: closes(3, [20, 22, 24]) },
    ])!;
    expect(idx.from).toBe('2026-07-03');
    expect(idx.shorter).toEqual(['NEW']);
    expect(idx.points[0]!.value).toBe(100);
  });

  test('skips days a holding has no close, and gives up without two shared days', () => {
    const idx = basketIndex([
      { symbol: 'A', weight: 1, closes: [{ date: '2026-07-01', value: 1 }, { date: '2026-07-02', value: 2 }, { date: '2026-07-03', value: 3 }] },
      { symbol: 'B', weight: 1, closes: [{ date: '2026-07-01', value: 1 }, { date: '2026-07-03', value: 1 }] },
    ])!;
    expect(idx.points.map((p) => p.date)).toEqual(['2026-07-01', '2026-07-03']);
    expect(idx.skippedDays).toBe(1);
    expect(basketIndex([{ symbol: 'A', weight: 1, closes: closes(1, [5]) }])).toBeNull();
    expect(basketIndex([])).toBeNull();
  });
});

describe('Sprout baskets', () => {
  test('every named starter mix and every holder bouquet is a basket; the even split is not', () => {
    const ids = allBaskets().map((b) => b.id);
    expect(ids).toEqual([...STARTER_MIXES.filter((m) => m.weights).map((m) => m.id), ...HOLDER_BOUQUETS.map((b) => b.id)]);
    expect(ids).not.toContain('even');
    expect(findBasket('chips')?.source).toBe('starter');
    expect(findBasket('moonshots')?.tier).toBe('seedling');
    expect(findBasket('nope')).toBeNull();
  });

  test('reads code, theme and tier when a mix has them, and falls back to the label', () => {
    const b = basketFromMix({ id: 'x', label: 'Chips', note: 'n', weights: { NVDA: 50, AMD: 50 }, code: 'SPRT-CHIPS', theme: 'chips', tier: 'bloom' }, 'holder')!;
    expect([b.code, b.theme, b.tier]).toEqual(['SPRT-CHIPS', 'chips', 'bloom']);
    expect(basketTheme(b)).toEqual({ themeId: 'chips', text: 'Chips' });
    const plain = basketFromMix({ id: 'y', label: 'Mine', note: 'n', weights: { SPY: 100 } }, 'starter')!;
    expect([plain.code, plain.theme, plain.tier]).toEqual([null, null, null]);
    expect(basketTheme(plain)).toEqual({ themeId: 'broad-market', text: 'Broad market' });
    expect(basketTheme(basketFromMix({ id: 'z', label: 'Z', note: '', weights: { SPY: 34, AAPL: 33, SLV: 33 } }, 'starter')!)).toBeNull();
    expect(basketFromMix({ id: 'e', label: 'Even', note: '', weights: null }, 'starter')).toBeNull();
    expect(findBasket('x')).toBeNull();
  });

  test('baskets holding a stock, with its weight', () => {
    const spcx = basketsWith('spcx').map((x) => [x.basket.id, x.weight]);
    expect(spcx).toEqual([['space', 30], ['moonshots', 25], ['wild-card', 20]]);
  });
});

describe('routes and links', () => {
  test('guide paths', () => {
    expect(parseGuidePath('/stocks')).toEqual({ page: 'index' });
    expect(parseGuidePath('/stocks/')).toEqual({ page: 'index' });
    expect(parseGuidePath('/stocks/nvda')).toEqual({ page: 'stock', symbol: 'NVDA' });
    expect(parseGuidePath('/stocks/basket/chips')).toEqual({ page: 'basket', id: 'chips' });
    expect(parseGuidePath('/stocks/basket/unknown')).toEqual({ page: 'missing' });
    expect(parseGuidePath('/stocks/AAA')).toEqual({ page: 'missing' });
    expect(parseGuidePath('/stocks/NVDA/extra')).toEqual({ page: 'missing' });
  });

  test('Intelligence takes a question from ?q= and only prefills it', () => {
    expect(prefillQuestion('?q=' + encodeURIComponent('  What is SPY?  '))).toBe('What is SPY?');
    expect(prefillQuestion('')).toBe('');
    expect(prefillQuestion('?q=' + 'a'.repeat(3000))).toHaveLength(2500);
  });
});
