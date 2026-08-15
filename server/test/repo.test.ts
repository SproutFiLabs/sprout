import { describe, expect, test } from 'bun:test';
import {
  consumeNonce,
  createNonce,
  dueJobs,
  getCursor,
  getJob,
  getMilestone,
  insertChainEvent,
  insertGiftPayment,
  listGiftPayments,
  listMilestonesByVault,
  recordJobRun,
  setCursor,
  setMilestoneStatus,
  upsertJob,
  upsertMilestone,
  upsertSprout,
} from '../src/repo';
import { memoryDb } from './helpers';

const CHAIN = 31337;
const VAULT = '0x00000000000000000000000000000000000000a1';
const VAULT_2 = '0x00000000000000000000000000000000000000a2';
const TOKEN = '0x00000000000000000000000000000000000000b2';

describe('persistence and idempotency', () => {
  test('chain events are unique by (chainId, txHash, logIndex)', () => {
    const db = memoryDb();
    const base = {
      chainId: CHAIN,
      txHash: '0x' + '11'.repeat(32),
      logIndex: 3,
      blockNumber: 100,
      address: VAULT,
      eventName: 'GiftReceived',
      vaultId: VAULT,
      payload: { amount: '5' },
    };
    expect(insertChainEvent(db, base)).toBe(true);
    expect(insertChainEvent(db, base)).toBe(false);
    expect(insertChainEvent(db, { ...base, logIndex: 4 })).toBe(true);
  });

  test('gift payments key on the chain log identity', () => {
    const db = memoryDb();
    const payment = {
      giftId: '0x' + 'ab'.repeat(32),
      vaultId: VAULT,
      chainId: CHAIN,
      txHash: '0x' + '22'.repeat(32),
      logIndex: 0,
      gifter: '0x00000000000000000000000000000000000000c3',
      token: TOKEN,
      amount: '5000000',
      blockNumber: 101,
    };
    expect(insertGiftPayment(db, payment)).toBe(true);
    expect(insertGiftPayment(db, payment)).toBe(false);
    // A different (fake) logIndex is a distinct chain event.
    expect(insertGiftPayment(db, { ...payment, logIndex: 9 })).toBe(true);
    expect(listGiftPayments(db, payment.giftId)).toHaveLength(2);
  });

  test('milestone status is scoped to chain and vault', () => {
    const db = memoryDb();
    const id = '0x' + 'cd'.repeat(32);
    const base = {
      id,
      token: TOKEN,
      amount: '10000000',
      unlockTime: 0,
      status: 'created' as const,
      descriptionHash: null,
      createdTxHash: null,
      releasedTxHash: null,
    };
    upsertMilestone(db, { ...base, vaultId: VAULT, chainId: CHAIN });
    upsertMilestone(db, { ...base, vaultId: VAULT_2, chainId: CHAIN });

    // Releasing vault A must not touch vault B.
    expect(setMilestoneStatus(db, { chainId: CHAIN, vaultId: VAULT, id }, 'released')).toBe(true);
    expect(getMilestone(db, CHAIN, VAULT, id)?.status).toBe('released');
    expect(getMilestone(db, CHAIN, VAULT_2, id)?.status).toBe('created');

    // A release must not clobber the creation/unlock fields.
    const updated = getMilestone(db, CHAIN, VAULT, id);
    expect(updated?.amount).toBe('10000000');
    expect(updated?.unlockTime).toBe(0);
  });

  test('repeated creation cannot regress a terminal milestone', () => {
    const db = memoryDb();
    const releasedId = '0x' + 'e1'.repeat(32);
    const cancelledId = '0x' + 'e2'.repeat(32);
    const base = {
      token: TOKEN,
      amount: '10000000',
      unlockTime: 0,
      status: 'created' as const,
      descriptionHash: null,
      createdTxHash: null,
      releasedTxHash: null,
    };
    // Released then re-created (old/late receipt) stays released.
    upsertMilestone(db, { ...base, id: releasedId, vaultId: VAULT, chainId: CHAIN });
    expect(setMilestoneStatus(db, { chainId: CHAIN, vaultId: VAULT, id: releasedId }, 'released')).toBe(true);
    upsertMilestone(db, { ...base, id: releasedId, vaultId: VAULT, chainId: CHAIN });
    expect(getMilestone(db, CHAIN, VAULT, releasedId)?.status).toBe('released');
    expect(setMilestoneStatus(db, { chainId: CHAIN, vaultId: VAULT, id: releasedId }, 'cancelled')).toBe(false);

    // Cancelled then re-created stays cancelled.
    upsertMilestone(db, { ...base, id: cancelledId, vaultId: VAULT, chainId: CHAIN });
    setMilestoneStatus(db, { chainId: CHAIN, vaultId: VAULT, id: cancelledId }, 'cancelled');
    upsertMilestone(db, { ...base, id: cancelledId, vaultId: VAULT, chainId: CHAIN });
    expect(getMilestone(db, CHAIN, VAULT, cancelledId)?.status).toBe('cancelled');

    // Different vault, same milestone id is unaffected by the other's update.
    upsertMilestone(db, { ...base, id: releasedId, vaultId: VAULT_2, chainId: CHAIN });
    expect(getMilestone(db, CHAIN, VAULT_2, releasedId)?.status).toBe('created');
  });

  test('indexer cursor round-trips', () => {
    const db = memoryDb();
    expect(getCursor(db, CHAIN)).toBe(0);
    setCursor(db, CHAIN, 4242);
    expect(getCursor(db, CHAIN)).toBe(4242);
  });
});

describe('investment jobs', () => {
  function seedJob(db: ReturnType<typeof memoryDb>, nextRunAt: number) {
    upsertJob(db, {
      id: `${VAULT}:investment`,
      vaultId: VAULT,
      chainId: CHAIN,
      kind: 'scheduled_investment',
      amount: '10000000',
      periodSeconds: 604800,
      nextRunAt,
      lastRunAt: null,
      lastTxHash: null,
      status: 'active',
      attempts: 0,
      consecutiveFailures: 0,
      lastError: null,
    });
  }

  test('due jobs are selected only when active and due', () => {
    const db = memoryDb();
    seedJob(db, 1000);
    expect(dueJobs(db, 999)).toHaveLength(0);
    expect(dueJobs(db, 1000)).toHaveLength(1);

    recordJobRun(db, `${VAULT}:investment`, { nextRunAt: 2000, txHash: '0x' + '44'.repeat(32) });
    const job = getJob(db, `${VAULT}:investment`);
    expect(job?.nextRunAt).toBe(2000);
    expect(job?.attempts).toBe(1);
    expect(job?.consecutiveFailures).toBe(0);
  });

  test('consecutive failures increase on error and reset on success', () => {
    const db = memoryDb();
    seedJob(db, 1000);
    recordJobRun(db, `${VAULT}:investment`, { nextRunAt: 1060, error: 'boom' });
    expect(getJob(db, `${VAULT}:investment`)?.consecutiveFailures).toBe(1);
    recordJobRun(db, `${VAULT}:investment`, { nextRunAt: 1120, error: 'boom' });
    expect(getJob(db, `${VAULT}:investment`)?.consecutiveFailures).toBe(2);
    recordJobRun(db, `${VAULT}:investment`, { nextRunAt: 2000, txHash: '0x' + '55'.repeat(32) });
    expect(getJob(db, `${VAULT}:investment`)?.consecutiveFailures).toBe(0);
  });

  test('sprout records persist arrays', () => {
    const db = memoryDb();
    upsertSprout(db, {
      id: VAULT,
      chainId: CHAIN,
      parent: '0x00000000000000000000000000000000000000d4',
      beneficiary: '0x00000000000000000000000000000000000000e5',
      settlementToken: TOKEN,
      graduationTimestamp: 2_000_000_000,
      assets: [TOKEN, VAULT],
      weights: [6000, 4000],
      createdTxHash: null,
      createdBlock: 10,
    });
    const row = db.prepare('SELECT assets_json FROM sprouts WHERE id = ?').get(VAULT) as { assets_json: string };
    expect(JSON.parse(row.assets_json)).toEqual([TOKEN, VAULT]);
  });
});

describe('nonce consumption', () => {
  test('conditional update allows exactly one consumption', () => {
    const db = memoryDb();
    createNonce(db, {
      nonce: 'abc',
      address: '0x00000000000000000000000000000000000000d4',
      purpose: 'plant',
      message: 'm',
      expiresAt: Date.now() + 1000,
      usedAt: null,
      createdAt: Date.now(),
    });
    expect(consumeNonce(db, 'abc')).toBe(true);
    expect(consumeNonce(db, 'abc')).toBe(false);
  });
});
