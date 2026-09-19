import { describe, expect, test } from 'bun:test';
import { MASK, isDiscreetShortcut, maskSegments, maskText } from '../src/privacyPack/discreet';

const hidden = (text: string) => maskText(text, { symbols: ['USDG', 'AAPL', 'AAA', 'Settlement'] });

describe('discreet mode: finding amounts in text', () => {
  test('dollar amounts keep their sign and currency, and never their length', () => {
    expect(hidden('$2,480.65')).toBe(`$${MASK}`);
    expect(hidden('$0.5')).toBe(`$${MASK}`);
    expect(hidden('$1,234,567,890.12')).toBe(`$${MASK}`);
    expect(hidden('-$12.30 (−3.2%)')).toBe(`-$${MASK} (−3.2%)`);
    expect(hidden('+$80.65')).toBe(`+$${MASK}`);
    expect(hidden('US$5')).toBe(`US$${MASK}`);
    expect(hidden('$ 25 every week')).toBe(`$ ${MASK} every week`);
    expect(hidden('Put in $1,025 · Growth $80.65 (+7.9%)')).toBe(`Put in $${MASK} · Growth $${MASK} (+7.9%)`);
    expect(hidden('已投入 $1,025')).toBe(`已投入 $${MASK}`);
  });

  test('token amounts hide the number and keep the ticker', () => {
    expect(hidden('10.00 USDG')).toBe(`${MASK} USDG`);
    expect(hidden('about 0.1234 AAPL')).toBe(`about ${MASK} AAPL`);
    expect(hidden('1,000.5 Settlement → 3 AAA')).toBe(`${MASK} Settlement → ${MASK} AAA`);
    expect(hidden('Available to invest: 25 USDG')).toBe(`Available to invest: ${MASK} USDG`);
    expect(hidden('0.3 shares')).toBe(`${MASK} shares`);
    expect(hidden('0.3 股')).toBe(`${MASK} 股`);
    expect(hidden('Available to invest: 350 settlement')).toBe(`Available to invest: ${MASK} settlement`);
    expect(hidden('可投资：350 结算代币')).toBe(`可投资：${MASK} 结算代币`);
  });

  test('dates, times, counts, percentages and addresses are left alone', () => {
    for (const text of [
      '2030-01-01 00:00 UTC',
      'Step 2 of 3',
      '42%',
      'Sep 19, 2026',
      'Invitation expires in 7 days',
      '0x70997970C51812dc3A010C7d01b50e0d17dc79C8',
      '3 gifts from 2 wallets',
      '1W 1M 3M 1Y',
      'AAPL',
      'Family sprout 2',
    ])
      expect(hidden(text)).toBe(text);
  });

  test('a number is not taken from inside a word or a longer ticker', () => {
    expect(hidden('0x12AAPL')).toBe('0x12AAPL');
    expect(hidden('5 AAPLE')).toBe('5 AAPLE');
    expect(hidden('v1.2 USDGX')).toBe('v1.2 USDGX');
  });

  test('React’s "$" + {amount} pieces are read together and masked piece by piece', () => {
    expect(maskSegments(['$', '1,500'])).toEqual(['$', MASK]);
    expect(maskSegments(['10.00', ' ', 'USDG'], { symbols: ['USDG'] })).toEqual([MASK, ' ', 'USDG']);
    expect(maskSegments(['$2,4', '80.65'])).toEqual([`$${MASK}`, '']);
    expect(maskSegments(['Due ', 'Sep 19'])).toBeNull();
  });

  test('elements that only hold amounts hide every number', () => {
    expect(maskText('12.3456', { bare: true })).toBe(MASK);
    expect(maskText('5.00', { bare: true })).toBe(MASK);
    expect(maskText('+ 2 USDG', { bare: true })).toBe(`+ ${MASK} USDG`);
    expect(maskText('n/a', { bare: true })).toBe('n/a');
  });

  test('the shortcut is Alt+Shift+H (Option+Shift+H), and not with Ctrl or Cmd', () => {
    const key = { altKey: true, shiftKey: true, ctrlKey: false, metaKey: false, code: 'KeyH' };
    expect(isDiscreetShortcut(key)).toBe(true);
    expect(isDiscreetShortcut({ ...key, ctrlKey: true })).toBe(false);
    expect(isDiscreetShortcut({ ...key, metaKey: true })).toBe(false);
    expect(isDiscreetShortcut({ ...key, shiftKey: false })).toBe(false);
    expect(isDiscreetShortcut({ ...key, code: 'KeyJ' })).toBe(false);
  });
});
