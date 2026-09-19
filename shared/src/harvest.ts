export const HARVEST_TOKEN = '0x5ec27c931fb49911128dddf7d914c1754da9f49f' as const;
export const HARVEST_CHAIN_ID = 4663;
export const HARVEST_RULES = 'Hold at least 1,000,000 SPROUT at the published snapshot block and register this wallet before the deadline. The announced budget is divided proportionally by snapshot balance among eligible registered wallets. Fractions of the smallest payout unit round down; the remainder stays with the treasury. Payments are sent manually by the team. Registration is not a guarantee of payment. No recurring payout is promised.';
export interface HarvestRound {
  id: string; title: string; state: 'open' | 'locked' | 'cancelled';
  chainId: number; token: string; symbol: string; decimals: number; funder: string;
  budget: string; snapshotBlock: string; snapshotHash: string; minHolding: string;
  holdingDecimals: number; closesAt: number; createdAt: number;
  lockedAt?: number; payoutAfterBlock?: string; allocated?: string; remainder?: string;
}
export interface HarvestRegistration {
  roundId: string; address: string; balance: string; registeredAt: number;
  amount: string | null; txHash: string | null; logIndex: number | null; paidAt: number | null;
  pendingTxHash?: string | null; pendingLogIndex?: number | null;
}
/** Pure integer arithmetic, independent of token decimals. */
export function allocateHarvest(budget: bigint, balances: readonly {address: string; balance: string}[]) {
  if (budget <= 0n || balances.some(b => BigInt(b.balance) <= 0n)) throw new Error('Positive budget and balances required');
  const total = balances.reduce((n, b) => n + BigInt(b.balance), 0n);
  const allocations = balances.map(b => ({address: b.address, amount: total ? budget * BigInt(b.balance) / total : 0n}));
  const allocated = allocations.reduce((n, b) => n + b.amount, 0n);
  return {allocations, allocated, remainder: budget - allocated};
}
