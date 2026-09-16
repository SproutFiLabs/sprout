import { decodeEventLog, type Address, type Hex } from 'viem';
import { sproutFactoryAbi, sproutVaultAbi } from '@sprout/shared';
import type { SproutDb } from './db';
import type { ChainClock, ChainContext } from './chain';
import { chainCache, getVaultState, invalidateChainReads, primeHoldings, readHoldings } from './chain';
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
  /** Vaults that emitted at least one newly indexed event in this pass. */
  vaultsTouched: string[];
}

/** Smallest log range tried before a pass gives up (Alchemy's free tier allows 10 blocks). */
const MIN_LOG_RANGE = 10;
/** Successful chunks in a row before the log range is doubled again. */
const GROW_AFTER = 8;
/** The log range that last worked, per chain context. */
const logRanges = new WeakMap<ChainContext, { span: number; streak: number }>();

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
  // A newer head than the shared clock means the clock (graduation, feed
  // staleness) is behind; drop it rather than wait out its TTL.
  const clock = chainCache(ctx).peek<ChainClock>('block');
  if (clock && clock.number < latest) invalidateChainReads(ctx, 'block');
  // Never scan from genesis by default: honor a configured deployment start block.
  const fromBlock = options.fromBlock !== undefined ? Number(options.fromBlock) : Math.max(cursor + 1, startBlock);
  const toBlock = options.toBlock !== undefined ? Math.min(Number(options.toBlock), latest) : latest;

  const result: ReconcileResult = { fromBlock, toBlock, sproutsIndexed: 0, eventsSeen: 0, eventsNew: 0, vaultsTouched: [] };
  if (fromBlock > toBlock) return result;

  // Bounded, resumable chunks: each chunk commits its cursor, so a rate-limit or
  // transport error on a later chunk is retried rather than losing earlier events.
  //
  // The free RPC tiers refuse log queries for different reasons: a block-count
  // cap (Alchemy: 10, drpc: about 100), a slow-query timeout on older blocks, or
  // a rate limit. No single range suits all of them, and a fixed range that is
  // too wide fails on every pass while the backlog grows. So a refused chunk is
  // retried from the same block with a quarter of the range, down to
  // MIN_LOG_RANGE; the range that works is remembered for the next pass and
  // only grows again after a run of successes.
  const maxRange = Math.max(1, ctx.config.maxLogRange ?? 2000);
  const floor = Math.min(MIN_LOG_RANGE, maxRange);
  const learned = logRanges.get(ctx);
  let span = Math.min(maxRange, learned?.span ?? maxRange);
  let streak = learned?.streak ?? 0;
  let start = fromBlock;
  while (start <= toBlock) {
    const end = Math.min(start + span - 1, toBlock);
    try {
      await processRange(ctx, db, chainId, start, end, result);
    } catch (error) {
      streak = 0;
      if (span <= floor) {
        logRanges.set(ctx, { span, streak });
        throw error;
      }
      span = Math.max(floor, Math.floor(span / 4));
      continue;
    }
    setCursor(db, chainId, end);
    start = end + 1;
    streak += 1;
    if (streak >= GROW_AFTER && span < maxRange) {
      span = Math.min(maxRange, span * 2);
      streak = 0;
    }
  }
  logRanges.set(ctx, { span, streak });

  await resyncJobs(ctx, db);
  if (result.vaultsTouched.length > 0) {
    // New vault events mean new balances: drop what request handlers cached.
    for (const vault of result.vaultsTouched) invalidateChainReads(ctx, `holdings:${vault.toLowerCase()}`);
  }
  return result;
}

function markTouched(result: ReconcileResult, vault: string): void {
  const id = vault.toLowerCase();
  if (!result.vaultsTouched.includes(id)) result.vaultsTouched.push(id);
}

async function processRange(
  ctx: ChainContext,
  db: SproutDb,
  chainId: number,
  fromBlock: number,
  toBlock: number,
  result: ReconcileResult,
): Promise<void> {
  // One query covers the factory and every known vault; a vault the factory
  // creates inside this chunk is queried separately below.
  const factory = ctx.config.chain.contracts.factory;
  const known = listAllVaults(db, chainId);
  const addresses = [...(factory ? [factory] : []), ...known] as Address[];
  if (addresses.length === 0) return;
  const logs = await getLogsFor(ctx, addresses, fromBlock, toBlock);
  const isFactory = (address: string) => !!factory && address.toLowerCase() === factory.toLowerCase();
  const discovered: Address[] = [];

  // 1. Factory-created sprouts (also discovers vaults not yet in the DB). A
  //    failed discovery aborts the chunk so the cursor does not move past it.
  if (factory) {
    for (const log of logs.filter((l) => isFactory(l.address))) {
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
        discovered.push(state.vault);
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
        markTouched(result, args.vault);
      }
      result.eventsSeen += 1;
    }
  }

  // 2. Vault events for every known sprout, applied in chain order.
  const vaultLogs = logs.filter((l) => !isFactory(l.address));
  if (discovered.length > 0) vaultLogs.push(...(await getLogsFor(ctx, discovered, fromBlock, toBlock)));
  vaultLogs.sort((a, b) => Number(a.blockNumber) - Number(b.blockNumber) || a.logIndex - b.logIndex);
  if (vaultLogs.length > 0) {
    for (const log of vaultLogs) {
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
      if (commit()) {
        result.eventsNew += 1;
        markTouched(result, log.address);
      }
    }
  }
}

function getLogsFor(ctx: ChainContext, addresses: Address[], fromBlock: number, toBlock: number) {
  return ctx.publicClient!.getLogs({ address: addresses, fromBlock: BigInt(fromBlock), toBlock: BigInt(toBlock) });
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
  const client = ctx.publicClient;
  const jobs = listResyncableJobs(db);
  // Issued together so a Multicall3-enabled client folds them into one request.
  const schedules = await Promise.all(
    jobs.map((job) =>
      (client.readContract({
        address: job.vaultId as Address,
        abi: sproutVaultAbi,
        functionName: 'schedule',
      }) as Promise<readonly [boolean, bigint, bigint, bigint, bigint]>).catch(() => null),
    ),
  );
  for (const [i, job] of jobs.entries()) {
    try {
      const schedule = schedules[i];
      // leave the job untouched on transient read failure
      if (!schedule) continue;
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

/** How many vaults are read concurrently (and batched together) per snapshot step. */
const SNAPSHOT_CONCURRENCY = 20;

/**
 * Compute and persist a holdings growth snapshot for every known sprout, or
 * only for `vaults` when given. Each fresh read also refreshes the cache that
 * the holdings endpoint serves from.
 */
export async function snapshotAll(ctx: ChainContext, db: SproutDb, vaults?: string[]): Promise<number> {
  if (!ctx.publicClient) return 0;
  const chainId = ctx.config.chain.chainId;
  const ids = vaults ?? listAllVaults(db, chainId);
  let count = 0;
  for (let i = 0; i < ids.length; i += SNAPSHOT_CONCURRENCY) {
    const batch = ids.slice(i, i + SNAPSHOT_CONCURRENCY);
    const results = await Promise.all(
      batch.map((id) => readHoldings(ctx, id as Address).catch(() => null)),
    );
    for (const [j, holdings] of results.entries()) {
      const id = batch[j]!;
      // unavailable history is better than a fabricated point
      if (!holdings) continue;
      primeHoldings(ctx, id, holdings);
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
    }
  }
  return count;
}
