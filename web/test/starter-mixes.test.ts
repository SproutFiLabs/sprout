import { describe, expect, test } from 'bun:test';
import { STARTER_MIXES, mixPercents } from '../src/components/StarterMixes';

const mainnet = ['AAPL', 'NVDA', 'MSFT', 'SPY'].map((symbol, i) => ({ symbol, address: `0x${i}` }));
const local = ['AAA', 'BBB'].map((symbol, i) => ({ symbol, address: `0x${i}` }));
const mix = (id: string) => STARTER_MIXES.find((m) => m.id === id)!;
const total = (p: Record<string, string>) => Object.values(p).reduce((n, v) => n + Number(v), 0);

describe('starter mixes', () => {
  test('every mix that fits the mainnet stocks totals exactly 100', () => {
    for (const m of STARTER_MIXES) {
      const p = mixPercents(m, mainnet);
      expect(p).not.toBeNull();
      expect(total(p!)).toBe(100);
    }
  });

  test('an even split hands the remainder to the first stocks', () => {
    expect(mixPercents(mix('even'), mainnet)).toEqual({ '0x0': '25', '0x1': '25', '0x2': '25', '0x3': '25' });
    expect(mixPercents(mix('even'), mainnet.slice(0, 3))).toEqual({ '0x0': '34', '0x1': '33', '0x2': '33' });
    expect(mixPercents(mix('even'), local)).toEqual({ '0x0': '50', '0x1': '50' });
  });

  test('named mixes are hidden where their stocks are not admitted', () => {
    expect(mixPercents(mix('index'), local)).toBeNull();
    expect(mixPercents(mix('companies'), mainnet.slice(0, 3))).toBeNull();
    expect(mixPercents(mix('index'), mainnet)).toEqual({ '0x0': '10', '0x1': '10', '0x2': '10', '0x3': '70' });
  });
});
