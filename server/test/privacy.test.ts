import { describe, expect, test } from 'bun:test';
import { createApp } from '../src/app';
import { account, otherAccount, memoryDb, testimonialChain } from './helpers';
import { insertGift, upsertSprout } from '../src/repo';
import { createFamilySession, digest, FAMILY_TTL } from '../src/privacy';
const VAULT = '0x00000000000000000000000000000000000000a1';
const TOKEN = '0x00000000000000000000000000000000000000b2';
const GIFT = `0x${'ba'.repeat(32)}`;
function setup() {
  const db = memoryDb();
  let clock = Date.now();
  upsertSprout(db, {
    id: VAULT,
    chainId: 31337,
    parent: account.address,
    beneficiary: otherAccount.address,
    settlementToken: TOKEN,
    graduationTimestamp: 2_000_000_000,
    assets: [TOKEN],
    weights: [10000],
    createdTxHash: null,
    createdBlock: null,
  });
  insertGift(db, {
    id: GIFT,
    vaultId: VAULT,
    label: 'Private child name',
    acceptedAssets: [TOKEN],
    status: 'open',
  });
  const app = createApp({
    db,
    chain: testimonialChain(),
    localDemo: false,
    now: () => clock,
  });
  async function signed(path: string, purpose: string, body: unknown = {}, signer = account) {
    const challenge = (await (
      await app.request('/api/auth/nonce', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ address: signer.address, purpose }),
      })
    ).json()) as { nonce: string; message: string };
    return app.request(path, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-sprout-address': signer.address,
        'x-sprout-nonce': challenge.nonce,
        'x-sprout-signature': await signer.signMessage({
          message: challenge.message,
        }),
      },
      body: JSON.stringify(body),
    });
  }
  return {
    app,
    db,
    signed,
    advance: (ms: number) => {
      clock += ms;
    },
  };
}
const bearer = (token: string) => ({ authorization: `Bearer ${token}` });

describe('private family read boundary', () => {
  test('anonymous and unrelated sessions cannot reach every family read; owner and beneficiary still can', async () => {
    const { app, db, signed } = setup();
    const paths = [
      `/api/sprouts?parent=${account.address}`,
      ...['', '/holdings', '/growth', '/events', '/jobs', '/milestones', '/beneficiary', '/invest-quote?amount=1'].map(
        (p) => `/api/sprouts/${VAULT}${p}`,
      ),
      '/api/jobs/unknown',
    ];
    const stranger = createFamilySession(db, '0x00000000000000000000000000000000000000ff', Date.now());
    for (const path of paths) {
      expect((await app.request(path)).status).toBe(401);
      expect((await app.request(path, { headers: bearer(stranger.token) })).status).toBe(403);
    }
    for (const signer of [account, otherAccount]) {
      const res = await signed('/api/family/session', 'family-session', {}, signer);
      expect(res.status).toBe(200);
      const session = (await res.json()) as { token: string };
      expect(
        (
          await app.request(`/api/sprouts/${VAULT}`, {
            headers: bearer(session.token),
          })
        ).status,
      ).toBe(200);
      const list = await app.request(
        `/api/sprouts?${signer === account ? 'parent' : 'beneficiary'}=${signer.address}`,
        { headers: bearer(session.token) },
      );
      expect(list.status).toBe(200);
      expect(
        (
          await app.request(`/api/sprouts/%30x${VAULT.slice(2)}`, {
            headers: bearer(stranger.token),
          })
        ).status,
      ).not.toBe(200);
    }
  });
  test('tokens are hashed, expire, and lock invalidates all sessions for only that signer', async () => {
    const { app, db, signed, advance } = setup();
    const first = (await (await signed('/api/family/session', 'family-session')).json()) as { token: string };
    const second = (await (await signed('/api/family/session', 'family-session')).json()) as { token: string };
    expect(JSON.stringify(db.query('SELECT * FROM family_sessions').all())).not.toContain(first.token);
    expect(db.query('SELECT token_hash FROM family_sessions WHERE token_hash=?').get(digest(first.token))).toBeTruthy();
    await app.request('/api/family/lock', {
      method: 'POST',
      headers: bearer(first.token),
    });
    expect(
      (
        await app.request(`/api/sprouts/${VAULT}`, {
          headers: bearer(second.token),
        })
      ).status,
    ).toBe(401);
    const third = (await (await signed('/api/family/session', 'family-session')).json()) as { token: string };
    advance(FAMILY_TTL + 1);
    expect(
      (
        await app.request(`/api/sprouts/${VAULT}`, {
          headers: bearer(third.token),
        })
      ).status,
    ).toBe(401);
  });
  test('public gift responses omit family metadata and checkout needs a signed wallet', async () => {
    const { app, signed } = setup();
    const res = await app.request(`/api/gifts/${GIFT}`);
    const text = await res.text();
    for (const privateText of ['Private child name', VAULT, account.address, 'notes', 'totals', 'paymentCount'])
      expect(text).not.toContain(privateText);
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(res.headers.get('referrer-policy')).toBe('no-referrer');
    expect((await app.request(`/api/gifts/${GIFT}/checkout`, { method: 'POST' })).status).toBe(401);
    const checkout = await signed(`/api/gifts/${GIFT}/checkout`, 'gift-checkout');
    expect(await checkout.json()).toMatchObject({
      vaultId: VAULT,
      chainVisibility: 'public',
    });
  });
});

describe('one-use read-only child invitations', () => {
  test('minimized view, single redemption, no family or write access, revoke closes the device session', async () => {
    const { app, signed } = setup();
    expect((await signed(`/api/family/invites/${VAULT}`, `kid-invite:${VAULT}`, {}, otherAccount)).status).toBe(403);
    const invite = (await (
      await signed(`/api/family/invites/${VAULT}`, `kid-invite:${VAULT}`, {
        showBalance: false,
      })
    ).json()) as { id: string; token: string };
    expect(invite.id).toMatch(/^[a-f0-9]{32}$/);
    const redeem = (token: string) =>
      app.request('/api/kid/redeem', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ id: invite.id, token }),
      });
    expect((await redeem('a'.repeat(43))).status).toBe(401);
    const first = await redeem(invite.token);
    expect(first.status).toBe(200);
    const session = (await first.json()) as { token: string };
    expect((await redeem(invite.token)).status).toBe(401);
    const view = await app.request('/api/kid/view', {
      headers: bearer(session.token),
    });
    expect(await view.json()).toMatchObject({
      balance: null,
      symbols: [],
      chores: 0,
    });
    expect(
      (
        await app.request(`/api/sprouts/${VAULT}`, {
          headers: bearer(session.token),
        })
      ).status,
    ).toBe(401);
    expect(
      (
        await app.request('/api/gifts', {
          method: 'POST',
          headers: bearer(session.token),
          body: '{}',
        })
      ).status,
    ).toBe(401);
    await signed(`/api/family/invites/${invite.id}/revoke`, `kid-revoke:${invite.id}`);
    expect((await app.request('/api/kid/view', { headers: bearer(session.token) })).status).toBe(401);
  });
  test('unopened invitations and redeemed sessions expire', async () => {
    const { app, signed, advance } = setup();
    const make = async () =>
      (await (await signed(`/api/family/invites/${VAULT}`, `kid-invite:${VAULT}`, {})).json()) as {
        id: string;
        token: string;
      };
    const a = await make(),
      b = await make();
    const redeem = (invite: unknown) =>
      app.request('/api/kid/redeem', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          id: (invite as { id: string }).id,
          token: (invite as { token: string }).token,
        }),
      });
    const redeemed = await redeem(a);
    expect(redeemed.status).toBe(200);
    const session = (await redeemed.json()) as { token: string };
    advance(24 * 60 * 60_000 + 1);
    expect((await app.request('/api/kid/view', { headers: bearer(session.token) })).status).toBe(401);
    advance(7 * 24 * 60 * 60_000);
    expect((await redeem(b)).status).toBe(401);
  });
});
