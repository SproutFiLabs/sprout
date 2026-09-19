import { describe, expect, test } from 'bun:test';
import { createApp } from '../src/app';
import { account, otherAccount, memoryDb, testimonialChain } from './helpers';
import { upsertSprout } from '../src/repo';
import { createFamilySession } from '../src/privacy';
import { primeHoldings, type HoldingsSnapshot } from '../src/chain';
import { snapshotCents } from '../src/zk';
import { ZK_TTL_MS, type ZkIssuance } from '@sprout/shared/zk';
import { milestoneCommitment } from '@sprout/shared/zk-commitment';
const VAULT = '0x00000000000000000000000000000000000000a1';
const base: HoldingsSnapshot = {
  available: true,
  blockNumber: 12,
  feedDecimals: 8,
  totalValueUsd: '125099999999',
  settlementAssumption: '1 USD',
  holdings: [],
};
function setup(snapshot: HoldingsSnapshot = base) {
  const db = memoryDb();
  const chain = testimonialChain();
  let now = Date.now();
  upsertSprout(db, {
    id: VAULT,
    chainId: 31337,
    parent: account.address,
    beneficiary: otherAccount.address,
    settlementToken: VAULT,
    graduationTimestamp: 2000000000,
    assets: [],
    weights: [],
    createdTxHash: null,
    createdBlock: null,
  });
  primeHoldings(chain, VAULT, snapshot);
  const app = createApp({ db, chain, localDemo: false, now: () => now });
  const post = (path: string, body: unknown, headers = {}) =>
    app.request(path, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...headers },
      body: JSON.stringify(body),
    });
  async function signed(path: string, purpose: string, body: unknown = {}, signer = account) {
    const challenge = (await (await post('/api/auth/nonce', { address: signer.address, purpose })).json()) as {
      message: string;
      nonce: string;
    };
    return post(path, body, {
      'x-sprout-address': signer.address,
      'x-sprout-nonce': challenge.nonce,
      'x-sprout-signature': await signer.signMessage({ message: challenge.message }),
    });
  }
  const issue = (amount = '50000', signer = account) =>
    signed(`/api/zk/issue/${VAULT}`, `zk-issue:${VAULT}`, { thresholdCents: amount }, signer);
  return {
    app,
    db,
    chain,
    signed,
    issue,
    post,
    advance: (ms: number) => {
      now += ms;
      primeHoldings(chain, VAULT, snapshot);
    },
  };
}
describe('certified zero-knowledge milestone boundary', () => {
  test('only the parent can issue or list; an invented balance is rejected; headers are private', async () => {
    const { app, db, issue, post } = setup();
    expect((await post(`/api/zk/issue/${VAULT}`, { thresholdCents: '50000', balance: '999999' })).status).toBe(401);
    expect((await issue('50000', otherAccount)).status).toBe(403);
    expect((await app.request(`/api/zk/certificates/${VAULT}`)).status).toBe(401);
    const other = createFamilySession(db, otherAccount.address, Date.now());
    expect(
      (await app.request(`/api/zk/certificates/${VAULT}`, { headers: { authorization: `Bearer ${other.token}` } }))
        .status,
    ).toBe(403);
    const res = await issue();
    expect(res.status).toBe(201);
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(res.headers.get('referrer-policy')).toBe('no-referrer');
    const issued = (await res.json()) as ZkIssuance;
    expect(issued.witness.balance).toBe('125099');
    expect(await milestoneCommitment(issued.witness.balance, issued.witness.salt, issued.witness.scope)).toBe(
      issued.certificate.commitment,
    );
    expect(issued.certificate.expiresAt - issued.certificate.issuedAt).toBe(ZK_TTL_MS);
    const stored = JSON.stringify(db.query('SELECT * FROM zk_milestone_certificates').all());
    expect(stored).not.toContain(issued.witness.salt);
    expect(stored).not.toContain('125099');
    const parent = createFamilySession(db, account.address, Date.now());
    const list = await (
      await app.request(`/api/zk/certificates/${VAULT}`, { headers: { authorization: `Bearer ${parent.token}` } })
    ).text();
    for (const secret of [VAULT, account.address, issued.witness.salt, '125099']) expect(list).not.toContain(secret);
    db.close();
  });
  test('certificates use fresh commitments and public checks never return family metadata', async () => {
    const { db, issue, post } = setup();
    const first = (await (await issue()).json()) as ZkIssuance;
    const second = (await (await issue()).json()) as ZkIssuance;
    expect(first.certificate.commitment).not.toBe(second.certificate.commitment);
    const status = await post('/api/zk/status', first.certificate);
    const body = await status.text();
    expect(JSON.parse(body).active).toBe(true);
    for (const secret of [VAULT, account.address, first.witness.salt, first.witness.balance])
      expect(body).not.toContain(secret);
    for (const change of [
      { commitment: '123' },
      { thresholdCents: '100000' },
      { issuedAt: first.certificate.issuedAt + 1, expiresAt: first.certificate.expiresAt + 1 },
    ]) {
      const altered = await post('/api/zk/status', { ...first.certificate, ...change });
      expect(((await altered.json()) as { active: boolean }).active).not.toBe(true);
    }
    db.close();
  });
  test('insufficient, zero, negative, overflowing and stale values fail closed', async () => {
    const { db, issue, signed } = setup();
    expect((await issue('500000')).status).toBe(422);
    for (const value of ['0', '-1', '18446744073709551616', '1e8', '00']) expect((await issue(value)).status).toBe(400);
    expect(
      (await signed(`/api/zk/issue/${VAULT}`, `zk-issue:${VAULT}`, { thresholdCents: '50000', balance: '1000000' }))
        .status,
    ).toBe(400);
    db.close();
    for (const state of [
      { ...base, available: false },
      { ...base, totalValueUsd: null },
      { ...base, blockNumber: null },
    ]) {
      const t = setup(state);
      expect((await t.issue()).status).toBe(503);
      t.db.close();
    }
    expect(snapshotCents({ ...base, feedDecimals: 0, totalValueUsd: '5' })).toBe('500');
    expect(snapshotCents({ ...base, feedDecimals: 8, totalValueUsd: '49999999999' })).toBe('49999');
    expect(() => snapshotCents({ ...base, totalValueUsd: '-1' })).toThrow();
  });
  test('revocation and expiry invalidate a certificate; beneficiaries cannot revoke', async () => {
    const { db, issue, post, signed, advance } = setup();
    const first = (await (await issue()).json()) as ZkIssuance;
    const second = (await (await issue()).json()) as ZkIssuance;
    expect(
      (await signed(`/api/zk/revoke/${first.certificate.id}`, `zk-revoke:${first.certificate.id}`, {}, otherAccount))
        .status,
    ).toBe(403);
    expect((await signed(`/api/zk/revoke/${first.certificate.id}`, `zk-revoke:${first.certificate.id}`)).status).toBe(
      200,
    );
    expect(await (await post('/api/zk/status', first.certificate)).json()).toMatchObject({ active: false });
    expect(await (await post('/api/zk/status', second.certificate)).json()).toMatchObject({ active: true });
    advance(ZK_TTL_MS);
    expect(await (await post('/api/zk/status', second.certificate)).json()).toMatchObject({ active: false });
    db.close();
  });
  test('limits issuance including revoked certificates and bounds input size', async () => {
    const { db, issue, post } = setup();
    for (let i = 0; i < 10; i++) expect((await issue()).status).toBe(201);
    expect((await issue()).status).toBe(429);
    expect((await post('/api/zk/status', { huge: 'x'.repeat(5000) })).status).toBe(413);
    db.close();
  });
});
