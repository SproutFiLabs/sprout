import { describe, expect, test } from 'bun:test';
import { ROOT_MULTIPLIER_BPS, rootCredit } from '@sprout/shared';
import type { HolderStatus, PerksInfo, RootInfo } from '../src/perks/holder';
import { compactSprout, multiplierLabel, parseSprout, previewRoot, rootDurations, rootedCounter, sharePercent, tierForAmount } from '../src/perks/root';

const E18 = 10n ** 18n;
const TIERS: PerksInfo['tiers'] = [
  { id: 'seedling', min: '100000' },
  { id: 'sapling', min: '1000000' },
  { id: 'bloom', min: '5000000' },
  { id: 'grove', min: '10000000' },
];
const status = (over: Partial<HolderStatus> = {}): HolderStatus => ({
  address: '0x1',
  enabled: true,
  decimals: 18,
  balance: '0',
  heldBalance: '0',
  tier: null,
  currentTier: null,
  holdDays: 7,
  holdSeconds: 604_800,
  windowStart: 0,
  checkedAt: 0,
  ...over,
});
const root = (over: Partial<RootInfo> = {}): RootInfo => ({
  contract: '0x00000000000000000000000000000000000f10cc',
  durations: [
    { days: 30, multiplierBps: 12_500 },
    { days: 90, multiplierBps: 15_000 },
    { days: 180, multiplierBps: 20_000 },
  ],
  rootedTotal: (812_500n * E18).toString(),
  rootedShare: 0.0008125,
  supply: (1_000_000_000n * E18).toString(),
  decimals: 18,
  ...over,
});

describe('multipliers', () => {
  test('30, 90 and 180 days count x1.25, x1.5 and x2 (the table the server uses)', () => {
    expect(ROOT_MULTIPLIER_BPS).toEqual({ 30: 12_500, 90: 15_000, 180: 20_000 });
    expect([30, 90, 180].map((d) => multiplierLabel(d as 30 | 90 | 180))).toEqual(['×1.25', '×1.5', '×2']);
    expect(rootCredit(800_000n * E18, 30)).toBe(1_000_000n * E18);
    expect(rootCredit(800_000n * E18, 90)).toBe(1_200_000n * E18);
    expect(rootCredit(800_000n * E18, 180)).toBe(1_600_000n * E18);
    expect(rootCredit(1n, 30)).toBe(1n); // rounds down, never up
  });

  test('the offered lengths follow the server, in order', () => {
    expect(rootDurations(root())).toEqual([30, 90, 180]);
    expect(rootDurations(root({ durations: [{ days: 180, multiplierBps: 20_000 }, { days: 30, multiplierBps: 12_500 }, { days: 7, multiplierBps: 99_999 }] }))).toEqual([30, 180]);
  });
});

describe('the lock preview', () => {
  test('a new holder: the lock alone reaches a tier, right away', () => {
    const p = previewRoot(status({ balance: (3_000_000n * E18).toString() }), 800_000n * E18, 30, TIERS);
    expect(p.credit).toBe(1_000_000n * E18);
    expect(p.effective).toBe(1_000_000n * E18);
    expect(p.tier).toBe('sapling');
  });

  test('the held balance can only drop to what stays in the wallet', () => {
    // Held 3M all week; locks 2.5M for 180 days: 0.5M stays, plus 5M counted.
    const s = status({ balance: (3_000_000n * E18).toString(), heldBalance: (3_000_000n * E18).toString(), tier: 'sapling' });
    const p = previewRoot(s, 2_500_000n * E18, 180, TIERS);
    expect(p.effective).toBe(5_500_000n * E18);
    expect(p.tier).toBe('bloom');
    // Locking everything leaves nothing held.
    expect(previewRoot(s, 3_000_000n * E18, 90, TIERS).effective).toBe(4_500_000n * E18);
  });

  test('existing locks keep counting', () => {
    const s = status({ balance: (1_000_000n * E18).toString(), heldBalance: '0', lockCredit: (8_000_000n * E18).toString() });
    expect(previewRoot(s, 1_000_000n * E18, 180, TIERS).tier).toBe('grove');
  });

  test('tiers match the server ladder at the boundaries', () => {
    expect(tierForAmount(99_999n * E18, 18, TIERS)).toBeNull();
    expect(tierForAmount(100_000n * E18, 18, TIERS)).toBe('seedling');
    expect(tierForAmount(10_000_000n * E18, 18, TIERS)).toBe('grove');
  });

  test('amounts people type', () => {
    expect(parseSprout('800,000', 18)).toBe(800_000n * E18);
    expect(parseSprout(' 1 250 000.5 ', 18)).toBe(1_250_000n * E18 + 5n * 10n ** 17n);
    expect(parseSprout('0', 18)).toBeNull();
    expect(parseSprout('-5', 18)).toBeNull();
    expect(parseSprout('1e6', 18)).toBeNull();
    expect(parseSprout('abc', 18)).toBeNull();
    expect(parseSprout('0.0000001', 6)).toBeNull();
  });
});

describe('the rooted counter', () => {
  test('total and share of the supply', () => {
    expect(rootedCounter(root())).toEqual({ total: '812,500', share: '0.08%' });
    expect(rootedCounter(root({ rootedTotal: (123_456_789n * E18).toString(), rootedShare: 0.123456 }))).toEqual({ total: '123.4M', share: '12.3%' });
    expect(rootedCounter(root({ rootedTotal: '0', rootedShare: 0 }))).toEqual({ total: '0', share: '0%' });
  });

  test('never rounds a real lock down to nothing', () => {
    expect(sharePercent(0.0000004)).toBe('<0.01%');
    expect(sharePercent(0.05)).toBe('5%');
    expect(sharePercent(0.0125)).toBe('1.25%');
    expect(sharePercent(1)).toBe('100%');
  });

  test('big numbers stay short', () => {
    expect(compactSprout(9_999_999n * E18, 18)).toBe('9,999,999');
    expect(compactSprout(10_000_000n * E18, 18)).toBe('10M');
    expect(compactSprout(1_020_000_000n * E18, 18)).toBe('1B');
  });

  test('hidden when the feature is off or the total is unknown', () => {
    expect(rootedCounter(undefined)).toBeNull();
    expect(rootedCounter(root({ rootedTotal: null }))).toBeNull();
  });
});

describe('wording', () => {
  test('rooting is only ever "lock" or "root": no staking, yield, interest, APY, earnings or returns, in either language', async () => {
    const { zh } = await import('../src/i18n/zh/root');
    const english = Object.keys(zh).join('\n').toLowerCase();
    const chinese = Object.values(zh).join('\n');
    expect(english).not.toMatch(/\b(stak(e|ing)|apy|apr|earn(s|ed|ing)?|yield|returns?|interest|rewards?)\b/);
    expect(chinese).not.toMatch(/质押|收益|利息|年化|回报|奖励|赚/);
  });
});
