import { describe, expect, test } from 'bun:test';
import { dollars, endOfDayUtc, giftAmountLabel, progressPercent, textProblem, timeLeftText } from '../src/components/Campaign';

const chain = {
  settlementToken: '0x00000000000000000000000000000000000000b2',
  settlementDecimals: 6,
  stockTokens: [{ address: '0x00000000000000000000000000000000000000c3', symbol: 'NVDA', decimals: 18 }],
};

describe('campaign formatting', () => {
  test('dollars drop cents only when there are none', () => {
    expect(dollars(10_000)).toBe('$100');
    expect(dollars(3550)).toBe('$35.50');
    expect(dollars(123_456_789)).toBe('$1,234,567.89');
  });

  test('progress is a whole percentage capped at 100', () => {
    expect(progressPercent({ raisedCents: 3550, goalCents: 10_000 })).toBe(36);
    expect(progressPercent({ raisedCents: 25_000, goalCents: 10_000 })).toBe(100);
    expect(progressPercent({ raisedCents: 10, goalCents: 0 })).toBe(0);
  });

  test('time left reads naturally and says when it ended', () => {
    const now = Date.UTC(2026, 8, 16, 12);
    expect(timeLeftText(Date.UTC(2026, 8, 20, 23, 59, 59) / 1000, now)).toBe('5 days left · ends Sep 20');
    expect(timeLeftText(Date.UTC(2026, 8, 16, 23, 59, 59) / 1000, now)).toBe('Ends today');
    expect(timeLeftText(Date.UTC(2026, 8, 10, 23, 59, 59) / 1000, now)).toBe('Ended Sep 10');
  });

  test('an end date means the last second of that day in UTC', () => {
    expect(endOfDayUtc('2026-09-30')).toBe(Date.UTC(2026, 8, 30, 23, 59, 59) / 1000);
    expect(endOfDayUtc('30/09/2026')).toBeNull();
  });

  test('gift amounts: dollars for the settlement token, quantity and ticker for stocks', () => {
    expect(giftAmountLabel(chain.settlementToken.toUpperCase(), '25500000', chain)).toBe('$25.50');
    expect(giftAmountLabel(chain.stockTokens[0]!.address, '5000000000000000', chain)).toBe('0.005 NVDA');
  });

  test('notes follow the server rules', () => {
    expect(textProblem('Happy birthday!', 140, 'The note')).toBeNull();
    expect(textProblem('go to www.example.com', 140, 'The note')).toBe("The note can't include links.");
    expect(textProblem('x'.repeat(141), 140, 'The note')).toBe('The note can be at most 140 characters.');
  });
});
