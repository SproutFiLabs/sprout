import { describe, expect, test } from "bun:test";
import { normalizeHoldings } from "../src/tools/PortfolioVisualizer";

describe("portfolio visualizer arithmetic", () => {
  test("combines duplicate symbols deterministically", () =>
    expect(
      normalizeHoldings([
        { symbol: "CASH", valueUsd: "2" },
        { symbol: "CASH", valueUsd: "3" },
      ]).report?.holdings,
    ).toEqual([{ symbol: "CASH", valueUsd: 5, percent: 100 }]));
  test("rejects zero totals and invalid values", () => {
    expect(normalizeHoldings([{ symbol: "CASH", valueUsd: "0" }]).error).toContain("positive");
    expect(normalizeHoldings([{ symbol: "cash", valueUsd: "1" }]).error).toBeTruthy();
  });
});
