import { describe, expect, test } from 'bun:test';
import { cadenceLabel, holdingSharesText } from '../src/garden/format';
import { HOLDINGS } from '../src/sampleData';

/**
 * Regression: the live holdings API returns `shareEquivalent`/`rawBalance` as
 * integer base units scaled by the token decimals. The holdings table used to
 * render that field verbatim, so a 0.15 stock holding displayed as
 * "150000000000000000". The shared formatter must divide base units back down.
 */
describe('holding share display', () => {
  test('live stock base units are divided by token decimals', () => {
    expect(holdingSharesText({ shareEquivalent: '150000000000000000', rawBalance: '150000000000000000', decimals: 18 }))
      .toBe('0.15');
    expect(holdingSharesText({ shareEquivalent: '2000000000000000000', rawBalance: '2000000000000000000', decimals: 18 }))
      .toBe('2');
  });

  test('live settlement base units use the settlement decimals', () => {
    expect(holdingSharesText({ shareEquivalent: '975000000', rawBalance: '975000000', decimals: 6 })).toBe('975');
  });

  test('missing shareEquivalent falls back to the raw balance', () => {
    expect(holdingSharesText({ shareEquivalent: null, rawBalance: '4120000000000000000', decimals: 18 })).toBe('4.12');
  });

  test('sample fixture stores base units and displays the approved quantities', () => {
    const bySymbol = Object.fromEntries(
      HOLDINGS.holdings.map((h) => [h.symbol, holdingSharesText({ shareEquivalent: h.shareEquivalent, rawBalance: h.rawBalance, decimals: h.decimals })]),
    );
    expect(bySymbol).toEqual({ AAPL: '4.12', NVDA: '2.08', MSFT: '3.06', SPY: '1.24' });
  });

  test('malformed input degrades to an em dash instead of throwing', () => {
    expect(holdingSharesText({ shareEquivalent: 'not-a-number', rawBalance: '0', decimals: 18 })).toBe('—');
  });
});

/**
 * Regression/safeguard: a fixed number of days is not a calendar period. Only
 * exact 1/7/14-day schedules get a named cadence; 30/90/365-day fixed schedules
 * must stay explicit so the plan does not imply a movable calendar month/year.
 */
describe('weekly plan cadence labels', () => {
  const days = (n: number) => n * 86400;
  test('exact day/week/two-week periods get a readable name', () => {
    expect(cadenceLabel(days(1))).toBe('day');
    expect(cadenceLabel(days(7))).toBe('week');
    expect(cadenceLabel(days(14))).toBe('2 weeks');
  });

  test('fixed 30/90/365-day schedules stay explicit, never month/quarter/year', () => {
    expect(cadenceLabel(days(30))).toBe('30 days');
    expect(cadenceLabel(days(31))).toBe('31 days');
    expect(cadenceLabel(days(90))).toBe('90 days');
    expect(cadenceLabel(days(365))).toBe('365 days');
  });
});
