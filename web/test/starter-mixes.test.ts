import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { STARTER_MIXES, lockLines, mixPercents, starterMixOptions, type ExtraMix } from '../src/components/StarterMixes';
import { ZH } from '../src/i18n/zh';
import { MAX_STOCKS, initialPicks, pickAvailability, pickedTokens } from '../src/components/StockPicker';

const config = JSON.parse(readFileSync(join(import.meta.dir, '..', '..', 'config', 'stocks.json'), 'utf8')) as {
  stocks: Array<{ symbol: string; token: string }>;
};
const all = config.stocks.map((s) => ({ symbol: s.symbol, address: s.token }));
const legacy = all.filter((s) => ['AAPL', 'NVDA', 'MSFT', 'SPY'].includes(s.symbol));
const local = ['AAA', 'BBB'].map((symbol, i) => ({ symbol, address: `0x${i}` }));
const bySymbol = (...symbols: string[]) => symbols.map((s) => all.find((a) => a.symbol === s)!);
const mix = (id: string) => STARTER_MIXES.find((m) => m.id === id)!;
const total = (p: Record<string, string>) => Object.values(p).reduce((n, v) => n + Number(v), 0);

describe('starter mixes', () => {
  test('every named mix holds at most 5 configured stocks and totals exactly 100', () => {
    for (const m of STARTER_MIXES.filter((m) => m.weights !== null)) {
      const choice = mixPercents(m, all, []);
      expect(choice).not.toBeNull();
      expect(choice!.selected.length).toBeLessThanOrEqual(MAX_STOCKS);
      expect(total(choice!.percents)).toBe(100);
    }
  });

  test('no two mixes are the same, and every name and note has Chinese', () => {
    const key = (w: Record<string, number> | null) => JSON.stringify(Object.entries(w ?? {}).sort());
    expect(new Set(STARTER_MIXES.map((m) => key(m.weights))).size).toBe(STARTER_MIXES.length);
    for (const m of STARTER_MIXES) expect([m.label, ZH[m.label] !== undefined, ZH[m.note] !== undefined]).toEqual([m.label, true, true]);
  });

  test('a named mix picks its stocks and fills their shares', () => {
    const choice = mixPercents(mix('space'), all, [])!;
    expect(choice.selected).toEqual(bySymbol('SPCX', 'TSLA', 'NVDA', 'PLTR', 'QQQ').map((s) => s.address));
    expect(choice.percents).toEqual(Object.fromEntries(bySymbol('SPCX', 'TSLA', 'NVDA', 'PLTR', 'QQQ').map((s, i) => [s.address, String([30, 25, 20, 15, 10][i])])));
    expect(mixPercents(mix('market'), all, [])!.percents).toEqual({ [bySymbol('SPY')[0]!.address]: '60', [bySymbol('QQQ')[0]!.address]: '40' });
    // Spread out: two funds, two companies and silver.
    expect(mixPercents(mix('spread'), all, [])!.selected).toEqual(bySymbol('SPY', 'QQQ', 'NVDA', 'AMZN', 'SLV').map((s) => s.address));
  });

  test('an even split shares out whatever is picked, the remainder to the first picks', () => {
    expect(mixPercents(mix('even'), all, [])).toBeNull();
    expect(mixPercents(mix('even'), local, local)!.percents).toEqual({ '0x0': '50', '0x1': '50' });
    const three = bySymbol('SPCX', 'TSLA', 'GME');
    expect(mixPercents(mix('even'), all, three)).toEqual({
      selected: three.map((s) => s.address),
      percents: Object.fromEntries(three.map((s, i) => [s.address, i === 0 ? '34' : '33'])),
    });
  });

  test('named mixes are hidden where any of their stocks is not admitted', () => {
    for (const m of STARTER_MIXES.filter((m) => m.weights !== null)) expect(mixPercents(m, local, local)).toBeNull();
    // Older sprouts were admitted the original four: only the S&P-led mix fits them.
    const fit = STARTER_MIXES.filter((m) => m.weights !== null && mixPercents(m, legacy, legacy) !== null).map((m) => m.id);
    expect(fit).toEqual(['index']);
  });
});

describe('stock picks', () => {
  test('five or fewer stocks to choose from start all picked', () => {
    expect(initialPicks(local)).toEqual(['0x0', '0x1']);
    expect(initialPicks(legacy)).toEqual(legacy.map((s) => s.address));
  });

  test('with more to choose from, the current mix starts picked and nothing else', () => {
    expect(initialPicks(all)).toEqual([]);
    const current = bySymbol('TSLA', 'SPY').map((s) => s.address.toLowerCase());
    expect(initialPicks(all, current)).toEqual(current);
    expect(initialPicks(all, ['0x000000000000000000000000000000000000dead'])).toEqual([]);
  });

  test('picks outside the candidates are dropped, in pick order', () => {
    const picks = [bySymbol('GME')[0]!.address, '0xnope', bySymbol('AAPL')[0]!.address];
    expect(pickedTokens(all, picks).map((s) => s.symbol)).toEqual(['GME', 'AAPL']);
    expect(pickedTokens(legacy, picks).map((s) => s.symbol)).toEqual(['AAPL']);
  });
});

describe('locked stocks and mixes', () => {
  const lockGme = (symbol: string) => (symbol === 'GME' ? { locked: true, note: 'Unlocks later.' } : { locked: false });

  test('nothing is locked by default', () => {
    expect(pickAvailability('GME', false, false)).toEqual({ locked: false, note: null, disabled: false });
    expect(starterMixOptions(all, []).every((o) => !o.locked)).toBe(true);
  });

  test('a locked stock cannot be picked, but a picked one can still be removed', () => {
    expect(pickAvailability('GME', false, false, lockGme)).toEqual({ locked: true, note: 'Unlocks later.', disabled: true });
    expect(pickAvailability('GME', true, false, lockGme)).toEqual({ locked: true, note: 'Unlocks later.', disabled: false });
    expect(pickAvailability('TSLA', false, false, lockGme).disabled).toBe(false);
  });

  test('past five picks only picked stocks stay clickable', () => {
    expect(pickAvailability('TSLA', false, true).disabled).toBe(true);
    expect(pickAvailability('TSLA', true, true).disabled).toBe(false);
  });

  test('extra mixes come after the built-in ones; locked ones carry their note', () => {
    const extras: ExtraMix[] = [
      { id: 'fun', label: 'Just for fun', note: 'GameStop and SpaceX.', weights: { GME: 50, SPCX: 50 }, locked: true, lockNote: 'Unlocks later.' },
      { id: 'metals', label: 'Metals', note: 'Silver.', weights: { SLV: 100 } },
      { id: 'too-big', label: 'Too big', note: '', weights: { AAPL: 10, MSFT: 10, NVDA: 10, GOOGL: 10, AMZN: 10, META: 50 } },
    ];
    const options = starterMixOptions(all, [], extras);
    expect(options.map((o) => o.mix.id).slice(-2)).toEqual(['fun', 'metals']);
    expect(options.find((o) => o.mix.id === 'fun')).toMatchObject({ locked: true, lockNote: 'Unlocks later.' });
    expect(options.find((o) => o.mix.id === 'metals')).toMatchObject({ locked: false, lockNote: null });
    // Older sprouts can't hold silver, so the mix isn't offered to them at all.
    expect(starterMixOptions(legacy, legacy, extras).map((o) => o.mix.id)).toEqual(['even', 'index']);
  });

  test('mixes locked for the same reason share one note line, in row order', () => {
    const extras: ExtraMix[] = [
      { id: 'a', label: 'A', note: '', weights: { GME: 100 }, locked: true, lockNote: 'For Sapling and up.' },
      { id: 'b', label: 'B', note: '', weights: { SLV: 100 }, locked: true, lockNote: 'For Bloom and up.' },
      { id: 'c', label: 'C', note: '', weights: { USO: 100 }, locked: true, lockNote: 'For Sapling and up.' },
      { id: 'd', label: 'D', note: '', weights: { SNDK: 100 } },
    ];
    expect(lockLines(starterMixOptions(all, [], extras))).toEqual([
      { ids: ['a', 'c'], labels: ['A', 'C'], note: 'For Sapling and up.' },
      { ids: ['b'], labels: ['B'], note: 'For Bloom and up.' },
    ]);
    expect(lockLines(starterMixOptions(all, []))).toEqual([]);
  });

  test('a mix naming a locked stock is locked too, with that stock’s note; the even split never is', () => {
    const extras: ExtraMix[] = [{ id: 'fun', label: 'Just for fun', note: '', weights: { GME: 50, SPCX: 50 } }];
    const options = starterMixOptions(all, bySymbol('GME'), extras, lockGme);
    expect(options.find((o) => o.mix.id === 'fun')).toMatchObject({ locked: true, lockNote: 'Unlocks later.' });
    expect(options.find((o) => o.mix.id === 'even')!.locked).toBe(false);
    expect(options.find((o) => o.mix.id === 'space')!.locked).toBe(false);
  });
});
