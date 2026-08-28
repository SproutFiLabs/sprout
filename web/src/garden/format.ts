import { formatUnits } from '@sprout/shared';

/**
 * Chore reward label. The approved sample shows dollars ("+ $2"). In live mode
 * a reward may be a stock token, so it must render its token quantity and
 * symbol rather than a `$` amount. Presentation only.
 */
export function choreRewardText(args: { amount: string; isSample: boolean; decimals: number; symbol: string }): string {
  let quantity: string;
  try {
    quantity = formatUnits(BigInt(args.amount), args.decimals, 2);
  } catch {
    quantity = '—';
  }
  return args.isSample ? `+ $${quantity}` : `+ ${quantity} ${args.symbol}`;
}

/**
 * Human-readable share/token quantity for a holding row.
 *
 * The backend `shareEquivalent` (and `rawBalance`) are integer base units scaled
 * by the token's decimals, so they must be divided back down before display.
 * Older sample fixtures carried a pre-formatted decimal; that is not the live
 * contract, so this helper always treats the value as base units.
 */
export function holdingSharesText(args: {
  shareEquivalent: string | null;
  rawBalance: string;
  decimals: number;
  maxFractionDigits?: number;
}): string {
  const value = args.shareEquivalent ?? args.rawBalance;
  try {
    return formatUnits(BigInt(value), args.decimals, args.maxFractionDigits ?? 4);
  } catch {
    return '—';
  }
}

/**
 * Human cadence label for a recurring plan period. Uses the existing
 * periodSeconds -> whole-days mapping. Only exact 1 / 7 / 14-day periods get a
 * named label; a fixed 30/90/365-day schedule is NOT a calendar
 * month/quarter/year, so it stays explicit ("30 days") to stay truthful.
 */
export function cadenceLabel(periodSeconds: number): string {
  const days = Math.round(periodSeconds / 86400);
  if (days === 1) return 'day';
  if (days === 7) return 'week';
  if (days === 14) return '2 weeks';
  return `${days} days`;
}
