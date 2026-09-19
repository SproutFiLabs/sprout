import { z } from 'zod';

const money = z.number().finite().min(0).max(100_000_000);
const horizon = z.number().int().min(1).max(600);
const annualReturn = z.number().finite().min(-90).max(50);
export const planningInput = z
  .object({
    initial: money,
    monthly: money,
    months: horizon,
    annualReturn,
  })
  .strict();
export const goalInput = planningInput.extend({ target: money.positive() });
export const comparisonInput = planningInput.extend({ alternativeMonthly: money });
export type PlanningInput = z.infer<typeof planningInput>;

export interface ProjectionRow {
  month: number;
  contributed: number;
  projected: number;
}

const cents = (value: number) => Math.round(value * 100) / 100;

/** Effective annual return, converted to monthly compounding; deposits at month end. */
export function projectSavings(raw: PlanningInput): ProjectionRow[] {
  const input = planningInput.parse(raw);
  const monthlyRate = Math.expm1(Math.log1p(input.annualReturn / 100) / 12);
  let balance = input.initial;
  const rows: ProjectionRow[] = [{ month: 0, contributed: cents(input.initial), projected: cents(balance) }];
  for (let month = 1; month <= input.months; month++) {
    balance = balance * (1 + monthlyRate) + input.monthly;
    if (!Number.isFinite(balance) || balance > 1e15) throw new Error('These assumptions produce a result outside the supported range.');
    rows.push({ month, contributed: cents(input.initial + month * input.monthly), projected: cents(balance) });
  }
  return rows;
}

export function goalReport(raw: z.infer<typeof goalInput>) {
  const input = goalInput.parse(raw);
  const { target, ...planning } = input;
  const rows = projectSavings(planning);
  const growth = Math.pow(1 + input.annualReturn / 100, input.months / 12);
  const rate = Math.expm1(Math.log1p(input.annualReturn / 100) / 12);
  const factor = rate === 0 ? input.months : Math.expm1(input.months * Math.log1p(rate)) / rate;
  const needed = Math.max(0, (target - input.initial * growth) / factor);
  return {
    rows,
    firstGoalMonth: rows.find((row) => row.projected >= target)?.month ?? null,
    // Round up so the displayed contribution is sufficient under the stated model.
    requiredMonthly: Math.ceil(needed * 100) / 100,
    shortfall: cents(Math.max(0, target - rows[rows.length - 1]!.projected)),
  };
}

export function comparisonReport(raw: z.infer<typeof comparisonInput>) {
  const input = comparisonInput.parse(raw);
  const { alternativeMonthly, ...planning } = input;
  const baseline = projectSavings(planning);
  const alternative = projectSavings({ ...planning, monthly: alternativeMonthly });
  return {
    baseline,
    alternative,
    extraContributed: cents((alternativeMonthly - input.monthly) * input.months),
    projectedDifference: cents(alternative[alternative.length - 1]!.projected - baseline[baseline.length - 1]!.projected),
  };
}

export const allocationInput = z
  .array(
    z.object({
      symbol: z.string().regex(/^[A-Z0-9.-]{1,16}$/),
      valueUsd: money,
    }),
  )
  .min(1)
  .max(100);

/** A descriptive allocation snapshot, with no recommendation or invented valuation. */
export function allocationReport(raw: z.infer<typeof allocationInput>) {
  const input = allocationInput.parse(raw);
  const combined = new Map<string, number>();
  for (const row of input) combined.set(row.symbol, (combined.get(row.symbol) ?? 0) + row.valueUsd);
  const totalUsd = [...combined.values()].reduce((sum, value) => sum + value, 0);
  if (totalUsd <= 0) throw new Error('A report needs at least one holding with a positive value.');
  const holdings = [...combined]
    .map(([symbol, valueUsd]) => ({ symbol, valueUsd: cents(valueUsd), percent: cents((valueUsd / totalUsd) * 100) }))
    .sort((a, b) => b.valueUsd - a.valueUsd || a.symbol.localeCompare(b.symbol));
  return {
    totalUsd: cents(totalUsd),
    holdings,
    largestHolding: holdings[0]!,
    topThreePercent: cents((holdings.slice(0, 3).reduce((sum, row) => sum + row.valueUsd, 0) / totalUsd) * 100),
  };
}

export const PROJECTION_ASSUMPTIONS =
  'Illustration using your chosen constant effective annual return, monthly compounding and contributions at month end. Excludes fees, taxes and inflation. Actual returns vary and may be negative; this is not a forecast.';
