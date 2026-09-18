import { describe, expect, test } from 'bun:test';
import { betaPoints } from '../src/components/BetaNotice';

describe('risk list automation line', () => {
  test('says automatic investing is off only when the server says so', () => {
    expect(betaPoints(false).some((p) => p.includes('switched off'))).toBe(true);
    expect(betaPoints(true).some((p) => p.includes('switched off'))).toBe(false);
    expect(betaPoints(true).some((p) => p.includes('run automatically'))).toBe(true);
  });

  test('makes no automation claim before the status is known', () => {
    const unknown = betaPoints(null);
    expect(unknown.some((p) => /automatic/i.test(p))).toBe(false);
    expect(unknown).toContain('The contracts have not been independently audited.');
  });
});
