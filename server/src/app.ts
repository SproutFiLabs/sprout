import { randomBytes } from 'node:crypto';
import { join } from 'node:path';
import { Hono, type Context } from 'hono';
import { getAddress, type Address, type Hex } from 'viem';
import { z } from 'zod';
import { addressSchema, hashSchema, sproutVaultAbi } from '@sprout/shared';
import type { SproutDb } from './db';
import type { ChainContext } from './chain';
import {
  ChainConfigError,
  decodeReceiptLogs,
  getBeneficiaryState,
  getSettlementDecimals,
  readHoldings,
  verifySproutCreated,
} from './chain';
import { AuthError, authenticate, issueNonce } from './auth';
import { reconcile, snapshotAll } from './indexer';
import { automationCapability, runDueJobs } from './jobs';
import { localFixtures } from './fixtures';
import {
  LocalWalletError,
  advanceLocalTime,
  assertLoopbackRequest,
  fundLocalAccount,
  handleLocalRpc,
  localWalletStatus,
} from './localWallet';
import { createMutex } from './lock';
import {
  getGift,
  getJob,
  getMilestone,
  getSprout,
  insertGift,
  insertGiftPayment,
  listChainEvents,
  listGiftPayments,
  listGiftsByVault,
  listJobsByVault,
  listMilestonesByVault,
  listSnapshots,
  listSproutsByBeneficiary,
  listSproutsByParent,
  setJobStatus,
  setMilestoneStatus,
  upsertMilestone,
} from './repo';

export interface AppDeps {
  db: SproutDb;
  chain: ChainContext;
  localDemo: boolean;
  adminToken?: string;
  now?: () => number;
  runExclusive?: <T>(fn: () => Promise<T>) => Promise<T>;
  serveWeb?: boolean;
  webDistPath?: string;
}

export class HttpError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

const authHeaderSchema = z.object({
  address: addressSchema,
  nonce: z.string().min(1),
  signature: z.string().regex(/^0x[0-9a-fA-F]+$/),
});

async function requireAuth(c: Context, deps: AppDeps, purpose: string): Promise<string> {
  const parsed = authHeaderSchema.safeParse({
    address: c.req.header('x-sprout-address'),
    nonce: c.req.header('x-sprout-nonce'),
    signature: c.req.header('x-sprout-signature'),
  });
  if (!parsed.success) throw new HttpError(401, 'missing wallet authentication headers');
  return authenticate(deps.db, { ...parsed.data, purpose, now: deps.now?.() });
}

function requireAdmin(c: Context, deps: AppDeps): void {
  if (deps.adminToken) {
    if (c.req.header('x-sprout-admin-token') !== deps.adminToken) throw new HttpError(401, 'invalid admin token');
    return;
  }
  if (!deps.localDemo) throw new HttpError(403, 'admin token is not configured');
}

async function readJson<S extends z.ZodTypeAny>(c: Context, schema: S): Promise<z.infer<S>> {
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    throw new HttpError(400, 'invalid JSON body');
  }
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    throw new HttpError(400, parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '));
  }
  return parsed.data as z.infer<S>;
}

function requireConfigured(deps: AppDeps): void {
  if (!deps.chain.config.chain.configured) {
    throw new ChainConfigError(`Missing configuration: ${deps.chain.config.chain.missing.join(', ')}`);
  }
}

function assertParent(db: SproutDb, vaultId: string, signer: string): void {
  const sprout = getSprout(db, vaultId);
  if (!sprout) throw new HttpError(404, 'sprout not found');
  if (getAddress(sprout.parent) !== getAddress(signer)) throw new HttpError(403, 'wallet is not the parent of this sprout');
}

interface Logger {
  info: (msg: string, meta?: unknown) => void;
  warn: (msg: string, meta?: unknown) => void;
  error: (msg: string, meta?: unknown) => void;
}

export function createApp(inputDeps: AppDeps, logger: Logger = console): Hono {
  // Local demo behavior is hard-disabled in production regardless of the flag.
  const deps: AppDeps = {
    ...inputDeps,
    localDemo: inputDeps.localDemo && process.env.NODE_ENV !== 'production',
  };
  const app = new Hono();
  const serialize = deps.runExclusive ?? createMutex();

  app.onError((err, c) => {
    if (err instanceof AuthError) return c.json({ error: err.message }, 401);
    if (err instanceof HttpError) return c.json({ error: err.message }, err.status as 400);
    if (err instanceof LocalWalletError) return c.json({ error: err.message }, err.status as 400);
    if (err instanceof ChainConfigError) return c.json({ error: err.message }, 503);
    logger.error('unhandled request error', err);
    return c.json({ error: 'internal error' }, 500);
  });

  app.get('/api/health', (c) =>
    c.json({
      ok: true,
      chainId: deps.chain.config.chain.chainId,
      chainName: deps.chain.config.chain.name,
      configured: deps.chain.config.chain.configured,
      missing: deps.chain.config.chain.missing,
      localDemo: deps.localDemo,
      automation: automationCapability(deps.chain),
    }),
  );

  app.get('/api/config', async (c) => {
    const chain = deps.chain.config.chain;
    let settlementDecimals = deps.chain.config.settlementDecimals ?? 6;
    if (chain.configured && deps.chain.publicClient) {
      try {
        settlementDecimals = await getSettlementDecimals(deps.chain);
      } catch {
        // keep fallback
      }
    }
    // Deliberately omit the internal RPC URL (it may carry credentials). Only an
    // explicitly public wallet RPC is exposed.
    const { rpcUrl: _rpcUrl, ...publicChain } = chain;
    return c.json({
      chain: {
        ...publicChain,
        walletRpcUrl: deps.chain.config.publicWalletRpcUrl,
        contracts: {
          ...chain.contracts,
          settlementDecimals,
          stockTokens: chain.contracts.stockTokens.map((t) => ({
            ...t,
            multiplier: t.multiplier.toString(),
          })),
        },
      },
    });
  });

  if (deps.localDemo) {
    app.get('/api/fixtures', (c) => c.json(localFixtures(deps.chain.config.chain.chainId)));
  }

  // ---- auth ---------------------------------------------------------------

  app.post('/api/auth/nonce', async (c) => {
    const body = await readJson(c, z.object({ address: addressSchema, purpose: z.string().min(1).max(60) }));
    return c.json(issueNonce(deps.db, { ...body, now: deps.now?.() }));
  });

  // ---- sprouts ------------------------------------------------------------

  app.get('/api/sprouts', async (c) => {
    const parent = c.req.query('parent');
    const beneficiary = c.req.query('beneficiary');
    if (!parent && !beneficiary) throw new HttpError(400, 'parent or beneficiary query parameter is required');
    const parsed = addressSchema.safeParse(parent ?? beneficiary);
    if (!parsed.success) throw new HttpError(400, 'invalid address');
    const records = parent
      ? listSproutsByParent(deps.db, getAddress(parsed.data))
      : listSproutsByBeneficiary(deps.db, getAddress(parsed.data));

    const chainReady = deps.chain.config.chain.configured && deps.chain.publicClient;
    const sprouts = await Promise.all(
      records.map(async (s) => {
        let graduated: boolean | null = null;
        if (chainReady) {
          graduated = (await deps.chain.publicClient!
            .readContract({ address: s.id as Address, abi: sproutVaultAbi, functionName: 'graduated' })
            .catch(() => null)) as boolean | null;
        }
        if (graduated === null) graduated = (deps.now ? deps.now() : Date.now()) / 1000 >= s.graduationTimestamp;
        return { ...s, graduated, role: parent ? 'parent' : 'beneficiary' };
      }),
    );
    return c.json({ sprouts });
  });

  app.get('/api/sprouts/:id', async (c) => {
    const sprout = getSprout(deps.db, c.req.param('id'));
    if (!sprout) throw new HttpError(404, 'sprout not found');
    let graduated: boolean | null = null;
    if (deps.chain.config.chain.configured && deps.chain.publicClient) {
      graduated = (await deps.chain.publicClient
        .readContract({ address: sprout.id as Address, abi: sproutVaultAbi, functionName: 'graduated' })
        .catch(() => null)) as boolean | null;
    }
    if (graduated === null) graduated = (deps.now ? deps.now() : Date.now()) / 1000 >= sprout.graduationTimestamp;
    return c.json({
      sprout: { ...sprout, graduated },
      automation: automationCapability(deps.chain),
      milestones: listMilestonesByVault(deps.db, sprout.chainId, sprout.id),
      jobs: listJobsByVault(deps.db, sprout.id),
      gifts: listGiftsByVault(deps.db, sprout.id).map((g) => {
        const payments = listGiftPayments(deps.db, g.id);
        const totals: Record<string, string> = {};
        for (const p of payments) {
          totals[p.token] = (BigInt(totals[p.token] ?? '0') + BigInt(p.amount)).toString();
        }
        return {
          id: g.id,
          vaultId: g.vaultId,
          label: g.label,
          status: g.status,
          acceptedAssets: g.acceptedAssets,
          paymentCount: payments.length,
          totals,
        };
      }),
    });
  });

  app.get('/api/sprouts/:id/beneficiary', async (c) => {
    const sprout = getSprout(deps.db, c.req.param('id'));
    if (!sprout) throw new HttpError(404, 'sprout not found');
    if (!deps.chain.config.chain.configured) throw new ChainConfigError('chain is not configured');
    return c.json(await getBeneficiaryState(deps.chain, sprout.id as Address));
  });

  app.post('/api/sprouts', async (c) => {
    const signer = await requireAuth(c, deps, 'plant');
    requireConfigured(deps);
    const body = await readJson(c, z.object({ txHash: hashSchema, nickname: z.string().max(40).optional() }));
    const created = await verifySproutCreated(deps.chain, body.txHash as Hex);
    if (getAddress(created.parent) !== getAddress(signer)) {
      throw new HttpError(403, 'transaction parent does not match authenticated wallet');
    }
    if (!getSprout(deps.db, created.vault)) {
      const state = await getVaultStateCompat(deps.chain, created.vault);
      const { upsertSprout } = await import('./repo');
      upsertSprout(deps.db, {
        id: state.vault,
        chainId: deps.chain.config.chain.chainId,
        parent: state.parent,
        beneficiary: state.beneficiary,
        settlementToken: state.settlementToken,
        graduationTimestamp: state.graduationTimestamp,
        assets: state.assets,
        weights: state.weights,
        createdTxHash: body.txHash,
        createdBlock: null,
      });
    }
    return c.json({ sprout: getSprout(deps.db, created.vault) }, 201);
  });

  app.post('/api/sprouts/:id/schedule', async (c) => {
    const signer = await requireAuth(c, deps, 'schedule');
    const vaultId = c.req.param('id');
    assertParent(deps.db, vaultId, signer);
    requireConfigured(deps);
    const body = await readJson(c, z.object({ txHash: hashSchema }));
    const events = await decodeReceiptLogs(deps.chain.publicClient!, sproutVaultAbi, [vaultId as Address], body.txHash as Hex);
    if (!events.some((e) => e.eventName === 'InvestmentScheduled')) {
      throw new HttpError(400, 'InvestmentScheduled event not found');
    }
    // The current chain state is authoritative: an old schedule receipt must not
    // reactivate a schedule the parent has since cancelled.
    const scheduleState = (await deps.chain.publicClient!.readContract({
      address: vaultId as Address,
      abi: sproutVaultAbi,
      functionName: 'schedule',
    })) as readonly [boolean, bigint, bigint, bigint, bigint];
    if (!scheduleState[0]) throw new HttpError(409, 'chain schedule is not active');
    await serialize(() => reconcile(deps.chain, deps.db, {}));
    return c.json({ jobs: listJobsByVault(deps.db, vaultId) });
  });

  app.post('/api/sprouts/:id/schedule/cancel', async (c) => {
    const signer = await requireAuth(c, deps, 'cancel-schedule');
    const vaultId = c.req.param('id');
    assertParent(deps.db, vaultId, signer);
    requireConfigured(deps);
    const body = await readJson(c, z.object({ txHash: hashSchema }));
    const events = await decodeReceiptLogs(deps.chain.publicClient!, sproutVaultAbi, [vaultId as Address], body.txHash as Hex);
    if (!events.some((e) => e.eventName === 'InvestmentCancelled')) {
      throw new HttpError(400, 'InvestmentCancelled event not found');
    }
    const scheduleState = (await deps.chain.publicClient!.readContract({
      address: vaultId as Address,
      abi: sproutVaultAbi,
      functionName: 'schedule',
    })) as readonly [boolean, bigint, bigint, bigint, bigint];
    if (scheduleState[0]) throw new HttpError(409, 'chain schedule is still active');
    const job = listJobsByVault(deps.db, vaultId)[0];
    if (job) setJobStatus(deps.db, job.id, 'cancelled');
    return c.json({ jobs: listJobsByVault(deps.db, vaultId) });
  });

  // ---- milestones ---------------------------------------------------------

  app.get('/api/sprouts/:id/milestones', (c) => {
    const sprout = getSprout(deps.db, c.req.param('id'));
    if (!sprout) throw new HttpError(404, 'sprout not found');
    return c.json({ milestones: listMilestonesByVault(deps.db, sprout.chainId, sprout.id) });
  });

  app.post('/api/sprouts/:id/milestones', async (c) => {
    const signer = await requireAuth(c, deps, 'milestone-create');
    const vaultId = c.req.param('id');
    assertParent(deps.db, vaultId, signer);
    requireConfigured(deps);
    const body = await readJson(
      c,
      z.object({
        milestoneId: hashSchema,
        txHash: hashSchema,
        descriptionHash: hashSchema.optional(),
      }),
    );
    const chainId = deps.chain.config.chain.chainId;
    const events = await decodeReceiptLogs(deps.chain.publicClient!, sproutVaultAbi, [vaultId as Address], body.txHash as Hex);
    const created = events.find(
      (e) => e.eventName === 'MilestoneCreated' && String(e.args.id).toLowerCase() === body.milestoneId.toLowerCase(),
    );
    if (!created) throw new HttpError(400, 'matching MilestoneCreated event not found');

    // All chain fields come from the exact receipt event, never the client body.
    upsertMilestone(deps.db, {
      id: String(created.args.id),
      vaultId: getAddress(vaultId),
      chainId,
      token: getAddress(String(created.args.token)),
      amount: String(created.args.amount),
      unlockTime: Number(created.args.unlockTime ?? 0),
      status: 'created',
      descriptionHash: body.descriptionHash ?? null,
      createdTxHash: body.txHash,
      releasedTxHash: null,
    });
    return c.json({ milestone: getMilestone(deps.db, chainId, vaultId, String(created.args.id)) }, 201);
  });

  app.post('/api/sprouts/:id/milestones/:milestoneId/release', async (c) => {
    const signer = await requireAuth(c, deps, 'milestone-release');
    const vaultId = c.req.param('id');
    assertParent(deps.db, vaultId, signer);
    requireConfigured(deps);
    const body = await readJson(c, z.object({ txHash: hashSchema }));
    const chainId = deps.chain.config.chain.chainId;
    const milestoneId = c.req.param('milestoneId');
    const existing = getMilestone(deps.db, chainId, vaultId, milestoneId);
    if (!existing) throw new HttpError(404, 'milestone not found for this vault');
    const events = await decodeReceiptLogs(deps.chain.publicClient!, sproutVaultAbi, [vaultId as Address], body.txHash as Hex);
    const released = events.find(
      (e) => e.eventName === 'MilestoneReleased' && String(e.args.id).toLowerCase() === milestoneId.toLowerCase(),
    );
    if (!released) throw new HttpError(400, 'matching MilestoneReleased event not found');
    setMilestoneStatus(deps.db, { chainId, vaultId, id: milestoneId }, 'released', body.txHash);
    return c.json({ milestone: getMilestone(deps.db, chainId, vaultId, milestoneId) });
  });

  app.post('/api/sprouts/:id/milestones/:milestoneId/cancel', async (c) => {
    const signer = await requireAuth(c, deps, 'milestone-cancel');
    const vaultId = c.req.param('id');
    assertParent(deps.db, vaultId, signer);
    requireConfigured(deps);
    const body = await readJson(c, z.object({ txHash: hashSchema }));
    const chainId = deps.chain.config.chain.chainId;
    const milestoneId = c.req.param('milestoneId');
    const existing = getMilestone(deps.db, chainId, vaultId, milestoneId);
    if (!existing) throw new HttpError(404, 'milestone not found for this vault');
    const events = await decodeReceiptLogs(deps.chain.publicClient!, sproutVaultAbi, [vaultId as Address], body.txHash as Hex);
    const cancelled = events.find(
      (e) => e.eventName === 'MilestoneCancelled' && String(e.args.id).toLowerCase() === milestoneId.toLowerCase(),
    );
    if (!cancelled) throw new HttpError(400, 'matching MilestoneCancelled event not found');
    setMilestoneStatus(deps.db, { chainId, vaultId, id: milestoneId }, 'cancelled', body.txHash);
    return c.json({ milestone: getMilestone(deps.db, chainId, vaultId, milestoneId) });
  });

  // ---- gifts --------------------------------------------------------------

  app.post('/api/gifts', async (c) => {
    const signer = await requireAuth(c, deps, 'gift-create');
    const body = await readJson(
      c,
      z.object({
        vaultId: addressSchema,
        label: z.string().min(1).max(60).optional(),
        acceptedAssets: z.array(addressSchema).min(1).max(5),
      }),
    );
    assertParent(deps.db, body.vaultId, signer);
    const id = `0x${randomBytes(32).toString('hex')}` as Hex;
    insertGift(deps.db, {
      id,
      vaultId: getAddress(body.vaultId),
      label: body.label ?? null,
      acceptedAssets: body.acceptedAssets.map(getAddress),
      status: 'open',
    });
    return c.json({ gift: getGift(deps.db, id) }, 201);
  });

  app.get('/api/gifts/:id', (c) => {
    const gift = getGift(deps.db, c.req.param('id'));
    if (!gift) throw new HttpError(404, 'gift not found');
    const payments = listGiftPayments(deps.db, gift.id);
    const totalByToken: Record<string, string> = {};
    for (const p of payments) {
      totalByToken[p.token] = (BigInt(totalByToken[p.token] ?? '0') + BigInt(p.amount)).toString();
    }
    return c.json({
      id: gift.id,
      vaultId: gift.vaultId,
      label: gift.label,
      acceptedAssets: gift.acceptedAssets,
      status: gift.status,
      paymentCount: payments.length,
      totals: totalByToken,
    });
  });

  app.post('/api/gifts/:id/payments', async (c) => {
    const signer = await requireAuth(c, deps, 'gift-pay');
    const gift = getGift(deps.db, c.req.param('id'));
    if (!gift) throw new HttpError(404, 'gift not found');
    requireConfigured(deps);
    const body = await readJson(c, z.object({ txHash: hashSchema }));
    const events = await decodeReceiptLogs(deps.chain.publicClient!, sproutVaultAbi, [gift.vaultId as Address], body.txHash as Hex);
    const payment = events.find(
      (e) => e.eventName === 'GiftReceived' && String(e.args.giftRef).toLowerCase() === gift.id.toLowerCase(),
    );
    if (!payment) throw new HttpError(400, 'GiftReceived event for this gift was not found');
    if (getAddress(String(payment.args.gifter)) !== getAddress(signer)) {
      throw new HttpError(403, 'gifter does not match authenticated wallet');
    }
    const token = getAddress(String(payment.args.token));
    if (!gift.acceptedAssets.some((a) => getAddress(a) === token)) {
      throw new HttpError(400, 'token is not accepted by this gift link');
    }
    // The chain logIndex is authoritative; clients cannot choose it.
    const inserted = insertGiftPayment(deps.db, {
      giftId: gift.id,
      vaultId: gift.vaultId,
      chainId: deps.chain.config.chain.chainId,
      txHash: body.txHash,
      logIndex: payment.logIndex,
      gifter: getAddress(String(payment.args.gifter)),
      token,
      amount: String(payment.args.amount),
      blockNumber: Number(payment.blockNumber),
    });
    return c.json(
      {
        accepted: true,
        duplicate: !inserted,
        payment: {
          giftId: gift.id,
          gifter: String(payment.args.gifter),
          token,
          amount: String(payment.args.amount),
          txHash: payment.txHash,
          logIndex: payment.logIndex,
          blockNumber: Number(payment.blockNumber),
        },
      },
      inserted ? 201 : 200,
    );
  });

  // ---- growth / jobs / events --------------------------------------------

  app.get('/api/sprouts/:id/growth', (c) => {
    const sprout = getSprout(deps.db, c.req.param('id'));
    if (!sprout) throw new HttpError(404, 'sprout not found');
    const snapshots = listSnapshots(deps.db, sprout.id);
    if (snapshots.length === 0) {
      return c.json({ available: false, reason: 'no verified growth history for this sprout yet', snapshots: [] });
    }
    return c.json({ available: true, snapshots });
  });

  app.get('/api/sprouts/:id/holdings', async (c) => {
    const sprout = getSprout(deps.db, c.req.param('id'));
    if (!sprout) throw new HttpError(404, 'sprout not found');
    const holdings = await readHoldings(deps.chain, sprout.id as Address);
    return c.json(holdings);
  });

  app.get('/api/sprouts/:id/jobs', (c) => c.json({ jobs: listJobsByVault(deps.db, c.req.param('id')) }));

  app.get('/api/sprouts/:id/events', (c) => c.json({ events: listChainEvents(deps.db, c.req.param('id')) }));

  app.post('/api/jobs/run', async (c) => {
    requireAdmin(c, deps);
    const results = await serialize(() => runDueJobs(deps.chain, deps.db));
    return c.json({ results });
  });

  app.post('/api/index/reconcile', async (c) => {
    requireAdmin(c, deps);
    const result = await serialize(async () => {
      const r = await reconcile(deps.chain, deps.db, {});
      const snapshots = await snapshotAll(deps.chain, deps.db);
      return { result: r, snapshots };
    });
    return c.json(result);
  });

  app.get('/api/jobs/:id', (c) => {
    const job = getJob(deps.db, c.req.param('id'));
    if (!job) throw new HttpError(404, 'job not found');
    return c.json({ job });
  });

  // Readiness is distinct from liveness: it fails closed when the chain is
  // misconfigured or the RPC chain id does not match.
  app.get('/api/ready', async (c) => {
    const checks: Record<string, unknown> = {
      db: true,
      configured: deps.chain.config.chain.configured,
      missing: deps.chain.config.chain.missing,
      chainId: deps.chain.config.chain.chainId,
      startBlockConfigured:
        deps.chain.config.chain.isLocal || (deps.chain.config.startBlock ?? 0) > 0,
    };
    let chainIdMatch = false;
    let rpcReachable = false;
    if (deps.chain.publicClient) {
      try {
        const actual = await deps.chain.publicClient.getChainId();
        rpcReachable = true;
        checks.actualChainId = actual;
        chainIdMatch = actual === deps.chain.config.chain.chainId;
      } catch {
        rpcReachable = false;
      }
    }
    checks.rpcReachable = rpcReachable;
    checks.chainIdMatch = chainIdMatch;
    const ready =
      checks.configured === true && rpcReachable && chainIdMatch && checks.startBlockConfigured === true;
    return c.json({ ready, checks }, ready ? 200 : 503);
  });

  // ---- local demo wallet (loopback + local demo only) --------------------
  // In mainnet/production mode (localDemo=false) these routes are not registered
  // at all, so accidental flag combinations cannot expose a signing proxy.

  if (deps.localDemo) {
    app.get('/api/local/wallet', async (c) => {
      return c.json(await localWalletStatus(deps.chain, deps.db));
    });

    app.post('/api/local/rpc', async (c) => {
      assertLoopbackRequest(c.req.header('origin'), c.req.header('host'));
      const account = c.req.header('x-sprout-local-account');
      if (!account) throw new LocalWalletError('missing x-sprout-local-account header', 401);
      let payload: unknown;
      try {
        payload = await c.req.json();
      } catch {
        throw new LocalWalletError('invalid JSON-RPC body');
      }
      return c.json(await handleLocalRpc(deps.chain, deps.db, account, payload as never));
    });

    app.post('/api/local/fund', async (c) => {
      assertLoopbackRequest(c.req.header('origin'), c.req.header('host'));
      const body = await readJson(
        c,
        z.object({ account: addressSchema, token: addressSchema.optional(), amount: z.string().regex(/^\d+(\.\d+)?$/) }),
      );
      // State-changing tool operations share the maintenance mutex so they cannot
      // race the keeper on nonce/gas.
      return c.json(await serialize(() => fundLocalAccount(deps.chain, deps.db, body)));
    });

    app.post('/api/local/advance-time', async (c) => {
      assertLoopbackRequest(c.req.header('origin'), c.req.header('host'));
      const body = await readJson(c, z.object({ seconds: z.number().int().positive() }));
      return c.json(await serialize(() => advanceLocalTime(deps.chain, deps.db, body.seconds)));
    });
  }

  // Same-origin static hosting of the built web app with SPA fallback for
  // client routes such as /gift/<id>.
  if (deps.serveWeb && deps.webDistPath) {
    const dist = deps.webDistPath;
    app.get('*', async (c) => {
      const path = new URL(c.req.url).pathname;
      if (path.startsWith('/api')) return c.json({ error: 'not found' }, 404);
      const safe = path.replace(/\.\./g, '');
      const candidate = Bun.file(join(dist, safe === '/' ? 'index.html' : safe));
      if (await candidate.exists()) return new Response(candidate);
      const index = Bun.file(join(dist, 'index.html'));
      if (await index.exists()) return new Response(index);
      return c.json({ error: 'not found' }, 404);
    });
  }

  app.notFound((c) => c.json({ error: 'not found' }, 404));

  return app;
}

async function getVaultStateCompat(chain: ChainContext, vault: Address) {
  const { getVaultState } = await import('./chain');
  return getVaultState(chain, vault);
}
