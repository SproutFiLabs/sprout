import { keccak256, type Hex } from 'viem';
import type { SproutDb } from './db';
import type { ChainContext } from './chain';
import {
  getInFlightKeeperTx,
  getInFlightKeeperTxForAccount,
  insertKeeperTx,
  keeperAccounting,
  listInFlightKeeperTxs,
  markKeeperTx,
  setJobStatus,
  type KeeperTxRecord,
} from './repo';
import type { KeeperBudgetConfig } from './config';
import { createMutex } from './lock';

/**
 * Keeper execution core. Bounded to a daily native-gas budget, durable signed-tx
 * identity persisted BEFORE broadcast, and same-hash reconciliation. Injectable
 * (chain/signer ports) for key-less tests. Raw signed bytes live only in the DB.
 *
 * Nonce safety: signing is blocked while ANY in-flight tx for the same
 * chain+signer is unresolved (even from another job); we never allocate a second
 * nonce while one is uncertain.
 */

export interface KeeperReceipt {
  status: 'success' | 'reverted';
  blockNumber: bigint;
  gasUsed: bigint;
  effectiveGasPrice?: bigint;
}

export interface KeeperChain {
  chainId(): Promise<number>;
  nonce(address: string): Promise<number>;
  balance(address: string): Promise<bigint>;
  estimateGas(data: Hex, from: string, to: string): Promise<bigint>;
  feePerGas(): Promise<{ maxFeePerGas: bigint; maxPriorityFeePerGas: bigint }>;
  sendRawTransaction(raw: Hex): Promise<Hex>;
  receipt(hash: Hex): Promise<KeeperReceipt | null>;
}

export interface UnsignedKeeperTx {
  to: string;
  data: Hex;
  nonce: number;
  gas: bigint;
  maxFeePerGas: bigint;
  maxPriorityFeePerGas: bigint;
  chainId: number;
  value: 0n;
  type: 'eip1559';
}

export interface KeeperSigner {
  address: string;
  signTransaction(tx: UnsignedKeeperTx): Promise<Hex>;
}

export type KeeperOutcome =
  | 'executed'
  | 'pending'
  | 'reverted'
  | 'unknown-fee'
  | 'deferred'
  | 'already-in-flight'
  | 'gas-cap-exceeded'
  | 'fee-cap-exceeded'
  | 'budget-exceeded'
  | 'balance-insufficient'
  | 'error';

export interface KeeperRunResult {
  outcome: KeeperOutcome;
  txHash?: Hex;
  error?: string;
  feeWei?: bigint;
}

export interface KeeperJobInput {
  jobId: string;
  vaultId: string;
  chainId: number;
  data: Hex;
  nowSeconds: number;
  sinceMs: number;
  budget: KeeperBudgetConfig;
  maxReceiptAttempts?: number;
  delayMs?: number;
  sleep?: (ms: number) => Promise<void>;
}

const keeperLock = createMutex();
export function withKeeperLock<T>(fn: () => Promise<T>): Promise<T> {
  return keeperLock(fn);
}

async function waitForReceipt(
  chain: KeeperChain,
  hash: Hex,
  attempts: number,
  delayMs: number,
  sleep: (ms: number) => Promise<void>,
): Promise<KeeperReceipt | null> {
  for (let i = 0; i < attempts; i++) {
    const r = await chain.receipt(hash);
    if (r) return r;
    if (i < attempts - 1) await sleep(delayMs);
  }
  return null;
}

type ReconcileOutcome = 'executed' | 'reverted' | 'pending' | 'unknown-fee' | 'error';

/**
 * Finalize a receipt. Missing effectiveGasPrice is NOT treated as a zero-fee
 * revert: the tx is marked `unknown_fee` so its worst-case reservation stays
 * held (conservative) and it is never retried.
 */
function finalizeReceipt(db: SproutDb, tx: KeeperTxRecord, receipt: KeeperReceipt): ReconcileOutcome {
  if (!receipt.effectiveGasPrice) {
    markKeeperTx(db, tx.id, 'unknown_fee', {
      blockNumber: receipt.blockNumber.toString(),
      gasUsed: receipt.gasUsed.toString(),
      error: `receipt missing effectiveGasPrice (${receipt.status}); reservation held`,
    });
    return 'unknown-fee';
  }
  if (receipt.status !== 'success') {
    markKeeperTx(db, tx.id, 'reverted', {
      blockNumber: receipt.blockNumber.toString(),
      gasUsed: receipt.gasUsed.toString(),
      effectiveGasPrice: receipt.effectiveGasPrice.toString(),
      error: 'transaction reverted',
    });
    return 'reverted';
  }
  markKeeperTx(db, tx.id, 'mined', {
    blockNumber: receipt.blockNumber.toString(),
    gasUsed: receipt.gasUsed.toString(),
    effectiveGasPrice: receipt.effectiveGasPrice.toString(),
    error: null,
  });
  return 'executed';
}

async function reconcileTx(
  chain: KeeperChain,
  db: SproutDb,
  tx: KeeperTxRecord,
  attempts: number,
  delayMs: number,
  sleep: (ms: number) => Promise<void>,
  allowRebroadcast: boolean,
): Promise<ReconcileOutcome> {
  if (!tx.txHash) {
    markKeeperTx(db, tx.id, 'unknown_fee', { error: 'missing tx hash; reservation held' });
    return 'unknown-fee';
  }
  // Verify the live RPC chain matches the tx's chain before any receipt/broadcast.
  let liveChain: number;
  try {
    liveChain = await chain.chainId();
  } catch {
    return 'error';
  }
  if (liveChain !== tx.chainId) {
    markKeeperTx(db, tx.id, tx.status, { error: `rpc chain ${liveChain} != tx chain ${tx.chainId}` });
    return 'error';
  }

  let receipt = await chain.receipt(tx.txHash as Hex);
  // unknown_fee txs are already mined/reverted: receipt-only, never rebroadcast.
  if (!receipt && tx.status !== 'unknown_fee' && tx.rawTx && allowRebroadcast) {
    try {
      await chain.sendRawTransaction(tx.rawTx as Hex);
    } catch (error) {
      markKeeperTx(db, tx.id, 'sent', { error: `broadcast: ${error instanceof Error ? error.message : String(error)}` });
    }
  }
  // Always poll (bounded) after the optional rebroadcast, including when
  // rebroadcast is disabled, so a freshly-sent tx is not reported pending before
  // its receipt can appear.
  if (!receipt) {
    receipt = await waitForReceipt(chain, tx.txHash as Hex, attempts, delayMs, sleep);
  }
  if (!receipt) {
    if (tx.status !== 'unknown_fee') {
      markKeeperTx(db, tx.id, 'sent', { error: 'receipt not found (uncertain; same hash retried)' });
    }
    return tx.status === 'unknown_fee' ? 'unknown-fee' : 'pending';
  }
  return finalizeReceipt(db, tx, receipt);
}

/**
 * Execute one due keeper job. If any in-flight tx exists for this chain+signer
 * it is reconciled first (same hash); if still unresolved, signing is blocked.
 */
export async function runKeeperJob(
  chain: KeeperChain,
  signer: KeeperSigner,
  db: SproutDb,
  input: KeeperJobInput,
): Promise<KeeperRunResult> {
  const attempts = input.maxReceiptAttempts ?? 20;
  const delayMs = input.delayMs ?? 3000;
  const sleep = input.sleep ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)));

  // Never sign for the wrong chain.
  try {
    if ((await chain.chainId()) !== input.chainId) return { outcome: 'error', error: 'rpc chain mismatch' };
  } catch (error) {
    return { outcome: 'error', error: error instanceof Error ? error.message : String(error) };
  }

  const own = getInFlightKeeperTx(db, input.jobId);
  if (own) {
    const outcome = await reconcileTx(chain, db, own, attempts, delayMs, sleep, true);
    if (outcome === 'executed') return { outcome: 'executed', txHash: own.txHash as Hex };
    if (outcome === 'reverted') return { outcome: 'reverted', txHash: own.txHash as Hex };
    if (outcome === 'unknown-fee') return { outcome: 'unknown-fee', txHash: own.txHash as Hex };
    if (outcome === 'error') return { outcome: 'error', txHash: own.txHash as Hex };
    return { outcome: 'already-in-flight', txHash: own.txHash as Hex };
  }

  // Global nonce safety: block new signing while any tx for this signer is in flight.
  const other = getInFlightKeeperTxForAccount(db, input.chainId, signer.address);
  if (other) {
    const outcome = await reconcileTx(chain, db, other, attempts, delayMs, sleep, true);
    if (outcome === 'pending' || outcome === 'unknown-fee') {
      // The other job's tx is still unresolved: defer, do not claim its result.
      return { outcome: 'deferred', txHash: other.txHash as Hex };
    }
    if (outcome === 'error') {
      return { outcome: 'error', error: 'in-flight tx from another job could not be reconciled' };
    }
    // The other tx (executed or reverted) belongs to the OTHER job, never this
    // one. Only continue this job if no in-flight tx remains for the signer.
    const remaining = getInFlightKeeperTxForAccount(db, input.chainId, signer.address);
    if (remaining) return { outcome: 'deferred', txHash: remaining.txHash as Hex };
    // fall through: this job may now safely create its own transaction
  }

  let estimate: bigint;
  try {
    // Estimate against the vault target, not contract-creation.
    estimate = await chain.estimateGas(input.data, signer.address, input.vaultId);
  } catch (error) {
    return { outcome: 'error', error: error instanceof Error ? error.message : String(error) };
  }
  if (estimate > input.budget.gasLimitCap) {
    return { outcome: 'gas-cap-exceeded', error: `estimate ${estimate} exceeds cap ${input.budget.gasLimitCap}` };
  }
  const fees = await chain.feePerGas();
  if (fees.maxFeePerGas > input.budget.maxFeePerGasWei) {
    return { outcome: 'fee-cap-exceeded', error: `maxFeePerGas ${fees.maxFeePerGas} exceeds cap ${input.budget.maxFeePerGasWei}` };
  }
  if (fees.maxPriorityFeePerGas > input.budget.maxPriorityFeePerGasWei) {
    return {
      outcome: 'fee-cap-exceeded',
      error: `maxPriorityFeePerGas ${fees.maxPriorityFeePerGas} exceeds cap ${input.budget.maxPriorityFeePerGasWei}`,
    };
  }
  const gas = estimate;
  const maxFeePerGas = fees.maxFeePerGas;
  const maxPriorityFeePerGas = fees.maxPriorityFeePerGas > maxFeePerGas ? maxFeePerGas : fees.maxPriorityFeePerGas;
  const worstCase = gas * maxFeePerGas;

  const accounting = keeperAccounting(db, input.chainId, input.sinceMs);
  if (accounting.spentWei + accounting.pendingWei + worstCase > input.budget.dailyFeeBudgetWei) {
    return {
      outcome: 'budget-exceeded',
      error: `spent ${accounting.spentWei} + pending ${accounting.pendingWei} + worst-case ${worstCase} exceeds daily budget ${input.budget.dailyFeeBudgetWei}`,
    };
  }
  const balance = await chain.balance(signer.address);
  if (balance < accounting.pendingWei + worstCase) {
    return { outcome: 'balance-insufficient', error: `balance ${balance} below reserved ${accounting.pendingWei + worstCase}` };
  }

  const nonce = await chain.nonce(signer.address);
  const raw = await signer.signTransaction({
    to: input.vaultId,
    data: input.data,
    nonce,
    gas,
    maxFeePerGas,
    maxPriorityFeePerGas,
    chainId: input.chainId,
    value: 0n,
    type: 'eip1559',
  });
  const txHash = keccak256(raw);
  const id = `${input.jobId}:${nonce}`;
  insertKeeperTx(db, {
    id,
    jobId: input.jobId,
    vaultId: input.vaultId,
    chainId: input.chainId,
    signer: signer.address,
    nonce,
    gas: gas.toString(),
    maxFeePerGas: maxFeePerGas.toString(),
    maxPriorityFeePerGas: maxPriorityFeePerGas.toString(),
    rawTx: raw,
    txHash,
    status: 'signed',
    blockNumber: null,
    gasUsed: null,
    effectiveGasPrice: null,
    error: null,
  });

  try {
    await chain.sendRawTransaction(raw);
    markKeeperTx(db, id, 'sent', {});
  } catch (error) {
    markKeeperTx(db, id, 'signed', { error: `broadcast: ${error instanceof Error ? error.message : String(error)}` });
  }

  const tx = getInFlightKeeperTx(db, input.jobId)!;
  const outcome = await reconcileTx(chain, db, tx, attempts, delayMs, sleep, false);
  if (outcome === 'executed') return { outcome: 'executed', txHash };
  if (outcome === 'reverted') return { outcome: 'reverted', txHash };
  if (outcome === 'unknown-fee') return { outcome: 'unknown-fee', txHash };
  if (outcome === 'error') return { outcome: 'error', txHash };
  return { outcome: 'pending', txHash };
}

/**
 * Reconcile in-flight keeper txs. When automation is disabled
 * (`allowRebroadcast: false`) this is receipt-only: persisted signed bytes are
 * never newly broadcast without a currently-enabled keeper + budget policy.
 */
export async function recoverKeeperTransactions(
  chain: KeeperChain,
  db: SproutDb,
  opts: { allowRebroadcast: boolean; maxReceiptAttempts?: number; delayMs?: number; sleep?: (ms: number) => Promise<void> },
): Promise<number> {
  const attempts = opts.maxReceiptAttempts ?? 3;
  const delayMs = opts.delayMs ?? 0;
  const sleep = opts.sleep ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)));
  let finalized = 0;
  for (const tx of listInFlightKeeperTxs(db)) {
    const outcome = await reconcileTx(chain, db, tx, attempts, delayMs, sleep, opts.allowRebroadcast);
    if (outcome === 'executed' || outcome === 'reverted') finalized += 1;
    if (outcome === 'reverted') setJobStatus(db, tx.jobId, 'paused');
  }
  return finalized;
}

// ---- real adapters over ChainContext -------------------------------------

export function keeperChain(ctx: ChainContext): KeeperChain {
  if (!ctx.publicClient) throw new Error('RPC is not configured');
  const client = ctx.publicClient;
  return {
    chainId: () => client.getChainId(),
    nonce: (address) => client.getTransactionCount({ address: address as `0x${string}`, blockTag: 'pending' }),
    balance: (address) => client.getBalance({ address: address as `0x${string}` }),
    estimateGas: (data, from, to) => client.estimateGas({ data, account: from as `0x${string}`, to: to as `0x${string}` } as never),
    feePerGas: async () => {
      const f = await client.estimateFeesPerGas();
      return { maxFeePerGas: (f.maxFeePerGas ?? f.gasPrice ?? 0n) as bigint, maxPriorityFeePerGas: (f.maxPriorityFeePerGas ?? 0n) as bigint };
    },
    sendRawTransaction: (raw) => client.sendRawTransaction({ serializedTransaction: raw }),
    receipt: async (hash) => {
      try {
        const r = await client.getTransactionReceipt({ hash });
        return { status: r.status, blockNumber: r.blockNumber, gasUsed: r.gasUsed, effectiveGasPrice: r.effectiveGasPrice ?? undefined };
      } catch {
        return null;
      }
    },
  };
}

export function keeperSigner(ctx: ChainContext): KeeperSigner | null {
  const account = ctx.walletClient?.account;
  if (!account || typeof account === 'string') return null;
  if (!('signTransaction' in account) || typeof account.signTransaction !== 'function') return null;
  return {
    address: account.address,
    signTransaction: (tx) => account.signTransaction({ ...tx } as never),
  };
}
