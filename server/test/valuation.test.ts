import { describe, expect, test } from 'bun:test';
import { allocate, formatUnits, shareEquivalent, tokenValueUsd } from '@sprout/shared';

describe('integer and decimal scaling', () => {
  test('values a 6-decimal stock balance with an 8-decimal feed', () => {
    // 1.234567 shares at $100.00 => $123.4567 -> 12345670000 in 8-decimal USD
    const raw = 1_234_567n;
    const price = 100n * 10n ** 8n;
    expect(tokenValueUsd(raw, price, 6)).toBe(1_234_567n * price / 10n ** 6n);
  });

  test('does not double-apply the corporate-action multiplier', () => {
    const raw = 1_000_000n; // 1.0 share at 6 decimals
    const price = 50n * 10n ** 8n;
    // Value uses the raw feed price only.
    expect(tokenValueUsd(raw, price, 6)).toBe(50n * 10n ** 8n);
    // Share-equivalent display applies the multiplier separately.
    expect(shareEquivalent(raw, 2n * 10n ** 18n)).toBe(2_000_000n * 10n ** 18n);
  });

  test('allocation floors and never creates value', () => {
    const weights = [3333n, 3333n, 3334n];
    const parts = allocate(5_000_123n, weights);
    const sum = parts.reduce((a, b) => a + b, 0n);
    expect(sum).toBeLessThanOrEqual(5_000_123n);
    expect(5_000_123n - sum).toBe(2n);
  });

  test('rejects negative or malformed valuation inputs', () => {
    expect(() => tokenValueUsd(-1n, 1n, 6)).toThrow();
    expect(() => allocate(100n, [5000n, 4000n])).toThrow();
  });

  test('formats units without floating point drift', () => {
    expect(formatUnits(5_000_000n, 6)).toBe('5');
    expect(formatUnits(1_234_567n, 6)).toBe('1.2345');
  });
});
