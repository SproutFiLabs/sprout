import { describe, expect, test } from 'bun:test';
import { asTier, autoInvestLock, autoInvestPerkText, requiredTier } from '../src/perks/autoInvest';

const on = (autoInvestTier?: string | null) => ({ enabled: true, autoInvestTier });

describe('automatic weekly investing as a holder perk', () => {
  test('nothing is locked when automation is off or open to everyone', () => {
    expect(requiredTier(null)).toBeNull();
    expect(requiredTier({ enabled: false, autoInvestTier: 'sapling' })).toBeNull();
    expect(requiredTier(on(null))).toBeNull();
    expect(requiredTier(on())).toBeNull();
    expect(autoInvestLock({ enabled: false, autoInvestTier: 'sapling' }, null)).toBeNull();
    expect(autoInvestLock(on(null), null)).toBeNull();
  });

  test('a parent below the tier is locked; at or above it is not', () => {
    expect(autoInvestLock(on('sapling'), null)).toBe('sapling');
    expect(autoInvestLock(on('sapling'), 'seedling')).toBe('sapling');
    expect(autoInvestLock(on('sapling'), 'sapling')).toBeNull();
    expect(autoInvestLock(on('sapling'), 'grove')).toBeNull();
    expect(autoInvestLock(on('grove'), 'bloom')).toBe('grove');
  });

  test('says nothing while the parent tier is unknown, or for a tier it does not know', () => {
    expect(autoInvestLock(on('sapling'), undefined)).toBeNull();
    expect(autoInvestLock(on('gold'), null)).toBeNull();
    expect(asTier('gold')).toBeNull();
    expect(asTier('bloom')).toBe('bloom');
  });

  test('names the tier in the notice', () => {
    expect(autoInvestPerkText('bloom')).toBe(
      'Automatic weekly investing is a perk for SPROUT holders (Bloom and up). Your plan is saved: run it any time with Invest now.',
    );
  });
});
