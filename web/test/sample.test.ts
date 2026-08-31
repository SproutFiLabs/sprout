import { describe, expect, test } from 'bun:test';
import {
  HOLDINGS, SAMPLE, SAMPLE_CHANGE, SAMPLE_FIRST, SAMPLE_LAST, buildGrowth, sampleHealth,
} from '../src/sampleData';
import { choreRewardText } from '../src/garden/format';

/**
 * Guards the sample/live separation contract at the data level:
 *  - the sample fixture is internally consistent (no copied numerical errors);
 *  - it is built with the same value shapes the live dashboard consumes;
 *  - it carries no wallet/API/runtime dependency (this file runs without a DOM,
 *    `window`, `fetch` or a wallet provider — importing it would throw otherwise).
 */
describe('garden sample fixture', () => {
  test('sample portfolio value equals the sum of its holdings', () => {
    const sum = HOLDINGS.holdings.reduce((acc, h) => acc + Number(h.valueUsd) / 10 ** h.feedDecimals, 0);
    expect(Number(HOLDINGS.totalValueUsd) / 10 ** HOLDINGS.feedDecimals).toBeCloseTo(sum, 2);
    expect(sum).toBeCloseTo(2480.65, 2);
  });

  test('sample change is truthful: first + change = last', () => {
    expect(SAMPLE_FIRST + SAMPLE_CHANGE).toBeCloseTo(SAMPLE_LAST, 2);
    expect(SAMPLE.portfolioChange).toContain(`+$${SAMPLE_CHANGE.toFixed(2)}`);
    expect(SAMPLE.portfolioChange).toContain('15.9%');
  });

  test('sample growth ends at the displayed value on the reference date', () => {
    const growth = buildGrowth();
    const first = growth.snapshots[0]!;
    const last = growth.snapshots[growth.snapshots.length - 1]!;
    expect(Number(first.valueUsd) / 10 ** first.feedDecimals).toBeCloseTo(SAMPLE_FIRST, 2);
    expect(Number(last.valueUsd) / 10 ** last.feedDecimals).toBeCloseTo(SAMPLE_LAST, 2);
    expect(last.takenAt).toBe(Date.UTC(2024, 6, 15) / 1000);
    expect(growth.snapshots.length).toBeGreaterThan(30);
  });

  test('sample per-asset changes are well-formed positive percentages', () => {
    for (const [symbol, change] of Object.entries(SAMPLE.assetChanges)) {
      expect(Number(change.replace(/[+%]/g, ''))).toBeGreaterThan(0);
      expect(symbol).toMatch(/^[A-Z]{2,5}$/);
    }
  });

  test('sample activity and health never claim to be live', () => {
    expect(SAMPLE.activity.length).toBe(4);
    expect(sampleHealth().localDemo).toBe(false);
    expect(sampleHealth().configured).toBe(false);
  });

  test('chore rewards show dollars only in sample and token units in live mode', () => {
    expect(choreRewardText({ amount: '2000000', isSample: true, decimals: 6, symbol: 'Settlement' })).toBe('+ $2');
    expect(choreRewardText({ amount: '2000000', isSample: false, decimals: 6, symbol: 'Settlement' })).toBe('+ 2 Settlement');
    expect(choreRewardText({ amount: '10000000000000000', isSample: false, decimals: 18, symbol: 'AAA' })).toBe('+ 0.01 AAA');
  });

  test('sample module does not import the wallet or API clients at runtime', async () => {
    const source = await Bun.file(new URL('../src/sampleData.ts', import.meta.url)).text();
    // Only type-only imports are allowed (they are erased at build time).
    expect(source).not.toMatch(/^import\s+\{[^}]*\}\s+from\s+'\.\/api'/m);
    expect(source).not.toMatch(/from '\.\/wallet'/);
    expect(source).not.toMatch(/\bfetch\(/);
    expect(source).not.toMatch(/window\.|localStorage|sessionStorage/);
  });
});
