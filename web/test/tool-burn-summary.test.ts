import { describe, expect, test } from 'bun:test';
import { sproutText } from '../src/perks/burn';

describe('premium tool burn display', () => {
  test('formats 18-decimal amounts as whole SPROUT', () => {
    expect(sproutText('123000000000000000000', 18)).toBe('123');
  });
});
