import { describe, expect, test } from 'bun:test';
import { classifyMarket } from '../src/marketAvailability';
describe('indicative market status', () => {
  test('keeps the exact one-percent boundary in integer arithmetic', () => {
    expect(classifyMarket(10000n, 9900n)).toBe('available');
    expect(classifyMarket(10000n, 9899n)).toBe('pool-too-far');
    expect(classifyMarket(10000n, 10010n)).toBe('available');
  });
  test('never calls zero or unreadable quotes available', () => {
    expect(classifyMarket(0n, 100n)).toBe('unavailable');
    expect(classifyMarket(100n, 0n)).toBe('unavailable');
  });
});
