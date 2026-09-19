import { formatQuantity, formatUnits } from '@sprout/shared';
import { t } from '../i18n';

/**
 * Chore reward label. The approved sample shows dollars ("+ $2"). In live mode
 * a reward may be a stock token, so it must render its token quantity and
 * symbol rather than a `$` amount. Presentation only.
 */
export function choreRewardText(args: { amount: string; isSample: boolean; decimals: number; symbol: string }): string {
  let quantity: string;
  try {
    // Enough digits for a small crypto reward (CBBTC has 8 decimals); dollars keep two.
    quantity = args.isSample ? formatUnits(BigInt(args.amount), args.decimals, 2) : formatQuantity(BigInt(args.amount), args.decimals, 2);
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
    // By the token's own decimals, with enough digits for a small Bitcoin holding.
    return args.maxFractionDigits === undefined ? formatQuantity(BigInt(value), args.decimals) : formatUnits(BigInt(value), args.decimals, args.maxFractionDigits);
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
  if (days === 1) return t('day');
  if (days === 7) return t('week');
  if (days === 14) return t('2 weeks');
  return t('{days} days', { days });
}
