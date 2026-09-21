import { describe, expect, test } from "bun:test";
import { calculateSpending, type SpendingFrequency } from "../src/tools/spendingMath";

describe("spending math", () => {
  test("annualizes weekly spending and averages it monthly", () =>
    expect(calculateSpending({ cost: "5", occurrences: "4", frequency: "week" })).toEqual({
      perOccurrence: 5,
      occurrencesPerYear: 208,
      yearly: 1040,
      monthly: 1040 / 12,
    }));
  test("uses twelve months and one year", () => {
    expect(calculateSpending({ cost: 10, occurrences: 2, frequency: "month" })?.yearly).toBe(240);
    expect(calculateSpending({ cost: 10, occurrences: 2, frequency: "year" })?.yearly).toBe(20);
  });
  test("rejects blanks, NaN and out of range values", () => {
    expect(calculateSpending({ cost: "", occurrences: 1, frequency: "week" })).toBeNull();
    expect(calculateSpending({ cost: Number.NaN, occurrences: 1, frequency: "week" })).toBeNull();
    expect(calculateSpending({ cost: 5, occurrences: 367, frequency: "week" })).toBeNull();
  });
  test("rejects an unknown runtime frequency", () =>
    expect(calculateSpending({ cost: 5, occurrences: 1, frequency: "daily" as SpendingFrequency })).toBeNull());
});
