/**
 * Local demo fixtures. These are explicitly labeled, never mixed into the
 * sprouts table, and only served when SPROUT_LOCAL_DEMO=1. They must not be
 * presented as real user data.
 */
export const FIXTURE_LABEL = 'LOCAL DEMO FIXTURE - placeholder data, no real value';

export function localFixtures(chainId: number) {
  return {
    fixture: true,
    label: FIXTURE_LABEL,
    chainId,
    note: 'Anvil + mock ERC-20/oracle/venue only. Cleartext child names never leave the device.',
    sample: {
      nickname: 'Demo Sprout',
      beneficiary: '0x000000000000000000000000000000000000dEaD',
      allocations: [
        { symbol: 'AAA', weightBps: 6000 },
        { symbol: 'BBB', weightBps: 4000 },
      ],
    },
  };
}
