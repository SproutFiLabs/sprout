import { dateLocale } from '../i18n';

/** A price in dollars: $335.38 (three decimals under $10). */
export function money(value: number): string {
  return new Intl.NumberFormat(dateLocale(), {
    style: 'currency',
    currency: 'USD',
    currencyDisplay: 'narrowSymbol',
    minimumFractionDigits: 2,
    maximumFractionDigits: value < 10 ? 3 : 2,
  }).format(value);
}

/** 0.0123 → "1.2%"; signed adds "+" (and a true minus sign) for changes. */
export function percent(fraction: number, signed = false): string {
  const digits = Math.abs(fraction) < 0.1 ? 1 : 0;
  const text = `${(Math.abs(fraction) * 100).toFixed(digits)}%`;
  if (!signed) return text;
  if (Math.abs(fraction) < 0.0005) return text;
  return `${fraction > 0 ? '+' : '−'}${text}`;
}

/** An index level: 108.4 */
export function indexLevel(value: number): string {
  return value.toLocaleString(dateLocale(), { minimumFractionDigits: 1, maximumFractionDigits: 1 });
}

/** "2026-06-23" → "Jun 23" / "6月23日" (or with the year). */
export function day(date: string, withYear = false): string {
  return new Date(`${date}T00:00:00Z`).toLocaleDateString(dateLocale(), {
    month: 'short',
    day: 'numeric',
    ...(withYear ? { year: 'numeric' } : {}),
    timeZone: 'UTC',
  });
}

/** Unix seconds → "Sep 18, 2026" in UTC, matching the daily closes. */
export function dayOf(seconds: number, withYear = true): string {
  return day(new Date(seconds * 1000).toISOString().slice(0, 10), withYear);
}
