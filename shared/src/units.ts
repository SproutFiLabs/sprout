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

export function formatUsd(value: bigint, feedDecimals = 8, maxFractionDigits = 2): string {
  return `$${formatUnits(value, feedDecimals, maxFractionDigits)}`;
}
