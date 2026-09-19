import type { Address } from 'viem';
import type { Growth, Holdings, Job, Milestone, Sprout } from './api';
import type { SampleDashboard } from './DashboardShell';

/**
 * Pure, local-only sample fixture for /dashboard/preview.
 *
 * No wallet, API, RPC or storage dependency lives here — only plain objects.
 * The live dashboard never reads these values (DashboardShell only consumes
 * them when mode === 'sample'), so sample data can never leak into live mode.
 */

export const EMMA = '0x1111111111111111111111111111111111111111' as Address;
export const NOAH = '0x2222222222222222222222222222222222222222' as Address;
export const SETTLEMENT = '0x3333333333333333333333333333333333333333' as Address;

export const SAMPLE_NOW = Date.UTC(2024, 6, 15) / 1000; // Jul 15 2024, UTC

/** Internally consistent sample history: first + change = last. */
export const SAMPLE_FIRST = 2140.37;
export const SAMPLE_LAST = 2480.65;
export const SAMPLE_CHANGE = 340.28;

export function buildGrowth(): Growth {
  const start = Date.UTC(2024, 4, 1) / 1000; // May 1 2024
  const days = 75; // May 1 -> Jul 15
  const snapshots: Growth['snapshots'] = [];
  for (let i = 0; i <= days; i += 1) {
    const t = i / days;
    const base = SAMPLE_FIRST + (SAMPLE_LAST - SAMPLE_FIRST) * t;
    // Visible dips/rises (like the reference curve) that still start at
    // SAMPLE_FIRST and end at SAMPLE_LAST exactly.
    const wave = Math.sin(i * 0.22) * 42 + Math.sin(i * 0.09) * 22 + Math.sin(i * 0.8) * 8;
    const value = i === 0 ? SAMPLE_FIRST : i === days ? SAMPLE_LAST : base + wave;
    snapshots.push({
      takenAt: start + i * 86400,
      valueUsd: String(Math.round(value * 1e8)),
      feedDecimals: 8,
      source: 'sample',
    });
  }
  return { available: true, snapshots };
}

export const HOLDINGS: Holdings = {
  available: true,
  blockNumber: null,
  feedDecimals: 8,
  totalValueUsd: '248065000000',
  settlementAssumption: 'Sample values for preview only. Nothing here is on-chain.',
  holdings: [
    { symbol: 'AAPL', address: '0x00000000000000000000000000000000000000a1', kind: 'stock', rawBalance: '4120000000000000000', decimals: 18, multiplier: '1', price: null, feedDecimals: 8, valueUsd: '67648000000', shareEquivalent: '4120000000000000000', status: 'ok' },
    { symbol: 'NVDA', address: '0x00000000000000000000000000000000000000a2', kind: 'stock', rawBalance: '2080000000000000000', decimals: 18, multiplier: '1', price: null, feedDecimals: 8, valueUsd: '54271000000', shareEquivalent: '2080000000000000000', status: 'ok' },
    { symbol: 'MSFT', address: '0x00000000000000000000000000000000000000a3', kind: 'stock', rawBalance: '3060000000000000000', decimals: 18, multiplier: '1', price: null, feedDecimals: 8, valueUsd: '40763000000', shareEquivalent: '3060000000000000000', status: 'ok' },
    { symbol: 'SPY', address: '0x00000000000000000000000000000000000000a4', kind: 'stock', rawBalance: '1240000000000000000', decimals: 18, multiplier: '1', price: null, feedDecimals: 8, valueUsd: '85383000000', shareEquivalent: '1240000000000000000', status: 'ok' },
  ],
};

export const JOB: Job = {
  id: `${EMMA}:investment`,
  vaultId: EMMA,
  amount: '25000000',
  periodSeconds: 604800,
  nextRunAt: Date.UTC(2024, 6, 22) / 1000,
  status: 'active',
  lastError: null,
};

export const MILESTONES: Milestone[] = [
  { id: '0xchore1', vaultId: EMMA, token: SETTLEMENT, amount: '2000000', unlockTime: 0, status: 'created', descriptionHash: null, createdTxHash: null, releasedTxHash: null },
  { id: '0xchore2', vaultId: EMMA, token: SETTLEMENT, amount: '2000000', unlockTime: 0, status: 'created', descriptionHash: null, createdTxHash: null, releasedTxHash: null },
];

function sprout(id: Address, beneficiary: Address): Sprout {
  return {
    id,
    chainId: 0,
    parent: beneficiary,
    beneficiary,
    settlementToken: SETTLEMENT,
    graduationTimestamp: Date.UTC(2036, 6, 15) / 1000,
    assets: ['0x00000000000000000000000000000000000000a1', '0x00000000000000000000000000000000000000a2'],
    weights: [6000, 4000],
    createdTxHash: null,
    createdBlock: null,
    createdAt: Date.UTC(2024, 3, 1) / 1000,
  };
}

export const SPROUTS: Sprout[] = [sprout(EMMA, '0x4444444444444444444444444444444444444444'), sprout(NOAH, '0x5555555555555555555555555555555555555555')];

export const NAMES: Record<string, string> = { [EMMA]: 'Emma', [NOAH]: 'Noah' };

export const SAMPLE: SampleDashboard = {
  childAvatars: { [EMMA]: '/art/dashboard/avatar-emma.png', [NOAH]: '/art/dashboard/avatar-noah.png' },
  assetNames: { AAPL: 'Apple Inc.', NVDA: 'NVIDIA Corp.', MSFT: 'Microsoft Corp.', SPY: 'SPDR S&P 500 ETF' },
  assetChanges: { AAPL: '+18.4%', NVDA: '+28.1%', MSFT: '+12.6%', SPY: '+9.7%' },
  choreLabels: { '0xchore1': 'Help set the dinner table', '0xchore2': 'Read for 20 minutes' },
  choreDone: { '0xchore1': true, '0xchore2': false },
  portfolioChange: `+$${SAMPLE_CHANGE.toFixed(2)} (15.9%)`,
  weeklyNext: 'Mon, Jul 22, 2024',
  weeklySubtitle: 'A little each week can make a big difference.',
  activity: [
    { title: 'Grandma Sue', sub: 'Gift contribution', amount: '+$100.00', date: 'Jul 12, 2024', kind: 'gift' },
    { title: 'Weekly investment', sub: 'Automatic contribution', amount: '+$25.00', date: 'Jul 8, 2024', kind: 'invest' },
    { title: 'Chore reward', sub: 'Helped with laundry', amount: '+$3.00', date: 'Jul 6, 2024', kind: 'chore' },
    { title: 'Happy Birthday, Emma!', sub: 'Mom & Dad', amount: '+$50.00', date: 'Jul 1, 2024', kind: 'gift' },
  ],
};

export function sampleHealth() {
  return {
    ok: true,
    chainId: 0,
    chainName: 'Sample',
    configured: false,
    missing: [] as string[],
    localDemo: false,
    automation: { keeperConfigured: false, gasBudgetConfigured: false, enabled: true },
  };
}
