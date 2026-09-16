/**
 * "What you put in vs. what it's worth": pure helpers for the portfolio card.
 *
 * Server amounts are 8-decimal USD integer strings (the scale of snapshot
 * valueUsd). Arithmetic stays in bigint; numbers are only used for drawing and
 * for the final display strings.
 */

export interface ContributionPoint {
  /** Unix seconds (block time). */
  at: number;
  /** Net amount put in so far, 8-decimal USD. */
  netUsd: string;
}

export interface ContributionTotals {
  inUsd: string;
  outUsd: string;
  netUsd: string;
}

const USD_DECIMALS = 8;

function toUsd8(value: string, decimals: number): bigint {
  const raw = BigInt(value);
  if (decimals === USD_DECIMALS) return raw;
  if (decimals < USD_DECIMALS) return raw * 10n ** BigInt(USD_DECIMALS - decimals);
  return raw / 10n ** BigInt(decimals - USD_DECIMALS);
}

/** Dollars as a plain number, for drawing. */
export function usd8ToNumber(value: string): number {
  try {
    return Number(BigInt(value)) / 1e8;
  } catch {
    return 0;
  }
}

/** "$1,025", "$80.65", "$0.50": whole dollars drop the cents. */
export function usdText(dollars: number): string {
  const cents = Math.round(Math.abs(dollars) * 100);
  const whole = cents % 100 === 0;
  return `$${(cents / 100).toLocaleString('en-US', {
    minimumFractionDigits: whole ? 0 : 2,
    maximumFractionDigits: whole ? 0 : 2,
  })}`;
}

/** "+$80.65", "-$12.30", or "$0" when it rounds to nothing. */
export function signedUsdText(dollars: number): string {
  const cents = Math.round(dollars * 100);
  if (cents === 0) return '$0';
  return `${cents > 0 ? '+' : '-'}${usdText(cents / 100)}`;
}

/** "+3.4%", "-0.04%", "0%". */
export function signedPercentText(percent: number): string {
  const abs = Math.abs(percent);
  const digits = abs < 0.1 ? 2 : 1;
  const rounded = Number(abs.toFixed(digits));
  if (rounded === 0) return '0%';
  return `${percent > 0 ? '+' : '-'}${rounded.toFixed(digits)}%`;
}

/** Net amount put in as of `atSeconds` (0 before the first step). */
export function putInAt(contributions: ContributionPoint[], atSeconds: number): number {
  let value = 0;
  for (const point of contributions) {
    if (point.at > atSeconds) break;
    value = usd8ToNumber(point.netUsd);
  }
  return value;
}

/**
 * Corner points of the put-in step line between two times (seconds): it starts
 * at the amount already put in, moves across, then up or down at each step.
 * Steps outside the span are not drawn; the summary figures still count them.
 */
export function putInSteps(
  contributions: ContributionPoint[],
  fromSeconds: number,
  toSeconds: number,
): Array<{ t: number; v: number }> {
  const sorted = [...contributions].sort((a, b) => a.at - b.at);
  let value = putInAt(sorted, fromSeconds);
  const points = [{ t: fromSeconds, v: value }];
  for (const point of sorted) {
    if (point.at <= fromSeconds) continue;
    if (point.at > toSeconds) break;
    const next = usd8ToNumber(point.netUsd);
    points.push({ t: point.at, v: value }, { t: point.at, v: next });
    value = next;
  }
  points.push({ t: toSeconds, v: value });
  return points;
}

export interface GrowthSummary {
  /** Net money put in, e.g. "$1,025". */
  putIn: string;
  /** Value minus net put in, e.g. "+$80.65"; null when the put-in figure is incomplete. */
  growth: string | null;
  /** Growth as a share of net put in; null when nothing (or less than nothing) is in. */
  percent: string | null;
  tone: 'up' | 'down' | 'flat';
}

/**
 * Summary for the card. `worthUsd` is the current total value the card shows.
 * When some deposits could not be valued (`incomplete`), growth against the
 * partial figure would be wrong, so only the put-in amount is returned.
 */
export function growthSummary(args: {
  totals: ContributionTotals;
  worthUsd: string;
  worthDecimals: number;
  incomplete?: boolean;
}): GrowthSummary | null {
  let net: bigint;
  let worth: bigint;
  try {
    net = BigInt(args.totals.netUsd);
    worth = toUsd8(args.worthUsd, args.worthDecimals);
  } catch {
    return null;
  }
  const netDollars = Number(net) / 1e8;
  const putIn = `${Math.round(netDollars * 100) < 0 ? '-' : ''}${usdText(netDollars)}`;
  if (args.incomplete) return { putIn, growth: null, percent: null, tone: 'flat' };
  const diff = worth - net;
  const growth = signedUsdText(Number(diff) / 1e8);
  const tone = growth === '$0' ? 'flat' : diff > 0n ? 'up' : 'down';
  // Percent to four decimal places, in integer math.
  const percent = net > 0n ? signedPercentText(Number((diff * 1_000_000n) / net) / 10_000) : null;
  return { putIn, growth, percent: tone === 'flat' && percent !== null ? '0%' : percent, tone };
}
