import { describe, expect, test } from 'bun:test';
import { shortCa } from '../src/components/PublicCa';

describe('contract address display', () => {
  test('keeps the start and end people check', () => {
    expect(shortCa('0x1111111111111111111111111111111111112222')).toBe('0x1111…2222');
    expect(shortCa('So11111111111111111111111111111111111111112')).toBe('So1111…1112');
    expect(shortCa('0x12345678')).toBe('0x12345678');
  });
});
