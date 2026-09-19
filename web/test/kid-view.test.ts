import { describe, expect, test } from 'bun:test';
import { kidViewPath, timeUntil } from '../src/KidView';

const at = (iso: string) => Date.parse(iso);
const ts = (iso: string) => Date.parse(iso) / 1000;

describe('kid view countdown', () => {
  test('reads in years and months, then months, then days', () => {
    expect(timeUntil(ts('2034-12-20T00:00:00Z'), at('2026-09-16T00:00:00Z'))).toBe('8 years and 3 months');
    expect(timeUntil(ts('2027-09-16T00:00:00Z'), at('2026-09-16T00:00:00Z'))).toBe('1 year');
    expect(timeUntil(ts('2027-02-10T00:00:00Z'), at('2026-09-16T00:00:00Z'))).toBe('4 months');
    expect(timeUntil(ts('2026-10-01T00:00:00Z'), at('2026-09-16T00:00:00Z'))).toBe('15 days');
    expect(timeUntil(ts('2026-09-16T01:00:00Z'), at('2026-09-16T00:00:00Z'))).toBe('1 day');
  });

  test('is null once the date has come', () => {
    expect(timeUntil(ts('2026-09-16T00:00:00Z'), at('2026-09-16T00:00:00Z'))).toBeNull();
  });
});

describe('kid view link', () => {
  const vault = '0x00000000000000000000000000000000000000a1';
  test('retires wallet-address links and never carries a name', () => {
    expect(kidViewPath(vault, 'Maya Rose')).toBe('/kid/expired');
    expect(kidViewPath(vault, null)).toBe('/kid/expired');
    expect(kidViewPath(vault, '  ')).toBe('/kid/expired');
  });
});
