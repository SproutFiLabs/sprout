import type { Hono } from 'hono';
import { decodeFunctionResult, encodeFunctionData, multicall3Abi, parseAbi, type Address, type Hex } from 'viem';
import { mockPriceFeedAbi, type StockTokenConfig } from '@sprout/shared';
import type { SproutDb } from './db';
import { READ_TTL, chainCache, requirePublic, type ChainContext } from './chain';
import { FOREVER_MS } from './readCache';

/**
 * Price history for the stock guide, read from the stocks' own on-chain price
 * feeds: the same Chainlink feeds Sprout values sprouts with.
 *
 * A Chainlink feed keeps every price it has ever published as a numbered round
 * (`getRoundData`), so the history is the feed's own record, not a separate
 * price service and never an estimate. Rounds never change once written, so
 * each one is read once and kept in SQLite; later requests only read the rounds
 * published since. A feed without round history (the local demo's mock feed)
 * contributes only the rounds this server has seen as its latest.
 *
 * Round ids are Chainlink proxy ids: (phase << 64) | round within the phase.
 * Only the current phase is walked back; rounds already stored from an earlier
 * phase are kept and still shown.
 *
 * This module owns its table (created on first use) so it does not touch the
 * shared schema in db.ts.
 */

export const feedRoundAbi = parseAbi([
  'function getRoundData(uint80 roundId) view returns (uint80 roundId, int256 answer, uint256 startedAt, uint256 updatedAt, uint80 answeredInRound)',
]);

/** How long a history is served from memory before new rounds are read. */
export const HISTORY_TTL_MS = 5 * 60_000;
/** A history that could not be read in full is retried sooner. */
export const HISTORY_RETRY_MS = 30_000;
/** Rounds per Multicall3 request (1,000 measured fine on every Robinhood Chain RPC). */
export const ROUNDS_PER_CALL = 500;
/** Multicall requests one load may make; the rest of a long backfill waits for the next load. */
export const MAX_CALLS_PER_LOAD = 40;
/** Without Multicall3 each round is its own request, so read far fewer. */
export const MAX_ROUNDS_WITHOUT_MULTICALL = 120;

const SCHEMA = `
CREATE TABLE IF NOT EXISTS feed_rounds (
  chain_id INTEGER NOT NULL,
  feed TEXT NOT NULL,
  phase INTEGER NOT NULL,
  agg_round INTEGER NOT NULL,
  answer TEXT NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (chain_id, feed, phase, agg_round)
);
CREATE INDEX IF NOT EXISTS idx_feed_rounds_time ON feed_rounds(chain_id, feed, updated_at);
`;

const ready = new WeakSet<SproutDb>();
function ensureSchema(db: SproutDb): void {
  if (ready.has(db)) return;
  db.exec(SCHEMA);
  ready.add(db);
}

const PHASE_SHIFT = 64n;
const ROUND_MASK = (1n << PHASE_SHIFT) - 1n;

export function splitRoundId(roundId: bigint): { phase: number; round: number } {
  return { phase: Number(roundId >> PHASE_SHIFT), round: Number(roundId & ROUND_MASK) };
}

export function joinRoundId(phase: number, round: number): bigint {
  return (BigInt(phase) << PHASE_SHIFT) | BigInt(round);
}

interface Round {
  phase: number;
  round: number;
  answer: bigint;
  updatedAt: number;
}

type RoundTuple = readonly [bigint, bigint, bigint, bigint, bigint];

/** A round Sprout would also accept as a price: answered, positive, timestamped. */
function validRound(requested: bigint, data: RoundTuple): Round | null {
  const [roundId, answer, , updatedAt, answeredInRound] = data;
  if (roundId !== requested || answer <= 0n || updatedAt === 0n || answeredInRound < roundId) return null;
  return { ...splitRoundId(roundId), answer, updatedAt: Number(updatedAt) };
}

/** Rounds `from`..`to` (inclusive) of one phase. Missing or invalid rounds are left out. */
async function readRounds(ctx: ChainContext, feed: Address, phase: number, from: number, to: number): Promise<Round[]> {
  const client = requirePublic(ctx);
  const ids: bigint[] = [];
  for (let r = from; r <= to; r++) ids.push(joinRoundId(phase, r));
  const multicall3 = ctx.config.chain.multicall3;
  if (multicall3) {
    // aggregate3 calls are never re-batched by the client, so this is one request.
    const results = (await client.readContract({
      address: multicall3,
      abi: multicall3Abi,
      functionName: 'aggregate3',
      args: [ids.map((id) => ({ target: feed, allowFailure: true, callData: encodeFunctionData({ abi: feedRoundAbi, functionName: 'getRoundData', args: [id] }) }))],
    })) as ReadonlyArray<{ success: boolean; returnData: Hex }>;
    return results.flatMap((r, i) => {
      if (!r.success || r.returnData === '0x') return [];
      try {
        const data = decodeFunctionResult({ abi: feedRoundAbi, functionName: 'getRoundData', data: r.returnData }) as RoundTuple;
        const round = validRound(ids[i]!, data);
        return round ? [round] : [];
      } catch {
        return [];
      }
    });
  }
  const rounds: Round[] = [];
  for (const id of ids) {
    try {
      const data = (await client.readContract({ address: feed, abi: feedRoundAbi, functionName: 'getRoundData', args: [id] })) as RoundTuple;
      const round = validRound(id, data);
      if (round) rounds.push(round);
    } catch {
      // not a round (or no round history at all)
    }
  }
  return rounds;
}

export interface DailyClose {
  /** UTC calendar day, YYYY-MM-DD. */
  date: string;
  /** The last price the feed published that day, in dollars. */
  price: number;
  /** When that price was published (unix seconds). */
  at: number;
}

export interface StockHistory {
  symbol: string;
  feed: Address;
  feedDecimals: number;
  /** Where the prices come from. */
  source: 'price-feed-rounds';
  /** Rounds the history is built from, and the time span they cover (unix seconds). */
  rounds: number;
  /** Oldest rounds left out because the feed wrote them in a different unit (see SCALE_BREAK). */
  otherUnitRounds: number;
  firstAt: number | null;
  lastAt: number | null;
  /** The last price of each UTC day that has one, oldest first. */
  days: DailyClose[];
  /** The feed's newest price, which may be days old when markets are closed. */
  latest: { price: number; updatedAt: number } | null;
  /** False while older rounds are still being read (or could not be): the history may start later than the feed does. */
  complete: boolean;
}

function toDollars(answer: bigint, decimals: number): number {
  return Number(answer) / 10 ** decimals;
}

function storeRounds(db: SproutDb, chainId: number, feed: string, rounds: Round[]): void {
  if (rounds.length === 0) return;
  const insert = db.prepare(
    'INSERT OR IGNORE INTO feed_rounds (chain_id, feed, phase, agg_round, answer, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
  );
  db.transaction((rows: Round[]) => {
    for (const r of rows) insert.run(chainId, feed, r.phase, r.round, r.answer.toString(), r.updatedAt);
  })(rounds);
}

/**
 * A jump this large between neighbouring rounds is not a price move but a
 * change in how the feed writes prices: the Robinhood Chain stock feeds
 * published their first day of rounds scaled 10^8 times larger than today's
 * 8-decimal answers. Rounds from before such a change are in another unit.
 */
export const SCALE_BREAK = 1_000;

/**
 * How many of the oldest rounds (oldest first) are in a different unit from
 * the newest one: everything before the most recent scale break.
 */
export function roundsBeforeScaleBreak(rows: ReadonlyArray<{ answer: string }>): number {
  for (let i = rows.length - 1; i > 0; i--) {
    const newer = BigInt(rows[i]!.answer);
    const older = BigInt(rows[i - 1]!.answer);
    if (older > newer * BigInt(SCALE_BREAK) || newer > older * BigInt(SCALE_BREAK)) return i;
  }
  return 0;
}

/** Group rounds (oldest first, all in the feed's current unit) into one closing price per UTC day. */
export function dailyCloses(rows: ReadonlyArray<{ answer: string; updated_at: number }>, decimals: number): DailyClose[] {
  const days: DailyClose[] = [];
  for (const row of rows) {
    const date = new Date(row.updated_at * 1000).toISOString().slice(0, 10);
    const point = { date, price: toDollars(BigInt(row.answer), decimals), at: row.updated_at };
    if (days.length && days[days.length - 1]!.date === date) days[days.length - 1] = point;
    else days.push(point);
  }
  return days;
}

/**
 * Read any rounds not stored yet, newest first: first those published since the
 * newest stored round, then older ones down to the start of the phase. Returns
 * whether everything that exists was read.
 */
async function backfill(ctx: ChainContext, db: SproutDb, feed: Address, latest: Round): Promise<boolean> {
  const chainId = ctx.config.chain.chainId;
  const key = feed.toLowerCase();
  const cache = chainCache(ctx);
  const floorKey = `price-history:${key}:${latest.phase}:floor`;
  const stored = db
    .query<{ lo: number | null; hi: number | null }, [number, string, number, number]>(
      'SELECT MIN(agg_round) AS lo, MAX(agg_round) AS hi FROM feed_rounds WHERE chain_id = ? AND feed = ? AND phase = ? AND agg_round < ?',
    )
    .get(chainId, key, latest.phase, latest.round);
  // The lowest round worth asking for: 1, until walking back finds nothing older.
  const floor = cache.peek<number>(floorKey) ?? 1;
  // Newest first: rounds published since the newest stored one, then older ones.
  // The latest round itself is already stored.
  const ranges: Array<{ from: number; to: number; older: boolean }> =
    stored?.hi == null || stored.lo == null
      ? [{ from: floor, to: latest.round - 1, older: true }]
      : [
          { from: stored.hi + 1, to: latest.round - 1, older: false },
          { from: floor, to: stored.lo - 1, older: true },
        ];
  const multicall = Boolean(ctx.config.chain.multicall3);
  const chunk = multicall ? ROUNDS_PER_CALL : MAX_ROUNDS_WITHOUT_MULTICALL;
  let calls = multicall ? MAX_CALLS_PER_LOAD : 1;
  for (const range of ranges) {
    let top = range.to;
    while (top >= range.from) {
      if (calls === 0) return false;
      calls -= 1;
      const bottom = Math.max(range.from, top - chunk + 1);
      const rounds = await readRounds(ctx, feed, latest.phase, bottom, top);
      storeRounds(db, chainId, key, rounds);
      if (rounds.length === 0) {
        // Walking back found nothing: the feed keeps no round history (a mock
        // feed), or its history starts above this chunk. Don't ask again.
        if (range.older) cache.set(floorKey, top + 1, FOREVER_MS);
        break;
      }
      top = bottom - 1;
    }
  }
  return true;
}

async function loadHistory(ctx: ChainContext, db: SproutDb, token: StockTokenConfig): Promise<StockHistory> {
  ensureSchema(db);
  const client = requirePublic(ctx);
  const feed = token.feedAddress!;
  const key = feed.toLowerCase();
  const chainId = ctx.config.chain.chainId;
  const cache = chainCache(ctx);
  // Same cache keys as the holdings read, so the two share these reads.
  const decimals = await cache.get(`feed:${key}:decimals`, FOREVER_MS, async () =>
    Number(await client.readContract({ address: feed, abi: mockPriceFeedAbi, functionName: 'decimals' })),
  );
  // A paused feed or a failing RPC still leaves the rounds already stored to show.
  const latestData = await cache
    .get(`feed:${key}:round`, READ_TTL.feedRound, () =>
      client.readContract({ address: feed, abi: mockPriceFeedAbi, functionName: 'latestRoundData' }) as Promise<RoundTuple>,
    )
    .catch(() => null);
  const latest = latestData ? validRound(latestData[0], latestData) : null;
  let complete = latestData !== null;
  if (latest) {
    storeRounds(db, chainId, key, [latest]);
    try {
      complete = await backfill(ctx, db, feed, latest);
    } catch {
      // Keep what was stored; the next load carries on from there.
      complete = false;
    }
  }
  const stored = db
    .query<{ answer: string; updated_at: number }, [number, string]>(
      'SELECT answer, updated_at FROM feed_rounds WHERE chain_id = ? AND feed = ? ORDER BY updated_at ASC, phase ASC, agg_round ASC',
    )
    .all(chainId, key);
  if (stored.length === 0 && latestData === null) throw new Error('price feed unreadable and nothing stored yet');
  const skipped = roundsBeforeScaleBreak(stored);
  const rows = stored.slice(skipped);
  return {
    symbol: token.symbol,
    feed,
    feedDecimals: decimals,
    source: 'price-feed-rounds',
    rounds: rows.length,
    otherUnitRounds: skipped,
    firstAt: rows[0]?.updated_at ?? null,
    lastAt: rows[rows.length - 1]?.updated_at ?? null,
    days: dailyCloses(rows, decimals),
    latest: latest ? { price: toDollars(latest.answer, decimals), updatedAt: latest.updatedAt } : null,
    complete,
  };
}

/** A stock's price history, shared by every visitor for HISTORY_TTL_MS. */
export async function stockHistory(ctx: ChainContext, db: SproutDb, token: StockTokenConfig): Promise<StockHistory> {
  const cache = chainCache(ctx);
  const cacheKey = `price-history:${token.feedAddress!.toLowerCase()}`;
  const history = await cache.get(cacheKey, HISTORY_TTL_MS, () => loadHistory(ctx, db, token));
  if (!history.complete && cache.peek(cacheKey) === history) cache.set(cacheKey, history, HISTORY_RETRY_MS);
  return history;
}

interface Logger {
  warn: (msg: string, meta?: unknown) => void;
}

export function registerStockPriceRoutes(app: Hono, deps: { db: SproutDb; chain: ChainContext }, logger: Logger = console): void {
  app.get('/api/stocks/:symbol/history', async (c) => {
    const symbol = c.req.param('symbol').toUpperCase();
    if (!/^[A-Z0-9.]{1,12}$/.test(symbol)) return c.json({ error: 'invalid symbol' }, 400);
    const token = deps.chain.config.chain.contracts.stockTokens.find((s) => s.symbol.toUpperCase() === symbol);
    // Not an error: this server's chain has no feed for it (the local demo has only mock tokens).
    if (!token?.feedAddress) return c.json({ symbol, available: false, reason: 'no price feed for this stock here' });
    requirePublic(deps.chain);
    try {
      return c.json({ available: true, ...(await stockHistory(deps.chain, deps.db, token)) });
    } catch (error) {
      logger.warn('price history failed', error instanceof Error ? error.message.slice(0, 200) : String(error));
      return c.json({ error: 'price history unavailable right now' }, 503);
    }
  });
}
