import { tokenValueUsd } from '@sprout/shared';
import type { ChainContext } from './chain';
import { getSettlementDecimals } from './chain';
import { blockTimestamps } from './blockTimes';
import type { GrowthSnapshotRecord } from './repo';

/** Snapshot valueUsd scale; every amount here uses it too. */
const USD_DECIMALS = 8;

export const MONEY_IN_EVENTS: ReadonlySet<string> = new Set(['Funded', 'GiftReceived']);
export const MONEY_OUT_EVENTS: ReadonlySet<string> = new Set(['AllowanceClaimed', 'Withdrawn']);

export interface ContributionPoint {
  /** Block timestamp, unix seconds. */
  at: number;
  /** Net amount put in so far, 8-decimal USD integer string. May be negative. */
  netUsd: string;
}

export interface ContributionTotals {
  inUsd: string;
  outUsd: string;
  netUsd: string;
}

export interface ContributionHistory {
  contributions: ContributionPoint[];
  totals: ContributionTotals | null;
  note?: string;
}

/** An indexed vault event, as listChainEvents returns it. */
export interface IndexedVaultEvent {
  eventName: string;
  blockNumber: number;
  logIndex: number;
  payload: unknown;
}

interface PricePoint {
  takenAt: number;
  price: bigint;
  feedDecimals: number;
  tokenDecimals: number;
}

function normalizeUsd(value: bigint, decimals: number): bigint {
  if (decimals === USD_DECIMALS) return value;
  if (decimals < USD_DECIMALS) return value * 10n ** BigInt(USD_DECIMALS - decimals);
  return value / 10n ** BigInt(decimals - USD_DECIMALS);
}

function parseAmount(value: unknown): bigint | null {
  try {
    const amount = BigInt(String(value));
    return amount > 0n ? amount : null;
  } catch {
    return null;
  }
}

/**
 * Per-token prices recorded in growth snapshots, oldest first. Only current
 * prices count: a holding whose feed was stale, paused or missing when the
 * snapshot was taken carries no usable price.
 */
function recordedPrices(ctx: ChainContext, snapshots: GrowthSnapshotRecord[]): Map<string, PricePoint[]> {
  const configured = new Map(ctx.config.chain.contracts.stockTokens.map((t) => [t.address.toLowerCase(), t.decimals]));
  const byToken = new Map<string, PricePoint[]>();
  const ordered = [...snapshots].sort((a, b) => a.takenAt - b.takenAt);
  for (const snapshot of ordered) {
    if (!Array.isArray(snapshot.holdings)) continue;
    for (const raw of snapshot.holdings as Array<Record<string, unknown>>) {
      if (!raw || raw.kind === 'settlement' || typeof raw.address !== 'string') continue;
      if (raw.status !== undefined && raw.status !== 'ok') continue;
      const price = parseAmount(raw.price);
      if (price === null) continue;
      const token = raw.address.toLowerCase();
      const tokenDecimals = typeof raw.decimals === 'number' ? raw.decimals : configured.get(token) ?? 18;
      const feedDecimals = typeof raw.feedDecimals === 'number' ? raw.feedDecimals : USD_DECIMALS;
      const points = byToken.get(token) ?? [];
      points.push({ takenAt: snapshot.takenAt, price, feedDecimals, tokenDecimals });
      byToken.set(token, points);
    }
  }
  return byToken;
}

/** The last price at or before `at`, else the first one after it. */
function priceAt(points: PricePoint[] | undefined, at: number): PricePoint | null {
  if (!points || points.length === 0) return null;
  let lo = 0;
  let hi = points.length - 1;
  let found = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (points[mid]!.takenAt <= at) {
      found = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return points[found >= 0 ? found : 0]!;
}

/**
 * What has been put into a sprout and taken out, over time, in USD.
 *
 * Rules:
 *  - Money in is `Funded` and `GiftReceived`; money out is `AllowanceClaimed`
 *    and `Withdrawn`. Purchases inside the vault and chore releases into the
 *    allowance bucket move nothing in or out, so they are not counted.
 *  - Each event is dated by its block's timestamp, not by when it was indexed.
 *  - The settlement token counts at $1.00 per token.
 *  - A stock token is valued with the price recorded in the nearest growth
 *    snapshot at or before the event (one with a current price for that
 *    token); failing that, the earliest later snapshot with one. With no
 *    recorded price at all the event is left out and `note` says so.
 *  - `contributions` is a cumulative step series in time order; events in the
 *    same second collapse into one point. `totals` is null when the sprout has
 *    no money events.
 *
 * Throws when block timestamps cannot be read; callers decide the fallback.
 */
export async function contributionHistory(
  ctx: ChainContext,
  input: { events: IndexedVaultEvent[]; snapshots: GrowthSnapshotRecord[]; settlementToken?: string | null },
): Promise<ContributionHistory> {
  const moneyEvents = input.events
    .filter((e) => MONEY_IN_EVENTS.has(e.eventName) || MONEY_OUT_EVENTS.has(e.eventName))
    .sort((a, b) => a.blockNumber - b.blockNumber || a.logIndex - b.logIndex);
  if (moneyEvents.length === 0) return { contributions: [], totals: null };

  const settlementTokens = new Set(
    [ctx.config.chain.contracts.settlementToken, input.settlementToken]
      .filter((t): t is string => typeof t === 'string' && t.length > 0)
      .map((t) => t.toLowerCase()),
  );
  const payloadOf = (e: IndexedVaultEvent) => (e.payload ?? {}) as Record<string, unknown>;
  const needsSettlement = moneyEvents.some((e) => settlementTokens.has(String(payloadOf(e).token ?? '').toLowerCase()));

  const [times, settlementDecimals] = await Promise.all([
    blockTimestamps(ctx, moneyEvents.map((e) => e.blockNumber)),
    needsSettlement ? getSettlementDecimals(ctx) : Promise.resolve(6),
  ]);
  const prices = recordedPrices(ctx, input.snapshots);

  let totalIn = 0n;
  let totalOut = 0n;
  let unvaluedIn = false;
  let unvaluedOut = false;
  const contributions: ContributionPoint[] = [];

  const dated = moneyEvents
    .map((e) => ({ event: e, at: times.get(e.blockNumber) }))
    .filter((d): d is { event: IndexedVaultEvent; at: number } => d.at !== undefined)
    .sort((a, b) => a.at - b.at || a.event.blockNumber - b.event.blockNumber || a.event.logIndex - b.event.logIndex);

  for (const { event, at } of dated) {
    const payload = payloadOf(event);
    const amount = parseAmount(payload.amount);
    if (amount === null) continue;
    const token = String(payload.token ?? '').toLowerCase();
    const incoming = MONEY_IN_EVENTS.has(event.eventName);

    let valueUsd: bigint | null;
    if (settlementTokens.has(token)) {
      valueUsd = normalizeUsd(amount, settlementDecimals);
    } else {
      const point = priceAt(prices.get(token), at);
      valueUsd = point
        ? normalizeUsd(tokenValueUsd(amount, point.price, point.tokenDecimals), point.feedDecimals)
        : null;
    }
    if (valueUsd === null) {
      if (incoming) unvaluedIn = true;
      else unvaluedOut = true;
      continue;
    }

    if (incoming) totalIn += valueUsd;
    else totalOut += valueUsd;
    const netUsd = (totalIn - totalOut).toString();
    const last = contributions[contributions.length - 1];
    if (last && last.at === at) last.netUsd = netUsd;
    else contributions.push({ at, netUsd });
  }

  const history: ContributionHistory = {
    contributions,
    totals: { inUsd: totalIn.toString(), outUsd: totalOut.toString(), netUsd: (totalIn - totalOut).toString() },
  };
  if (unvaluedIn || unvaluedOut) {
    history.note = unvaluedOut
      ? 'Some stock deposits or withdrawals could not be valued yet (no recorded price), so they are left out of these figures.'
      : 'Some stock deposits could not be valued yet (no recorded price), so they are left out of these figures.';
  }
  return history;
}
