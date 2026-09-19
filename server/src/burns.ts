import { Hono, type Context } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { decodeEventLog, erc20Abi, getAddress, isAddress, type Address, type Hex, type PublicClient } from 'viem';
import { z } from 'zod';
import {
  BURN_DEFAULT_SLIPPAGE_BPS,
  BURN_MAX_USD,
  BURN_MIN_USD,
  BURN_PRESETS_USD,
  DEAD_ADDRESS,
  ROBINHOOD_BURN_ROUTE,
  addressSchema,
  decodeBurnCalldata,
  hashSchema,
  minOutFor,
  parseBurnUsd,
  quoteBurn,
  type BurnRoute,
} from '@sprout/shared';
import type { SproutDb } from './db';
import { createReadCache } from './readCache';

/**
 * "Buy & burn": anyone may spend a little USDG from their own wallet to buy
 * SPROUT on the open market and send it to the dead address (shared/src/burn.ts
 * has the route). The server never sends anything. It:
 *
 *  - tells the browser the route and quotes it (Uniswap's quoters, eth_call);
 *  - checks a finished burn on chain and records it once (POST /api/burns);
 *  - publishes the counter: burns through Sprout, and all SPROUT ever burned.
 *
 * Off unless SPROUT_BURN_ENABLED is set and SPROUT_BURN_ROUTER names the
 * UniversalRouter; unset, every endpoint answers "off" and the site hides the
 * feature. It only knows Robinhood Chain's route, so it stays off elsewhere
 * (the local demo chain has no Uniswap v4).
 *
 * Nothing here touches a sprout: burns are paid by the wallet that sends them.
 */

type EnvLike = Record<string, string | undefined>;

export interface BurnConfig {
  enabled: boolean;
  route: BurnRoute | null;
  /** The floor under a quote the browser signs, in basis points. */
  slippageBps: number;
  minUsd: number;
  maxUsd: number;
  /** How old a burn may be when it is reported (seconds). */
  maxAgeSeconds: number;
}

const TRUE = /^(1|true|yes|on)$/i;
const DEFAULT_MAX_AGE_SECONDS = 72 * 3600;

/** Reads the burn settings; a bad value fails the deploy instead of half-enabling the feature. */
export function loadBurnConfig(env: EnvLike, chainId: number): BurnConfig {
  const off: BurnConfig = { enabled: false, route: null, slippageBps: BURN_DEFAULT_SLIPPAGE_BPS, minUsd: BURN_MIN_USD, maxUsd: BURN_MAX_USD, maxAgeSeconds: DEFAULT_MAX_AGE_SECONDS };
  const flag = env.SPROUT_BURN_ENABLED?.trim() ?? '';
  if (!flag || !TRUE.test(flag)) return off;
  const routerRaw = env.SPROUT_BURN_ROUTER?.trim() ?? '';
  if (!routerRaw) throw new Error('SPROUT_BURN_ROUTER is required with SPROUT_BURN_ENABLED (the Uniswap UniversalRouter address)');
  if (!isAddress(routerRaw)) throw new Error('SPROUT_BURN_ROUTER must be a 0x contract address');
  if (chainId !== ROBINHOOD_BURN_ROUTE.chainId) {
    throw new Error(`SPROUT_BURN_ENABLED: buy & burn only knows Robinhood Chain's route (chain ${ROBINHOOD_BURN_ROUTE.chainId}), not chain ${chainId}`);
  }
  const router = getAddress(routerRaw);
  if (router !== ROBINHOOD_BURN_ROUTE.router) {
    throw new Error(`SPROUT_BURN_ROUTER must be Uniswap's UniversalRouter on Robinhood Chain, ${ROBINHOOD_BURN_ROUTE.router}`);
  }
  const slippageBps = Number(env.SPROUT_BURN_SLIPPAGE_BPS?.trim() || BURN_DEFAULT_SLIPPAGE_BPS);
  if (!Number.isInteger(slippageBps) || slippageBps < 50 || slippageBps > 1000) throw new Error('SPROUT_BURN_SLIPPAGE_BPS must be a whole number from 50 to 1000');
  const maxUsd = Number(env.SPROUT_BURN_MAX_USD?.trim() || BURN_MAX_USD);
  if (!Number.isInteger(maxUsd) || maxUsd < 20 || maxUsd > 5000) throw new Error('SPROUT_BURN_MAX_USD must be a whole number from 20 to 5000');
  return { ...off, enabled: true, route: { ...ROBINHOOD_BURN_ROUTE, router }, slippageBps, maxUsd };
}

// ---------------------------------------------------------------------------
// Verification (pure)

export class BurnError extends Error {
  constructor(
    readonly status: 400 | 403 | 404 | 409 | 422 | 429 | 503,
    message: string,
  ) {
    super(message);
    this.name = 'BurnError';
  }
}

export interface BurnTxEvidence {
  hash: Hex;
  status: 'success' | 'reverted';
  from: Address;
  to: Address | null;
  input: Hex;
  blockNumber: bigint;
  /** The block's timestamp (unix seconds). */
  timestamp: number;
  logs: ReadonlyArray<{ address: Address; topics: readonly Hex[]; data: Hex }>;
}

export interface BurnRecord {
  txHash: Hex;
  chainId: number;
  wallet: Address;
  /** SPROUT (base units) the pool sent to the dead address in this transaction. */
  sproutBurned: bigint;
  /** USDG (base units) that left the wallet in this transaction. */
  usdgIn: bigint;
  blockNumber: number;
  burnedAt: number;
}

const transferAbi = erc20Abi.filter((e) => e.type === 'event' && e.name === 'Transfer');

/**
 * Checks one transaction is a finished Sprout buy & burn and measures it:
 * successful; sent to the configured UniversalRouter; its calldata is the
 * Sprout route with the SPROUT taken to the dead address; the pool (v4
 * PoolManager) sent SPROUT to the dead address; the wallet paid USDG and sent
 * no SPROUT of its own; and it is recent. `claimedWallet`, when given, must be
 * the sender: nobody can file someone else's burn under their own wallet.
 */
export function verifyBurn(tx: BurnTxEvidence, route: BurnRoute, opts: { nowSeconds: number; maxAgeSeconds: number; claimedWallet?: string }): BurnRecord {
  if (tx.status !== 'success') throw new BurnError(422, 'That transaction did not go through, so nothing was burned.');
  if (!tx.to || getAddress(tx.to) !== getAddress(route.router)) throw new BurnError(422, 'That transaction was not sent to the buy & burn router.');
  const wallet = getAddress(tx.from);
  if (opts.claimedWallet && getAddress(opts.claimedWallet) !== wallet) throw new BurnError(403, 'That burn was sent by a different wallet.');
  if (tx.timestamp > opts.nowSeconds + 600) throw new BurnError(422, 'That transaction’s time is in the future.');
  if (opts.nowSeconds - tx.timestamp > opts.maxAgeSeconds) throw new BurnError(422, 'That burn is too old to add now.');
  const decoded = decodeBurnCalldata(tx.input, route);
  if (!decoded) throw new BurnError(422, 'That transaction is not a Sprout buy & burn.');
  if (decoded.recipient !== getAddress(DEAD_ADDRESS)) throw new BurnError(422, 'That transaction sends the SPROUT somewhere other than the dead address.');

  const sprout = getAddress(route.sprout);
  const usdg = getAddress(route.usdg);
  const poolManager = getAddress(route.poolManager);
  const dead = getAddress(DEAD_ADDRESS);
  let sproutBurned = 0n;
  let usdgIn = 0n;
  for (const log of tx.logs) {
    const token = getAddress(log.address);
    if (token !== sprout && token !== usdg) continue;
    let args: { from: Address; to: Address; value: bigint };
    try {
      const ev = decodeEventLog({ abi: transferAbi, data: log.data, topics: log.topics as [Hex, ...Hex[]] });
      args = ev.args as typeof args;
    } catch {
      continue; // an Approval or another event of the same token
    }
    const from = getAddress(args.from);
    const to = getAddress(args.to);
    if (token === sprout) {
      if (from === wallet) throw new BurnError(422, 'That transaction also moved SPROUT from the wallet; only SPROUT bought in it counts.');
      if (from === poolManager && to === dead) sproutBurned += args.value;
    } else if (from === wallet) {
      usdgIn += args.value;
    }
  }
  if (sproutBurned === 0n) throw new BurnError(422, 'No SPROUT reached the dead address in that transaction.');
  if (usdgIn === 0n) throw new BurnError(422, 'That transaction spent no USDG from the wallet.');
  return { txHash: tx.hash.toLowerCase() as Hex, chainId: route.chainId, wallet, sproutBurned, usdgIn, blockNumber: Number(tx.blockNumber), burnedAt: tx.timestamp };
}

// ---------------------------------------------------------------------------
// Storage

const BURN_TABLE = `
CREATE TABLE IF NOT EXISTS sprout_burns (
  tx_hash TEXT PRIMARY KEY,
  chain_id INTEGER NOT NULL,
  wallet TEXT NOT NULL,
  sprout_burned TEXT NOT NULL,
  usdg_in TEXT NOT NULL,
  block_number INTEGER NOT NULL,
  burned_at INTEGER NOT NULL,
  recorded_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS sprout_burns_recent ON sprout_burns (chain_id, burned_at DESC);
`;

interface BurnRow {
  tx_hash: string;
  chain_id: number;
  wallet: string;
  sprout_burned: string;
  usdg_in: string;
  block_number: number;
  burned_at: number;
}

const fromRow = (r: BurnRow): BurnRecord => ({
  txHash: r.tx_hash as Hex,
  chainId: r.chain_id,
  wallet: getAddress(r.wallet),
  sproutBurned: BigInt(r.sprout_burned),
  usdgIn: BigInt(r.usdg_in),
  blockNumber: r.block_number,
  burnedAt: r.burned_at,
});

export function ensureBurnTable(db: SproutDb): void {
  db.exec(BURN_TABLE);
}

/** Records a burn once. Returns false when the transaction is already recorded. */
export function insertBurn(db: SproutDb, rec: BurnRecord, recordedAt: number): boolean {
  const res = db.run(
    'INSERT OR IGNORE INTO sprout_burns (tx_hash, chain_id, wallet, sprout_burned, usdg_in, block_number, burned_at, recorded_at) VALUES (?,?,?,?,?,?,?,?)',
    [rec.txHash.toLowerCase(), rec.chainId, rec.wallet, rec.sproutBurned.toString(), rec.usdgIn.toString(), rec.blockNumber, rec.burnedAt, recordedAt],
  );
  return res.changes > 0;
}

export function getBurn(db: SproutDb, txHash: string): BurnRecord | null {
  const row = db.query<BurnRow, [string]>('SELECT * FROM sprout_burns WHERE tx_hash = ?').get(txHash.toLowerCase());
  return row ? fromRow(row) : null;
}

export interface BurnTotals {
  count: number;
  sproutBurned: bigint;
  usdgSpent: bigint;
  latest: BurnRecord[];
}

/** Totals over every recorded burn on the chain, plus the newest `latest`. Amounts are summed exactly. */
export function burnTotals(db: SproutDb, chainId: number, latest = 10): BurnTotals {
  let sproutBurned = 0n;
  let usdgSpent = 0n;
  let count = 0;
  for (const r of db.query<{ sprout_burned: string; usdg_in: string }, [number]>('SELECT sprout_burned, usdg_in FROM sprout_burns WHERE chain_id = ?').iterate(chainId)) {
    sproutBurned += BigInt(r.sprout_burned);
    usdgSpent += BigInt(r.usdg_in);
    count++;
  }
  const rows = db
    .query<BurnRow, [number, number]>('SELECT * FROM sprout_burns WHERE chain_id = ? ORDER BY burned_at DESC, block_number DESC, tx_hash LIMIT ?')
    .all(chainId, latest);
  return { count, sproutBurned, usdgSpent, latest: rows.map(fromRow) };
}

// ---------------------------------------------------------------------------
// Public views

/** "0x1234…abcd". */
export function shortWallet(address: string): string {
  const a = getAddress(address);
  return `${a.slice(0, 6)}…${a.slice(-4)}`;
}

export interface BurnView {
  wallet: string;
  sprout: string;
  usdg: string;
  tx: Hex;
  at: number;
}

const view = (r: BurnRecord): BurnView => ({ wallet: shortWallet(r.wallet), sprout: r.sproutBurned.toString(), usdg: r.usdgIn.toString(), tx: r.txHash, at: r.burnedAt });

export type BurnSummary =
  | { enabled: false }
  | {
      enabled: true;
      token: Address;
      decimals: number;
      usdgDecimals: number;
      deadAddress: Address;
      /** Burns recorded through Sprout. */
      count: number;
      sproutBurned: string;
      usdgSpent: string;
      latest: BurnView[];
      /** Every SPROUT at the dead address, from anyone (null if unreadable just now). */
      deadBalance: string | null;
      asOf: number;
    };

export function summaryFrom(totals: BurnTotals, route: BurnRoute, deadBalance: bigint | null, asOf: number): BurnSummary {
  return {
    enabled: true,
    token: route.sprout,
    decimals: route.sproutDecimals,
    usdgDecimals: route.usdgDecimals,
    deadAddress: DEAD_ADDRESS,
    count: totals.count,
    sproutBurned: totals.sproutBurned.toString(),
    usdgSpent: totals.usdgSpent.toString(),
    latest: totals.latest.map(view),
    deadBalance: deadBalance === null ? null : deadBalance.toString(),
    asOf,
  };
}

// ---------------------------------------------------------------------------
// Service: chain reads, cached

/** The reads a burn needs; a viem PublicClient satisfies it. */
export type BurnChainClient = Pick<PublicClient, 'getTransactionReceipt' | 'getTransaction' | 'getBlock' | 'readContract'>;

export interface BurnQuoteView {
  usdgIn: string;
  ethMid: string;
  sproutOut: string;
  /** The floor the browser will sign with (sproutOut less slippageBps). */
  minSproutOut: string;
  slippageBps: number;
  quotedAt: number;
}

export interface BurnService {
  config: BurnConfig;
  publicConfig(explorerUrl?: string): Record<string, unknown>;
  quote(usdgIn: bigint): Promise<BurnQuoteView>;
  record(txHash: Hex, claimedWallet?: string): Promise<{ burn: BurnView; recorded: boolean }>;
  summary(): Promise<BurnSummary>;
}

const QUOTE_TTL_MS = 10_000;
const SUMMARY_TTL_MS = 15_000;
const DEAD_BALANCE_TTL_MS = 60_000;

export function createBurnService(input: { db: SproutDb; client: BurnChainClient | null; config: BurnConfig; now?: () => number }): BurnService {
  const { db, config } = input;
  const now = input.now ?? Date.now;
  const cache = createReadCache(now);
  if (config.enabled) ensureBurnTable(db);
  const route = config.route;
  const client = input.client;

  function live(): { route: BurnRoute; client: BurnChainClient } {
    if (!config.enabled || !route) throw new BurnError(404, 'Buy & burn is not switched on here.');
    if (!client) throw new BurnError(503, 'The chain can’t be read right now. Try again shortly.');
    return { route, client };
  }

  async function deadBalance(): Promise<bigint | null> {
    const { route, client } = live();
    try {
      return await cache.get('dead', DEAD_BALANCE_TTL_MS, async () =>
        (await client.readContract({ address: route.sprout, abi: erc20Abi, functionName: 'balanceOf', args: [DEAD_ADDRESS] })) as bigint,
      );
    } catch {
      return null;
    }
  }

  return {
    config,
    publicConfig(explorerUrl) {
      if (!config.enabled || !route) return { enabled: false };
      return {
        enabled: true,
        chainId: route.chainId,
        route,
        deadAddress: DEAD_ADDRESS,
        slippageBps: config.slippageBps,
        minUsd: config.minUsd,
        maxUsd: config.maxUsd,
        presets: BURN_PRESETS_USD,
        explorerUrl: explorerUrl ?? null,
      };
    },

    async quote(usdgIn) {
      const { route, client } = live();
      return cache.get(`quote:${usdgIn}`, QUOTE_TTL_MS, async () => {
        let q;
        try {
          q = await quoteBurn(client as never, route, usdgIn);
        } catch {
          throw new BurnError(503, 'Couldn’t get a price from the pool just now. Try again in a moment.');
        }
        if (q.sproutOut <= 0n) throw new BurnError(503, 'The pool returned no SPROUT for that amount.');
        return {
          usdgIn: usdgIn.toString(),
          ethMid: q.ethMid.toString(),
          sproutOut: q.sproutOut.toString(),
          minSproutOut: minOutFor(q.sproutOut, config.slippageBps).toString(),
          slippageBps: config.slippageBps,
          quotedAt: Math.floor(now() / 1000),
        };
      });
    },

    async record(txHash, claimedWallet) {
      const { route, client } = live();
      const existing = getBurn(db, txHash);
      if (existing) {
        if (claimedWallet && getAddress(claimedWallet) !== existing.wallet) throw new BurnError(403, 'That burn was sent by a different wallet.');
        return { burn: view(existing), recorded: false };
      }
      let evidence: BurnTxEvidence;
      try {
        const receipt = await client.getTransactionReceipt({ hash: txHash });
        const [tx, block] = await Promise.all([client.getTransaction({ hash: txHash }), client.getBlock({ blockNumber: receipt.blockNumber })]);
        evidence = {
          hash: txHash,
          status: receipt.status,
          from: receipt.from,
          to: receipt.to,
          input: tx.input,
          blockNumber: receipt.blockNumber,
          timestamp: Number(block.timestamp),
          logs: receipt.logs,
        };
      } catch (error) {
        const name = (error as { name?: string })?.name ?? '';
        if (/NotFound/i.test(name)) throw new BurnError(409, 'That transaction isn’t confirmed yet. Try again in a few seconds.');
        throw new BurnError(503, 'The chain can’t be read right now. Try again shortly.');
      }
      const rec = verifyBurn(evidence, route, { nowSeconds: Math.floor(now() / 1000), maxAgeSeconds: config.maxAgeSeconds, claimedWallet });
      const recorded = insertBurn(db, rec, Math.floor(now() / 1000));
      if (recorded) {
        // The counter's two numbers move together: re-read the dead address's balance too.
        cache.invalidate('summary');
        cache.invalidate('dead');
      }
      return { burn: view(getBurn(db, rec.txHash) ?? rec), recorded };
    },

    async summary() {
      if (!config.enabled || !route) return { enabled: false };
      return cache.get('summary', SUMMARY_TTL_MS, async () => {
        const dead = client ? await deadBalance() : null;
        return summaryFrom(burnTotals(db, route.chainId), route, dead, Math.floor(now() / 1000));
      });
    },
  };
}

// ---------------------------------------------------------------------------
// Rate limits

/**
 * Fixed-window request counts per key, in memory. A client's key is the first
 * X-Forwarded-For hop, which a client can vary, so every limited route also has
 * one global window that bounds the chain reads the server can be made to do.
 */
export function createWindowLimiter(max: number, windowMs: number, now: () => number = Date.now) {
  const windows = new Map<string, { start: number; count: number }>();
  return (key: string): boolean => {
    const at = now();
    if (windows.size > 5_000) for (const [k, w] of windows) if (at - w.start >= windowMs) windows.delete(k);
    const w = windows.get(key);
    if (!w || at - w.start >= windowMs) {
      windows.set(key, { start: at, count: 1 });
      return true;
    }
    if (w.count >= max) return false;
    w.count++;
    return true;
  };
}

function clientKey(c: Context): string {
  const forwarded = c.req.header('x-forwarded-for')?.split(',')[0]?.trim();
  return forwarded || c.req.header('x-real-ip')?.trim() || 'direct';
}

// ---------------------------------------------------------------------------
// Routes

export function registerBurnRoutes(app: Hono, deps: { service: BurnService; explorerUrl?: string; now?: () => number }): void {
  const { service } = deps;
  const now = deps.now ?? Date.now;
  const perClient = { quote: createWindowLimiter(40, 60_000, now), record: createWindowLimiter(12, 60_000, now) };
  const global = { quote: createWindowLimiter(300, 60_000, now), record: createWindowLimiter(120, 60_000, now) };
  const limited = (c: Context, kind: 'quote' | 'record') => {
    if (!perClient[kind](clientKey(c)) || !global[kind]('all')) throw new BurnError(429, 'Too many requests. Wait a minute and try again.');
  };
  const fail = (c: Context, error: unknown) => {
    if (error instanceof BurnError) return c.json({ error: error.message }, error.status);
    throw error;
  };

  app.use('/api/burns', bodyLimit({ maxSize: 1024, onError: (c) => c.json({ error: 'Request too large.' }, 413) }));

  app.get('/api/burns/config', (c) => c.json(service.publicConfig(deps.explorerUrl)));

  app.get('/api/burns/summary', async (c) => c.json(await service.summary()));

  app.get('/api/burns/quote', async (c) => {
    try {
      if (!service.config.enabled || !service.config.route) throw new BurnError(404, 'Buy & burn is not switched on here.');
      const usdgIn = parseBurnUsd(c.req.query('usd') ?? '', service.config.route.usdgDecimals, service.config.minUsd, service.config.maxUsd);
      if (usdgIn === null) throw new BurnError(400, `Pick an amount from $${service.config.minUsd} to $${service.config.maxUsd}.`);
      limited(c, 'quote');
      return c.json(await service.quote(usdgIn));
    } catch (error) {
      return fail(c, error);
    }
  });

  app.post('/api/burns', async (c) => {
    try {
      if (!service.config.enabled) throw new BurnError(404, 'Buy & burn is not switched on here.');
      let body: unknown;
      try {
        body = await c.req.json();
      } catch {
        throw new BurnError(400, 'invalid JSON body');
      }
      const parsed = z.object({ txHash: hashSchema, wallet: addressSchema.optional() }).strict().safeParse(body);
      if (!parsed.success) throw new BurnError(400, 'Send the transaction hash of a buy & burn.');
      limited(c, 'record');
      const result = await service.record(parsed.data.txHash.toLowerCase() as Hex, parsed.data.wallet);
      return c.json(result, result.recorded ? 201 : 200);
    } catch (error) {
      return fail(c, error);
    }
  });
}
