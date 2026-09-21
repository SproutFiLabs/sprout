export type SavingsCalendarOptions = {
  firstReminder: string;
  monthly: number;
  months: number;
  includeAmount?: boolean;
};

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const MAX_MONTHLY = 100_000_000;
const MAX_MONTHS = 600;

export function isValidCalendarDate(value: string): boolean {
  const match = DATE_RE.exec(value);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (year < 100 || year > 9999) return false;
  const date = new Date(0);
  date.setUTCFullYear(year, month - 1, day);
  date.setUTCHours(0, 0, 0, 0);
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

export function validateSavingsCalendarOptions(options: SavingsCalendarOptions): void {
  if (!Number.isFinite(options.monthly) || options.monthly < 0 || options.monthly > MAX_MONTHLY) {
    throw new Error("Monthly amount must be between 0 and 100,000,000.");
  }
  if (!Number.isInteger(options.months) || options.months < 1 || options.months > MAX_MONTHS) {
    throw new Error("Number of months must be a whole number from 1 to 600.");
  }
  if (!isValidCalendarDate(options.firstReminder)) throw new Error("Choose a real calendar date.");
}

export function reminderDates(firstReminder: string, months: number): string[] {
  if (!isValidCalendarDate(firstReminder) || !Number.isInteger(months) || months < 1 || months > MAX_MONTHS)
    throw new Error("Invalid calendar schedule.");
  const parts = firstReminder.split("-").map(Number);
  const year = parts[0]!;
  const month = parts[1]!;
  const day = parts[2]!;
  return Array.from({ length: months }, (_, index) => {
    const absoluteMonth = month - 1 + index;
    const targetYear = year + Math.floor(absoluteMonth / 12);
    const targetMonth = absoluteMonth % 12;
    const lastDate = new Date(0);
    lastDate.setUTCFullYear(targetYear, targetMonth + 1, 0);
    lastDate.setUTCHours(0, 0, 0, 0);
    const lastDay = lastDate.getUTCDate();
    if (targetYear > 9999 || (targetYear === 9999 && targetMonth === 11 && Math.min(day, lastDay) === 31))
      throw new Error("Schedule exceeds the supported calendar range.");
    return `${String(targetYear).padStart(4, "0")}-${String(targetMonth + 1).padStart(2, "0")}-${String(Math.min(day, lastDay)).padStart(2, "0")}`;
  });
}

function nextDay(date: string): string {
  const [year, month, day] = date.split("-").map(Number) as [number, number, number];
  const next = new Date(0);
  next.setUTCFullYear(year, month - 1, day + 1);
  next.setUTCHours(0, 0, 0, 0);
  return `${String(next.getUTCFullYear()).padStart(4, "0")}-${String(next.getUTCMonth() + 1).padStart(2, "0")}-${String(next.getUTCDate()).padStart(2, "0")}`;
}

function escapeText(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");
}

function foldLine(line: string): string[] {
  const result: string[] = [];
  let current = "";
  for (const character of line) {
    const bytes = new TextEncoder().encode(current + character).length;
    const limit = result.length ? 74 : 75;
    if (bytes > limit) {
      result.push(current);
      current = character;
    } else current += character;
  }
  result.push(current);
  return result;
}

export function foldIcsLine(line: string): string {
  return foldLine(line).join("\r\n ");
}

export function buildSavingsCalendarIcs(options: SavingsCalendarOptions, uid: string = crypto.randomUUID(), now = new Date()): string {
  validateSavingsCalendarOptions(options);
  const dates = reminderDates(options.firstReminder, options.months);
  const stamp = now
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/\.\d{3}Z$/, "Z");
  const events = dates.map((date, index) => {
    const next = nextDay(date);
    const description = options.includeAmount
      ? `Monthly savings reminder\nAmount: USD $${options.monthly.toFixed(2)}`
      : "Monthly savings reminder";
    return [
      "BEGIN:VEVENT",
      `UID:${escapeText(`${uid}-${index + 1}`)}`,
      `DTSTAMP:${stamp}`,
      `DTSTART;VALUE=DATE:${date.replace(/-/g, "")}`,
      `DTEND;VALUE=DATE:${next.replace(/-/g, "")}`,
      "SUMMARY:Monthly savings reminder",
      `DESCRIPTION:${escapeText(description)}`,
      "END:VEVENT",
    ]
      .map(foldIcsLine)
      .join("\r\n");
  });
  return (
    [
      foldIcsLine("BEGIN:VCALENDAR"),
      foldIcsLine("VERSION:2.0"),
      foldIcsLine("PRODID:-//Sprout//Savings Calendar//EN"),
      foldIcsLine("CALSCALE:GREGORIAN"),
      ...events,
      foldIcsLine("END:VCALENDAR"),
    ].join("\r\n") + "\r\n"
  );
}

export function defaultReminderDate(today = new Date()): string {
  const year = today.getFullYear();
  const month = today.getMonth() + 1;
  const nextMonth = month === 12 ? 1 : month + 1;
  return `${String(year + (month === 12 ? 1 : 0)).padStart(4, "0")}-${String(nextMonth).padStart(2, "0")}-01`;
}
