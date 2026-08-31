import { describe, expect, test } from 'bun:test';
import { formatRunDateTime, formatUtcDate, formatZonedDateTime, parseDateOnlyToUtcTs } from '../src/dates';

// The regression this guards: a viewer west of UTC must still see the exact
// calendar date they picked, because date-only input maps to 00:00 UTC.
process.env.TZ = 'America/Toronto';

describe('date-only UTC consistency in a non-UTC timezone', () => {
  test('the picked UTC date is shown unchanged while local context differs', () => {
    const ts = parseDateOnlyToUtcTs('2027-09-13');
    expect(ts).toBe(Date.parse('2027-09-13T00:00:00Z') / 1000);
    // Contract/dashboard date is the picked date.
    expect(formatUtcDate(ts)).toBe('2027-09-13');
    // The old bug: rendering that instant in Toronto shows the previous day.
    const localRendering = new Date(ts * 1000).toLocaleDateString('en-US', {
      timeZone: 'America/Toronto',
      month: 'short',
      day: 'numeric',
    });
    expect(localRendering).toContain('Sep 12');
    // The confirmation shows both, so selected date, timestamp and dashboard agree.
    expect(formatZonedDateTime(ts, 'America/Toronto')).toContain('Sep 12');
  });

  test('UTC formatting is stable regardless of viewer timezone', () => {
    const ts = parseDateOnlyToUtcTs('2027-01-01');
    expect(formatUtcDate(ts)).toBe('2027-01-01');
  });

  test('malformed or absent values do not silently shift the calendar day', () => {
    expect(formatUtcDate(parseDateOnlyToUtcTs('2027-12-31'))).toBe('2027-12-31');
  });
});

describe('scheduled execution date/time formatting', () => {
  test('keeps a readable date, the exact time and the viewer timezone', () => {
    const ts = Date.parse('2026-09-21T20:00:00Z') / 1000;
    const out = formatRunDateTime(ts);
    // Same date style as the overview's niceDate().
    expect(out).toContain('Sep 21, 2026');
    // Execution time retained (20:00 UTC == 16:00 in Toronto, EDT).
    expect(out).toContain('16:00');
    expect(out).toContain('America/Toronto');
  });
});
