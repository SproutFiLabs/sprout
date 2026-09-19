import { afterAll, describe, expect, test } from 'bun:test';
import { ROBINHOOD_BURN_ROUTE, minOutFor } from '@sprout/shared';
import { burnAmount, burnCounter, burnFloor, burnOfferWanted, readBurnOptIn, slippageLabel, sproutText, usdText, writeBurnOptIn, type BurnSummaryInfo } from '../src/perks/burn';

const E18 = 10n ** 18n;
const CONFIG = { minUsd: 1, maxUsd: 500, route: { usdgDecimals: 6 } };

describe('the quote and its floor', () => {
  test('the floor is the quote less 3%, rounded down, the same as the server signs', () => {
    // The $5 quote from the mainnet-fork rehearsal: 40,445.93 SPROUT.
    const quoted = 40_445_925_164_698_883_147_164n;
    expect(burnFloor(quoted, 300)).toBe((quoted * 9_700n) / 10_000n);
    expect(burnFloor(quoted.toString(), 300)).toBe(minOutFor(quoted, 300));
    expect(burnFloor(1_000n, 300)).toBe(970n);
    expect(burnFloor(999n, 300)).toBe(969n); // never rounds the floor up
    expect(burnFloor(100n * E18, 50)).toBe(995n * 10n ** 17n);
    expect(() => burnFloor(1n, 10_000)).toThrow();
  });

  test('labels', () => {
    expect(slippageLabel(300)).toBe('3%');
    expect(slippageLabel(250)).toBe('2.5%');
    expect(sproutText(40_445_925_164_698_883_147_164n, 18)).toBe('40,445');
    expect(usdText(5_000_000n, 6)).toBe('5');
    expect(usdText(12_500_000n, 6)).toBe('12.50');
    expect(usdText('500000000', 6)).toBe('500');
  });

  test('amounts: the chips, and custom dollars within the server’s limits', () => {
    expect([1, 5, 20].map((p) => burnAmount(String(p), CONFIG))).toEqual([1_000_000n, 5_000_000n, 20_000_000n]);
    expect(burnAmount('12.50', CONFIG)).toBe(12_500_000n);
    expect(burnAmount('$7', CONFIG)).toBe(7_000_000n);
    expect(burnAmount('0.99', CONFIG)).toBeNull();
    expect(burnAmount('500.01', CONFIG)).toBeNull();
    expect(burnAmount('1.005', CONFIG)).toBeNull();
    expect(burnAmount('', CONFIG)).toBeNull();
    expect(burnAmount('-5', CONFIG)).toBeNull();
    expect(burnAmount('150', { ...CONFIG, maxUsd: 100 })).toBeNull();
  });

  test('the route the browser signs is the verified Robinhood Chain one', () => {
    expect(ROBINHOOD_BURN_ROUTE.chainId).toBe(4663);
    expect(ROBINHOOD_BURN_ROUTE.router).toBe('0x8876789976dEcBfCbBbe364623C63652db8C0904');
    expect(ROBINHOOD_BURN_ROUTE.sproutPool).toMatchObject({ currency0: '0x0000000000000000000000000000000000000000', fee: 0, tickSpacing: 200 });
  });
});

describe('the counter', () => {
  const summary = (over: Partial<BurnSummaryInfo> = {}): BurnSummaryInfo => ({
    enabled: true,
    token: ROBINHOOD_BURN_ROUTE.sprout,
    decimals: 18,
    usdgDecimals: 6,
    deadAddress: '0x000000000000000000000000000000000000dEaD',
    count: 2,
    sproutBurned: (202_481n * E18).toString(),
    usdgSpent: '25000000',
    latest: [],
    deadBalance: (81_360_803n * E18).toString(),
    asOf: 0,
    ...over,
  });
  test('via Sprout, and everything ever burned', () => {
    expect(burnCounter(summary())).toEqual({ viaSprout: '202,481', total: '81.3M', count: 2 });
    expect(burnCounter(summary({ deadBalance: null }))).toEqual({ viaSprout: '202,481', total: null, count: 2 });
    expect(burnCounter(summary({ sproutBurned: '0', count: 0 }))).toEqual({ viaSprout: '0', total: '81.3M', count: 0 });
    expect(burnCounter(null)).toBeNull();
  });
});

describe('"Add a $1 burn to my buys"', () => {
  const store = new Map<string, string>();
  let broken = false;
  Object.assign(globalThis, {
    window: {
      localStorage: {
        getItem: (k: string) => {
          if (broken) throw new Error('blocked');
          return store.get(k) ?? null;
        },
        setItem: (k: string, v: string) => {
          if (broken) throw new Error('blocked');
          store.set(k, v);
        },
        removeItem: (k: string) => void store.delete(k),
      },
    },
  });
  const fetchBefore = globalThis.fetch;
  afterAll(() => {
    delete (globalThis as Record<string, unknown>).window;
    globalThis.fetch = fetchBefore;
  });

  test('off by default, remembered per device, and never an error when storage is blocked', () => {
    expect(readBurnOptIn()).toBe(false);
    writeBurnOptIn(true);
    expect(store.get('sprout.burn.afterBuys')).toBe('1');
    expect(readBurnOptIn()).toBe(true);
    writeBurnOptIn(false);
    expect(readBurnOptIn()).toBe(false);
    expect(store.has('sprout.burn.afterBuys')).toBe(false);
    broken = true;
    expect(() => writeBurnOptIn(true)).not.toThrow();
    expect(readBurnOptIn()).toBe(true); // kept for this page
    writeBurnOptIn(false);
    broken = false;
  });

  test('offered only when opted in and the server has burns on', async () => {
    let enabled = true;
    globalThis.fetch = (async () => new Response(JSON.stringify(enabled ? { enabled: true, chainId: 4663 } : { enabled: false }))) as unknown as typeof fetch;
    expect(await burnOfferWanted(4663)).toBe(false); // not opted in
    writeBurnOptIn(true);
    expect(await burnOfferWanted(4663)).toBe(true);
    expect(await burnOfferWanted(31337)).toBe(false); // a wallet on another chain
    enabled = false;
    writeBurnOptIn(false);
    expect(await burnOfferWanted(4663)).toBe(false);
  });
});

describe('wording', () => {
  test('"buy & burn" and "burn" only: no price talk, gains or returns, in either language; voluntary and not advice', async () => {
    const { zh } = await import('../src/i18n/zh/burn');
    const english = Object.keys(zh).join('\n').toLowerCase();
    const chinese = Object.values(zh).join('\n');
    expect(english).not.toMatch(
      /\b(number go(es)? up|pump(s|ed|ing)?|moon|deflation(ary)?|returns?|yield(s|ing)?|earn(s|ed|ing|ings)?|gains?|profit(s|able)?|investment|apprecia(te|tion)|scarc(e|ity)|go(es)? up|rise|rising|destroy|buy-?backs?|reward(s)?|stak(e|ing))\b/,
    );
    expect(chinese).not.toMatch(/收益|回报|赚|利润|升值|增值|上涨|暴涨|拉盘|通缩|奖励|月球|质押|回购/);
    const note = 'This buys SPROUT on the open market with your USDG and burns it for good. It’s voluntary, it pays you nothing, and it’s not advice.';
    expect(zh[note]).toContain('不构成投资建议');
    expect(zh[note]).toContain('自愿');
    expect(english).toContain('buy & burn');
  });
});
