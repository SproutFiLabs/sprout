import { registerIntelligenceRoutes, createIntelligenceRuntime, loadIntelligenceConfig, type IntelligenceRuntime } from './intelligence';
import { registerZkRoutes } from './zk';
import { randomBytes, createPublicKey } from 'node:crypto';
import { join } from 'node:path';
import { Hono, type Context } from 'hono';
import { getAddress, type Address, type Hex } from 'viem';
import { z } from 'zod';
import { addressSchema, hashSchema, sproutFactoryAbi, sproutVaultAbi } from '@sprout/shared';
import type { SproutDb } from './db';
import type { ChainContext } from './chain';
import {
  ChainConfigError,
  READ_TTL,
  cachedHoldings,
  chainCache,
  decodeReceiptLogs,
  getBeneficiaryState,
  getSettlementDecimals,
  invalidateChainReads,
  isGraduated,
  verifySproutCreated,
} from './chain';
import { contributionHistory, type ContributionHistory } from './contributions';
import { AuthError, authenticate, issueNonce } from './auth';
import { createFamilySession, familySession, authorizeVault, childSession, digest, secret, CHILD_TTL, type KidInvite } from './privacy';
import { historyCsv, historyFilename } from './history';
import { reconcile, snapshotAll } from './indexer';
import { automationCapability, autoInvestRequirement, holderAutoInvestGate, runDueJobs } from './jobs';
import { investQuote } from './invest';
import { factoryAdmitsVenue, sproutDeploymentView } from './deployments';
import { listDeployments } from './config';
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
import { createHolderChecker, loadPerksConfig, publicPerks, type HolderChecker } from './holders';
import { DEFAULT_PUBLIC_ORIGIN, giftPreviewHtml } from './sharePreview';
import {
  CAMPAIGN_MAX_DAYS,
  GOAL_MAX_DOLLARS,
  NAME_MAX,
  NOTE_MAX,
  TITLE_MAX,
  TextRuleError,
  campaignView,
  cleanText,
  noteView,
  notesView,
} from './campaigns';
import {
  activityTotals,
  getGift,
  getJob,
  getMilestone,
  getSprout,
  insertGift,
  insertGiftCampaign,
  listGiftNotes,
  setGiftNoteHidden,
  upsertGiftNote,
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
  intelligence?: IntelligenceRuntime;
  db: SproutDb;
  chain: ChainContext;
  localDemo: boolean;
  adminToken?: string;
  now?: () => number;
  /** SPROUT holder tiers; built from the environment when not given. */
  holders?: HolderChecker;
  runExclusive?: <T>(fn: () => Promise<T>) => Promise<T>;
  serveWeb?: boolean;
  webDistPath?: string;
  /** Canonical public origin for absolute URLs in link previews. */
  publicOrigin?: string;
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
  const holders = deps.holders ?? createHolderChecker(deps.chain.publicClient, loadPerksConfig(process.env));
  const serialize = deps.runExclusive ?? createMutex();

  const nowSeconds = () => Math.floor((deps.now ? deps.now() : Date.now()) / 1000);
  const settlementDecimalsFor = async (): Promise<number> => {
    if (deps.chain.config.chain.configured && deps.chain.publicClient) return getSettlementDecimals(deps.chain);
    return deps.chain.config.settlementDecimals ?? 6;
  };
  const campaignFor = (giftId: string, settlementDecimals: number) =>
    campaignView(deps.db, giftId, {
      settlementToken: deps.chain.config.chain.contracts.settlementToken,
      settlementDecimals,
      nowSeconds: nowSeconds(),
    });
  const giftCampaign = async (giftId: string) => campaignFor(giftId, await settlementDecimalsFor());
  /** Text rules (length, no links) surface as a 400 with the rule's own message. */
  const textRule = <T>(fn: () => T): T => {
    try {
      return fn();
    } catch (error) {
      if (error instanceof TextRuleError) throw new HttpError(400, error.message);
      throw error;
    }
  };

  app.onError((err, c) => {
    if (err instanceof AuthError) return c.json({ error: err.message }, err.status as 401);
    if (err instanceof HttpError) return c.json({ error: err.message }, err.status as 400);
    if (err instanceof LocalWalletError) return c.json({ error: err.message }, err.status as 400);
    if (err instanceof ChainConfigError) return c.json({ error: err.message }, 503);
    logger.error('unhandled request error'); // Never log request bodies, secrets or family metadata.
    return c.json({ error: 'internal error' }, 500);
  });

  const now = () => deps.now?.() ?? Date.now();
  app.use('*', async (c, next) => {
    c.header('Referrer-Policy', 'no-referrer');
    c.header('X-Content-Type-Options', 'nosniff');
    c.header('Content-Security-Policy', "frame-ancestors 'none'; base-uri 'self'; object-src 'none'");
    c.header('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
    if (/^\/(api|kid|dashboard|family|gift|verify)(\/|$)/.test(c.req.path)) {
      c.header('Cache-Control', 'no-store');
      c.header('X-Robots-Tag', 'noindex, nofollow, noarchive');
    }
    // Every family GET, including nested resources, crosses the same boundary.
    if (c.req.method === 'GET' && /^\/api\/(sprouts|jobs)(\/|$)/.test(c.req.path)) {
      const session = familySession(c, deps.db, now());
      const parts = c.req.path.split('/').map(decodeURIComponent);
      if (parts[2] === 'sprouts' && parts[3]) authorizeVault(deps.db, parts[3], session.address);
      else if (parts[2] === 'jobs' && parts[3]) {
        const job = getJob(deps.db, parts[3]);
        if (!job) throw new HttpError(403, 'This family view is unavailable.');
        authorizeVault(deps.db, job.vaultId, session.address);
      } else {
        const requested = c.req.query('parent') ?? c.req.query('beneficiary');
        if (requested?.toLowerCase() !== session.address) throw new HttpError(403, 'Only your own family can be listed.');
      }
    }
    await next();
    c.res.headers.set('Referrer-Policy', 'no-referrer');
    c.res.headers.set('X-Content-Type-Options', 'nosniff');
    c.res.headers.set('Content-Security-Policy', "frame-ancestors 'none'; base-uri 'self'; object-src 'none'");
    c.res.headers.set('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
    if (/^\/(api|kid|dashboard|family|gift|verify)(\/|$)/.test(c.req.path)) {
      c.res.headers.set('Cache-Control', 'no-store');
      c.res.headers.set('X-Robots-Tag', 'noindex, nofollow, noarchive');
    }
  });

  registerZkRoutes(app, deps, (c, purpose) => requireAuth(c, deps, purpose));
  registerIntelligenceRoutes(app, { db: deps.db, now: deps.now, runtime: deps.intelligence ?? createIntelligenceRuntime(deps.chain.config.intelligence ?? loadIntelligenceConfig({})) }, (c, purpose) => requireAuth(c, deps, purpose));

  app.post('/api/family/gift-key', async (c) => {
    const signer = (await requireAuth(c, deps, 'family-gift-key')).toLowerCase();
    const body = await readJson(c, z.object({ publicKey: z.string().min(100).max(1200) }).strict());
    try {
      const publicKey = createPublicKey({ key: Buffer.from(body.publicKey, 'base64'), type: 'spki', format: 'der' });
      if (publicKey.asymmetricKeyType !== 'rsa' || publicKey.asymmetricKeyDetails?.modulusLength !== 3072) throw new Error();
    } catch { throw new HttpError(400, 'Invalid gift encryption key.'); }
    const existing = deps.db.query<{ public_key: string }, [string]>('SELECT public_key FROM family_gift_keys WHERE address=?').get(signer);
    if (existing && existing.public_key !== body.publicKey) throw new HttpError(409, 'Restore your original encrypted vault; its gift key is already registered.');
    deps.db.run('INSERT OR IGNORE INTO family_gift_keys VALUES (?,?)', [signer, body.publicKey]);
    return c.json({ registered: true });
  });
  app.post('/api/family/session', async (c) => {
    const address = await requireAuth(c, deps, 'family-session');
    return c.json(createFamilySession(deps.db, address, now()));
  });
  app.post('/api/family/lock', (c) => {
    const session = familySession(c, deps.db, now());
    deps.db.run('DELETE FROM family_sessions WHERE address=?', [session.address]);
    return c.json({ locked: true });
  });
  app.get('/api/family/invites/:vault', (c) => {
    const session = familySession(c, deps.db, now());
    const vault = authorizeVault(deps.db, c.req.param('vault'), session.address, true);
    const invites = deps.db.query('SELECT id, expires_at AS expiresAt, redeemed, revoked, show_balance AS showBalance FROM kid_invites WHERE lower(vault_id)=? ORDER BY expires_at DESC').all(vault.id.toLowerCase());
    return c.json({ invites });
  });
  app.post('/api/family/invites/:vault', async (c) => {
    const vaultId = c.req.param('vault');
    const signer = await requireAuth(c, deps, `kid-invite:${vaultId.toLowerCase()}`);
    const vault = authorizeVault(deps.db, vaultId, signer, true);
    const body = await readJson(c, z.object({ showBalance: z.boolean().default(false) }).strict());
    const id = randomBytes(16).toString('hex');
    const token = secret();
    const expiresAt = now() + 7 * 24 * 60 * 60_000;
    deps.db.run('INSERT INTO kid_invites (id,vault_id,secret_hash,expires_at,show_balance) VALUES (?,?,?,?,?)', [id, vault.id, digest(token), expiresAt, Number(body.showBalance)]);
    return c.json({ id, token, expiresAt }, 201);
  });
  app.post('/api/family/invites/:id/revoke', async (c) => {
    const id = c.req.param('id');
    const signer = await requireAuth(c, deps, `kid-revoke:${id}`);
    const invite = deps.db.query<KidInvite, [string]>('SELECT * FROM kid_invites WHERE id=?').get(id);
    if (!invite) throw new HttpError(404, 'Invitation unavailable.');
    authorizeVault(deps.db, invite.vault_id, signer, true);
    deps.db.run('UPDATE kid_invites SET revoked=1 WHERE id=?', [id]);
    return c.json({ revoked: true });
  });
  app.post('/api/kid/redeem', async (c) => {
    const body = await readJson(c, z.object({ id: z.string().regex(/^[a-f0-9]{32}$/), token: z.string().regex(/^[\w-]{43}$/) }).strict());
    const token = secret();
    const result = deps.db.transaction(() => {
      const invite = deps.db.query<KidInvite, [string, string, number]>('SELECT * FROM kid_invites WHERE id=? AND secret_hash=? AND expires_at>? AND revoked=0 AND redeemed=0').get(body.id, digest(body.token), now());
      if (!invite) throw new AuthError('Invitation unavailable. Ask a grown-up for a new one.');
      deps.db.run('UPDATE kid_invites SET redeemed=1 WHERE id=?', [invite.id]);
      const expiresAt = Math.min(invite.expires_at, now() + CHILD_TTL);
      deps.db.run('INSERT INTO kid_sessions VALUES (?,?,?)', [digest(token), invite.id, expiresAt]);
      return { token, expiresAt };
    })();
    return c.json(result);
  });
  app.get('/api/kid/view', async (c) => {
    const invite = childSession(c, deps.db, now());
    const sprout = getSprout(deps.db, invite.vault_id);
    if (!sprout) throw new HttpError(404, 'View unavailable.');
    // No wallet addresses, transaction hashes, names, birth/graduation dates or gift messages.
    const symbols = deps.chain.config.chain.contracts.stockTokens.filter(t => sprout.assets.some(a => a.toLowerCase() === t.address.toLowerCase())).map(t => t.symbol);
    let balance: { valueUsd: string | null; feedDecimals: number } | null = null;
    if (invite.show_balance) {
      const holdings = await cachedHoldings(deps.chain, sprout.id as Address);
      if (holdings.available) balance = { valueUsd: holdings.totalValueUsd, feedDecimals: holdings.feedDecimals };
    }
    return c.json({ symbols, balance, chores: listMilestonesByVault(deps.db, sprout.chainId, sprout.id).filter(m => m.status === 'created').length, expiresAt: invite.expires_at });
  });

  app.get('/api/health', (c) =>
    c.json({
      ok: true,
      chainId: deps.chain.config.chain.chainId,
      chainName: deps.chain.config.chain.name,
      configured: deps.chain.config.chain.configured,
      missing: deps.chain.config.chain.missing,
      localDemo: deps.localDemo,
      // autoInvestTier: the SPROUT tier a parent needs for the keeper to run their plan (null: everyone).
      automation: { ...automationCapability(deps.chain), autoInvestTier: autoInvestRequirement(holders.config) },
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
    // Deliberately omit the internal RPC URLs, primary and fallback alike: they
    // may carry provider API keys. Only an explicitly public wallet RPC is exposed.
    const { rpcUrl: _rpcUrl, rpcFallbackUrls: _rpcFallbackUrls, ...publicChain } = chain;
    return c.json({
      // A token contract address for visitors to copy; null hides it.
      publicCa: deps.chain.config.publicCa ?? null,
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

  // SPROUT holder perks: the tier ladder, what is in early access, and one wallet's tier.
  app.get('/api/perks', (c) => c.json(publicPerks(holders.config)));
  app.get('/api/holders/:address', async (c) => {
    const address = c.req.param('address');
    if (!/^0x[0-9a-fA-F]{40}$/.test(address)) throw new HttpError(400, 'invalid address');
    try {
      return c.json(await holders.status(address));
    } catch (error) {
      logger.error?.('holder check failed', error);
      throw new HttpError(503, 'holder check unavailable, try again shortly');
    }
  });

  // Holder stock votes (see votes.ts). The module is imported where it is used,
  // like ./repo in POST /api/sprouts, so the feature stays in this one block.
  app.get('/api/polls', async (c) => {
    const votes = await import('./votes');
    const now = nowSeconds();
    return c.json({
      polls: votes.listCurrentPolls(deps.db, now).map((p) => votes.pollView(deps.db, p, now)),
      weights: votes.VOTE_WEIGHTS,
    });
  });

  app.get('/api/polls/:id/mine', async (c) => {
    const votes = await import('./votes');
    const parsed = addressSchema.safeParse(c.req.query('address'));
    if (!parsed.success) throw new HttpError(400, 'invalid address');
    const poll = votes.getPoll(deps.db, c.req.param('id'));
    if (!poll) throw new HttpError(404, 'poll not found');
    return c.json({ vote: votes.getVote(deps.db, poll.id, parsed.data) });
  });

  app.post('/api/polls/:id/vote', async (c) => {
    const signer = await requireAuth(c, deps, 'vote');
    const votes = await import('./votes');
    const body = await readJson(c, votes.voteInputSchema);
    const poll = votes.getPoll(deps.db, c.req.param('id'));
    if (!poll) throw new HttpError(404, 'poll not found');
    const assertOpen = () => {
      const status = votes.pollStatus(poll, nowSeconds());
      if (status === 'upcoming') throw new HttpError(409, 'This poll has not opened yet');
      if (status === 'closed') throw new HttpError(409, 'This poll has closed');
    };
    assertOpen();
    if (!poll.options.some((o) => o.id === body.optionId)) throw new HttpError(400, 'unknown option');
    // Re-read on every vote, so a changed vote carries the wallet's tier now.
    const tier = await holders.tier(signer);
    if (!tier) throw new HttpError(403, 'Voting is for SPROUT holders');
    // The holder check reads the chain and can take a moment; the poll may have closed meanwhile.
    assertOpen();
    const vote = votes.recordVote(deps.db, { pollId: poll.id, address: signer, optionId: body.optionId, tier, votedAt: nowSeconds() });
    return c.json({ poll: votes.pollView(deps.db, poll, nowSeconds()), vote });
  });

  app.post('/api/polls', async (c) => {
    requireAdmin(c, deps);
    const votes = await import('./votes');
    const body = await readJson(c, votes.pollInputSchema);
    const question = textRule(() => cleanText(body.question, votes.QUESTION_MAX, 'Question'));
    if (!question) throw new HttpError(400, 'Question is required');
    const options = body.options.map((o) => {
      const label = textRule(() => cleanText(o.label, votes.OPTION_LABEL_MAX, 'Option label'));
      if (!label) throw new HttpError(400, 'Every option needs a label');
      return { id: o.id, label };
    });
    if (new Set(options.map((o) => o.id.toLowerCase())).size !== options.length) throw new HttpError(400, 'Option ids must be different');
    const now = nowSeconds();
    const opensAt = body.opensAt ?? now;
    if (body.closesAt <= now) throw new HttpError(400, 'A poll must close in the future');
    if (body.closesAt <= opensAt) throw new HttpError(400, 'A poll must close after it opens');
    if (body.closesAt - opensAt > votes.POLL_MAX_DAYS * 86_400) {
      throw new HttpError(400, `A poll can run for at most ${votes.POLL_MAX_DAYS} days`);
    }
    const poll = votes.createPoll(deps.db, { question, options, opensAt, closesAt: body.closesAt, createdAt: now });
    return c.json({ poll: votes.pollView(deps.db, poll, now) }, 201);
  });

  if (deps.localDemo) {
    app.get('/api/fixtures', (c) => c.json(localFixtures(deps.chain.config.chain.chainId)));
  }

  // Public, aggregate-only numbers for the landing page. The sprout count is
  // read from every configured factory (current and legacy), so it includes
  // sprouts this server never indexed.
  app.get('/api/stats', async (c) => {
    const chain = deps.chain;
    const stats = await chainCache(chain).get('stats', READ_TTL.stats, async () => {
      const totals = activityTotals(deps.db, chain.config.chain.chainId);
      let planted = totals.sprouts;
      let source: 'chain' | 'index' = 'index';
      const factories = listDeployments(chain.config).map((d) => d.factory);
      const client = chain.publicClient;
      if (client && chain.config.chain.configured && factories.length > 0) {
        try {
          const counts = await Promise.all(
            factories.map((factory) =>
              client.readContract({ address: factory, abi: sproutFactoryAbi, functionName: 'totalSprouts' }),
            ),
          );
          planted = counts.reduce((sum, n) => sum + Number(n), 0);
          source = 'chain';
        } catch {
          // fall back to the indexed count, which spans every factory too
        }
      }
      return {
        sproutsPlanted: planted,
        sproutsFunded: totals.fundedSprouts,
        giftsSent: totals.gifts,
        purchases: totals.purchases,
        source,
        asOf: Math.floor((deps.now ? deps.now() : Date.now()) / 1000),
      };
    });
    return c.json(stats);
  });

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

    const nowMs = deps.now ? deps.now() : Date.now();
    const sprouts = await Promise.all(
      records.map(async (s) => ({
        ...s,
        // factory + admittedAssets: which stocks this sprout may ever hold.
        ...(await sproutDeploymentView(deps.chain, deps.db, s)),
        graduated: await isGraduated(deps.chain, s.graduationTimestamp, nowMs),
        role: parent ? 'parent' : 'beneficiary',
      })),
    );
    return c.json({ sprouts });
  });

  app.get('/api/sprouts/:id', async (c) => {
    const sprout = getSprout(deps.db, c.req.param('id'));
    if (!sprout) throw new HttpError(404, 'sprout not found');
    const graduated = await isGraduated(deps.chain, sprout.graduationTimestamp, deps.now ? deps.now() : Date.now());
    const settlementDecimals = await settlementDecimalsFor();
    // The sprout's own factory decides which stocks it may hold (a legacy
    // sprout: only the legacy factory's four), whatever /api/config lists.
    const deployment = await sproutDeploymentView(deps.chain, deps.db, sprout);
    return c.json({
      sprout: { ...sprout, ...deployment, graduated },
      automation: automationCapability(deps.chain),
      milestones: listMilestonesByVault(deps.db, sprout.chainId, sprout.id),
      jobs: listJobsByVault(deps.db, sprout.id),
      gifts: listGiftsByVault(deps.db, sprout.id).map((g) => {
        const payments = listGiftPayments(deps.db, g.id);
        const totals: Record<string, string> = {};
        for (const p of payments) {
          totals[p.token] = (BigInt(totals[p.token] ?? '0') + BigInt(p.amount)).toString();
        }
        const { notes, hiddenNotes } = notesView(deps.db, g.id, 5);
        return {
          id: g.id,
          vaultId: g.vaultId,
          label: g.label,
          status: g.status,
          acceptedAssets: g.acceptedAssets,
          paymentCount: payments.length,
          totals,
          campaign: campaignFor(g.id, settlementDecimals),
          notes,
          hiddenNotes,
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
    const body = await readJson(c, z.object({ txHash: hashSchema }).strict());
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
        factory: created.factory,
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
        // The settlement token plus at most five stocks (SproutVault.MAX_ASSETS).
        acceptedAssets: z.array(addressSchema).min(1).max(6),
        campaign: z
          .object({
            title: z.string(),
            goalDollars: z.number().int().min(1).max(GOAL_MAX_DOLLARS),
            endsAt: z.number().int(),
          })
          .optional(),
      }),
    );
    assertParent(deps.db, body.vaultId, signer);
    let campaign: { title: string; goalCents: number; endsAt: number } | null = null;
    if (body.campaign) {
      const title = textRule(() => cleanText(body.campaign!.title, TITLE_MAX, 'Campaign title'));
      if (!title) throw new HttpError(400, 'Campaign title is required');
      const nowSeconds = Math.floor((deps.now ? deps.now() : Date.now()) / 1000);
      if (body.campaign.endsAt <= nowSeconds) throw new HttpError(400, 'The campaign must end in the future');
      if (body.campaign.endsAt > nowSeconds + CAMPAIGN_MAX_DAYS * 86400) {
        throw new HttpError(400, `A campaign can run for at most ${CAMPAIGN_MAX_DAYS} days`);
      }
      campaign = { title: 'Family gift', goalCents: body.campaign.goalDollars * 100, endsAt: body.campaign.endsAt };
    }
    const id = `0x${randomBytes(32).toString('hex')}` as Hex;
    deps.db.transaction(() => {
      insertGift(deps.db, {
        id,
        vaultId: getAddress(body.vaultId),
        label: 'A gift for the future',
        acceptedAssets: body.acceptedAssets.map(getAddress),
        status: 'open',
      });
      if (campaign) insertGiftCampaign(deps.db, { giftId: id, ...campaign });
    })();
    return c.json({ gift: { ...getGift(deps.db, id)!, campaign: await giftCampaign(id) } }, 201);
  });

  app.get('/api/gifts/:id', async (c) => {
    const gift = getGift(deps.db, c.req.param('id'));
    if (!gift) throw new HttpError(404, 'gift not found');
    const parent = getSprout(deps.db, gift.vaultId)?.parent.toLowerCase();
    const key = deps.db.query<{ public_key: string }, [string]>('SELECT public_key FROM family_gift_keys WHERE address=?').get(parent ?? '');
    return c.json({ id: gift.id, label: 'A gift for the future', acceptedAssets: gift.acceptedAssets, status: gift.status, publicKey: key?.public_key ?? null });
  });
  app.post('/api/gifts/:id/checkout', async (c) => {
    await requireAuth(c, deps, `gift-checkout`);
    const gift = getGift(deps.db, c.req.param('id'));
    if (!gift || gift.status !== 'open') throw new HttpError(404, 'Gift unavailable.');
    return c.json({ id: gift.id, vaultId: gift.vaultId, acceptedAssets: gift.acceptedAssets, chainVisibility: 'public' });
  });

  // The parent's full list of notes for a gift link, hidden ones included.
  app.post('/api/gifts/:id/notes', async (c) => {
    const signer = await requireAuth(c, deps, 'gift-notes');
    const gift = getGift(deps.db, c.req.param('id'));
    if (!gift) throw new HttpError(404, 'gift not found');
    assertParent(deps.db, gift.vaultId, signer);
    return c.json({ notes: listGiftNotes(deps.db, gift.id, { includeHidden: true }).map((n) => noteView(n, true)) });
  });

  app.post('/api/gifts/:id/notes/visibility', async (c) => {
    const signer = await requireAuth(c, deps, 'gift-note-visibility');
    const gift = getGift(deps.db, c.req.param('id'));
    if (!gift) throw new HttpError(404, 'gift not found');
    assertParent(deps.db, gift.vaultId, signer);
    const body = await readJson(c, z.object({ txHash: hashSchema, logIndex: z.number().int().min(0), hidden: z.boolean() }));
    if (!setGiftNoteHidden(deps.db, { giftId: gift.id, txHash: body.txHash, logIndex: body.logIndex }, body.hidden)) {
      throw new HttpError(404, 'note not found');
    }
    return c.json({ notes: listGiftNotes(deps.db, gift.id, { includeHidden: true }).map((n) => noteView(n, true)) });
  });

  app.post('/api/gifts/:id/payments', async (c) => {
    const signer = await requireAuth(c, deps, 'gift-pay');
    const gift = getGift(deps.db, c.req.param('id'));
    if (!gift) throw new HttpError(404, 'gift not found');
    requireConfigured(deps);
    const body = await readJson(
      c,
      z.object({ txHash: hashSchema, encryptedNote: z.string().max(6000).startsWith('encrypted:v1:').optional() }).strict(),
    );
    // Check the note before anything is recorded, so a refused note is reported
    // as such rather than half-applied.
    const name = null;
    const note = body.encryptedNote ?? null;
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
    // The note belongs to the verified gift whether this call or the indexer
    // recorded the payment first.
    if (name || note) {
      upsertGiftNote(deps.db, {
        chainId: deps.chain.config.chain.chainId,
        txHash: body.txHash,
        logIndex: payment.logIndex,
        giftId: gift.id,
        gifter: getAddress(String(payment.args.gifter)),
        name,
        note,
      });
    }
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

  app.get('/api/sprouts/:id/growth', async (c) => {
    const sprout = getSprout(deps.db, c.req.param('id'));
    if (!sprout) throw new HttpError(404, 'sprout not found');
    const snapshots = listSnapshots(deps.db, sprout.id);
    // What was put in, beside what it is worth (see contributionHistory). A
    // failed block-time read only drops this part; the recorded values are
    // still served unchanged.
    let history: ContributionHistory;
    try {
      history = await contributionHistory(deps.chain, {
        events: listChainEvents(deps.db, sprout.id),
        snapshots,
        settlementToken: sprout.settlementToken,
      });
    } catch (error) {
      logger.warn('contribution history unavailable', error instanceof Error ? error.message : error);
      history = { contributions: [], totals: null, note: 'What was put in cannot be shown right now. Try again shortly.' };
    }
    if (snapshots.length === 0) {
      return c.json({ available: false, reason: 'no verified growth history for this sprout yet', snapshots: [], ...history });
    }
    return c.json({ available: true, snapshots, ...history });
  });

  app.get('/api/sprouts/:id/holdings', async (c) => {
    const sprout = getSprout(deps.db, c.req.param('id'));
    if (!sprout) throw new HttpError(404, 'sprout not found');
    // `after` is the block the caller's own transaction confirmed in; anything
    // cached from before it is re-read (see cachedHoldings).
    const afterRaw = c.req.query('after');
    const afterBlock = afterRaw && /^\d{1,12}$/.test(afterRaw) ? Number(afterRaw) : undefined;
    const holdings = await cachedHoldings(deps.chain, sprout.id as Address, { afterBlock });
    return c.json(holdings);
  });

  // Preview (and, once due, the signed minimums for) a parent-run purchase.
  app.get('/api/sprouts/:id/invest-quote', async (c) => {
    const sprout = getSprout(deps.db, c.req.param('id'));
    if (!sprout) throw new HttpError(404, 'sprout not found');
    requireConfigured(deps);
    const amountRaw = c.req.query('amount') ?? '';
    if (!/^\d{1,30}$/.test(amountRaw)) throw new HttpError(400, 'amount must be a whole number of settlement base units');
    const afterRaw = c.req.query('after');
    const minBlock = afterRaw && /^\d{1,12}$/.test(afterRaw) ? Number(afterRaw) : undefined;
    const amount = BigInt(amountRaw);
    // Family authorization runs before this route; reuse identical chain quotes briefly.
    const quote = await chainCache(deps.chain).get(
      `invest-quote:${sprout.id.toLowerCase()}:${amount}:${minBlock ?? 0}`,
      READ_TTL.investQuote,
      () => investQuote(deps.chain, sprout.id as Address, amount, { minBlock }),
    );
    return c.json(quote);
  });

  app.get('/api/sprouts/:id/jobs', (c) => c.json({ jobs: listJobsByVault(deps.db, c.req.param('id')) }));

  // The sprout's history as a spreadsheet download. Built from the same public
  // chain events as /events.
  app.get('/api/sprouts/:id/history.csv', async (c) => {
    const sprout = getSprout(deps.db, c.req.param('id'));
    if (!sprout) throw new HttpError(404, 'sprout not found');
    const csv = await historyCsv(deps.chain, deps.db, sprout.id);
    return new Response(csv, {
      headers: {
        'content-type': 'text/csv; charset=utf-8',
        'content-disposition': `attachment; filename="${historyFilename(sprout.id)}"`,
        'cache-control': 'no-store',
      },
    });
  });

  app.get('/api/sprouts/:id/events', (c) => c.json({ events: listChainEvents(deps.db, c.req.param('id')) }));

  app.post('/api/jobs/run', async (c) => {
    requireAdmin(c, deps);
    const results = await serialize(() => runDueJobs(deps.chain, deps.db, { mayAutoInvest: holderAutoInvestGate(deps.db, holders) }));
    return c.json({ results });
  });

  app.post('/api/index/reconcile', async (c) => {
    requireAdmin(c, deps);
    const result = await serialize(async () => {
      // An operator asking for a reconcile wants current state, not cached reads.
      invalidateChainReads(deps.chain);
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
        const client = deps.chain.publicClient;
        const actual = await chainCache(deps.chain).get('chainId', READ_TTL.chainId, () => client.getChainId());
        rpcReachable = true;
        checks.actualChainId = actual;
        chainIdMatch = actual === deps.chain.config.chain.chainId;
      } catch {
        rpcReachable = false;
      }
    }
    checks.rpcReachable = rpcReachable;
    checks.chainIdMatch = chainIdMatch;
    // Every factory must admit the venue configured for it (SPROUT_VENUE_ADDRESS
    // for the current one, SPROUT_LEGACY_DEPLOYMENTS for each legacy one), or
    // its sprouts' purchases would revert. A wrong pairing fails readiness, so
    // a deploy with it never replaces the running version.
    let venuesAdmitted = false;
    if (rpcReachable && chainIdMatch && checks.configured === true) {
      const deployments = listDeployments(deps.chain.config).filter((d) => d.venue);
      try {
        const admitted = await Promise.all(deployments.map((d) => factoryAdmitsVenue(deps.chain, d.factory, d.venue!)));
        checks.deployments = deployments.map((d, i) => ({
          factory: d.factory,
          venue: d.venue,
          current: d.current,
          venueAdmitted: admitted[i],
        }));
        venuesAdmitted = admitted.every(Boolean);
      } catch {
        venuesAdmitted = false;
      }
    }
    checks.venuesAdmitted = venuesAdmitted;
    const ready =
      checks.configured === true &&
      rpcReachable &&
      chainIdMatch &&
      checks.startBlockConfigured === true &&
      venuesAdmitted;
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
      const response = await handleLocalRpc(deps.chain, deps.db, account, payload as never);
      // The local wallet sends its transactions through this proxy, and Anvil
      // mines them immediately, so a relayed send makes cached balances stale.
      if ((payload as { method?: string } | null)?.method === 'eth_sendTransaction') invalidateChainReads(deps.chain);
      return c.json(response);
    });

    app.post('/api/local/fund', async (c) => {
      assertLoopbackRequest(c.req.header('origin'), c.req.header('host'));
      const body = await readJson(
        c,
        z.object({ account: addressSchema, token: addressSchema.optional(), amount: z.string().regex(/^\d+(\.\d+)?$/) }),
      );
      // State-changing tool operations share the maintenance mutex so they cannot
      // race the keeper on nonce/gas.
      const result = await serialize(() => fundLocalAccount(deps.chain, deps.db, body));
      invalidateChainReads(deps.chain);
      return c.json(result);
    });

    app.post('/api/local/advance-time', async (c) => {
      assertLoopbackRequest(c.req.header('origin'), c.req.header('host'));
      const body = await readJson(c, z.object({ seconds: z.number().int().positive() }));
      const result = await serialize(() => advanceLocalTime(deps.chain, deps.db, body.seconds));
      invalidateChainReads(deps.chain);
      return c.json(result);
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
      // A child's page is for the family, not for search engines.
      if (/^\/kid\//.test(path)) {
        const index = Bun.file(join(dist, 'index.html'));
        if (await index.exists()) return new Response(index, { headers: { 'x-robots-tag': 'noindex, nofollow' } });
      }
      const index = Bun.file(join(dist, 'index.html'));
      if (await index.exists()) {
        // A known gift link previews as a gift, not as the home page.
        const giftId = path.match(/^\/gift\/(0x[0-9a-fA-F]{64})\/?$/)?.[1];
        const gift = giftId ? getGift(deps.db, giftId) : null;
        if (gift) {
          const origin = deps.publicOrigin ?? DEFAULT_PUBLIC_ORIGIN;
          const html = giftPreviewHtml(await index.text(), gift, `${origin}/gift/${gift.id}`, origin);
          return new Response(html, { headers: { 'content-type': 'text/html;charset=utf-8' } });
        }
        return new Response(index);
      }
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
