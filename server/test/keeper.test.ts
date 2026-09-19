import { readHeaders } from './helpers';
import { describe, expect, test } from 'bun:test';
import type { Hex } from 'viem';
import type { KeeperBudgetConfig } from '../src/config';
import {
  automationCapability,
  runDueJobs,
} from '../src/jobs';
import {
  keeperAccounting,
  getKeeperTx,
  getInFlightKeeperTx,
  insertKeeperTx,
  listInFlightKeeperTxs,
  upsertJob,
  upsertSprout,
} from '../src/repo';
import { recoverKeeperTransactions, runKeeperJob, type KeeperChain, type KeeperReceipt, type KeeperSigner } from '../src/keeper';
import { memoryDb, testimonialChain, testApp } from './helpers';

const CHAIN = 4663;
const KEEPER = '0x13fAE4472016C83C393d5809Fb990A72e45e0d22';
const VAULT = '0x00000000000000000000000000000000000000a1';
const DATA = '0xabcdef' as Hex;
const BUDGET: KeeperBudgetConfig = {
  maxFeePerGasWei: 1_000_000_000n,
  maxPriorityFeePerGasWei: 100_000_000n,
  gasLimitCap: 6_000_000n,
  dailyFeeBudgetWei: 10n ** 16n,
};

function fakeChain(opts: {
  chainId?: number;
  nonce?: number;
  balance?: bigint;
  estimateGas?: bigint;
  maxFeePerGas?: bigint;
  receipts?: Array<KeeperReceipt | null>;
} = {}) {
  const sent: Hex[] = [];
  const estimateArgs: Array<{ data: Hex; from: string; to: string }> = [];
  let receiptIndex = 0;
  let failBroadcast = 0;
  const chain: KeeperChain = {
    chainId: async () => opts.chainId ?? CHAIN,
    nonce: async () => opts.nonce ?? 0,
    balance: async () => opts.balance ?? 10n ** 18n,
    estimateGas: async (data, from, to) => {
      estimateArgs.push({ data, from, to });
      return opts.estimateGas ?? 1_000_000n;
    },
    feePerGas: async () => ({ maxFeePerGas: opts.maxFeePerGas ?? 1_000_000_000n, maxPriorityFeePerGas: 50_000_000n }),
    sendRawTransaction: async (raw) => {
      if (failBroadcast > 0) {
        failBroadcast -= 1;
        throw new Error('nonce too low');
      }
      sent.push(raw);
      return raw;
    },
    receipt: async () => opts.receipts?.[receiptIndex++] ?? null,
  };
  return { chain, sent, estimateArgs, failNextBroadcast: () => (failBroadcast += 1) };
}

function signer() {
  let signs = 0;
  const s: KeeperSigner & { signs: () => number } = {
    address: KEEPER,
    signTransaction: async (tx) => {
      signs += 1;
      return `0x02${tx.nonce.toString(16).padStart(2, '0')}${'ab'.repeat(31)}` as Hex;
    },
    signs: () => signs,
  };
  return s;
}

const input = (over: Record<string, unknown> = {}) => ({
  jobId: 'job1',
  vaultId: VAULT,
  chainId: CHAIN,
  data: DATA,
  nowSeconds: 1_700_000_000,
  sinceMs: 0,
  budget: BUDGET,
  maxReceiptAttempts: 1,
  delayMs: 0,
  sleep: async () => {},
  ...over,
});

const mined = (gasUsed = 100_000n, price = 1_000_000_000n): KeeperReceipt => ({
  status: 'success',
  blockNumber: 10n,
  gasUsed,
  effectiveGasPrice: price,
});

describe('keeper gas policy (B3)', () => {
  test('rejects an estimate above the gas cap before signing', async () => {
    const db = memoryDb();
    const s = signer();
    const { chain, sent } = fakeChain({ estimateGas: 9_000_000n });
    const r = await runKeeperJob(chain, s, db, input());
    expect(r.outcome).toBe('gas-cap-exceeded');
    expect(s.signs()).toBe(0);
    expect(sent).toHaveLength(0);
    expect(getInFlightKeeperTx(db, 'job1')).toBeNull();
  });

  test('rejects a fee above the cap before signing', async () => {
    const db = memoryDb();
    const { chain, sent } = fakeChain({ maxFeePerGas: 5_000_000_000n });
    const r = await runKeeperJob(chain, signer(), db, input());
    expect(r.outcome).toBe('fee-cap-exceeded');
    expect(sent).toHaveLength(0);
  });

  test('enforces the priority-fee ceiling', async () => {
    const db = memoryDb();
    const chain = fakeChain().chain;
    const withPriority = {
      ...chain,
      feePerGas: async () => ({ maxFeePerGas: 1_000_000_000n, maxPriorityFeePerGas: 5_000_000_000n }),
    } as KeeperChain;
    const r = await runKeeperJob(withPriority, signer(), db, input());
    expect(r.outcome).toBe('fee-cap-exceeded');
  });

  test('estimates against the vault target, not contract creation', async () => {
    const db = memoryDb();
    const { chain, estimateArgs } = fakeChain({ receipts: [null] });
    await runKeeperJob(chain, signer(), db, input());
    expect(estimateArgs[0]).toEqual({ data: DATA, from: KEEPER, to: VAULT });
  });

  test('daily budget counts pending + spent across restart', async () => {
    const db = memoryDb();
    // Pre-existing rows as if written by a previous process.
    insertKeeperTx(db, row('old-mined', 'oldJob', 0, '100000', '1000000000', 'mined', '100000', '1000000000'));
    insertKeeperTx(db, row('old-sent', 'oldJob2', 1, '1000000', '1000000000', 'sent', null, null));
    const accounting = keeperAccounting(db, CHAIN, 0);
    expect(accounting.spentWei).toBe(100_000n * 1_000_000_000n);
    expect(accounting.pendingWei).toBe(1_000_000n * 1_000_000_000n);
    // dailyBudget below spent+pending+worst → rejected with no sign.
    const s = signer();
    const tight = { ...BUDGET, dailyFeeBudgetWei: 1_200_000_000_000n };
    const r = await runKeeperJob(fakeChain().chain, s, db, input({ budget: tight }));
    expect(r.outcome).toBe('budget-exceeded');
    expect(s.signs()).toBe(0);
  });

  test('refuses when the keeper balance cannot cover the reservation', async () => {
    const db = memoryDb();
    const r = await runKeeperJob(fakeChain({ balance: 1n }).chain, signer(), db, input());
    expect(r.outcome).toBe('balance-insufficient');
  });
});

describe('keeper durable idempotency (B2)', () => {
  test('persists signed raw+hash before broadcast and returns pending on uncertain receipt', async () => {
    const db = memoryDb();
    const s = signer();
    const { chain, sent } = fakeChain({ receipts: [null] });
    const r = await runKeeperJob(chain, s, db, input());
    expect(r.outcome).toBe('pending');
    const tx = getInFlightKeeperTx(db, 'job1')!;
    expect(tx.rawTx).toBeTruthy();
    expect(String(tx.txHash)).toBe(String(r.txHash));
    expect(tx.status).toBe('sent');
    expect(sent).toHaveLength(1);
  });

  test('mined-on-resume reconciles the same hash without re-signing or a new nonce', async () => {
    const db = memoryDb();
    const s = signer();
    const first = fakeChain({ receipts: [null] });
    await runKeeperJob(first.chain, s, db, input());
    const txHash = getInFlightKeeperTx(db, 'job1')!.txHash;

    const second = fakeChain({ receipts: [mined()] });
    const r = await runKeeperJob(second.chain, s, db, input());
    expect(r.outcome).toBe('executed');
    expect(String(r.txHash)).toBe(String(txHash));
    expect(s.signs()).toBe(1); // signed exactly once
    expect(getInFlightKeeperTx(db, 'job1')).toBeNull();
    expect(getKeeperTx(db, `job1:0`)!.status).toBe('mined');
    expect(second.sent).toHaveLength(0); // receipt found first, no rebroadcast
  });

  test('uncertain in-flight blocks a new nonce and rebroadcasts the same raw bytes', async () => {
    const db = memoryDb();
    const s = signer();
    const first = fakeChain({ receipts: [null, null] });
    first.failNextBroadcast(); // first broadcast errors (already-known/nonce-too-low)
    const r1 = await runKeeperJob(first.chain, s, db, input({ maxReceiptAttempts: 1 }));
    expect(r1.outcome).toBe('pending');
    const tx = getInFlightKeeperTx(db, 'job1')!;
    expect(tx.status).toBe('sent');
    expect(tx.rawTx).toBeTruthy();
    const raw = tx.rawTx;

    // Resume while still uncertain: same raw rebroadcast, no new sign.
    const second = fakeChain({ receipts: [null] });
    const r2 = await runKeeperJob(second.chain, s, db, input());
    expect(r2.outcome).toBe('already-in-flight');
    expect(String(second.sent[0])).toBe(String(raw)); // exact same bytes
    expect(s.signs()).toBe(1);
    expect(listInFlightKeeperTxs(db)).toHaveLength(1);
  });

  test('reverted receipt counts the fee', async () => {
    const db = memoryDb();
    const reverted: KeeperReceipt = { status: 'reverted', blockNumber: 10n, gasUsed: 50_000n, effectiveGasPrice: 1_000_000_000n };
    const r = await runKeeperJob(fakeChain({ receipts: [reverted] }).chain, signer(), db, input());
    expect(r.outcome).toBe('reverted');
    expect(getKeeperTx(db, 'job1:0')!.status).toBe('reverted');
    expect(keeperAccounting(db, CHAIN, 0).spentWei).toBe(50_000n * 1_000_000_000n);
  });

  test('missing effectiveGasPrice keeps the reservation held and blocks retry', async () => {
    const db = memoryDb();
    const s = signer();
    const noFee: KeeperReceipt = { status: 'success', blockNumber: 10n, gasUsed: 1_000_000n };
    const r = await runKeeperJob(fakeChain({ receipts: [noFee] }).chain, s, db, input());
    expect(r.outcome).toBe('unknown-fee');
    const tx = getKeeperTx(db, 'job1:0')!;
    expect(tx.status).toBe('unknown_fee');
    // Conservative reservation: worst-case is still counted as pending, not zero.
    const acct = keeperAccounting(db, CHAIN, 0);
    expect(acct.pendingWei).toBe(1_000_000n * 1_000_000_000n);
    expect(acct.spentWei).toBe(0n);
    // A later run reconciles receipt-only and never re-signs.
    const r2 = await runKeeperJob(fakeChain({ receipts: [noFee] }).chain, s, db, input());
    expect(r2.outcome).toBe('unknown-fee');
    expect(s.signs()).toBe(1);

    // Reverted + missing fee is also held, not zeroed.
    const db2 = memoryDb();
    const revertedNoFee: KeeperReceipt = { status: 'reverted', blockNumber: 10n, gasUsed: 2n };
    const r3 = await runKeeperJob(fakeChain({ receipts: [revertedNoFee] }).chain, signer(), db2, input());
    expect(r3.outcome).toBe('unknown-fee');
    expect(getKeeperTx(db2, 'job1:0')!.status).toBe('unknown_fee');
  });

  test('a second job never inherits the first job result and executes its own tx once clear', async () => {
    const db = memoryDb();
    const s = signer();
    // Job A signs and is left uncertain.
    const a1 = fakeChain({ receipts: [null] });
    expect((await runKeeperJob(a1.chain, s, db, input())).outcome).toBe('pending');
    const jobATx = getKeeperTx(db, 'job1:0')!;

    // Job B is deferred while A is unresolved: no result inherited, no own tx.
    const b1 = fakeChain({ receipts: [null] });
    const rb1 = await runKeeperJob(b1.chain, s, db, input({ jobId: 'job2' }));
    expect(rb1.outcome).toBe('deferred');
    expect(String(rb1.txHash)).toBe(String(jobATx.txHash)); // A's hash, not B's execution
    expect(getKeeperTx(db, 'job2:1')).toBeNull();
    expect(s.signs()).toBe(1);

    // Job A's receipt arrives; A executes with its own hash.
    const a2 = fakeChain({ receipts: [mined()] });
    const ra2 = await runKeeperJob(a2.chain, s, db, input());
    expect(ra2.outcome).toBe('executed');
    expect(String(ra2.txHash)).toBe(String(jobATx.txHash));

    // Now that no tx is in flight, job B signs its own nonce-1 tx with a distinct hash.
    const b2 = fakeChain({ nonce: 1, receipts: [mined()] });
    const rb2 = await runKeeperJob(b2.chain, s, db, input({ jobId: 'job2' }));
    expect(rb2.outcome).toBe('executed');
    expect(String(rb2.txHash)).not.toBe(String(jobATx.txHash));
    const jobBTx = getKeeperTx(db, 'job2:1')!;
    expect(jobBTx.nonce).toBe(1);
    expect(jobBTx.status).toBe('mined');
    expect(String(jobBTx.txHash)).toBe(String(rb2.txHash));
  });

  test('receipt polling still runs when rebroadcast is disabled', async () => {
    const db = memoryDb();
    const s = signer();
    // First call leaves a signed/sent in-flight tx without a receipt.
    await runKeeperJob(fakeChain({ receipts: [null] }).chain, s, db, input());
    // Disabled reconcile with a receipt available must finalize, not return pending.
    const c = fakeChain({ receipts: [mined()] });
    const finalized = await recoverKeeperTransactions(c.chain, db, { allowRebroadcast: false, maxReceiptAttempts: 2, delayMs: 0 });
    expect(finalized).toBe(1);
    expect(c.sent).toHaveLength(0);
    expect(getKeeperTx(db, 'job1:0')!.status).toBe('mined');
  });

  test('disabled recovery is receipt-only and never broadcasts persisted signed bytes', async () => {
    const db = memoryDb();
    const s = signer();
    await runKeeperJob(fakeChain({ receipts: [null] }).chain, s, db, input());
    const inFlight = getInFlightKeeperTx(db, 'job1')!;

    const c1 = fakeChain({ receipts: [null] });
    const fin1 = await recoverKeeperTransactions(c1.chain, db, { allowRebroadcast: false, maxReceiptAttempts: 1, delayMs: 0 });
    expect(fin1).toBe(0);
    expect(c1.sent).toHaveLength(0); // no new broadcast while disabled

    const c2 = fakeChain({ receipts: [mined()] });
    const fin2 = await recoverKeeperTransactions(c2.chain, db, { allowRebroadcast: false, maxReceiptAttempts: 1, delayMs: 0 });
    expect(fin2).toBe(1);
    expect(c2.sent).toHaveLength(0);
    expect(getKeeperTx(db, inFlight.id)!.status).toBe('mined');
  });

  test('blocks signing for another job while any tx for the signer is in flight', async () => {
    const db = memoryDb();
    const s = signer();
    await runKeeperJob(fakeChain({ receipts: [null] }).chain, s, db, input());
    const jobARaw = getInFlightKeeperTx(db, 'job1')!.rawTx;
    expect(jobARaw).toBeTruthy();

    const b = fakeChain({ receipts: [null] });
    const r = await runKeeperJob(b.chain, s, db, input({ jobId: 'jobB' }));
    expect(r.outcome).toBe('deferred');
    // Only job A's exact raw tx may be rebroadcast; job B never signs a new nonce.
    expect(b.sent).toHaveLength(1);
    expect(String(b.sent[0])).toBe(String(jobARaw));
    expect(s.signs()).toBe(1);
    expect(getKeeperTx(db, 'jobB:0')).toBeNull();
  });
});

describe('automation capability (B1)', () => {
  test('no keeper => disabled, and due jobs become unavailable without erasing the schedule', async () => {
    const ctx = testimonialChain(); // no keeperPrivateKey
    expect(automationCapability(ctx)).toEqual({ keeperConfigured: false, gasBudgetConfigured: false, enabled: false });
    const db = memoryDb();
    upsertSprout(db, {
      id: VAULT,
      chainId: ctx.config.chain.chainId,
      parent: '0x00000000000000000000000000000000000000d4',
      beneficiary: '0x00000000000000000000000000000000000000e5',
      settlementToken: '0x00000000000000000000000000000000000000b2',
      graduationTimestamp: 2_000_000_000,
      assets: ['0x00000000000000000000000000000000000000b2'],
      weights: [10000],
      createdTxHash: null,
      createdBlock: null,
    });
    upsertJob(db, {
      id: 'job1',
      vaultId: VAULT,
      chainId: ctx.config.chain.chainId,
      kind: 'scheduled_investment',
      amount: '1000000',
      periodSeconds: 604800,
      nextRunAt: 0,
      lastRunAt: null,
      lastTxHash: null,
      status: 'active',
      attempts: 0,
      consecutiveFailures: 0,
      lastError: null,
    });

    // No publicClient in testimonialChain, but runDueJobs still gates on signer/budget.
    const results = await runDueJobs(ctx, db, { nowSeconds: 1_000_000, sinceMs: 0 });
    expect(results[0]?.status).toBe('paused');
    const job = db.prepare("SELECT status FROM investment_jobs WHERE id='job1'").get() as { status: string };
    expect(job.status).toBe('unavailable');

    const app = testApp(db, ctx);
    const health = (await (await app.request('/api/health')).json()) as { automation: { enabled: boolean } };
    expect(health.automation.enabled).toBe(false);
    const detail = (await (await app.request(`/api/sprouts/${VAULT}`, { headers: readHeaders(db, '0x00000000000000000000000000000000000000d4') })).json()) as { automation: { enabled: boolean }; jobs: unknown[] };
    expect(detail.automation.enabled).toBe(false);
    // No key material is ever returned.
    expect(JSON.stringify(detail)).not.toMatch(/rawTx|PRIVATE_KEY|keeperPrivateKey/i);
  });
});

// ---- helpers --------------------------------------------------------------

function row(
  id: string,
  jobId: string,
  nonce: number,
  gas: string,
  maxFee: string,
  status: 'signed' | 'sent' | 'mined' | 'reverted',
  gasUsed: string | null,
  price: string | null,
) {
  return {
    id,
    jobId,
    vaultId: VAULT,
    chainId: CHAIN,
    // A different signer so pre-seeded rows don't trip the global nonce guard;
    // accounting still counts them for the daily budget.
    signer: '0x00000000000000000000000000000000000000ff',
    nonce,
    gas,
    maxFeePerGas: maxFee,
    maxPriorityFeePerGas: '1',
    rawTx: status === 'signed' || status === 'sent' ? ('0xdead' as Hex) : null,
    txHash: '0x' + nonce.toString(16).padStart(64, '0'),
    status,
    blockNumber: gasUsed ? '1' : null,
    gasUsed,
    effectiveGasPrice: price,
    error: null,
  };
}
