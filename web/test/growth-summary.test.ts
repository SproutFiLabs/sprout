import { describe, expect, test } from 'bun:test';
import {
  growthSummary, putInAt, putInSteps, signedPercentText, signedUsdText, usd8ToNumber, usdText,
} from '../src/garden/growthSummary';
import { HOLDINGS, SAMPLE_LAST, SAMPLE_NOW, buildGrowth } from '../src/sampleData';

const USD = (dollars: number) => (BigInt(Math.round(dollars * 100)) * 10n ** 6n).toString();
const totals = (inUsd: number, outUsd: number) => ({ inUsd: USD(inUsd), outUsd: USD(outUsd), netUsd: USD(inUsd - outUsd) });

describe('put in vs. worth summary', () => {
  test('growth is value minus net put in, as a share of net put in', () => {
    expect(growthSummary({ totals: totals(2400, 0), worthUsd: USD(2480.65), worthDecimals: 8 })).toEqual({
      putIn: '$2,400', growth: '+$80.65', percent: '+3.4%', tone: 'up',
    });
  });

  test('a loss shows a minus sign and a down tone', () => {
    expect(growthSummary({ totals: totals(1000, 10), worthUsd: USD(977.8), worthDecimals: 8 })).toEqual({
      putIn: '$990', growth: '-$12.20', percent: '-1.2%', tone: 'down',
    });
  });

  test('no percentage when nothing is in, and none of a negative amount', () => {
    expect(growthSummary({ totals: totals(0, 0), worthUsd: USD(5), worthDecimals: 8 })?.percent).toBeNull();
    const out = growthSummary({ totals: totals(100, 150), worthUsd: USD(20), worthDecimals: 8 });
    expect(out).toEqual({ putIn: '-$50', growth: '+$70', percent: null, tone: 'up' });
  });

  test('an unchanged value is flat', () => {
    expect(growthSummary({ totals: totals(1025, 0), worthUsd: USD(1025), worthDecimals: 8 })).toEqual({
      putIn: '$1,025', growth: '$0', percent: '0%', tone: 'flat',
    });
  });

  test('an incomplete put-in figure hides growth rather than overstating it', () => {
    expect(growthSummary({ totals: totals(50, 0), worthUsd: USD(400), worthDecimals: 8, incomplete: true })).toEqual({
      putIn: '$50', growth: null, percent: null, tone: 'flat',
    });
  });

  test('values on another scale are normalized first', () => {
    // 1,030.00 at 6 decimals against 1,000 put in.
    expect(growthSummary({ totals: totals(1000, 0), worthUsd: '1030000000', worthDecimals: 6 })?.growth).toBe('+$30');
    expect(growthSummary({ totals: { inUsd: 'x', outUsd: '0', netUsd: 'x' }, worthUsd: '1', worthDecimals: 8 })).toBeNull();
  });

  test('money text', () => {
    expect(usdText(1025)).toBe('$1,025');
    expect(usdText(0.5)).toBe('$0.50');
    expect(usdText(1234.567)).toBe('$1,234.57');
    expect(signedUsdText(0.004)).toBe('$0');
    expect(signedUsdText(-0.37)).toBe('-$0.37');
    expect(signedPercentText(0.036)).toBe('+0.04%');
    expect(signedPercentText(-12.345)).toBe('-12.3%');
    expect(signedPercentText(0.001)).toBe('0%');
  });
});

describe('sample put-in series', () => {
  test('weekly $25 steps and two gifts, ending below the sample value', () => {
    const growth = buildGrowth();
    const series = growth.contributions ?? [];
    const steps = series.map((p, i) => usd8ToNumber(p.netUsd) - (i === 0 ? 0 : usd8ToNumber(series[i - 1]!.netUsd)));
    expect(steps.filter((s) => s === 25)).toHaveLength(14);
    expect(steps.filter((s) => s !== 25 && s !== steps[0])).toEqual([50, 100]);
    const times = series.map((p) => p.at);
    expect(times).toEqual([...times].sort((a, b) => a - b));
    expect(times[times.length - 1]!).toBeLessThanOrEqual(SAMPLE_NOW);
    expect(growth.totals?.netUsd).toBe(series[series.length - 1]!.netUsd);
    const summary = growthSummary({ totals: growth.totals!, worthUsd: HOLDINGS.totalValueUsd!, worthDecimals: HOLDINGS.feedDecimals });
    expect(summary).toEqual({ putIn: '$2,400', growth: '+$80.65', percent: '+3.4%', tone: 'up' });
    // On the default 3M chart the put-in line starts at $2,000 and stays under the value line.
    const first = growth.snapshots[0]!;
    expect(putInAt(series, first.takenAt)).toBe(2000);
    for (const s of growth.snapshots) {
      expect(Number(s.valueUsd) / 1e8).toBeGreaterThan(putInAt(series, s.takenAt));
    }
    expect(usd8ToNumber(growth.totals!.netUsd)).toBeLessThan(SAMPLE_LAST);
  });
});

describe('put-in step line', () => {
  const series = [
    { at: 100, netUsd: USD(1000) },
    { at: 200, netUsd: USD(1025) },
    { at: 300, netUsd: USD(990) },
  ];

  test('the amount put in at a time is the last step at or before it', () => {
    expect(putInAt(series, 99)).toBe(0);
    expect(putInAt(series, 100)).toBe(1000);
    expect(putInAt(series, 250)).toBe(1025);
    expect(putInAt(series, 1_000)).toBe(990);
  });

  test('steps carry in from before the span and stop at its end', () => {
    expect(putInSteps(series, 150, 250)).toEqual([
      { t: 150, v: 1000 },
      { t: 200, v: 1000 },
      { t: 200, v: 1025 },
      { t: 250, v: 1025 },
    ]);
    expect(putInSteps(series, 0, 50)).toEqual([{ t: 0, v: 0 }, { t: 50, v: 0 }]);
    expect(putInSteps([...series].reverse(), 100, 400).map((p) => p.v)).toEqual([1000, 1000, 1025, 1025, 990, 990]);
  });
});
