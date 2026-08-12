import { decodeEventLog, type Address, type Hex } from 'viem';
import { sproutFactoryAbi, sproutVaultAbi } from '@sprout/shared';
import type { SproutDb } from './db';
import type { ChainContext } from './chain';
import { getVaultState, readHoldings } from './chain';
import { keeperBudget } from './config';
import {
  getCursor,
  getGift,
  insertChainEvent,
  insertGiftPayment,
  insertSnapshot,
  listJobsByVault,
  listResyncableJobs,
  setCursor,
  setJobNextRun,
  setJobStatus,
  setMilestoneStatus,
  upsertJob,
  upsertMilestone,
  upsertSprout,
} from './repo';

function jsonable(value: unknown): unknown {
  if (typeof value === 'bigint') return value.toString();
  if (Array.isArray(value)) return value.map(jsonable);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, jsonable(v)]));
  }
  return value;
}

export interface ReconcileResult {
  fromBlock: number;
  toBlock: number;
  sproutsIndexed: number;
  eventsSeen: number;
  eventsNew: number;
}

export interface ReconcileOptions {
  fromBlock?: number;
  toBlock?: number;
}

interface EventContext {
  chainId: number;
  vaultId: string;
  eventName: string;
  args: Record<string, unknown>;
  txHash: Hex;
  logIndex: number;
  blockNumber: number;
}

/**
 * Pull logs for the factory and every known vault, persist unique
 * (chainId, txHash, logIndex) events and derive sprout/job/milestone state.
 *
 * Re-running the same range is idempotent. Each event insert and its derived
 * state change commit in one transaction, and the cursor only advances after
 * the whole pass succeeds, so a failure is retried rather than skipped.
 */
export async function reconcile(
  ctx: ChainContext,
  db: SproutDb,
  options: ReconcileOptions = {},
): Promise<ReconcileResult> {
  if (!ctx.publicClient) throw new Error('RPC is not configured');
  const chainId = ctx.config.chain.chainId;
  const startBlock = ctx.config.startBlock ?? 0;
  // Never scan from genesis on a public chain: a positive, validated deployment
  // start block is required there. Local Anvil keeps 0 for convenience.
  if (chainId !== 31337 && startBlock <= 0) {
    throw new Error('SPROUT_START_BLOCK must be a positive deployment block for a public chain');
  }
  const cursor = getCursor(db, chainId);
  const latest = Number(await ctx.publicClient.getBlockNumber());
  // Never scan from genesis by default: honor a configured deployment start block.
  const fromBlock = options.fromBlock !== undefined ? Number(options.fromBlock) : Math.max(cursor + 1, startBlock);
  const toBlock = options.toBlock !== undefined ? Math.min(Number(options.toBlock), latest) : latest;

  const result: ReconcileResult = { fromBlock, toBlock, sproutsIndexed: 0, eventsSeen: 0, eventsNew: 0 };
  if (fromBlock > toBlock) return result;

  // Bounded, resumable chunks: each chunk commits its cursor, so a rate-limit or
  // transport error on a later chunk is retried rather than losing earlier events.
  const maxRange = Math.max(1, ctx.config.maxLogRange ?? 2000);
  for (let start = fromBlock; start <= toBlock; start += maxRange) {
    const end = Math.min(start + maxRange - 1, toBlock);
    await processRange(ctx, db, chainId, start, end, result);
    setCursor(db, chainId, end);
  }

  await resyncJobs(ctx, db);
  return result;
}

async function processRange(
  ctx: ChainContext,
  db: SproutDb,
  chainId: number,
  fromBlock: number,
  toBlock: number,
  result: ReconcileResult,
): Promise<void> {
  // 1. Factory-created sprouts (also discovers vaults not yet in the DB). A
  //    failed discovery aborts the chunk so the cursor does not move past it.
  const factory = ctx.config.chain.contracts.factory;
  if (factory) {
    const logs = await ctx.publicClient!.getLogs({ address: factory, fromBlock: BigInt(fromBlock), toBlock: BigInt(toBlock) });
    for (const log of logs) {
      let decoded;
      try {
        decoded = decodeEventLog({ abi: sproutFactoryAbi, data: log.data, topics: log.topics });
      } catch {
        continue;
      }
      if (decoded.eventName !== 'SproutCreated') continue;
      const args = decoded.args as unknown as { vault: Address; parent: Address };
      if (!vaultExists(db, args.vault)) {
        // Throws (and therefore aborts without advancing) if discovery fails.
        const state = await getVaultState(ctx, args.vault);
        upsertSprout(db, {
          id: state.vault,
          chainId,
          parent: state.parent,
          beneficiary: state.beneficiary,
          settlementToken: state.settlementToken,
          graduationTimestamp: state.graduationTimestamp,
          assets: state.assets,
          weights: state.weights,
          createdTxHash: log.transactionHash,
          createdBlock: Number(log.blockNumber),
        });
        result.sproutsIndexed += 1;
      }
      if (
        insertChainEvent(db, {
          chainId,
          txHash: log.transactionHash,
          logIndex: log.logIndex,
          blockNumber: Number(log.blockNumber),
          address: log.address,
          eventName: decoded.eventName,
          vaultId: args.vault,
          payload: jsonable(decoded.args),
        })
      ) {
        result.eventsNew += 1;
      }
      result.eventsSeen += 1;
    }
  }

  // 2. Vault events for every known sprout, applied in chain order.
  const vaults = listAllVaults(db, chainId);
  if (vaults.length > 0) {
    const logs = await ctx.publicClient!.getLogs({
      address: vaults as Address[],
      fromBlock: BigInt(fromBlock),
      toBlock: BigInt(toBlock),
    });
    for (const log of logs) {
      let decoded;
      try {
        decoded = decodeEventLog({ abi: sproutVaultAbi, data: log.data, topics: log.topics });
      } catch {
        continue;
      }
      result.eventsSeen += 1;
      const args = (decoded.args ?? {}) as Record<string, unknown>;
      const eventCtx: EventContext = {
        chainId,
        vaultId: log.address,
        eventName: decoded.eventName,
        args,
        txHash: log.transactionHash,
        logIndex: log.logIndex,
        blockNumber: Number(log.blockNumber),
      };

      const commit = db.transaction(() => {
        const inserted = insertChainEvent(db, {
          chainId,
          txHash: eventCtx.txHash,
          logIndex: eventCtx.logIndex,
          blockNumber: eventCtx.blockNumber,
          address: log.address,
          eventName: eventCtx.eventName,
          vaultId: eventCtx.vaultId,
          payload: jsonable(args),
        });
        if (inserted) {
          applyDerived(db, eventCtx);
        } else if (eventCtx.eventName === 'GiftReceived') {
          // Gift attribution is idempotent, so retry it on replay to recover a
          // confirmed gift whose link was created after the payment event.
          attributeGiftPayment(db, eventCtx);
        }
        return inserted;
      });
      if (commit()) result.eventsNew += 1;
    }
  }
}

function vaultExists(db: SproutDb, vault: string): boolean {
  const row = db.prepare('SELECT 1 AS present FROM sprouts WHERE lower(id) = lower(?)').get(vault) as { present: number } | null;
  return row !== null;
}

function applyDerived(db: SproutDb, e: EventContext): void {
  switch (e.eventName) {
    case 'MilestoneCreated': {
      upsertMilestone(db, {
        id: String(e.args.id),
        vaultId: e.vaultId,
        chainId: e.chainId,
        token: String(e.args.token),
        amount: String(e.args.amount),
        unlockTime: Number(e.args.unlockTime ?? 0),
        status: 'created',
        descriptionHash: null,
        createdTxHash: e.txHash,
        releasedTxHash: null,
      });
      break;
    }
    case 'MilestoneReleased': {
      // Only status is touched; creation and unlock fields are preserved.
      setMilestoneStatus(
        db,
        { chainId: e.chainId, vaultId: e.vaultId, id: String(e.args.id) },
        'released',
        e.txHash,
      );
      break;
    }
    case 'MilestoneCancelled': {
      setMilestoneStatus(db, { chainId: e.chainId, vaultId: e.vaultId, id: String(e.args.id) }, 'cancelled');
      break;
    }
    case 'InvestmentScheduled': {
      const existing = listJobsByVault(db, e.vaultId).find((j) => j.kind === 'scheduled_investment');
      upsertJob(db, {
        id: existing?.id ?? `${e.vaultId.toLowerCase()}:investment`,
        vaultId: e.vaultId,
        chainId: e.chainId,
        kind: 'scheduled_investment',
        amount: String(e.args.amount),
        periodSeconds: Number(e.args.period),
        nextRunAt: Number(e.args.nextExecution),
        lastRunAt: existing?.lastRunAt ?? null,
        lastTxHash: e.txHash,
        status: 'active',
        attempts: existing?.attempts ?? 0,
        consecutiveFailures: existing?.consecutiveFailures ?? 0,
        lastError: null,
      });
      break;
    }
    case 'InvestmentCancelled': {
      const job = listJobsByVault(db, e.vaultId).find((j) => j.kind === 'scheduled_investment');
      if (job) setJobStatus(db, job.id, 'cancelled');
      break;
    }
    case 'GiftReceived': {
      attributeGiftPayment(db, e);
      break;
    }
    default:
      break;
  }
}

/**
 * Attribute a GiftReceived event to a stored gift link. Derived entirely from
 * the event and the stored link; ignores any client callback. Idempotent via the
 * (chainId, txHash, logIndex) unique key.
 */
function attributeGiftPayment(db: SproutDb, e: EventContext): void {
  const giftId = String(e.args.giftRef);
  const gift = getGift(db, giftId);
  if (!gift) return;
  if (gift.vaultId.toLowerCase() !== e.vaultId.toLowerCase()) return;
  const token = String(e.args.token);
  if (!gift.acceptedAssets.some((a) => a.toLowerCase() === token.toLowerCase())) return;
  insertGiftPayment(db, {
    giftId: gift.id,
    vaultId: e.vaultId,
    chainId: e.chainId,
    txHash: e.txHash,
    logIndex: e.logIndex,
    gifter: String(e.args.gifter),
    token,
    amount: String(e.args.amount),
    blockNumber: e.blockNumber,
  });
}

/**
 * Re-read the chain schedule. A schedule is never erased: an inactive on-chain
 * schedule is cancelled; an active schedule whose automation is unavailable
 * (no keeper key or no approved gas budget) is marked `unavailable`, and is
 * re-enabled when a keeper + budget are configured. Jobs paused due to repeated
 * failures are left paused.
 */
export async function resyncJobs(ctx: ChainContext, db: SproutDb): Promise<void> {
  if (!ctx.publicClient) return;
  const automationEnabled = Boolean(ctx.walletClient) && Boolean(keeperBudget(ctx.config));
  const jobs = listResyncableJobs(db);
  for (const job of jobs) {
    try {
      const schedule = (await ctx.publicClient.readContract({
        address: job.vaultId as Address,
        abi: sproutVaultAbi,
        functionName: 'schedule',
      })) as readonly [boolean, bigint, bigint, bigint, bigint];
      if (!schedule[0]) {
        setJobStatus(db, job.id, 'cancelled');
        continue;
      }
      if (Number(schedule[3]) !== job.nextRunAt) setJobNextRun(db, job.id, Number(schedule[3]));
      if (!automationEnabled) setJobStatus(db, job.id, 'unavailable');
      else if (job.status === 'unavailable') setJobStatus(db, job.id, 'active');
    } catch {
      // leave the job untouched on transient read failure
    }
  }
}

export function listAllVaults(db: SproutDb, chainId: number): string[] {
  const rows = db.prepare('SELECT id FROM sprouts WHERE chain_id = ?').all(chainId) as Array<{ id: string }>;
  return rows.map((r) => r.id);
}

/** Compute and persist a holdings growth snapshot for every known sprout. */
export async function snapshotAll(ctx: ChainContext, db: SproutDb): Promise<number> {
  if (!ctx.publicClient) return 0;
  const chainId = ctx.config.chain.chainId;
  const rows = db.prepare('SELECT id FROM sprouts WHERE chain_id = ?').all(chainId) as Array<{ id: string }>;
  let count = 0;
  for (const { id } of rows) {
    try {
      const holdings = await readHoldings(ctx, id as Address);
      // Never persist a "complete" snapshot when a nonzero holding lacks a price.
      if (!holdings.available || holdings.totalValueUsd === null) continue;
      insertSnapshot(db, {
        vaultId: id,
        chainId,
        takenAt: Math.floor(Date.now() / 1000),
        blockNumber: holdings.blockNumber,
        valueUsd: holdings.totalValueUsd,
        feedDecimals: holdings.feedDecimals,
        holdings: holdings.holdings,
        source: 'chain',
        note: holdings.settlementAssumption,
      });
      count += 1;
    } catch {
      // unavailable history is better than a fabricated point
    }
  }
  return count;
}
