import { ROOT_DURATIONS, ROOT_MULTIPLIER_BPS, isRootDays, rootCredit, type RootDays } from '@sprout/shared';
import { TIER_ORDER, type HolderStatus, type PerksInfo, type RootInfo, type TierId } from './holder';

/**
 * "Root your SPROUT": the numbers behind the optional lock on /perks. The server
 * decides tiers; these only preview what a lock would do and format the public
 * counter. Multipliers come from @sprout/shared, the same table the server uses.
 */

export { ROOT_DURATIONS, isRootDays, type RootDays };

/** "×1.25", "×1.5", "×2". */
export function multiplierLabel(days: RootDays): string {
  return `×${ROOT_MULTIPLIER_BPS[days] / 10_000}`;
}

/** The highest tier an amount (base units) reaches, or null. Mirrors server/src/holders.ts. */
export function tierForAmount(amount: bigint, decimals: number, tiers: PerksInfo['tiers']): TierId | null {
  const unit = 10n ** BigInt(decimals);
  let best: TierId | null = null;
  for (const id of TIER_ORDER) {
    const tier = tiers.find((x) => x.id === id);
    if (tier && amount >= BigInt(tier.min) * unit) best = id;
  }
  return best;
}

/**
 * Whole SPROUT typed by a person ("800,000", "1 250 000.5") in base units, or
 * null when it is not a positive amount with at most `decimals` places.
 */
export function parseSprout(input: string, decimals: number): bigint | null {
  const clean = input.replace(/[\s,_]/g, '');
  if (!/^\d+(\.\d+)?$/.test(clean)) return null;
  const [whole, frac = ''] = clean.split('.');
  if (frac.length > decimals) return null;
  const value = BigInt(whole!) * 10n ** BigInt(decimals) + BigInt(frac.padEnd(decimals, '0') || '0');
  return value > 0n ? value : null;
}

export interface RootPreview {
  /** What the new lock adds toward the tier while locked (base units). */
  credit: bigint;
  /** The effective balance once it is locked (base units). */
  effective: bigint;
  tier: TierId | null;
}

/**
 * What locking `amount` for `days` would do to this wallet's tier, right away.
 * The tokens leave the wallet, so the held balance can only drop to what stays
 * behind; the lock then adds its multiplied amount on top.
 */
export function previewRoot(status: HolderStatus, amount: bigint, days: RootDays, tiers: PerksInfo['tiers']): RootPreview {
  const held = BigInt(status.heldBalance || '0');
  const balance = BigInt(status.balance || '0');
  const left = balance > amount ? balance - amount : 0n;
  const credit = rootCredit(amount, days);
  const effective = (held < left ? held : left) + BigInt(status.lockCredit ?? '0') + credit;
  return { credit, effective, tier: tierForAmount(effective, status.decimals, tiers) };
}

/** Whole tokens, grouped, rounded down ("1,250,000"). */
export function wholeSprout(raw: bigint | string, decimals: number): string {
  return (BigInt(raw) / 10n ** BigInt(decimals)).toLocaleString('en-US');
}

/** Compact whole tokens for the counter ("812,500", "12.3M", "1.2B"). */
export function compactSprout(raw: bigint | string, decimals: number): string {
  const whole = BigInt(raw) / 10n ** BigInt(decimals);
  const fmt = (n: bigint, unit: bigint, suffix: string) => {
    const tenths = (n * 10n) / unit;
    const text = tenths % 10n === 0n ? `${tenths / 10n}` : `${tenths / 10n}.${tenths % 10n}`;
    return `${text}${suffix}`;
  };
  if (whole >= 1_000_000_000n) return fmt(whole, 1_000_000_000n, 'B');
  if (whole >= 10_000_000n) return fmt(whole, 1_000_000n, 'M');
  return whole.toLocaleString('en-US');
}

/** A share of the supply as a percent: "0.08%", "12.5%", "<0.01%" (never rounds a real lock to 0). */
export function sharePercent(share: number): string {
  if (!Number.isFinite(share) || share <= 0) return '0%';
  const pct = share * 100;
  if (pct < 0.01) return '<0.01%';
  const text = pct < 10 ? pct.toFixed(2) : pct.toFixed(1);
  return `${text.replace(/\.?0+$/, '')}%`;
}

/** The public counter's two numbers, or null when the feature is off or the total is unknown. */
export function rootedCounter(root: RootInfo | undefined | null): { total: string; share: string } | null {
  if (!root || root.rootedTotal === null || root.decimals === null) return null;
  return { total: compactSprout(root.rootedTotal, root.decimals), share: sharePercent(root.rootedShare ?? 0) };
}

/** Always 30, 90 and 180 today; follows the server's list if it ever sends fewer. */
export function rootDurations(root: RootInfo): RootDays[] {
  const offered = root.durations.map((d) => d.days).filter(isRootDays);
  return offered.length ? ROOT_DURATIONS.filter((d) => offered.includes(d)) : [...ROOT_DURATIONS];
}
