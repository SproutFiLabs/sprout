import { describe, expect, test } from 'bun:test';
import { privateKeyToAccount } from 'viem/accounts';
import { createApp } from '../src/app';
import { createFamilySession } from '../src/privacy';
import { ERASE_CONFIRM, GENERIC_CAMPAIGN_TITLE, GENERIC_GIFT_LABEL, PRIVACY_LIMITS, type FamilyFootprint } from '../src/privacyPack';
import {
  insertChainEvent,
  insertGift,
  insertGiftCampaign,
  insertGiftPayment,
  insertSnapshot,
  upsertGiftNote,
  upsertJob,
  upsertMilestone,
  upsertSprout,
} from '../src/repo';
import { account, memoryDb, otherAccount, testimonialChain } from './helpers';

/** Family A: `account` planted VAULT_A for `otherAccount`. Family B: `thirdAccount` planted VAULT_B. */
const thirdAccount = privateKeyToAccount('0x7c852118294e51e653712a81e05800f419141751be58f605c371e15141b007a6');
const VAULT_A = '0x00000000000000000000000000000000000000a1';
const VAULT_B = '0x00000000000000000000000000000000000000b1';
const TOKEN = '0x00000000000000000000000000000000000000c2';
const GIFT_A = `0x${'a1'.repeat(32)}`;
const GIFT_A2 = `0x${'a2'.repeat(32)}`;
const GIFT_B = `0x${'b1'.repeat(32)}`;
const TX = (n: number) => `0x${n.toString(16).padStart(64, '0')}`;
const ENVELOPE = `encrypted:v1:${JSON.stringify({ wrapped: 'AAAA', box: { iv: 'AAAAAAAAAAAAAAAA', ciphertext: 'AAAA' } })}`;
const bearer = (token: string) => ({ authorization: `Bearer ${token}` });

function seedFamily(db: ReturnType<typeof memoryDb>, f: { vault: string; parent: string; beneficiary: string; gift: string; gift2?: string; tx: number }) {
  upsertSprout(db, {
    id: f.vault,
    chainId: 31337,
    parent: f.parent,
    beneficiary: f.beneficiary,
    settlementToken: TOKEN,
    graduationTimestamp: 2_000_000_000,
    assets: [TOKEN],
    weights: [10000],
    createdTxHash: null,
    createdBlock: null,
  });
  // An older link: the family's own label and campaign title in plain text.
  insertGift(db, { id: f.gift, vaultId: f.vault, label: 'Maya’s 8th birthday', acceptedAssets: [TOKEN], status: 'open' });
  insertGiftCampaign(db, { giftId: f.gift, title: 'Maya turns 8', goalCents: 50_000, endsAt: 2_000_000_000 });
  if (f.gift2) insertGift(db, { id: f.gift2, vaultId: f.vault, label: GENERIC_GIFT_LABEL, acceptedAssets: [TOKEN], status: 'open' });
  for (const [i, note] of [
    { name: 'Grandma June', note: 'For your first bike', hidden: false },
    { name: null, note: ENVELOPE, hidden: false },
    { name: 'Uncle Ray', note: 'Hidden one', hidden: true },
  ].entries()) {
    const txHash = TX(f.tx + i);
    insertGiftPayment(db, { giftId: f.gift, vaultId: f.vault, chainId: 31337, txHash, logIndex: 0, gifter: thirdAccount.address, token: TOKEN, amount: '1000000', blockNumber: 1 });
    upsertGiftNote(db, { chainId: 31337, txHash, logIndex: 0, giftId: f.gift, gifter: thirdAccount.address, name: note.name, note: note.note });
    if (note.hidden) db.run('UPDATE gift_notes SET hidden = 1 WHERE tx_hash = ?', [txHash.toLowerCase()]);
  }
  insertChainEvent(db, { chainId: 31337, txHash: TX(f.tx + 50), logIndex: 0, blockNumber: 1, address: f.vault, eventName: 'Funded', vaultId: f.vault, payload: { from: f.parent, token: TOKEN, amount: '5' } });
  insertSnapshot(db, { vaultId: f.vault, chainId: 31337, takenAt: 1_700_000_000, blockNumber: 1, valueUsd: '100', feedDecimals: 8, holdings: [], source: 'chain', note: null });
  upsertMilestone(db, { id: TX(f.tx + 60), vaultId: f.vault, chainId: 31337, token: TOKEN, amount: '5', unlockTime: 0, status: 'created', descriptionHash: TX(99), createdTxHash: null, releasedTxHash: null });
  upsertJob(db, { id: `${f.vault}:investment`, vaultId: f.vault, chainId: 31337, kind: 'scheduled_investment', amount: '1', periodSeconds: 604800, nextRunAt: 1, lastRunAt: null, lastTxHash: null, status: 'active', attempts: 0, consecutiveFailures: 0, lastError: null });
  db.run(
    'INSERT INTO zk_milestone_certificates (id,vault_id,commitment,threshold_cents,scope,issued_at,expires_at) VALUES (?,?,?,?,?,?,?)',
    [`${f.vault.slice(-2)}${'0'.repeat(30)}`, f.vault.toLowerCase(), '1', '100', '2', Date.now(), Date.now() + 30 * 60_000],
  );
  db.run('INSERT INTO family_gift_keys VALUES (?,?)', [f.parent.toLowerCase(), `key-of-${f.parent}`]);
}

function setup() {
  const db = memoryDb();
  let clock = Date.now();
  seedFamily(db, { vault: VAULT_A, parent: account.address, beneficiary: otherAccount.address, gift: GIFT_A, gift2: GIFT_A2, tx: 1 });
  seedFamily(db, { vault: VAULT_B, parent: thirdAccount.address, beneficiary: otherAccount.address, gift: GIFT_B, tx: 1001 });
  const app = createApp({ db, chain: testimonialChain(), localDemo: false, now: () => clock });
  type Signer = typeof account;
  async function nonce(signer: Signer, purpose: string) {
    const res = await app.request('/api/auth/nonce', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ address: signer.address, purpose }),
    });
    const challenge = (await res.json()) as { nonce: string; message: string };
    return {
      'x-sprout-address': signer.address,
      'x-sprout-nonce': challenge.nonce,
      'x-sprout-signature': await signer.signMessage({ message: challenge.message }),
    };
  }
  async function signed(path: string, purpose: string, body: unknown = {}, signer: Signer = account, extra: Record<string, string> = {}) {
    return app.request(path, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...(await nonce(signer, purpose)), ...extra },
      body: JSON.stringify(body),
    });
  }
  const session = (address: string) => createFamilySession(db, address, clock).token;
  const report = async (token: string) => {
    const res = await app.request('/api/family/privacy-report', { headers: bearer(token) });
    expect(res.status).toBe(200);
    return (await res.json()) as FamilyFootprint;
  };
  const rows = (sql: string, ...params: string[]) => (db.query(sql).all(...params) as unknown[]).length;
  return { app, db, nonce, signed, session, report, rows, advance: (ms: number) => (clock += ms) };
}

async function createInvite(ctx: ReturnType<typeof setup>, vault: string, signer = account, showBalance = false) {
  const res = await ctx.signed(`/api/family/invites/${vault}`, `kid-invite:${vault.toLowerCase()}`, { showBalance }, signer);
  expect(res.status).toBe(201);
  return (await res.json()) as { id: string; token: string };
}
async function redeem(ctx: ReturnType<typeof setup>, invite: { id: string; token: string }) {
  const res = await ctx.app.request('/api/kid/redeem', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ id: invite.id, token: invite.token }),
  });
  expect(res.status).toBe(200);
  return ((await res.json()) as { token: string }).token;
}

describe('privacy report', () => {
  test('needs a family session and only ever describes the signed-in parent’s own sprouts', async () => {
    const ctx = setup();
    expect((await ctx.app.request('/api/family/privacy-report')).status).toBe(401);
    expect((await ctx.app.request('/api/family/privacy-report', { headers: bearer('x'.repeat(43)) })).status).toBe(401);
    const waiting = await createInvite(ctx, VAULT_A, account, true);
    await redeem(ctx, await createInvite(ctx, VAULT_A));
    await createInvite(ctx, VAULT_B, thirdAccount);

    const res = await ctx.app.request('/api/family/privacy-report', { headers: bearer(ctx.session(account.address)) });
    expect(res.headers.get('cache-control')).toBe('no-store');
    const a = (await res.json()) as FamilyFootprint;
    expect(a.sprouts.map((s) => s.id.toLowerCase())).toEqual([VAULT_A]);
    expect(JSON.stringify(a)).not.toContain(VAULT_B.slice(2));
    expect(JSON.stringify(a)).not.toContain(GIFT_B.slice(2));
    const s = a.sprouts[0]!;
    expect(s.gifts).toEqual({ links: 2, plainLabels: 1, campaigns: 1, plainCampaignTitles: 1, payments: 3 });
    expect(s.notes).toEqual({ total: 3, encrypted: 1, plain: 2, hidden: 1 });
    expect(s.invites).toEqual({ total: 2, waiting: 1, openNow: 1, balanceVisible: 1, ended: 0 });
    expect(s.proofs).toEqual({ total: 1, active: 1 });
    expect(s.chores).toEqual({ total: 1, open: 1, described: 1 });
    expect(a.legacyText).toEqual([{ giftId: GIFT_A, label: 'Maya’s 8th birthday', title: 'Maya turns 8' }]);
    expect(a.giftKeyRegistered).toBe(true);
    expect(a.erase).toMatchObject({ giftLinks: 2, campaigns: 1, giftNotes: 3, giftPayments: 3, kidInvites: 2, kidSessions: 1, proofs: 1, choreDescriptions: 1, giftKey: 1 });
    expect(a.kept).toEqual({ sprouts: 1, events: 1, snapshots: 1, chores: 1, jobs: 1, keeperTxs: 0 });
    void waiting;

    // Expired and revoked links count as ended.
    ctx.advance(8 * 24 * 60 * 60_000);
    const later = await ctx.report(ctx.session(account.address));
    expect(later.sprouts[0]!.invites).toMatchObject({ waiting: 0, openNow: 0, ended: 2 });

    // A beneficiary is not the parent: nothing of the family's is reported to them.
    const kid = await ctx.report(ctx.session(otherAccount.address));
    expect(kid.sprouts).toEqual([]);
    expect(kid.beneficiaryOf).toBe(2);
    expect(kid.legacyText).toEqual([]);
  });
});

describe('delete my family’s data', () => {
  const eraseBody = (vaults: string[] = [VAULT_A]) => ({ confirm: ERASE_CONFIRM, vaults });

  test('refuses anonymous, session-only, signature-only and mixed-wallet requests without deleting anything', async () => {
    const ctx = setup();
    const before = await ctx.report(ctx.session(account.address));
    const post = (headers: Record<string, string>) =>
      ctx.app.request('/api/family/erase', { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(eraseBody()) });
    expect((await post({})).status).toBe(401);
    expect((await post(bearer(ctx.session(account.address)))).status).toBe(401);
    expect((await post(await ctx.nonce(account, 'erase-family-data'))).status).toBe(401);
    // A's session with B's signature, and B's session with A's signature.
    expect((await post({ ...bearer(ctx.session(account.address)), ...(await ctx.nonce(thirdAccount, 'erase-family-data')) })).status).toBe(403);
    expect((await post({ ...bearer(ctx.session(thirdAccount.address)), ...(await ctx.nonce(account, 'erase-family-data')) })).status).toBe(403);
    // A signature for another purpose does not authorize an erase.
    expect((await post({ ...bearer(ctx.session(account.address)), ...(await ctx.nonce(account, 'family-session')) })).status).toBe(401);
    // A stale kid token is not a family session.
    const kid = await redeem(ctx, await createInvite(ctx, VAULT_A));
    expect((await post({ ...bearer(kid), ...(await ctx.nonce(account, 'erase-family-data')) })).status).toBe(401);
    const after = await ctx.report(ctx.session(account.address));
    expect(after.erase.giftNotes).toBe(before.erase.giftNotes);
    expect(after.erase.giftLinks).toBe(2);
  });

  test('the body can never reach another family, and a wrong confirmation or replay deletes nothing', async () => {
    const ctx = setup();
    const erase = (signer: typeof account, body: unknown) => ctx.signed('/api/family/erase', 'erase-family-data', body, signer, bearer(ctx.session(signer.address)));
    // B tries to erase A's vault (alone, or alongside its own): refused, nothing changes.
    expect((await erase(thirdAccount, eraseBody([VAULT_A]))).status).toBe(409);
    expect((await erase(thirdAccount, eraseBody([VAULT_A, VAULT_B]))).status).toBe(409);
    // The beneficiary of A's sprout is not its parent: its erase touches only its own wallet's records.
    const beneficiary = await erase(otherAccount, eraseBody([]));
    expect(beneficiary.status).toBe(200);
    expect(((await beneficiary.json()) as { erased: { giftLinks: number } }).erased.giftLinks).toBe(0);
    expect((await erase(account, { confirm: 'delete', vaults: [VAULT_A] })).status).toBe(400);
    expect((await erase(account, { vaults: [VAULT_A] })).status).toBe(400);
    expect((await erase(account, { ...eraseBody(), extra: true })).status).toBe(400);
    expect(ctx.rows('SELECT 1 FROM gift_notes')).toBe(6);
    expect(ctx.rows('SELECT 1 FROM gifts')).toBe(3);

    // A replayed signature is refused even with a valid session (after the refusals above age out of the limit).
    ctx.advance(PRIVACY_LIMITS.erase.windowMs);
    const headers = await ctx.nonce(account, 'erase-family-data');
    const send = () =>
      ctx.app.request('/api/family/erase', {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...headers, ...bearer(ctx.session(account.address)) },
        body: JSON.stringify(eraseBody()),
      });
    expect((await send()).status).toBe(200);
    expect((await send()).status).toBe(401);
  });

  test('erases exactly what the preview counted, keeps chain copies, ends every access path, and leaves the other family intact', async () => {
    const ctx = setup();
    const kidA = await redeem(ctx, await createInvite(ctx, VAULT_A));
    const kidB = await redeem(ctx, await createInvite(ctx, VAULT_B, thirdAccount));
    const tokenA = ctx.session(account.address);
    const tokenB = ctx.session(thirdAccount.address);
    const preview = await ctx.report(tokenA);
    const beforeB = await ctx.report(tokenB);

    const secureDeleteBefore = ctx.db.query('PRAGMA secure_delete').get();
    const res = await ctx.signed('/api/family/erase', 'erase-family-data', eraseBody(), account, bearer(tokenA));
    expect(res.status).toBe(200);
    const result = (await res.json()) as { erased: FamilyFootprint['erase']; kept: FamilyFootprint['kept']; inviteIds: string[] };
    // The confirmation screen's counts are the counts that were erased (report adds its own sign-in row).
    expect({ ...result.erased, signIns: 0, sessions: 0 }).toEqual({ ...preview.erase, signIns: 0, sessions: 0 });
    expect(result.erased.sessions).toBeGreaterThanOrEqual(1);
    expect(result.inviteIds).toHaveLength(1);
    expect(result.kept).toEqual(preview.kept);

    const a = VAULT_A;
    for (const sql of [
      'SELECT 1 FROM gifts WHERE lower(vault_id) = ?',
      'SELECT 1 FROM gift_payments WHERE lower(vault_id) = ?',
      'SELECT 1 FROM kid_invites WHERE lower(vault_id) = ?',
      'SELECT 1 FROM zk_milestone_certificates WHERE lower(vault_id) = ?',
      'SELECT 1 FROM milestones WHERE lower(vault_id) = ? AND description_hash IS NOT NULL',
    ])
      expect(ctx.rows(sql, a)).toBe(0);
    expect(ctx.rows('SELECT 1 FROM gift_notes WHERE lower(gift_id) IN (?, ?)', GIFT_A, GIFT_A2)).toBe(0);
    expect(ctx.rows('SELECT 1 FROM gift_campaigns WHERE lower(gift_id) = ?', GIFT_A)).toBe(0);
    expect(ctx.rows('SELECT 1 FROM family_gift_keys WHERE address = ?', account.address.toLowerCase())).toBe(0);
    expect(ctx.rows('SELECT 1 FROM family_sessions WHERE address = ?', account.address.toLowerCase())).toBe(0);
    expect(ctx.rows('SELECT 1 FROM nonces WHERE lower(address) = ?', account.address.toLowerCase())).toBe(0);
    // The connection's secure_delete setting is back to what it was.
    expect(ctx.db.query('PRAGMA secure_delete').get()).toEqual(secureDeleteBefore);
    // Copies of public chain data stay, so the sprout still works.
    expect(ctx.rows('SELECT 1 FROM sprouts WHERE lower(id) = ?', a)).toBe(1);
    expect(ctx.rows('SELECT 1 FROM chain_events WHERE lower(vault_id) = ?', a)).toBe(1);
    expect(ctx.rows('SELECT 1 FROM growth_snapshots WHERE lower(vault_id) = ?', a)).toBe(1);
    expect(ctx.rows('SELECT 1 FROM milestones WHERE lower(vault_id) = ?', a)).toBe(1);
    expect(ctx.rows('SELECT 1 FROM investment_jobs WHERE lower(vault_id) = ?', a)).toBe(1);

    // Access paths are closed: family session, kid view, gift link, proof status.
    expect((await ctx.app.request(`/api/sprouts/${VAULT_A}`, { headers: bearer(tokenA) })).status).toBe(401);
    expect((await ctx.app.request('/api/kid/view', { headers: bearer(kidA) })).status).toBe(401);
    expect((await ctx.app.request(`/api/gifts/${GIFT_A}`)).status).toBe(404);
    const status = await ctx.app.request('/api/zk/status', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ id: `a1${'0'.repeat(30)}`, commitment: '1', thresholdCents: '100', scope: '2', issuedAt: 1, expiresAt: 2 }),
    });
    expect(((await status.json()) as { active?: boolean }).active ?? false).toBe(false);

    // Family B is untouched, including its kid view and session.
    const afterB = await ctx.report(tokenB);
    expect(afterB.erase).toEqual(beforeB.erase);
    expect(afterB.legacyText).toEqual(beforeB.legacyText);
    expect((await ctx.app.request('/api/kid/view', { headers: bearer(kidB) })).status).toBe(200);
    expect((await ctx.app.request(`/api/gifts/${GIFT_B}`)).status).toBe(200);

    // The same parent can sign in again and sees an empty footprint.
    const again = await ctx.report(ctx.session(account.address));
    expect(again.erase).toMatchObject({ giftLinks: 0, campaigns: 0, giftNotes: 0, giftPayments: 0, kidInvites: 0, kidSessions: 0, proofs: 0, giftKey: 0 });
  });

  test('is rate limited per wallet', async () => {
    const ctx = setup();
    const erase = () => ctx.signed('/api/family/erase', 'erase-family-data', eraseBody(), account, bearer(ctx.session(account.address)));
    for (let i = 0; i < PRIVACY_LIMITS.erase.max; i++) expect((await erase()).status).toBe(200);
    expect((await erase()).status).toBe(429);
    // Another family is not affected by A's limit.
    const other = await ctx.signed('/api/family/erase', 'erase-family-data', eraseBody([VAULT_B]), thirdAccount, bearer(ctx.session(thirdAccount.address)));
    expect(other.status).toBe(200);
    ctx.advance(PRIVACY_LIMITS.erase.windowMs);
    expect((await erase()).status).toBe(200);
    // The table stores a digest, not the wallet address.
    expect(JSON.stringify(ctx.db.query('SELECT * FROM privacy_request_usage').all()).toLowerCase()).not.toContain(account.address.slice(2).toLowerCase());
  });
});

describe('one-signature fixes', () => {
  test('older plain gift messages: listed only to their family, swapped only for envelopes, only on its own links', async () => {
    const ctx = setup();
    expect((await ctx.app.request('/api/family/plain-notes', { method: 'POST', body: '{}' })).status).toBe(401);
    // A family read session alone does not list them (hidden notes included): it takes a signature.
    expect((await ctx.app.request('/api/family/plain-notes', { method: 'POST', body: '{}', headers: bearer(ctx.session(account.address)) })).status).toBe(401);
    const theirList = (await (await ctx.signed('/api/family/plain-notes', 'gift-notes-plain', {}, thirdAccount)).json()) as { notes: Array<{ giftId: string }> };
    expect(theirList.notes.every((n) => n.giftId === GIFT_B)).toBe(true);
    const list = await ctx.signed('/api/family/plain-notes', 'gift-notes-plain');
    const { notes } = (await list.json()) as { notes: Array<{ giftId: string; txHash: string; logIndex: number; name: string | null; note: string | null; hidden: boolean }> };
    expect(notes.map((n) => n.note).sort()).toEqual(['For your first bike', 'Hidden one']);
    expect(notes.every((n) => n.giftId === GIFT_A)).toBe(true);
    const encrypt = (body: unknown, signer = account) => ctx.signed('/api/family/plain-notes/encrypt', 'encrypt-gift-notes', body, signer);
    const mine = notes.map((n) => ({ giftId: n.giftId, txHash: n.txHash, logIndex: n.logIndex, encryptedNote: ENVELOPE }));
    const theirs = { giftId: GIFT_B, txHash: TX(1001), logIndex: 0, encryptedNote: ENVELOPE };

    expect((await encrypt({ notes: [...mine, theirs] })).status).toBe(403);
    expect((await encrypt({ notes: [theirs] }, thirdAccount)).status).toBe(200);
    expect(ctx.rows("SELECT 1 FROM gift_notes WHERE lower(gift_id) = ? AND note LIKE 'encrypted:v1:%'", GIFT_A)).toBe(1);
    expect((await encrypt({ notes: [{ ...mine[0]!, encryptedNote: 'plain text' }] })).status).toBe(400);
    expect((await encrypt({ notes: [{ ...mine[0]!, encryptedNote: 'encrypted:v1:{"wrapped":"<script>"}' }] })).status).toBe(400);
    expect((await encrypt({ notes: [{ ...mine[0]!, giftId: GIFT_A2 }] })).status).toBe(403);

    const ok = await encrypt({ notes: mine });
    expect(await ok.json()).toEqual({ encrypted: 2, skipped: 0 });
    const stored = ctx.db.query('SELECT name, note, hidden FROM gift_notes WHERE lower(gift_id) = ?').all(GIFT_A) as Array<{ name: string | null; note: string; hidden: number }>;
    expect(stored.every((n) => n.name === null && n.note === ENVELOPE)).toBe(true);
    expect(stored.filter((n) => n.hidden === 1)).toHaveLength(1);
    expect(await (await encrypt({ notes: mine })).json()).toEqual({ encrypted: 0, skipped: 2 });
    const report = await ctx.report(ctx.session(account.address));
    expect(report.sprouts[0]!.notes).toMatchObject({ encrypted: 3, plain: 0 });
  });

  test('older server labels are cleared only for the signer’s own links', async () => {
    const ctx = setup();
    const clear = (giftIds: string[], signer = account) => ctx.signed('/api/family/server-labels/clear', 'clear-server-labels', { giftIds }, signer);
    expect((await clear([GIFT_A, GIFT_B])).status).toBe(403);
    expect((await clear([GIFT_A], thirdAccount)).status).toBe(403);
    expect(ctx.db.query('SELECT label FROM gifts WHERE id = ?').get(GIFT_A)).toEqual({ label: 'Maya’s 8th birthday' });
    const ok = await clear([GIFT_A, GIFT_A2]);
    expect(await ok.json()).toEqual({ labels: 1, titles: 1 });
    expect(ctx.db.query('SELECT label FROM gifts WHERE id = ?').get(GIFT_A)).toEqual({ label: GENERIC_GIFT_LABEL });
    expect(ctx.db.query('SELECT title FROM gift_campaigns WHERE gift_id = ?').get(GIFT_A)).toEqual({ title: GENERIC_CAMPAIGN_TITLE });
    expect(ctx.db.query('SELECT label FROM gifts WHERE id = ?').get(GIFT_B)).toEqual({ label: 'Maya’s 8th birthday' });
    expect((await ctx.report(ctx.session(account.address))).legacyText).toEqual([]);
  });

  test('revoking every kid link closes open kid views for that family only', async () => {
    const ctx = setup();
    const kidA = await redeem(ctx, await createInvite(ctx, VAULT_A));
    await createInvite(ctx, VAULT_A);
    const kidB = await redeem(ctx, await createInvite(ctx, VAULT_B, thirdAccount));
    expect((await ctx.app.request('/api/family/kid-links/revoke-all', { method: 'POST', body: '{}' })).status).toBe(401);
    const res = await ctx.signed('/api/family/kid-links/revoke-all', 'kid-revoke-all', {});
    expect(await res.json()).toEqual({ revoked: 2 });
    expect((await ctx.app.request('/api/kid/view', { headers: bearer(kidA) })).status).toBe(401);
    expect((await ctx.app.request('/api/kid/view', { headers: bearer(kidB) })).status).toBe(200);
    // The beneficiary of A's sprout cannot revoke A's links.
    await createInvite(ctx, VAULT_A);
    expect(await (await ctx.signed('/api/family/kid-links/revoke-all', 'kid-revoke-all', {}, otherAccount)).json()).toEqual({ revoked: 0 });
    expect((await ctx.report(ctx.session(account.address))).sprouts[0]!.invites.waiting).toBe(1);
  });

  test('the checkup page is kept out of caches and search results', async () => {
    const db = memoryDb();
    const app = createApp({ db, chain: testimonialChain(), localDemo: false });
    const res = await app.request('/privacy-checkup');
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(res.headers.get('x-robots-tag')).toContain('noindex');
  });
});
