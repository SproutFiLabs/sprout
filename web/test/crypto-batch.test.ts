import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { formatQuantity, isCryptoSymbol, tokenValueUsd, formatUsd } from '@sprout/shared';
import { assetDecimals, parseAssetAmount } from '../src/assetUnits';
import { holdingSharesText, choreRewardText } from '../src/garden/format';
import { buyingLabel, blockerText } from '../src/components/InvestNow';
import { NEWEST_SYMBOLS, STOCK_CATEGORIES, stockInfo, stockMatches } from '../src/stocks';
import { STARTER_MIXES, mixPercents } from '../src/components/StarterMixes';
import { HOLDER_BOUQUETS, holderBouquets } from '../src/perks/locks';
import { allBaskets, basketTheme, basketsWith } from '../src/stockGuide/baskets';
import { spreadReading, spreadText } from '../src/stockGuide/diversification';
import { ZH } from '../src/i18n/zh';
import { zh as cryptoZh } from '../src/i18n/zh/crypto';
import type { Holder } from '../src/perks/holder';

const config = JSON.parse(readFileSync(join(import.meta.dir, '..', '..', 'config', 'stocks.json'), 'utf8')) as {
  settlement: string;
  stocks: Array<{ symbol: string; token: string; decimals: number }>;
};
const all = config.stocks.map((s) => ({ symbol: s.symbol, address: s.token }));
// The second factory's 21 stocks: no crypto, no Circle, no Treasury bills.
const secondFactory = all.filter((s) => !NEWEST_SYMBOLS.includes(s.symbol));
const token = (symbol: string) => config.stocks.find((s) => s.symbol === symbol)!;
const contracts = {
  settlementToken: config.settlement,
  settlementDecimals: 6,
  stockTokens: config.stocks.map((s) => ({ address: s.token, decimals: s.decimals })),
};

describe('an 8-decimal asset (CBBTC) is entered, displayed and valued by its own decimals', () => {
  test('the config says CBBTC has 8 decimals and every other asset 18', () => {
    expect(token('CBBTC').decimals).toBe(8);
    expect(config.stocks.filter((s) => s.symbol !== 'CBBTC').every((s) => s.decimals === 18)).toBe(true);
  });

  test('typed amounts are parsed with the token’s decimals', () => {
    expect(assetDecimals(contracts, token('CBBTC').token)).toBe(8);
    expect(assetDecimals(contracts, token('CBBTC').token.toLowerCase())).toBe(8);
    expect(parseAssetAmount(contracts, token('CBBTC').token, '0.001')).toBe(100_000n);
    expect(parseAssetAmount(contracts, token('CBBTC').token, '1')).toBe(100_000_000n);
    expect(parseAssetAmount(contracts, token('WETH').token, '0.5')).toBe(500_000_000_000_000_000n);
    expect(parseAssetAmount(contracts, config.settlement, '5')).toBe(5_000_000n);
    expect(parseAssetAmount(contracts, token('CBBTC').token, ' ')).toBe(0n);
    expect(() => parseAssetAmount(contracts, token('CBBTC').token, 'abc')).toThrow();
  });

  test('small Bitcoin holdings keep their digits', () => {
    // $30 and $500 of CBBTC from the fork rehearsal (raw 36761 and 611691 at 8 decimals).
    // At least four significant digits, up to the token's 8 decimals.
    expect(formatQuantity(36_761n, 8)).toBe('0.0003676');
    expect(formatQuantity(611_691n, 8)).toBe('0.006116');
    expect(formatQuantity(1_227n, 8)).toBe('0.00001227');
    expect(formatQuantity(123_456_789n, 8)).toBe('1.2345');
    expect(formatQuantity(0n, 8)).toBe('0');
    expect(holdingSharesText({ shareEquivalent: '36761', rawBalance: '36761', decimals: 8 })).toBe('0.0003676');
    expect(formatQuantity(1n, 8)).toBe('0.00000001');
    // 18-decimal stocks read as before.
    expect(formatQuantity(150_000_000_000_000_000n, 18)).toBe('0.15');
    expect(formatQuantity(4_120_000_000_000_000_000n, 18)).toBe('4.12');
    expect(holdingSharesText({ shareEquivalent: '150000000000000000', rawBalance: '150000000000000000', decimals: 18 })).toBe('0.15');
    // A chore reward of 0.0001 CBBTC is not shown as 0.
    expect(choreRewardText({ amount: '10000', isSample: false, decimals: 8, symbol: 'CBBTC' })).toBe('+ 0.0001 CBBTC');
  });

  test('value = balance x price / 10^decimals: 0.00036761 CBBTC at $81,465.50 is about $29.95', () => {
    const price = 8_146_550_220_179n; // CBBTC/USD, 8 decimals
    const value = tokenValueUsd(36_761n, price, 8);
    expect(formatUsd(value, 8)).toBe('$29.94');
    // The old hard-coded 18 would have valued it at a ten-billionth of that.
    expect(tokenValueUsd(36_761n, price, 18)).toBe(0n);
  });
});

describe('crypto wording', () => {
  test('crypto is WETH and CBBTC; Circle is a company', () => {
    expect(['WETH', 'cbbtc', 'CBBTC'].map(isCryptoSymbol)).toEqual([true, true, true]);
    expect(['CRCL', 'SGOV', 'AAPL', '', null].map((s) => isCryptoSymbol(s as string))).toEqual([false, false, false, false, false]);
  });

  test('the buying line says what is being bought', () => {
    expect(buyingLabel(['AAPL', 'SPY'])).toBe('Buying stock tokens');
    expect(buyingLabel(['CBBTC', 'WETH'])).toBe('Buying crypto tokens');
    expect(buyingLabel(['CBBTC', 'SGOV'])).toBe('Buying stock and crypto tokens');
    for (const label of ['Buying stock tokens', 'Buying crypto tokens', 'Buying stock and crypto tokens']) expect(ZH[label]).toBeTruthy();
  });

  test('a stale crypto price does not blame closed US markets, and both messages translate', () => {
    const stock = 'The AAPL price has not updated recently, so buying is paused to protect the price you get. This usually means US markets are closed; try again once they reopen.';
    const coin = 'The CBBTC price has not updated recently, so buying is paused to protect the price you get. Crypto prices normally update around the clock, so try again in a little while.';
    expect(blockerText({ code: 'stale-price', message: stock })).toBe(stock);
    expect(blockerText({ code: 'stale-price', message: coin })).toBe(coin);
    expect(ZH[coin.replace('CBBTC', '{symbol}')]).toContain('全天候');
  });
});

describe('the catalogue and baskets', () => {
  test('Crypto and Cash-like groups in the picker', () => {
    expect(STOCK_CATEGORIES).toContain('Crypto');
    expect(STOCK_CATEGORIES).toContain('Cash-like');
    expect(['WETH', 'CBBTC', 'CRCL'].map((s) => stockInfo(s).category)).toEqual(['Crypto', 'Crypto', 'Crypto']);
    expect(stockInfo('SGOV').category).toBe('Cash-like');
    expect(stockMatches('CBBTC', 'bitcoin')).toBe(true);
    expect(stockMatches('CBBTC', 'coinbase')).toBe(true);
    expect(stockMatches('WETH', 'ethereum')).toBe(true);
    expect(stockMatches('SGOV', 'treasury')).toBe(true);
    expect(stockMatches('CRCL', 'usdc')).toBe(true);
  });

  test('the new baskets: SPRT-BTC and SPRT-CASH for everyone, SPRT-COIN for holders', () => {
    const btc = STARTER_MIXES.find((m) => m.code === 'SPRT-BTC')!;
    expect([btc.label, btc.weights, btc.theme]).toEqual(['Bitcoin & Ethereum', { CBBTC: 50, WETH: 50 }, 'Crypto']);
    const cash = STARTER_MIXES.find((m) => m.code === 'SPRT-CASH')!;
    expect([cash.label, cash.weights]).toEqual(['Cash-like', { SGOV: 100 }]);
    const coin = HOLDER_BOUQUETS.find((b) => b.code === 'SPRT-COIN')!;
    expect([coin.label, coin.weights, coin.tier]).toEqual(['Crypto & Circle', { CBBTC: 40, WETH: 30, CRCL: 30 }, 'seedling']);
    for (const b of [btc, cash, coin]) {
      const weights = Object.values(b.weights!);
      expect(weights.length).toBeLessThanOrEqual(5);
      expect(weights.reduce((a, w) => a + w, 0)).toBe(100);
      expect(weights.every((w) => Number.isInteger(w))).toBe(true);
    }
    expect(basketsWith('CBBTC').map((x) => [x.basket.code, x.weight])).toEqual([['SPRT-BTC', 50], ['SPRT-COIN', 40]]);
    expect(basketTheme(allBaskets().find((b) => b.code === 'SPRT-BTC')!)?.text).toBe('Crypto');
  });

  test('baskets with the new assets only show for sprouts whose factory admits them', () => {
    const btc = STARTER_MIXES.find((m) => m.id === 'bitcoin-ethereum')!;
    const cash = STARTER_MIXES.find((m) => m.id === 'cash-like')!;
    expect(mixPercents(btc, secondFactory, [])).toBeNull();
    expect(mixPercents(cash, secondFactory, [])).toBeNull();
    expect(mixPercents(btc, all, [])!.percents).toEqual({ [token('CBBTC').token]: '50', [token('WETH').token]: '50' });
    const holder: Holder = {
      perks: { enabled: true, token: '0x5ec27c931fb49911128dddf7d914c1754da9f49f', tiers: [{ id: 'seedling', min: '1' }], holdDays: 7, earlyAccess: null, autoInvestTier: null } as never,
      status: { address: '0x1', enabled: true, decimals: 18, balance: '0', heldBalance: '0', tier: 'seedling', currentTier: 'seedling', holdDays: 7, holdSeconds: 604800, windowStart: 0, checkedAt: 0 },
    };
    expect(holderBouquets(holder, secondFactory.map((s) => s.symbol)).map((b) => b.id)).not.toContain('bouquet-crypto-circle');
    expect(holderBouquets(holder, all.map((s) => s.symbol)).map((b) => b.id)).toContain('bouquet-crypto-circle');
  });

  test('the diversification meter reads crypto and Treasury bills', () => {
    const read = (w: Record<string, number>) => spreadText(spreadReading(Object.entries(w).map(([symbol, weight]) => ({ symbol, weight })))!).sentence;
    expect(read({ CBBTC: 50, WETH: 50 })).toBe('All in one theme: crypto.');
    expect(read({ CBBTC: 100 })).toBe('Everything is in one crypto coin.');
    expect(read({ SGOV: 100 })).toBe('Everything is in US Treasury bills: short loans to one borrower, the US government.');
    expect(read({ CBBTC: 40, WETH: 30, CRCL: 30 })).toBe('All in one theme: crypto.');
  });

  test('the crypto dictionary does not quietly change another area’s translation', async () => {
    // zh/crypto.ts is spread last into ZH, so compare it with every other area directly.
    const areas = ['core', 'app', 'dashboard', 'landing', 'kid', 'knowledge', 'components', 'perks', 'votes', 'autoinvest', 'guardian', 'guardian-view', 'privacy', 'intelligence', 'harvest', 'root', 'stocks-guide', 'privacy-pack'];
    const others: Record<string, string> = {};
    for (const area of areas) Object.assign(others, ((await import(`../src/i18n/zh/${area}`)) as { zh: Record<string, string> }).zh);
    expect(Object.keys(cryptoZh).filter((k) => others[k] !== undefined && others[k] !== cryptoZh[k])).toEqual([]);
    expect(Object.keys(cryptoZh).every((k) => ZH[k] === cryptoZh[k])).toBe(true);
  });
});
