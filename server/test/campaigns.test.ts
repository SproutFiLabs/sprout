import { describe, expect, test } from 'bun:test';
import { issueNonce } from '../src/auth';
import { cleanText, TextRuleError } from '../src/campaigns';
import { insertGiftPayment, upsertGiftNote, upsertSprout } from '../src/repo';
import { createChainContext } from '../src/chain';
import { account, memoryDb, otherAccount, testApp, testConfig } from './helpers';

const VAULT = '0x00000000000000000000000000000000000000a1';
const TOKEN = '0x00000000000000000000000000000000000000b2';
const NOW_MS = 1_789_000_000_000;

function seed() {
  const db = memoryDb();
  upsertSprout(db, {
    id: VAULT,
    chainId: 31337,
    parent: account.address,
    beneficiary: '0x00000000000000000000000000000000000000e5',
    settlementToken: TOKEN,
    graduationTimestamp: 2_000_000_000,
    assets: [TOKEN],
    weights: [10_000],
    createdTxHash: null,
    createdBlock: null,
  });
  return db;
}

async function signed(db: ReturnType<typeof memoryDb>, purpose: string, useOther = false) {
  const signer = useOther ? otherAccount : account;
  const challenge = issueNonce(db, { address: signer.address, purpose, now: NOW_MS });
  return {
    'content-type': 'application/json',
    'x-sprout-address': signer.address,
    'x-sprout-nonce': challenge.nonce,
    'x-sprout-signature': await signer.signMessage({ message: challenge.message }),
  };
}

// No RPC, but a known settlement token, so progress can be counted.
const chain = createChainContext(testConfig({ SPROUT_SETTLEMENT_TOKEN: TOKEN, SPROUT_SETTLEMENT_DECIMALS: '6' }));

function app(db: ReturnType<typeof memoryDb>) {
  return testApp(db, chain, { now: () => NOW_MS });
}

async function createCampaign(db: ReturnType<typeof memoryDb>, campaign: Record<string, unknown>) {
  return app(db).request('/api/gifts', {
    method: 'POST',
    headers: await signed(db, 'gift-create'),
    body: JSON.stringify({ vaultId: VAULT, acceptedAssets: [TOKEN], campaign }),
  });
}

describe('note text rules', () => {
  test('keeps ordinary text and emoji, trims and collapses whitespace', () => {
    expect(cleanText('  Happy   birthday,\nSam! 🎂 👨‍👩‍👧 ', 140, 'Note')).toBe('Happy birthday, Sam! 🎂 👨‍👩‍👧');
    expect(cleanText('   ', 140, 'Note')).toBeNull();
    expect(cleanText(undefined, 140, 'Note')).toBeNull();
  });

  test('drops invisible and direction-changing characters', () => {
    expect(cleanText('Gran\u202Edma\u200B', 40, 'Name')).toBe('Grandma');
  });

  test('refuses links and overlong text', () => {
    for (const text of ['see https://x.io', 'www.example.org', 'visit claim-prize.xyz now']) {
      expect(() => cleanText(text, 140, 'Note')).toThrow(TextRuleError);
    }
    expect(() => cleanText('a'.repeat(141), 140, 'Note')).toThrow('at most 140');
    // Counted in characters, not UTF-16 units.
    expect(cleanText('🎉'.repeat(140), 140, 'Note')).toHaveLength(280);
  });
});

describe('birthday campaigns', () => {
  test('a parent creates a campaign and the gift page shows its progress and notes', async () => {
    const db = seed();
    const created = await createCampaign(db, { title: 'Maya turns 8', goalDollars: 100, endsAt: NOW_MS / 1000 + 5 * 86400 });
    expect(created.status).toBe(201);
    const { gift } = (await created.json()) as { gift: { id: string; label: string; campaign: { title: string; goalCents: number } } };
    expect(gift.label).toBe('Maya turns 8');
    expect(gift.campaign).toMatchObject({ title: 'Maya turns 8', goalCents: 10_000 });

    const pay = (n: number, token: string, amount: string) =>
      insertGiftPayment(db, {
        giftId: gift.id,
        vaultId: VAULT,
        chainId: 31337,
        txHash: `0x${String(n).padStart(64, '0')}`,
        logIndex: 0,
        gifter: account.address,
        token,
        amount,
        blockNumber: n,
      });
    pay(1, TOKEN, '25500000'); // 25.50 at 6 decimals
    pay(2, TOKEN, '10000000');
    pay(3, '0x00000000000000000000000000000000000000c3', '5000000000000000'); // a stock-token gift
    upsertGiftNote(db, { chainId: 31337, txHash: `0x${'1'.padStart(64, '0')}`, logIndex: 0, giftId: gift.id, gifter: account.address, name: 'Grandma', note: 'Happy birthday!' });
    upsertGiftNote(db, { chainId: 31337, txHash: `0x${'2'.padStart(64, '0')}`, logIndex: 0, giftId: gift.id, gifter: account.address, name: 'Uncle Joe', note: null });

    const view = (await (await app(db).request(`/api/gifts/${gift.id}`)).json()) as {
      campaign: { raisedCents: number; goalCents: number; ended: boolean; otherGifts: Record<string, string> };
      notes: Array<{ name: string; note: string | null; amount: string }>;
      hiddenNotes: number;
    };
    expect(view.campaign.raisedCents).toBe(3550);
    expect(view.campaign.ended).toBe(false);
    expect(Object.values(view.campaign.otherGifts)).toEqual(['5000000000000000']);
    expect(view.notes.map((n) => n.name).sort()).toEqual(['Grandma', 'Uncle Joe']);
    expect(view.notes.find((n) => n.name === 'Grandma')?.amount).toBe('25500000');
    expect(JSON.stringify(view)).not.toContain(account.address.slice(2).toLowerCase());
    expect(view.hiddenNotes).toBe(0);
  });

  test('campaign rules: a title, an end in the future, at most a year', async () => {
    const db = seed();
    const now = NOW_MS / 1000;
    expect((await createCampaign(db, { title: '  ', goalDollars: 50, endsAt: now + 86400 })).status).toBe(400);
    expect((await createCampaign(db, { title: 'Party', goalDollars: 50, endsAt: now - 1 })).status).toBe(400);
    expect((await createCampaign(db, { title: 'Party', goalDollars: 50, endsAt: now + 400 * 86400 })).status).toBe(400);
    expect((await createCampaign(db, { title: 'Party', goalDollars: 0, endsAt: now + 86400 })).status).toBe(400);
    const link = await createCampaign(db, { title: 'Go to www.win.com', goalDollars: 50, endsAt: now + 86400 });
    expect(link.status).toBe(400);
    expect(((await link.json()) as { error: string }).error).toBe("Campaign title can't include links");
  });

  test('only the parent can see and hide notes', async () => {
    const db = seed();
    const created = await createCampaign(db, { title: 'Sam turns 5', goalDollars: 20, endsAt: NOW_MS / 1000 + 86400 });
    const { gift } = (await created.json()) as { gift: { id: string } };
    const txHash = `0x${'9'.padStart(64, '0')}`;
    upsertGiftNote(db, { chainId: 31337, txHash, logIndex: 0, giftId: gift.id, gifter: otherAccount.address, name: 'Spam', note: 'buy my stuff' });

    const hide = async (useOther: boolean) =>
      app(db).request(`/api/gifts/${gift.id}/notes/visibility`, {
        method: 'POST',
        headers: await signed(db, 'gift-note-visibility', useOther),
        body: JSON.stringify({ txHash, logIndex: 0, hidden: true }),
      });
    expect((await hide(true)).status).toBe(403);
    const hidden = await hide(false);
    expect(hidden.status).toBe(200);
    expect(((await hidden.json()) as { notes: Array<{ hidden: boolean }> }).notes[0]?.hidden).toBe(true);

    const view = (await (await app(db).request(`/api/gifts/${gift.id}`)).json()) as { notes: unknown[]; hiddenNotes: number };
    expect(view.notes).toHaveLength(0);
    expect(view.hiddenNotes).toBe(1);

    // A gifter updating their note does not unhide it.
    upsertGiftNote(db, { chainId: 31337, txHash, logIndex: 0, giftId: gift.id, gifter: otherAccount.address, name: 'Spam', note: 'again' });
    const all = await app(db).request(`/api/gifts/${gift.id}/notes`, { method: 'POST', headers: await signed(db, 'gift-notes') });
    expect(((await all.json()) as { notes: Array<{ hidden: boolean; note: string }> }).notes[0]).toMatchObject({ hidden: true, note: 'again' });
    const stranger = await app(db).request(`/api/gifts/${gift.id}/notes`, { method: 'POST', headers: await signed(db, 'gift-notes', true) });
    expect(stranger.status).toBe(403);
  });
});
