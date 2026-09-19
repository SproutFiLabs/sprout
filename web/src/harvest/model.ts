/** Preview-only accounting. These values are never fetched as live entitlements. */
export type Scenario = 'funded' | 'empty' | 'ineligible' | 'unavailable';
export type Claim = { id: string; date: string; cents: number };
export type HarvestState = { scenario: Scenario; availableCents: number; claims: Claim[] };
export type HarvestAction = { type: 'scenario'; scenario: Scenario } | { type: 'claim'; date: string } | { type: 'reset' };
export const EXAMPLE_POOL_CENTS = 856000;
export const EXAMPLE_SHARE_BPS = 50;
export const EXAMPLE_ALLOCATION = Math.floor(EXAMPLE_POOL_CENTS * EXAMPLE_SHARE_BPS / 10000);
export const initialHarvest = (): HarvestState => ({
  scenario: 'funded', availableCents: EXAMPLE_ALLOCATION,
  claims: [{ id: 'DEMO-002', date: '2026-09-12', cents: 1860 }, { id: 'DEMO-001', date: '2026-08-28', cents: 2420 }],
});
export function harvestReducer(state: HarvestState, action: HarvestAction): HarvestState {
  if (action.type === 'reset') return initialHarvest();
  if (action.type === 'scenario') return { ...state, scenario: action.scenario };
  if (state.scenario !== 'funded' || state.availableCents <= 0) return state;
  return { ...state, availableCents: 0, claims: [{ id: 'DEMO-003', date: action.date, cents: state.availableCents }, ...state.claims] };
}
export const money = (cents: number) => (cents / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
export const claimCsv = (claims: Claim[]) => 'Preview only - no funds transferred\nReceipt,Date,Amount USDC,Status\n' + claims.map(c => `${c.id},${c.date},${(c.cents / 100).toFixed(2)},Simulated`).join('\n');
