import { describe, expect, test } from "bun:test";
import {
  buildSavingsCalendarIcs,
  foldIcsLine,
  isValidCalendarDate,
  reminderDates,
  validateSavingsCalendarOptions,
} from "../src/tools/savings-calendar-utils";

describe("savings calendar", () => {
  test("clamps leap and short months while preserving every reminder", () => {
    expect(reminderDates("2024-01-31", 4)).toEqual(["2024-01-31", "2024-02-29", "2024-03-31", "2024-04-30"]);
    expect(buildSavingsCalendarIcs({ firstReminder: "2024-01-31", monthly: 25, months: 4 }, "test")).toMatch(/DTEND;VALUE=DATE:20240201/);
    expect(buildSavingsCalendarIcs({ firstReminder: "2024-01-31", monthly: 25, months: 4 }, "test").match(/BEGIN:VEVENT/g)?.length).toBe(4);
  });
  test("all-day events end the next day across leap and year boundaries", () => {
    for (const [date, end] of [
      ["2024-02-29", "20240301"],
      ["2026-12-31", "20270101"],
    ]) {
      expect(buildSavingsCalendarIcs({ firstReminder: date!, monthly: 25, months: 1 }, "test")).toContain(`DTEND;VALUE=DATE:${end}`);
    }
    expect(() => reminderDates("9999-12-31", 1)).toThrow();
    expect(() => reminderDates("9999-11-01", 3)).toThrow();
    const line = `DESCRIPTION:${"育".repeat(100)}`;
    const folded = foldIcsLine(line);
    expect(folded.replaceAll("\r\n ", "")).toBe(line);
    for (const part of folded.split("\r\n")) expect(new TextEncoder().encode(part).length).toBeLessThanOrEqual(75);
  });
  test("rejects invalid dates and unsafe bounds", () => {
    expect(isValidCalendarDate("2023-02-29")).toBe(false);
    expect(() => validateSavingsCalendarOptions({ firstReminder: "2023-02-29", monthly: 1, months: 1 })).toThrow();
    expect(() => validateSavingsCalendarOptions({ firstReminder: "2024-01-01", monthly: Infinity, months: 1 })).toThrow();
    expect(() => validateSavingsCalendarOptions({ firstReminder: "2024-01-01", monthly: 1, months: 601 })).toThrow();
  });
  test("amount is omitted by default and long lines fold at 75 octets", () => {
    const ics = buildSavingsCalendarIcs({ firstReminder: "2024-01-01", monthly: 25, months: 1 }, "test");
    expect(ics).not.toContain("Amount:");
    expect(buildSavingsCalendarIcs({ firstReminder: "2024-01-01", monthly: 25, months: 1, includeAmount: true }, "test")).toContain(
      "Amount: USD $25.00",
    );
    expect(ics).toContain("\r\n");
    expect(foldIcsLine(`DESCRIPTION:${"x".repeat(100)}`)).toContain("\r\n ");
    expect(foldIcsLine(`DESCRIPTION:${"育".repeat(40)}`)).toContain("\r\n ");
  });
});
