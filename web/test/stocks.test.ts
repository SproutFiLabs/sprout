import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { KNOWN_SYMBOLS, STOCK_CATEGORIES, displayLabel, displayName, isKnownStock, stockInfo, stockMatches } from '../src/stocks';
import { STARTER_MIXES } from '../src/components/StarterMixes';
import { EXIT_TOKENS } from '../src/knowledge/sections.zh';
import { kidCompany } from '../src/KidView';
import { ZH } from '../src/i18n/zh';

const config = JSON.parse(readFileSync(join(import.meta.dir, '..', '..', 'config', 'stocks.json'), 'utf8')) as {
  settlement: string;
  stocks: Array<{ symbol: string; name: string; nameZh: string; token: string; decimals: number }>;
};

describe('stock catalogue', () => {
  test('knows every configured stock, by the same name, and nothing else', () => {
    expect([...KNOWN_SYMBOLS].sort()).toEqual(config.stocks.map((s) => s.symbol).sort());
    for (const s of config.stocks) {
      expect(isKnownStock(s.symbol)).toBe(true);
      expect(stockInfo(s.symbol).name).toBe(s.name);
      expect(stockInfo(s.symbol).description.length).toBeGreaterThan(0);
    }
  });

  test('Chinese names match the config, and every name, description and group is translated', () => {
    for (const s of config.stocks) expect([s.symbol, ZH[s.name]]).toEqual([s.symbol, s.nameZh]);
    const texts = [...KNOWN_SYMBOLS.flatMap((s) => [stockInfo(s).name, stockInfo(s).description]), ...STOCK_CATEGORIES];
    expect(texts.filter((text) => ZH[text] === undefined)).toEqual([]);
  });

  test('the kid view names every stock, in Chinese too', () => {
    expect(kidCompany('SPY')).toBe('500 big US companies');
    expect(kidCompany('SPCX')).toBe('SpaceX');
    expect(kidCompany('AAA')).toBeNull();
    const kidNames = KNOWN_SYMBOLS.map((s) => kidCompany(s)!);
    expect(kidNames.filter((k) => ZH[`${k}|holding`] === undefined && ZH[k] === undefined)).toEqual([]);
  });

  test('an unknown ticker is just its ticker', () => {
    expect(stockInfo('AAA')).toEqual({ symbol: 'AAA', name: 'AAA', description: '', category: 'Other' });
    expect(displayName('AAA')).toBeNull();
    expect(displayLabel('AAA')).toBe('AAA');
    expect(displayName('AMD')).toBeNull();
    expect(displayName('spcx')).toBe('SpaceX');
    expect(displayLabel('TSLA')).toBe('Tesla (TSLA)');
  });

  test('search matches ticker, name or description', () => {
    expect(stockMatches('SPCX', 'space')).toBe(true);
    expect(stockMatches('SPCX', 'starlink')).toBe(true);
    expect(stockMatches('QQQ', 'nasdaq')).toBe(true);
    expect(stockMatches('ASML', 'chips')).toBe(true);
    expect(stockMatches('TSLA', 'space')).toBe(true);
    expect(stockMatches('SLV', 'commod')).toBe(true);
    expect(stockMatches('AAPL', 'rocket')).toBe(false);
    expect(stockMatches('AAA', 'aa')).toBe(true);
    expect(stockMatches('AAA', '')).toBe(true);
  });

  test('starter mixes only name catalogued stocks', () => {
    for (const m of STARTER_MIXES) for (const symbol of Object.keys(m.weights ?? {})) expect([m.id, isKnownStock(symbol)]).toEqual([m.id, true]);
  });
});

describe('taking money out without Sprout', () => {
  test('lists USDG and every configured stock token with its address and decimals', () => {
    expect(EXIT_TOKENS[0]).toEqual({ symbol: 'USDG', address: config.settlement, decimals: 6 });
    expect(EXIT_TOKENS.slice(1)).toEqual(config.stocks.map((s) => ({ symbol: s.symbol, address: s.token, decimals: s.decimals })));
  });
});
