import { describe, expect, test } from 'bun:test';
import { clearLocalFamilyData, errorMessage, localFamilyData, normalizeLabelKey, publicPicture, type KeyStore } from '../src/privacyPack/data';
import type { ChainEvent } from '../src/api';

function memoryStore(entries: Record<string, string> = {}): KeyStore & { dump: () => Record<string, string> } {
  const values = new Map(Object.entries(entries));
  return {
    getItem: (k) => values.get(k) ?? null,
    setItem: (k, v) => void values.set(k, v),
    removeItem: (k) => void values.delete(k),
    key: (i) => [...values.keys()][i] ?? null,
    get length() {
      return values.size;
    },
    dump: () => Object.fromEntries(values),
  };
}

const PARENT = '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266';
const MINE = '0x00000000000000000000000000000000000000a1';
const THEIRS = '0x00000000000000000000000000000000000000b1';
const GRANDMA = '0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC';
const UNCLE = '0x90F79bf6EB2c4f870365E785982E1f101E93b906';
const USDG = '0x00000000000000000000000000000000000000c2';
const ev = (eventName: string, payload: Record<string, unknown>, blockNumber = 1): ChainEvent => ({ eventName, payload, blockNumber, logIndex: 0 });

describe('what anyone can see, from a sprout’s public events', () => {
  test('gifts are grouped by sending wallet with their totals; deposits split into yours and others’', () => {
    const picture = publicPicture(
      [
        ev('Funded', { from: PARENT.toLowerCase(), token: USDG, amount: '1000' }),
        ev('Funded', { from: PARENT, token: USDG, amount: '5' }),
        ev('Funded', { from: UNCLE, token: USDG, amount: '7' }),
        ev('GiftReceived', { gifter: GRANDMA, token: USDG, amount: '25', giftRef: '0x1' }),
        ev('GiftReceived', { gifter: GRANDMA.toLowerCase(), token: USDG, amount: '10', giftRef: '0x1' }),
        ev('GiftReceived', { gifter: UNCLE, token: USDG, amount: '3', giftRef: '0x2' }),
        ev('InvestmentExecuted', { token: USDG, amountIn: '1', amountOut: '1' }),
        ev('MilestoneCreated', { token: USDG, amount: '2' }),
        ev('AllowanceClaimed', { token: USDG, amount: '2' }),
        ev('Withdrawn', { token: USDG, amount: '1', to: UNCLE }),
        ev('SproutInitialized', {}),
      ],
      PARENT,
    );
    expect(picture.gifts.count).toBe(3);
    expect(picture.gifts.wallets.map((w) => [w.address.toLowerCase(), w.count, w.amounts[USDG]])).toEqual([
      [GRANDMA.toLowerCase(), 2, 35n],
      [UNCLE.toLowerCase(), 1, 3n],
    ]);
    expect(picture.deposits.fromParent).toBe(2);
    expect(picture.deposits.fromOthers.map((w) => [w.address, w.count])).toEqual([[UNCLE, 1]]);
    expect(picture).toMatchObject({ purchases: 1, choreRewards: 1, claims: 1, withdrawals: { count: 1, to: [UNCLE] } });
  });

  test('a sprout with no history reports nothing, not zeros from a failed read', () => {
    expect(publicPicture([], PARENT)).toEqual({
      gifts: { count: 0, wallets: [] },
      deposits: { fromParent: 0, fromOthers: [] },
      purchases: 0,
      choreRewards: 0,
      claims: 0,
      withdrawals: { count: 0, to: [] },
    });
  });
});

describe('this browser’s Sprout data', () => {
  const owner = PARENT.toLowerCase();
  const seeded = () =>
    memoryStore({
      [`sprout.private.v1.${owner}`]: '{"version":1}',
      'sprout.private.v1.0xsomeoneelse': '{"version":1}',
      [`sprout.nickname.${MINE}`]: 'Maya',
      [`sprout.milestone.31337.${MINE}.0xabc`]: 'Feed the cat',
      [`sprout.nickname.${THEIRS}`]: 'Not ours',
      'sprout.favorite.': JSON.stringify([MINE, THEIRS]),
      [`sprout.investNow.scheduleTx.${MINE}`]: '[]',
      [`sprout.investNow.oneOff.${MINE}`]: '25',
      [`sprout.learn.${MINE}`]: '{"done":[]}',
      'sprout.learn.inviteabc': '{"done":["a"]}',
      'sprout-appearance': 'dark',
      'sprout-locale': 'zh',
      'sprout-discreet': '1',
      'sprout-onboarding-intro-seen': '1',
    });

  test('finds this wallet’s vault and the older plain labels and helpers for its own sprouts only', () => {
    const found = localFamilyData(PARENT, [MINE], seeded());
    expect(found.vault).toBe(true);
    expect(found.plainLabels.sort()).toEqual([`sprout.milestone.31337.${MINE}.0xabc`, `sprout.nickname.${MINE}`, 'sprout.favorite.'].sort());
    expect(found.helpers.sort()).toEqual([`sprout.investNow.oneOff.${MINE}`, `sprout.investNow.scheduleTx.${MINE}`, `sprout.learn.${MINE}`].sort());
    expect(localFamilyData(PARENT, [], seeded())).toEqual({ vault: true, plainLabels: [], helpers: [] });
  });

  test('clearing removes only this family’s data and keeps device preferences and other families', () => {
    const local = seeded();
    const session = memoryStore({ 'sprout.kid.session.inviteabc': 'token', 'sprout.kid.session.other': 'token', 'sprout-pending-nickname': 'Maya' });
    const removed = clearLocalFamilyData(PARENT, [MINE], ['inviteabc'], { local, session });
    expect(removed).toBeGreaterThan(0);
    expect(local.dump()).toEqual({
      'sprout.private.v1.0xsomeoneelse': '{"version":1}',
      [`sprout.nickname.${THEIRS}`]: 'Not ours',
      'sprout.favorite.': JSON.stringify([THEIRS]),
      'sprout-appearance': 'dark',
      'sprout-locale': 'zh',
      'sprout-discreet': '1',
      'sprout-onboarding-intro-seen': '1',
    });
    expect(session.dump()).toEqual({ 'sprout.kid.session.other': 'token' });
  });

  test('clearing with blocked storage does not throw', () => {
    const broken: KeyStore = {
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new Error('blocked');
      },
      removeItem: () => {
        throw new Error('blocked');
      },
      key: () => {
        throw new Error('blocked');
      },
      get length(): number {
        throw new Error('blocked');
      },
    };
    expect(() => clearLocalFamilyData(PARENT, [MINE], ['x'], { local: broken, session: broken })).not.toThrow();
    expect(clearLocalFamilyData(PARENT, [MINE], [], { local: null, session: null })).toBe(0);
  });

  test('older label keys map onto the vault’s lower-case keys', () => {
    expect(normalizeLabelKey('sprout.nickname.0xAbC')).toBe('sprout.nickname.0xabc');
    expect(normalizeLabelKey('sprout.milestone.31337.0xAbC.0xDeF')).toBe('sprout.milestone.31337.0xabc.0xdef');
    expect(normalizeLabelKey('sprout.favorite.')).toBe('sprout.favorite.');
  });
});

describe('server errors', () => {
  test('the server’s own message is shown, not the status line and JSON', () => {
    expect(errorMessage(new Error('429 {"error":"Too many privacy requests from this wallet. Please try again later."}'))).toBe(
      'Too many privacy requests from this wallet. Please try again later.',
    );
    expect(errorMessage(new Error('User rejected the request.'))).toBe('User rejected the request.');
  });
});
