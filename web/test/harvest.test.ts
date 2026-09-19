import { describe, expect, test } from 'bun:test';
import { claimCsv, EXAMPLE_ALLOCATION, harvestReducer, initialHarvest } from '../src/harvest/model';
describe('Harvest preview accounting', () => {
  test('allocates 0.50% of 8560 USDC as 42.80, using integer cents', () => expect(EXAMPLE_ALLOCATION).toBe(4280));
  test('a double completion can never duplicate a receipt or allocation', () => {
    const first = harvestReducer(initialHarvest(), { type: 'claim', date: '2026-09-19' });
    const second = harvestReducer(first, { type: 'claim', date: '2026-09-19' });
    expect(second).toBe(first); expect(first.availableCents).toBe(0); expect(first.claims).toHaveLength(3); expect(first.claims[0]!.cents).toBe(4280);
  });
  test('empty, unavailable and ineligible states cannot claim', () => {
    for (const scenario of ['empty', 'ineligible', 'unavailable'] as const) {
      const state = harvestReducer(initialHarvest(), { type: 'scenario', scenario });
      expect(harvestReducer(state, { type: 'claim', date: '2026-09-19' })).toBe(state);
    }
  });
  test('reset restores the demo and exports explicitly identify simulated receipts', () => {
    const claimed = harvestReducer(initialHarvest(), { type: 'claim', date: '2026-09-19' });
    expect(harvestReducer(claimed, { type: 'reset' })).toEqual(initialHarvest());
    expect(claimCsv(claimed.claims)).toContain('Preview only - no funds transferred');
    expect(claimCsv(claimed.claims)).toContain('DEMO-003,2026-09-19,42.80,Simulated');
  });
});
