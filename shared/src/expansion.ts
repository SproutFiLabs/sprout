export type ExpansionPage =
  "events" | "roundups" | "arena" | "cash" | "continuity";
export type ExpansionFlags = Record<ExpansionPage, boolean>;
export interface GrowthEvent {
  id: string;
  vault: string;
  kind: "birthday" | "baby-shower" | "graduation" | "milestone";
  title: string;
  goalCents: number;
  endsAt: number;
  createdAt: number;
  closed: boolean;
  publicWall: boolean;
  giftRef: string;
  raisedCents: number;
  guests: Array<{ alias: string; message: string; at: number }>;
}
export interface RoundupSettings {
  id: string;
  vault: string;
  wallet: string;
  step: 1 | 5 | 10;
  multiplier: 1 | 2 | 3;
  capCents: number;
  enabled: boolean;
  linkedAt: number;
  observedThrough: string;
}
export interface RoundupEntry {
  id: string;
  vault: string;
  at: number;
  amountCents: number;
  roundupCents: number;
  txHash: string;
  block: string;
  sweepHash?: string;
  sweptCents?: number;
}
export interface ArenaAsset {
  address: string;
  symbol: string;
  name: string;
  priceCents: number;
  quantityMicros: number;
  status: "open" | "closed" | "unavailable";
}
export interface ArenaFill {
  id: string;
  symbol: string;
  side: "buy" | "sell";
  quantityMicros: number;
  priceCents: number;
  costCents: number;
  at: number;
  quoteId: string;
}
export interface ArenaAccount {
  id: string;
  vault: string;
  cashCents: number;
  startingCents: number;
  holdings: Record<string, number>;
  fills: ArenaFill[];
  practiceDays: number[];
  lessons: string[];
  createdAt: number;
  snapshotBlock: string;
  mirror: Array<{ symbol: string; quantityMicros: number }>;
  unlockDays: number;
}
export interface ArenaLeague {
  id: string;
  title: string;
  owner: string;
  invite: string;
  members: Array<{ owner: string; alias: string; joinedAt: number }>;
  createdAt: number;
}
export interface MatchView {
  id: string;
  sponsor: string;
  capCents: number;
  remainingCents: number;
  matchedCents: number;
  expires: number;
  cancelled: boolean;
}
export interface V3ChainState {
  vault: string;
  parent: string;
  beneficiary: string;
  chainId: number;
  now: number;
  block: string;
  settlement: string;
  settlementDecimals: number;
  balanceCents: number;
  availableCents: number;
  matches: MatchView[];
  roundup: {
    id: string;
    active: boolean;
    capCents: number;
    nextSweep: number;
    totalCents: number;
    executor: string;
  };
  cash: {
    available: boolean;
    enabled: boolean;
    shares: string;
    valueCents: number;
    policyFresh: boolean;
    permitted: boolean;
    navAt: number;
    treasury: string;
  };
  continuity: {
    successor: string;
    coGuardian: string;
    hash: string;
    heartbeatAt: number;
    cadence: number;
    grace: number;
    claimAt: number;
    active: boolean;
    reserveCents: number;
    installmentCents: number;
    earlyGraduation: number;
    graduation: number;
    epoch: number;
  };
  market: ArenaAsset[];
}
export interface V3PublicConfig {
  enabled: boolean;
  flags: ExpansionFlags;
  local: boolean;
  chainId: number;
  factory: string;
  matching: string;
  roundups: string;
  eventBook: string;
  executor: string;
  treasuryAvailable: boolean;
}
export interface ExpansionState {
  config: V3PublicConfig;
  vaults: Array<{ id: string; label: string }>;
  chain: V3ChainState | null;
  events: GrowthEvent[];
  roundup: RoundupSettings | null;
  ledger: RoundupEntry[];
  arena: ArenaAccount | null;
  leagues: Array<{
    id: string;
    title: string;
    invite?: string;
    members: Array<{ alias: string; score: number }>;
  }>;
}
export interface PreparedTransaction {
  to: string;
  data: string;
  value?: string;
  approval?: { token: string; spender: string; amount: string };
  description: string;
}
export const EXPANSION_PAGES: ExpansionPage[] = [
  "events",
  "roundups",
  "arena",
  "cash",
  "continuity",
];
export const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";
export function roundupDelta(
  amountCents: number,
  step: 1 | 5 | 10,
  multiplier: 1 | 2 | 3,
): number {
  if (
    !Number.isSafeInteger(amountCents) ||
    amountCents < 0 ||
    ![1, 5, 10].includes(step) ||
    ![1, 2, 3].includes(multiplier)
  )
    throw Error("Invalid round-up input.");
  return (
    ((step * 100 - (amountCents % (step * 100))) % (step * 100)) * multiplier
  );
}
export function arenaValue(
  account: ArenaAccount,
  market: ArenaAsset[],
): number {
  return (
    account.cashCents +
    market.reduce(
      (sum, a) =>
        sum +
        Math.floor(((account.holdings[a.symbol] ?? 0) * a.priceCents) / 1e6),
      0,
    )
  );
}
export function arenaReadiness(account: ArenaAccount): number {
  return Math.min(
    100,
    Math.floor(
      Math.min(
        account.practiceDays.length / Math.max(1, account.unlockDays),
        1,
      ) * 60,
    ) +
      Math.min(account.lessons.length, 4) * 10,
  );
}
