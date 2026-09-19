import { encodeFunctionData, type Address, type Hex } from 'viem';
import { sproutVaultAbi, sproutVenueAbi } from '@sprout/shared';
import type { SproutDb } from './db';
import type { ChainContext } from './chain';
import { ChainConfigError, invalidateChainReads } from './chain';
import { keeperBudget, type KeeperBudgetConfig } from './config';
import { resolveVaultVenue } from './deployments';
import { dueJobs, recordJobRun, setJobStatus, getJob, type JobRecord } from './repo';
import {
  keeperChain,
  keeperSigner,
  recoverKeeperTransactions,
  runKeeperJob,
  withKeeperLock,
} from './keeper';

export interface JobRunResult {
  jobId: string;
  vaultId: string;
  status: 'executed' | 'skipped' | 'pending' | 'paused' | 'error';
  txHash?: Hex;
  error?: string;
}

export async function chainNowSeconds(ctx: ChainContext): Promise<number> {
  if (!ctx.publicClient) return Math.floor(Date.now() / 1000);
  try {
    const block = await ctx.publicClient.getBlock({ blockTag: 'latest' });
    return Number(block.timestamp);
  } catch {
    return Math.floor(Date.now() / 1000);
  }
}

/**
 * Oracle-floor minimums for a purchase of `spend` through `venue`, which must
 * be the vault's own venue (see resolveVaultVenue); resolved when omitted.
 */
export async function computeMinOuts(ctx: ChainContext, vault: Address, spend: bigint, venueOverride?: Address): Promise<bigint[]> {
  if (!ctx.publicClient) throw new ChainConfigError('RPC is not configured');
  const venue = venueOverride ?? (await resolveVaultVenue(ctx, vault)).venue;
  const [assets, weights, schedule] = await Promise.all([
    ctx.publicClient.readContract({ address: vault, abi: sproutVaultAbi, functionName: 'assets' }) as Promise<readonly Address[]>,
    ctx.publicClient.readContract({ address: vault, abi: sproutVaultAbi, functionName: 'weights' }) as Promise<readonly number[]>,
    ctx.publicClient.readContract({ address: vault, abi: sproutVaultAbi, functionName: 'schedule' }) as Promise<
      readonly [boolean, bigint, bigint, bigint, bigint]
    >,
  ]);
  const settlement = (await ctx.publicClient.readContract({
    address: vault,
    abi: sproutVaultAbi,
    functionName: 'settlementToken',
  })) as Address;
  const maxSlippage = BigInt(schedule[4]);
  const mins: bigint[] = [];
  for (let i = 0; i < assets.length; i++) {
    const amountIn = (spend * BigInt(weights[i] ?? 0)) / 10_000n;
    if (amountIn === 0n) {
      mins.push(0n);
      continue;
    }
    const expected = (await ctx.publicClient.readContract({
      address: venue,
      abi: sproutVenueAbi,
      functionName: 'quote',
      args: [settlement, assets[i]!, amountIn],
    })) as bigint;
    mins.push((expected * (10_000n - maxSlippage)) / 10_000n);
  }
  return mins;
}

export interface RunDueJobsOptions {
  nowSeconds?: number;
  sinceMs?: number;
}

const AUTOMATION_DISABLED = 'automation disabled: keeper key or gas budget not configured';

/**
 * Execute due investments. Reconciles any in-flight signed tx first (same hash,
 * no new nonce). When no keeper/budget is configured, active jobs are marked
 * `paused` (scheduled but unavailable) rather than erased; resync re-enables them
 * when a keeper and budget are configured.
 */
export async function runDueJobs(ctx: ChainContext, db: SproutDb, options: RunDueJobsOptions = {}): Promise<JobRunResult[]> {
  const nowSeconds = options.nowSeconds ?? (await chainNowSeconds(ctx));
  const sinceMs = options.sinceMs ?? Date.now() - 24 * 60 * 60 * 1000;
  const results: JobRunResult[] = [];

  const signer = keeperSigner(ctx);
  const budget = keeperBudget(ctx.config);
  const enabled = Boolean(signer && budget);

  // Reconcile in-flight transactions. When automation is disabled this is
  // receipt-only: persisted signed bytes are not newly broadcast.
  if (ctx.publicClient) {
    try {
      await withKeeperLock(() =>
        recoverKeeperTransactions(keeperChain(ctx), db, { allowRebroadcast: enabled, maxReceiptAttempts: 1, delayMs: 0 }),
      );
    } catch {
      // recovery is best-effort; run continues
    }
  }

  const due = dueJobs(db, nowSeconds);

  if (!signer || !budget) {
    for (const job of due) {
      setJobStatus(db, job.id, 'unavailable');
      recordJobRun(db, job.id, { nextRunAt: job.nextRunAt, error: AUTOMATION_DISABLED });
      results.push({ jobId: job.id, vaultId: job.vaultId, status: 'paused', error: AUTOMATION_DISABLED });
    }
    return results;
  }

  const chain = keeperChain(ctx);
  for (const job of due) {
    results.push(await runJob(ctx, db, job, nowSeconds, sinceMs, budget));
  }
  return results;
}

async function runJob(
  ctx: ChainContext,
  db: SproutDb,
  job: JobRecord,
  nowSeconds: number,
  sinceMs: number,
  budget: KeeperBudgetConfig,
): Promise<JobRunResult> {
  const chain = keeperChain(ctx);
  try {
    const schedule = (await ctx.publicClient!.readContract({
      address: job.vaultId as Address,
      abi: sproutVaultAbi,
      functionName: 'schedule',
    })) as readonly [boolean, bigint, bigint, bigint, bigint];
    if (!schedule[0]) {
      setJobStatus(db, job.id, 'cancelled');
      return { jobId: job.id, vaultId: job.vaultId, status: 'skipped', error: 'schedule inactive' };
    }
    if (BigInt(nowSeconds) < schedule[3]) {
      return { jobId: job.id, vaultId: job.vaultId, status: 'skipped', error: 'not due' };
    }
    // The vault's own factory decides the venue: a legacy sprout can only buy
    // through the legacy venue. An unknown factory throws, and the job fails closed.
    const { venue } = await resolveVaultVenue(ctx, job.vaultId as Address);
    const mins = await computeMinOuts(ctx, job.vaultId as Address, schedule[1], venue);
    const data = encodeFunctionData({ abi: sproutVaultAbi, functionName: 'executeInvestment', args: [venue, mins] });
    const signer = keeperSigner(ctx)!;

    const result = await withKeeperLock(() =>
      runKeeperJob(chain, signer, db, {
        jobId: job.id,
        vaultId: job.vaultId,
        chainId: ctx.config.chain.chainId,
        data,
        nowSeconds,
        sinceMs,
        budget,
      }),
    );

    if (result.outcome === 'executed') {
      invalidateChainReads(ctx, `holdings:${job.vaultId.toLowerCase()}`);
      const after = (await ctx.publicClient!.readContract({
        address: job.vaultId as Address,
        abi: sproutVaultAbi,
        functionName: 'schedule',
      })) as readonly [boolean, bigint, bigint, bigint, bigint];
      let nextRunAt = Number(after[3]);
      if (nextRunAt <= nowSeconds) nextRunAt = nowSeconds + Number(after[2]);
      recordJobRun(db, job.id, { nextRunAt, txHash: result.txHash });
      return { jobId: job.id, vaultId: job.vaultId, status: 'executed', txHash: result.txHash };
    }
    if (
      result.outcome === 'already-in-flight' ||
      result.outcome === 'pending' ||
      result.outcome === 'unknown-fee' ||
      result.outcome === 'deferred'
    ) {
      // Uncertain / deferred / unknown-fee: never report another job's result as
      // this job's execution, and never advance this job's nextRunAt. Keep the
      // schedule and the reservation; the correct job resyncs on its own.
      return { jobId: job.id, vaultId: job.vaultId, status: 'pending' };
    }

    // Policy failures, reverts and errors: record and apply the pause streak.
    const message = result.error ?? result.outcome;
    const failures = job.consecutiveFailures + 1;
    if (failures >= 3) {
      setJobStatus(db, job.id, 'paused');
      recordJobRun(db, job.id, { nextRunAt: job.nextRunAt, error: message });
    } else {
      recordJobRun(db, job.id, { nextRunAt: nowSeconds + 60, error: message });
    }
    return { jobId: job.id, vaultId: job.vaultId, status: 'error', txHash: result.txHash, error: message };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const failures = job.consecutiveFailures + 1;
    if (failures >= 3) {
      setJobStatus(db, job.id, 'paused');
      recordJobRun(db, job.id, { nextRunAt: job.nextRunAt, error: message });
    } else {
      recordJobRun(db, job.id, { nextRunAt: nowSeconds + 60, error: message });
    }
    return { jobId: job.id, vaultId: job.vaultId, status: 'error', error: message };
  }
}

export function automationCapability(ctx: ChainContext): { keeperConfigured: boolean; gasBudgetConfigured: boolean; enabled: boolean } {
  const keeperConfigured = Boolean(ctx.walletClient);
  const gasBudgetConfigured = Boolean(keeperBudget(ctx.config));
  return { keeperConfigured, gasBudgetConfigured, enabled: keeperConfigured && gasBudgetConfigured };
}

export function jobById(db: SproutDb, id: string): JobRecord | null {
  return getJob(db, id);
}
