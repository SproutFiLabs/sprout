import { describe, expect, test } from 'bun:test';
import { issueNonce } from '../src/auth';
import { insertGift, upsertMilestone, upsertSprout } from '../src/repo';
import { loadServerConfig } from '../src/config';
import { createChainContext } from '../src/chain';
import {
  account,
  otherAccount,
  memoryDb,
  testimonialChain,
  testApp,
} from './helpers';

const VAULT = '0x00000000000000000000000000000000000000a1';
const TOKEN = '0x00000000000000000000000000000000000000b2';
const PARENT = account.address;
const BENEFICIARY = '0x00000000000000000000000000000000000000e5';

function seedSprout(db: ReturnType<typeof memoryDb>) {
  upsertSprout(db, {
    id: VAULT,
    chainId: 31337,
    parent: PARENT,
    beneficiary: BENEFICIARY,
    settlementToken: TOKEN,
    graduationTimestamp: 2_000_000_000,
    assets: [TOKEN],
    weights: [10_000],
    createdTxHash: null,
    createdBlock: null,
  });
}

async function signedHeaders(db: ReturnType<typeof memoryDb>, purpose: string, useOther = false) {
  const signer = useOther ? otherAccount : account;
  const challenge = issueNonce(db, { address: signer.address, purpose });
  const signature = await signer.signMessage({ message: challenge.message });
  return {
    'content-type': 'application/json',
    'x-sprout-address': signer.address,
    'x-sprout-nonce': challenge.nonce,
    'x-sprout-signature': signature,
  };
}

describe('read endpoints', () => {
  test('health reports configuration state without secrets', async () => {
    const db = memoryDb();
    const app = testApp(db, testimonialChain());
    const res = await app.request('/api/health');
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.ok).toBe(true);
    expect(body.configured).toBe(false);
    expect(body.localDemo).toBe(true);
  });

  test('fixtures are labeled when local demo is on', async () => {
    const db = memoryDb();
    const app = testApp(db, testimonialChain());
    const res = await app.request('/api/fixtures');
    const body = (await res.json()) as { fixture: boolean; label: string };
    expect(body.fixture).toBe(true);
    expect(body.label).toContain('LOCAL DEMO FIXTURE');
  });

  test('public config never leaks the internal RPC URLs', async () => {
    const config = loadServerConfig({
      SPROUT_CHAIN_ID: '4663',
      SPROUT_RPC_URL: 'https://user:supersecret@rpc.example.invalid',
      SPROUT_RPC_FALLBACK_URLS: 'https://backup.example.invalid/v2/fallbackkey123,https://second.example.invalid',
      SPROUT_FACTORY_ADDRESS: '0x00000000000000000000000000000000000000aa',
      SPROUT_SETTLEMENT_TOKEN: TOKEN,
      SPROUT_VENUE_ADDRESS: '0x00000000000000000000000000000000000000bb',
      SPROUT_STOCK_TOKENS: `AAA:${TOKEN}:18:1000000000000000000:0x00000000000000000000000000000000000000f1`,
    });
    const db = memoryDb();
    const app = testApp(db, createChainContext(config));
    const res = await app.request('/api/config');
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).not.toContain('supersecret');
    expect(text).not.toContain('rpc.example.invalid');
    expect(text).not.toContain('"rpcUrl"');
    expect(text).not.toContain('fallbackkey123');
    expect(text).not.toContain('example.invalid');
    expect(text).not.toContain('rpcFallbackUrls');
  });
});

describe('public gift reads do not leak family records', () => {
  test('gift lookup exposes only opaque ids and accepted assets', async () => {
    const db = memoryDb();
    seedSprout(db);
    const giftId = '0x' + 'ab'.repeat(32);
    insertGift(db, { id: giftId, vaultId: VAULT, label: 'Birthday', acceptedAssets: [TOKEN], status: 'open' });
    const app = testApp(db, testimonialChain());
    const res = await app.request(`/api/gifts/${giftId}`);
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).not.toContain(BENEFICIARY);
    expect(text).not.toContain('parent');
    const body = JSON.parse(text) as { vaultId: string; paymentCount: number };
    expect(body.vaultId).toBe(VAULT);
    expect(body.paymentCount).toBe(0);
  });

  test('sprout detail includes vaultId on gift summaries', async () => {
    const db = memoryDb();
    seedSprout(db);
    insertGift(db, { id: '0x' + 'ab'.repeat(32), vaultId: VAULT, label: null, acceptedAssets: [TOKEN], status: 'open' });
    const app = testApp(db, testimonialChain());
    const res = await app.request(`/api/sprouts/${VAULT}`);
    const body = (await res.json()) as { gifts: Array<{ vaultId: string }> };
    expect(body.gifts[0]?.vaultId).toBe(VAULT);
  });
});

describe('per-vault authorization', () => {
  test('a non-parent wallet cannot create a milestone', async () => {
    const db = memoryDb();
    seedSprout(db);
    const app = testApp(db, testimonialChain());
    const headers = await signedHeaders(db, 'milestone-create', true);
    const res = await app.request(`/api/sprouts/${VAULT}/milestones`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ milestoneId: '0x' + 'cd'.repeat(32), txHash: '0x' + 'ef'.repeat(32) }),
    });
    expect(res.status).toBe(403);
  });

  test('a parent cannot create a milestone without an on-chain receipt', async () => {
    const db = memoryDb();
    seedSprout(db);
    const app = testApp(db, testimonialChain());
    const headers = await signedHeaders(db, 'milestone-create');
    const res = await app.request(`/api/sprouts/${VAULT}/milestones`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ milestoneId: '0x' + 'cd'.repeat(32), txHash: '0x' + 'ef'.repeat(32) }),
    });
    // Chain is not configured, so a receipt cannot be verified.
    expect(res.status).toBe(503);
  });

  test('missing authentication headers are rejected', async () => {
    const db = memoryDb();
    seedSprout(db);
    const app = testApp(db, testimonialChain());
    const res = await app.request(`/api/sprouts/${VAULT}/milestones`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ milestoneId: '0x' + 'cd'.repeat(32), txHash: '0x' + 'ef'.repeat(32) }),
    });
    expect(res.status).toBe(401);
  });

  test('milestone reads are scoped to the vault', async () => {
    const db = memoryDb();
    seedSprout(db);
    upsertMilestone(db, {
      id: '0x' + 'cd'.repeat(32),
      vaultId: '0x00000000000000000000000000000000000000ff',
      chainId: 31337,
      token: TOKEN,
      amount: '1',
      unlockTime: 0,
      status: 'created',
      descriptionHash: null,
      createdTxHash: null,
      releasedTxHash: null,
    });
    const app = testApp(db, testimonialChain());
    const res = await app.request(`/api/sprouts/${VAULT}/milestones`);
    const body = (await res.json()) as { milestones: unknown[] };
    expect(body.milestones).toHaveLength(0);
  });
});

describe('growth history honesty', () => {
  test('reports unavailable rather than fabricating a chart', async () => {
    const db = memoryDb();
    seedSprout(db);
    const app = testApp(db, testimonialChain());
    const res = await app.request(`/api/sprouts/${VAULT}/growth`);
    const body = (await res.json()) as { available: boolean; reason?: string };
    expect(body.available).toBe(false);
    expect(body.reason).toContain('no verified growth history');
  });
});
