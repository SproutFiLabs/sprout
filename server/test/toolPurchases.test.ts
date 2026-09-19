import { afterEach, describe, expect, test } from 'bun:test';
import { Hono } from 'hono';
import { openDb } from '../src/db';
import { createFamilySession } from '../src/privacy';
import { AuthError } from '../src/auth';
import { registerToolRoutes, type ToolRuntime } from '../src/tools';
import { createToolPurchase, ensureToolTables, eraseToolReports, ownedToolPurchase, redeemToolPurchase } from '../src/toolPurchases';

const wallet = '0x1111111111111111111111111111111111111111';
const other = '0x2222222222222222222222222222222222222222';
const hash = '0x' + 'ab'.repeat(32);
const now = 2_000_000;
const dbs: ReturnType<typeof openDb>[] = [];
afterEach(() => {
  for (const db of dbs.splice(0)) db.close();
});
function setup() {
  const db = openDb(':memory:');
  dbs.push(db);
  ensureToolTables(db);
  const runtime: ToolRuntime = { enabled: true, quote: async () => ({ amount: 123n, block: 10n }), verify: async () => ({ at: 2010 }) };
  const app = new Hono();
  app.onError((e, c) => c.json({ error: e instanceof AuthError ? e.message : 'Error' }, e instanceof AuthError ? 401 : 500));
  registerToolRoutes(app, { db, runtime, now: () => now });
  const token = createFamilySession(db, wallet, now).token;
  const tokenOther = createFamilySession(db, other, now).token;
  const req = (path: string, body?: unknown, auth = token) =>
    app.request('/api/family/tools/' + path, {
      method: body === undefined ? 'GET' : 'POST',
      headers: { authorization: `Bearer ${auth}`, 'content-type': 'application/json' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  const prepare = () => req('prepare', { kind: 'goal', input: { initial: 0, monthly: 100, months: 12, annualReturn: 0, target: 1200 } });
  return { db, runtime, app, req, prepare, tokenOther };
}

describe('paid reports', () => {
  test('prepares before payment but hides output; paid result survives retries and reloading', async () => {
    const { prepare, req } = setup();
    const response = await prepare();
    expect(response.status).toBe(201);
    const order = await response.json();
    expect(order.amount).toBe('123');
    expect(order.result).toBeNull();
    const first = await req(`purchases/${order.id}/verify`, { txHash: hash });
    expect(first.status).toBe(200);
    const paid = await first.json();
    expect(paid.result.report.requiredMonthly).toBe(100);
    expect(await (await req(`purchases/${order.id}/verify`, { txHash: hash })).json()).toEqual(paid);
    expect(await (await req(`purchases/${order.id}`)).json()).toEqual(paid);
  });
  test('public burn summary exposes only aggregate receipt fields', async () => {
    const { db, app } = setup();
    const first = createToolPurchase(db, { wallet, kind: 'goal', result: { private: 'x' }, amount: 7n, now: 1000, issuedBlock: 1n });
    redeemToolPurchase(db, first.id, wallet, hash, 1001);
    const response = await app.request('/api/tools/burns');
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ count: 1, totalAmount: '7', latest: [{ txHash: hash, amount: '7', at: 1001 }] });
  });
  test('different wallet and unauthenticated requests cannot see or claim reports', async () => {
    const { prepare, req, tokenOther } = setup();
    const order = await (await prepare()).json();
    expect((await req(`purchases/${order.id}`, undefined, tokenOther)).status).toBe(404);
    expect((await req(`purchases/${order.id}/verify`, { txHash: hash }, tokenOther)).status).toBe(404);
    expect((await req('purchases', undefined, '')).status).toBe(401);
    expect((await (await req('purchases', undefined, tokenOther)).json()).purchases).toEqual([]);
  });
  test('one transfer cannot buy two reports, including concurrent claims', async () => {
    const { prepare, req } = setup();
    const a = await (await prepare()).json(),
      b = await (await prepare()).json();
    const results = await Promise.all([
      req(`purchases/${a.id}/verify`, { txHash: hash }),
      req(`purchases/${b.id}/verify`, { txHash: hash }),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
  });
  test('failed verification never unlocks output or records payment', async () => {
    const { prepare, req, runtime } = setup();
    const order = await (await prepare()).json();
    runtime.verify = async () => {
      throw new Error('untrusted provider details');
    };
    const failed = await req(`purchases/${order.id}/verify`, { txHash: hash });
    expect(failed.status).toBe(409);
    expect(await failed.text()).not.toContain('untrusted provider');
    expect((await (await req(`purchases/${order.id}`)).json()).result).toBeNull();
  });
  test('bad inputs and unavailable quotes never create a payable purchase', async () => {
    const { req, prepare, runtime } = setup();
    expect((await req('prepare', { kind: 'goal', input: { initial: -1 } })).status).toBe(400);
    runtime.quote = async () => {
      throw new Error('rpc secret');
    };
    const failed = await prepare();
    expect(failed.status).toBe(503);
    expect(await failed.text()).not.toContain('rpc secret');
    expect((await (await req('purchases')).json()).purchases).toEqual([]);
  });
  test('disabled payments stop new purchases but paid reports remain accessible', async () => {
    const { prepare, req, runtime } = setup();
    const order = await (await prepare()).json();
    await req(`purchases/${order.id}/verify`, { txHash: hash });
    runtime.enabled = false;
    expect((await prepare()).status).toBe(503);
    expect((await (await req(`purchases/${order.id}`)).json()).result).not.toBeNull();
  });
  test('erasing private reports preserves the spent-receipt ledger', () => {
    const { db } = setup();
    const make = (owner: string) =>
      createToolPurchase(db, { wallet: owner, kind: 'portfolio', result: { private: 'value' }, amount: 1n, now: 1000, issuedBlock: 1n });
    const first = make(wallet),
      untouched = make(other);
    redeemToolPurchase(db, first.id, wallet, hash, 1001);
    eraseToolReports(db, wallet);
    expect(() => ownedToolPurchase(db, first.id, wallet)).toThrow();
    expect(ownedToolPurchase(db, untouched.id, other).result_json).toContain('value');
    const next = make(wallet);
    expect(() => redeemToolPurchase(db, next.id, wallet, hash, 1002)).toThrow('already');
  });
  test('prepared output is retained for delayed receipt recovery', () => {
    const { db } = setup();
    const first = createToolPurchase(db, { wallet, kind: 'goal', result: { ready: true }, amount: 1n, now: 1000, issuedBlock: 1n });
    createToolPurchase(db, { wallet, kind: 'goal', result: {}, amount: 1n, now: 1_000_000, issuedBlock: 2n });
    expect(ownedToolPurchase(db, first.id, wallet).result_json).not.toBeNull();
    expect(redeemToolPurchase(db, first.id, wallet, hash, 2000).result).toEqual({ ready: true });
  });
});

// More than the recent-history limit must still count toward lifetime burns.
test('public tool burn totals include all receipts with exact token precision', async () => {
  const { db, app } = setup();
  const amount = 123000000000000000001n;
  for (let i = 0; i < 25; i++) db.run('INSERT INTO tool_burn_redemptions VALUES (?,?,?,?)', ['0x' + i.toString(16).padStart(64, '0'), 'receipt-' + i, String(amount), 1000 + i]);
  const summary = await (await app.request('/api/tools/burns')).json();
  expect(summary.count).toBe(25);
  expect(summary.totalAmount).toBe(String(amount * 25n));
  expect(summary.latest).toHaveLength(20);
});
