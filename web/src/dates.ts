/**
 * Date-only inputs (`<input type="date">`) are interpreted as 00:00 UTC, matching
 * how a bare `YYYY-MM-DD` string parses and how the contract stores the selected
 * graduation/unlock timestamp. Presentation must therefore use UTC too, otherwise
 * a viewer west of UTC sees the previous calendar day.
 */

import { dateLocale, t } from './i18n';

/** Parse a date-only `YYYY-MM-DD` value as 00:00 UTC seconds. */
export function parseDateOnlyToUtcTs(dateOnly: string): number {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateOnly);
  if (!match) return Math.floor(new Date(dateOnly).getTime() / 1000);
  return Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])) / 1000;
}

/** Calendar date in UTC (`YYYY-MM-DD`), independent of the viewer's timezone. */
export function formatUtcDate(tsSeconds: number): string {
  return new Date(tsSeconds * 1000).toLocaleDateString('en-CA', {
    timeZone: 'UTC',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
}

/** Date-time in UTC, used for explicit confirmations. */
export function formatUtcDateTime(tsSeconds: number): string {
  return new Date(tsSeconds * 1000).toLocaleString(dateLocale(), {
    timeZone: 'UTC',
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
}

/** Same instant rendered in a given (or the viewer's) timezone, for context. */
export function formatZonedDateTime(tsSeconds: number, timeZone?: string, locale = dateLocale()): string {
  return new Date(tsSeconds * 1000).toLocaleString(locale, {
    timeZone,
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
}

export function viewerTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch {
    return 'UTC';
  }
}

/**
 * Readable date + time + timezone for scheduled execution times (e.g. the next
 * weekly investment run). The date part matches the dashboard's `niceDate`
 * style; the time and zone are kept because when the vault executes matters.
 */
export function formatRunDateTime(tsSeconds: number): string {
  return t('{date} ({zone})', { date: formatZonedDateTime(tsSeconds), zone: viewerTimeZone() });
}
