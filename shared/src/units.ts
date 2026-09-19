export const ALLOCATION_TOTAL = 10_000n;
export const BPS_DENOMINATOR = 10_000n;

/** 10**decimals without floating point error. */
export function tenPow(decimals: number): bigint {
  return 10n ** BigInt(decimals);
}

/**
 * USD value of a raw token balance using a Chainlink-style feed.
 *
 * The Robinhood Stock Token feed returns a per-token value already adjusted for
 * the corporate-action multiplier, so the raw feed price is used directly. The
 * UI multiplier is intentionally NOT applied here.
 *
 * Result is denominated in 10**feedDecimals.
 */
export function tokenValueUsd(rawBalance: bigint, feedPrice: bigint, tokenDecimals: number): bigint {
  if (rawBalance < 0n || feedPrice < 0n) throw new Error('negative inputs are not valid');
  return (rawBalance * feedPrice) / tenPow(tokenDecimals);
}

/**
 * Share-equivalent display units. Corporate actions are represented by
 * multiplying the raw balance by the token's UI multiplier.
 */
export function shareEquivalent(rawBalance: bigint, uiMultiplier: bigint): bigint {
  return rawBalance * uiMultiplier;
}

/** Split `amount` across weights that sum to 10_000, flooring each share. */
export function allocate(amount: bigint, weights: bigint[]): bigint[] {
  const total = weights.reduce((acc, w) => acc + w, 0n);
  if (total !== ALLOCATION_TOTAL) throw new Error('weights must sum to 10000');
  return weights.map((w) => (amount * w) / ALLOCATION_TOTAL);
}

export function formatUnits(value: bigint, decimals: number, maxFractionDigits = 4): string {
  const negative = value < 0n;
  const abs = negative ? -value : value;
  const base = tenPow(decimals);
  const whole = abs / base;
  let fraction = (abs % base).toString().padStart(decimals, '0');
  fraction = fraction.slice(0, maxFractionDigits).replace(/0+$/, '');
  const out = fraction.length > 0 ? `${whole}.${fraction}` : whole.toString();
  return negative ? `-${out}` : out;
}

/**
 * A token quantity for display, by the token's own decimals: at least
 * `minFractionDigits` decimals, and below one whole token enough decimals to
 * show `significant` digits (never more than the token has). $10 of Bitcoin
 * (CBBTC, 8 decimals) is about 0.00012 of a coin: a fixed four decimals would
 * show 0.0001, and $1 of it would show 0.
 */
export function formatQuantity(value: bigint, decimals: number, minFractionDigits = 4, significant = 4): string {
  const abs = value < 0n ? -value : value;
  let digits = minFractionDigits;
  if (abs > 0n && abs < tenPow(decimals)) {
    const fraction = abs.toString().padStart(decimals, '0');
    const leadingZeros = fraction.length - fraction.replace(/^0+/, '').length;
    digits = Math.max(minFractionDigits, leadingZeros + significant);
  }
  return formatUnits(value, decimals, Math.min(digits, decimals));
}

export function formatUsd(value: bigint, feedDecimals = 8, maxFractionDigits = 2): string {
  return `$${formatUnits(value, feedDecimals, maxFractionDigits)}`;
}
