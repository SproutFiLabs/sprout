import { describe, expect, test } from 'bun:test';
import { allocationReport, comparisonReport, goalReport, projectSavings } from '../../shared/src/toolReports';

describe('planning tools', () => {
  test('zero return is initial savings plus contributions; initial goal is month zero', () => {
    const goal = goalReport({ initial: 1000, monthly: 100, months: 12, annualReturn: 0, target: 2200 });
    expect(goal.rows.at(-1)).toEqual({ month: 12, contributed: 2200, projected: 2200 });
    expect(goal.requiredMonthly).toBe(100);
    expect(goal.firstGoalMonth).toBe(12);
    expect(goalReport({ initial: 1000, monthly: 0, months: 12, annualReturn: 0, target: 1000 }).firstGoalMonth).toBe(0);
  });
  test('effective annual growth matches one year and deposits earn only after arrival', () => {
    const rows = projectSavings({ initial: 1000, monthly: 0, months: 12, annualReturn: 12 });
    expect(rows.at(-1)!.projected).toBe(1120);
    expect(projectSavings({ initial: 0, monthly: 100, months: 1, annualReturn: 12 }).at(-1)!.projected).toBe(100);
  });
  test('negative returns remain losses, and required contribution reaches the target', () => {
    const goal = goalReport({ initial: 1000, monthly: 0, months: 12, annualReturn: -20, target: 1000 });
    expect(goal.rows.at(-1)!.projected).toBe(800);
    expect(goal.firstGoalMonth).toBe(0);
    expect(goal.shortfall).toBe(200);
    expect(
      projectSavings({ initial: 1000, monthly: goal.requiredMonthly, months: 12, annualReturn: -20 }).at(-1)!.projected,
    ).toBeGreaterThanOrEqual(1000);
  });
  test('comparison separates extra contributions from growth and supports a lower alternative', () => {
    const result = comparisonReport({ initial: 100, monthly: 20, alternativeMonthly: 10, months: 12, annualReturn: 0 });
    expect(result.extraContributed).toBe(-120);
    expect(result.projectedDifference).toBe(-120);
  });
  test('invalid, infinite and explosive inputs are refused', () => {
    for (const value of [NaN, Infinity, -1])
      expect(() => projectSavings({ initial: value, monthly: 1, months: 12, annualReturn: 0 })).toThrow();
    expect(() => projectSavings({ initial: 1, monthly: 1, months: 0, annualReturn: 0 })).toThrow();
    expect(() => projectSavings({ initial: 1e8, monthly: 1e8, months: 600, annualReturn: 50 })).toThrow();
  });
});

describe('portfolio allocation', () => {
  test('combines repeated assets and computes weights from total value', () => {
    const report = allocationReport([
      { symbol: 'WETH', valueUsd: 20 },
      { symbol: 'CBBTC', valueUsd: 60 },
      { symbol: 'WETH', valueUsd: 20 },
    ]);
    expect(report.totalUsd).toBe(100);
    expect(report.holdings).toEqual([
      { symbol: 'CBBTC', valueUsd: 60, percent: 60 },
      { symbol: 'WETH', valueUsd: 40, percent: 40 },
    ]);
    expect(report.topThreePercent).toBe(100);
  });
  test('refuses empty or negative valuations and unsafe symbols', () => {
    expect(() => allocationReport([])).toThrow();
    expect(() => allocationReport([{ symbol: 'A', valueUsd: 0 }])).toThrow();
    expect(() => allocationReport([{ symbol: '<script>', valueUsd: 1 }])).toThrow();
    expect(() => allocationReport([{ symbol: 'A', valueUsd: -1 }])).toThrow();
  });
});
