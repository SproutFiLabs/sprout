/**
 * Bumpiness: how much a price has swung, measured plainly from daily closing
 * prices over the window Sprout has. It describes the past only.
 *
 *  - Typical daily move: the median size of the day-to-day changes (up or
 *    down), so half of the days moved more and half less. The label comes
 *    from this number alone:
 *      under 1%  Calm
 *      1% to 2%  Bumpy
 *      2% or more  Very bumpy
 *    (A 1% typical day is roughly a 24% yearly volatility, a 2% one about 47%.)
 *  - Biggest fall from a high: the largest drop from a closing high to a
 *    later closing low (maximum drawdown), with both dates.
 *  - Change: first close to last close.
 *
 * With fewer than MIN_MOVES daily moves there is no label, only the numbers.
 */

export interface ClosePoint {
  /** YYYY-MM-DD */
  date: string;
  value: number;
}

export type BumpinessLevel = 'calm' | 'bumpy' | 'very-bumpy';

export const CALM_BELOW = 0.01;
export const VERY_BUMPY_FROM = 0.02;
export const MIN_MOVES = 20;

export const BUMPINESS_LABEL: Record<BumpinessLevel, string> = {
  calm: 'Calm',
  bumpy: 'Bumpy',
  'very-bumpy': 'Very bumpy',
};

export interface Bumpiness {
  from: string;
  to: string;
  /** Daily closes in the window. */
  days: number;
  /** Day-to-day moves measured (days - 1). */
  moves: number;
  /** Median absolute daily change, as a fraction (0.012 = 1.2%). */
  typicalMove: number;
  /** Largest fall from a high, as a positive fraction, or null if the price never fell below an earlier high. */
  biggestFall: { fraction: number; from: string; to: string } | null;
  /** First close to last close, as a fraction (can be negative). */
  change: number;
  /** Null when the window is too short to call. */
  level: BumpinessLevel | null;
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

export function levelFor(typicalMove: number): BumpinessLevel {
  if (typicalMove < CALM_BELOW) return 'calm';
  if (typicalMove < VERY_BUMPY_FROM) return 'bumpy';
  return 'very-bumpy';
}

export function bumpiness(points: readonly ClosePoint[]): Bumpiness | null {
  const series = points.filter((p) => Number.isFinite(p.value) && p.value > 0);
  if (series.length < 2) return null;
  const moves = series.slice(1).map((p, i) => p.value / series[i]!.value - 1);
  const typicalMove = median(moves.map(Math.abs));

  let peak = series[0]!;
  let fall: Bumpiness['biggestFall'] = null;
  for (const p of series) {
    if (p.value > peak.value) peak = p;
    const drop = 1 - p.value / peak.value;
    if (drop > 0 && (!fall || drop > fall.fraction)) fall = { fraction: drop, from: peak.date, to: p.date };
  }

  return {
    from: series[0]!.date,
    to: series[series.length - 1]!.date,
    days: series.length,
    moves: moves.length,
    typicalMove,
    biggestFall: fall,
    change: series[series.length - 1]!.value / series[0]!.value - 1,
    level: moves.length >= MIN_MOVES ? levelFor(typicalMove) : null,
  };
}
