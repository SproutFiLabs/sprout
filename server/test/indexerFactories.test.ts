import { describe, expect, test } from 'bun:test';
import { Database } from 'bun:sqlite';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { encodeAbiParameters, encodeEventTopics } from 'viem';
import { sproutFactoryAbi, sproutVaultAbi } from '@sprout/shared';
import type { ChainContext } from '../src/chain';
import { loadServerConfig } from '../src/config';
import { openDb, type SproutDb } from '../src/db';
import { readHoldings } from '../src/chain';
import { reconcile, snapshotAll } from '../src/indexer';
import { getCursor, getFactoryCursor, getSprout, listChainEvents, listSnapshots, upsertSprout } from '../src/repo';
import { memoryDb } from './helpers';

const NEW_FACTORY = '0x00000000000000000000000000000000000000aa';
const NEW_VENUE = '0x00000000000000000000000000000000000000bb';
const OLD_FACTORY = '0x00000000000000000000000000000000000000a1';
const OLD_VENUE = '0x00000000000000000000000000000000000000b1';
const SETTLEMENT = '0x00000000000000000000000000000000000000c2';
const STOCK_A = '0x0000000000000000000000000000000000000d01';
const STOCK_B = '0x0000000000000000000000000000000000000d02';
const FEED = '0x00000000000000000000000000000000000000f1';
const OLD_VAULT = '0x0000000000000000000000000000000000000e01';
const NEW_VAULT = '0x0000000000000000000000000000000000000e02';
const PARENT = '0x0000000000000000000000000000000000000f0a';
const KID = '0x0000000000000000000000000000000000000f0b';

type AnyAbi = typeof sproutFactoryAbi | typeof sproutVaultAbi;

interface FakeLog {
  address: string;
  topics: readonly `0x${string}`[];
  data: `0x${string}`;
  blockNumber: bigint;
  logIndex: number;
  transactionHash: `0x${string}`;
}

function log(address: string, abi: AnyAbi, eventName: string, args: Record<string, unknown>, blockNumber: number): FakeLog {
  const event = (abi as readonly { type: string; name?: string; inputs?: readonly { name: string; type: string; indexed?: boolean }[] }[]).find(
    (e) => e.type === 'event' && e.name === eventName,
  )!;
  const topics = encodeEventTopics({ abi, eventName, args } as never) as `0x${string}`[];
  const unindexed = event.inputs!.filter((i) => !i.indexed);
  const data = encodeAbiParameters(unindexed as never, unindexed.map((i) => args[i.name]) as never);
  return { address, topics, data, blockNumber: BigInt(blockNumber), logIndex: 0, transactionHash: `0x${blockNumber.toString(16).padStart(64, '0')}` };
}

const created = (factory: string, vault: string, block: number) =>
  log(factory, sproutFactoryAbi, 'SproutCreated', { vault, parent: PARENT, beneficiary: KID, settlementToken: SETTLEMENT, graduationTimestamp: 2_000_000_000n }, block);
const funded = (vault: string, block: number) => log(vault, sproutVaultAbi, 'Funded', { from: PARENT, token: SETTLEMENT, amount: 5_000_000n }, block);

function env(current: { factory: string; venue: string; start: number }, legacy?: string): Record<string, string> {
  return {
    SPROUT_CHAIN_ID: '4663',
    SPROUT_RPC_URL: 'https://rpc.example.invalid',
    SPROUT_FACTORY_ADDRESS: current.factory,
    SPROUT_SETTLEMENT_TOKEN: SETTLEMENT,
    SPROUT_VENUE_ADDRESS: current.venue,
    SPROUT_STOCK_TOKENS: `AAA:${STOCK_A}:18:1000000000000000000:${FEED}`,
    SPROUT_START_BLOCK: String(current.start),
    SPROUT_MAX_LOG_RANGE: '1000',
    ...(legacy ? { SPROUT_LEGACY_DEPLOYMENTS: legacy } : {}),
  };
}

/** A chain holding `logs`; getLogs honours the address list and block range and records each query. */
function chain(envVars: Record<string, string>, logs: FakeLog[], head: number) {
  const queries: Array<{ addresses: string[]; from: number; to: number }> = [];
  const publicClient = {
    getBlockNumber: async () => BigInt(head),
    getLogs: async ({ address, fromBlock, toBlock }: { address: string[]; fromBlock: bigint; toBlock: bigint }) => {
      const addresses = address.map((a) => a.toLowerCase());
      queries.push({ addresses, from: Number(fromBlock), to: Number(toBlock) });
      return logs.filter(
        (l) => addresses.includes(l.address.toLowerCase()) && l.blockNumber >= fromBlock && l.blockNumber <= toBlock,
      );
    },
    readContract: async ({ functionName }: { functionName: string }) =>
      ({ parent: PARENT, beneficiary: KID, settlementToken: SETTLEMENT, graduationTimestamp: 2_000_000_000n, assets: [STOCK_A], weights: [10000], graduated: false })[
        functionName
      ],
  };
  const ctx = {
    config: loadServerConfig(envVars),
    publicClient,
    walletClient: null,
    walletAddress: null,
    walletIsAnvilDev: false,
  } as unknown as ChainContext;
  return { ctx, queries, setHead: (n: number) => (head = n) };
}

const names = (db: SproutDb, vault: string) => listChainEvents(db, vault).map((e) => `${e.eventName}@${e.blockNumber}`);

describe('indexing the current factory and legacy factories', () => {
  test('a fresh database reads both factories from the earliest start block, in one query per range', async () => {
    const db = memoryDb();
    const logs = [
      created(OLD_FACTORY, OLD_VAULT, 1100),
      funded(OLD_VAULT, 1200),
      log(OLD_VAULT, sproutVaultAbi, 'AllocationUpdated', { assets: [STOCK_A, STOCK_B], weights: [4000, 6000] }, 1300),
      created(NEW_FACTORY, NEW_VAULT, 2100),
      funded(NEW_VAULT, 2200),
      funded(OLD_VAULT, 2300),
    ];
    const { ctx, queries } = chain(env({ factory: NEW_FACTORY, venue: NEW_VENUE, start: 2000 }, `${OLD_FACTORY}:${OLD_VENUE}:1000`), logs, 2500);

    const result = await reconcile(ctx, db, {});
    expect(result.fromBlock).toBe(1000);
    expect(result.sproutsIndexed).toBe(2);
    expect(result.backfilled).toEqual([]);
    // Both factories in every shared query (current first); discovered vaults follow up.
    expect(queries).toEqual([
      { addresses: [NEW_FACTORY, OLD_FACTORY], from: 1000, to: 1999 },
      { addresses: [OLD_VAULT], from: 1000, to: 1999 },
      { addresses: [NEW_FACTORY, OLD_FACTORY, OLD_VAULT], from: 2000, to: 2500 },
      { addresses: [NEW_VAULT], from: 2000, to: 2500 },
    ]);
    expect(getSprout(db, OLD_VAULT)?.factory).toBe(OLD_FACTORY);
    expect(getSprout(db, NEW_VAULT)?.factory).toBe(NEW_FACTORY);
    expect(names(db, OLD_VAULT)).toEqual(['SproutCreated@1100', 'Funded@1200', 'AllocationUpdated@1300', 'Funded@2300']);
    expect(names(db, NEW_VAULT)).toEqual(['SproutCreated@2100', 'Funded@2200']);
    // A changed allocation replaces the stored one.
    expect(getSprout(db, OLD_VAULT)?.assets).toEqual([STOCK_A, STOCK_B]);
    expect(getSprout(db, OLD_VAULT)?.weights).toEqual([4000, 6000]);
    expect(getCursor(db, 4663)).toBe(2500);
    expect(getFactoryCursor(db, 4663, NEW_FACTORY)).toBe(2500);
    expect(getFactoryCursor(db, 4663, OLD_FACTORY)).toBe(2500);
  });

  test('switching an existing database to a new factory backfills only the new one, from its own start block', async () => {
    // A database written before per-factory cursors: the old factory was the
    // only one, the sprouts table had no factory column, and the shared cursor is at 3000.
    const dir = mkdtempSync(join(tmpdir(), 'sprout-factories-'));
    const path = join(dir, 'sprout.sqlite');
    const legacyDb = new Database(path);
    legacyDb.exec(`
      CREATE TABLE sprouts (
        id TEXT PRIMARY KEY, chain_id INTEGER NOT NULL, parent TEXT NOT NULL, beneficiary TEXT NOT NULL,
        settlement_token TEXT NOT NULL, graduation_timestamp INTEGER NOT NULL, assets_json TEXT NOT NULL,
        weights_json TEXT NOT NULL, created_tx_hash TEXT, created_block INTEGER, created_at INTEGER NOT NULL
      );
      CREATE TABLE chain_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT, chain_id INTEGER NOT NULL, tx_hash TEXT NOT NULL, log_index INTEGER NOT NULL,
        block_number INTEGER NOT NULL, address TEXT NOT NULL, event_name TEXT NOT NULL, vault_id TEXT,
        payload_json TEXT NOT NULL, created_at INTEGER NOT NULL, UNIQUE(chain_id, tx_hash, log_index)
      );
      CREATE TABLE indexer_cursor (chain_id INTEGER PRIMARY KEY, last_block INTEGER NOT NULL DEFAULT 0, updated_at INTEGER NOT NULL);
    `);
    legacyDb
      .prepare('INSERT INTO sprouts VALUES (?, 4663, ?, ?, ?, 2000000000, ?, ?, ?, 1100, 1)')
      .run(OLD_VAULT, PARENT, KID, SETTLEMENT, JSON.stringify([STOCK_A]), JSON.stringify([10000]), `0x${(1100).toString(16).padStart(64, '0')}`);
    legacyDb
      .prepare("INSERT INTO chain_events (chain_id, tx_hash, log_index, block_number, address, event_name, vault_id, payload_json, created_at) VALUES (4663, ?, 0, 1100, ?, 'SproutCreated', ?, '{}', 1)")
      .run(`0x${(1100).toString(16).padStart(64, '0')}`, OLD_FACTORY, OLD_VAULT);
    legacyDb.prepare('INSERT INTO indexer_cursor VALUES (4663, 3000, 1)').run();
    legacyDb.close();

    // The migration adds the column and fills it from the indexed SproutCreated.
    const db = openDb(path);
    expect(getSprout(db, OLD_VAULT)?.factory).toBe(OLD_FACTORY);

    const logs = [
      created(OLD_FACTORY, OLD_VAULT, 1100),
      funded(OLD_VAULT, 1200),
      // The new factory was deployed at 2500 and planted a sprout before the server switched over.
      created(NEW_FACTORY, NEW_VAULT, 2600),
      funded(NEW_VAULT, 2700),
      funded(OLD_VAULT, 3100),
      funded(NEW_VAULT, 3200),
    ];
    const { ctx, queries, setHead } = chain(
      env({ factory: NEW_FACTORY, venue: NEW_VENUE, start: 2500 }, `${OLD_FACTORY}:${OLD_VENUE}:1000`),
      logs,
      3600,
    );
    const result = await reconcile(ctx, db, {});

    // Nothing before the shared cursor is read for the old factory or its vaults.
    for (const q of queries.filter((q) => q.from <= 3000)) {
      expect(q.addresses).not.toContain(OLD_FACTORY);
      expect(q.addresses).not.toContain(OLD_VAULT);
    }
    expect(queries).toEqual([
      { addresses: [NEW_FACTORY], from: 2500, to: 3000 },
      { addresses: [NEW_VAULT], from: 2500, to: 3000 },
      { addresses: [NEW_FACTORY, OLD_FACTORY, OLD_VAULT, NEW_VAULT], from: 3001, to: 3600 },
    ]);
    expect(result.backfilled).toEqual([{ factory: NEW_FACTORY, fromBlock: 2500, toBlock: 3000 }]);
    expect(result.fromBlock).toBe(3001);
    expect(getSprout(db, NEW_VAULT)?.factory).toBe(NEW_FACTORY);
    expect(names(db, NEW_VAULT)).toEqual(['SproutCreated@2600', 'Funded@2700', 'Funded@3200']);
    expect(names(db, OLD_VAULT)).toEqual(['SproutCreated@1100', 'Funded@3100']);
    expect(getCursor(db, 4663)).toBe(3600);
    expect(getFactoryCursor(db, 4663, OLD_FACTORY)).toBe(3600);
    expect(getFactoryCursor(db, 4663, NEW_FACTORY)).toBe(3600);

    // Caught up: later passes are one shared query again.
    queries.length = 0;
    setHead(3700);
    await reconcile(ctx, db, {});
    expect(queries).toEqual([{ addresses: [NEW_FACTORY, OLD_FACTORY, OLD_VAULT, NEW_VAULT], from: 3601, to: 3700 }]);
    db.close();
  });

  test('a backfill that fails part-way resumes where it stopped, and the shared pass waits for it', async () => {
    const db = memoryDb();
    // Old-factory history indexed with the previous configuration.
    const before = chain(env({ factory: OLD_FACTORY, venue: OLD_VENUE, start: 1000 }), [created(OLD_FACTORY, OLD_VAULT, 1100)], 5000);
    await reconcile(before.ctx, db, {});
    expect(getCursor(db, 4663)).toBe(5000);

    const logs = [created(OLD_FACTORY, OLD_VAULT, 1100), created(NEW_FACTORY, NEW_VAULT, 3500)];
    const after = chain(env({ factory: NEW_FACTORY, venue: NEW_VENUE, start: 2000 }, `${OLD_FACTORY}:${OLD_VENUE}:1000`), logs, 5200);
    const client = after.ctx.publicClient as unknown as { getLogs: (args: { address: string[]; fromBlock: bigint; toBlock: bigint }) => Promise<unknown> };
    const getLogs = client.getLogs;
    let failFrom: number | null = 3000;
    client.getLogs = async (args) => {
      if (failFrom !== null && Number(args.fromBlock) === failFrom) throw new Error('rate limited');
      return getLogs(args);
    };
    await expect(reconcile(after.ctx, db, {})).rejects.toThrow(/rate limited/);
    expect(getFactoryCursor(db, 4663, NEW_FACTORY)).toBe(2999);
    expect(getFactoryCursor(db, 4663, OLD_FACTORY)).toBe(5000);
    expect(getCursor(db, 4663)).toBe(5000);

    failFrom = null;
    after.queries.length = 0;
    const result = await reconcile(after.ctx, db, {});
    expect(after.queries[0]).toMatchObject({ addresses: [NEW_FACTORY], from: 3000 });
    expect(result.backfilled).toEqual([{ factory: NEW_FACTORY, fromBlock: 3000, toBlock: 5000 }]);
    expect(getSprout(db, NEW_VAULT)?.factory).toBe(NEW_FACTORY);
    expect(getCursor(db, 4663)).toBe(5200);
  });

  test('a single local factory with no legacy deployments indexes exactly as before', async () => {
    const db = memoryDb();
    const { ctx, queries, setHead } = chain(
      { ...env({ factory: NEW_FACTORY, venue: NEW_VENUE, start: 0 }), SPROUT_CHAIN_ID: '31337' },
      [created(NEW_FACTORY, NEW_VAULT, 5), funded(NEW_VAULT, 6)],
      50,
    );
    const result = await reconcile(ctx, db, {});
    expect(result.backfilled).toEqual([]);
    // As before: a fresh local database starts right after genesis.
    expect(queries).toEqual([
      { addresses: [NEW_FACTORY], from: 1, to: 50 },
      { addresses: [NEW_VAULT], from: 1, to: 50 },
    ]);
    expect(names(db, NEW_VAULT)).toEqual(['SproutCreated@5', 'Funded@6']);
    expect(getFactoryCursor(db, 31337, NEW_FACTORY)).toBe(50);

    queries.length = 0;
    setHead(60);
    expect((await reconcile(ctx, db, {})).backfilled).toEqual([]);
    expect(queries).toEqual([{ addresses: [NEW_FACTORY, NEW_VAULT], from: 51, to: 60 }]);
  });
});

describe('valuation with the full stock list configured', () => {
  const STOCK_C = '0x0000000000000000000000000000000000000d03';
  const FEED_STALE = '0x00000000000000000000000000000000000000f2';
  const NOW = 2_000_000_000;

  function valuationCtx(): ChainContext {
    const config = loadServerConfig({
      ...env({ factory: NEW_FACTORY, venue: NEW_VENUE, start: 2000 }, `${OLD_FACTORY}:${OLD_VENUE}:1000`),
      SPROUT_STOCK_TOKENS: [
        `AAA:${STOCK_A}:18:1000000000000000000:${FEED}:86400`,
        `BBB:${STOCK_B}:18:1000000000000000000:${FEED}:86400`,
        // Not held, and its feed is stale: must not make the total unknown.
        `CCC:${STOCK_C}:18:1000000000000000000:${FEED_STALE}:86400`,
      ].join(','),
    });
    const publicClient = {
      getBlock: async () => ({ number: 42n, timestamp: BigInt(NOW) }),
      getBlockNumber: async () => 42n,
      readContract: async ({ address, functionName }: { address: string; functionName: string }) => {
        const a = address.toLowerCase();
        switch (functionName) {
          case 'settlementToken':
            return SETTLEMENT;
          case 'decimals':
            // USDG 6, the stock tokens 18, the feeds 8.
            return a === SETTLEMENT ? 6 : a === FEED || a === FEED_STALE ? 8 : 18;
          case 'balanceOf':
            return a === SETTLEMENT ? 2_000_000n : a === STOCK_A ? 10n ** 18n : 0n;
          case 'uiMultiplier':
            return 10n ** 18n;
          case 'oraclePaused':
            return false;
          case 'latestRoundData':
            return [1n, 100n * 10n ** 8n, BigInt(NOW), BigInt(a === FEED_STALE ? NOW - 10 * 86400 : NOW - 60), 1n];
          default:
            throw new Error(`unexpected readContract ${functionName}`);
        }
      },
    };
    return { config, publicClient, walletClient: null, walletAddress: null, walletIsAnvilDev: false } as unknown as ChainContext;
  }

  test('a legacy sprout holding one stock is valued, and its snapshot stores only what it holds', async () => {
    const ctx = valuationCtx();
    const holdings = await readHoldings(ctx, OLD_VAULT);
    expect(holdings.available).toBe(true);
    // $2 settlement + 1 AAA at $100, in 8 decimals.
    expect(holdings.totalValueUsd).toBe(String(102n * 10n ** 8n));
    expect(holdings.holdings.map((h) => h.symbol)).toEqual(['SETTLEMENT', 'AAA', 'BBB', 'CCC']);

    const db = memoryDb();
    upsertSprout(db, {
      id: OLD_VAULT,
      chainId: 4663,
      parent: PARENT,
      beneficiary: KID,
      settlementToken: SETTLEMENT,
      graduationTimestamp: 2_100_000_000,
      assets: [STOCK_A],
      weights: [10000],
      createdTxHash: null,
      createdBlock: null,
      factory: OLD_FACTORY,
    });
    expect(await snapshotAll(ctx, db, [OLD_VAULT])).toBe(1);
    const stored = listSnapshots(db, OLD_VAULT)[0]!.holdings as Array<{ symbol: string }>;
    expect(stored.map((h) => h.symbol)).toEqual(['SETTLEMENT', 'AAA']);
  });
});

describe('three factories: the crypto batch makes a third one current', () => {
  // The third factory is deployed at 3000; the first (1000) and second (2000) become legacy.
  const THIRD_FACTORY = '0x00000000000000000000000000000000000000ac';
  const THIRD_VENUE = '0x00000000000000000000000000000000000000bc';
  const THIRD_VAULT = '0x0000000000000000000000000000000000000e03';
  const legacyBoth = `${OLD_FACTORY}:${OLD_VENUE}:1000,${NEW_FACTORY}:${NEW_VENUE}:2000`;

  test('a fresh database reads all three factories, and each vault keeps its own factory', async () => {
    const db = memoryDb();
    const logs = [
      created(OLD_FACTORY, OLD_VAULT, 1100),
      created(NEW_FACTORY, NEW_VAULT, 2100),
      created(THIRD_FACTORY, THIRD_VAULT, 3100),
      funded(THIRD_VAULT, 3200),
      funded(OLD_VAULT, 3300),
    ];
    const { ctx, queries } = chain(env({ factory: THIRD_FACTORY, venue: THIRD_VENUE, start: 3000 }, legacyBoth), logs, 3500);
    const result = await reconcile(ctx, db, {});
    expect(result.fromBlock).toBe(1000);
    expect(result.sproutsIndexed).toBe(3);
    // Every query for the factories names all three, current first.
    for (const q of queries.filter((q) => q.addresses.includes(THIRD_FACTORY))) {
      expect(q.addresses.slice(0, 3)).toEqual([THIRD_FACTORY, OLD_FACTORY, NEW_FACTORY]);
    }
    expect([OLD_VAULT, NEW_VAULT, THIRD_VAULT].map((v) => getSprout(db, v)?.factory)).toEqual([OLD_FACTORY, NEW_FACTORY, THIRD_FACTORY]);
    expect(names(db, THIRD_VAULT)).toEqual(['SproutCreated@3100', 'Funded@3200']);
    expect(names(db, OLD_VAULT)).toEqual(['SproutCreated@1100', 'Funded@3300']);
    for (const f of [OLD_FACTORY, NEW_FACTORY, THIRD_FACTORY]) expect(getFactoryCursor(db, 4663, f)).toBe(3500);
  });

  test('switching from two factories to three backfills only the third, from its own start block', async () => {
    const db = memoryDb();
    const logs = [
      created(OLD_FACTORY, OLD_VAULT, 1100),
      created(NEW_FACTORY, NEW_VAULT, 2100),
      // Deployed at 3000 and used before the server switched over at 4000.
      created(THIRD_FACTORY, THIRD_VAULT, 3100),
      funded(THIRD_VAULT, 3900),
      funded(NEW_VAULT, 4100),
    ];
    // Indexed up to 4000 with the second factory current and the first legacy.
    const before = chain(env({ factory: NEW_FACTORY, venue: NEW_VENUE, start: 2000 }, `${OLD_FACTORY}:${OLD_VENUE}:1000`), logs, 4000);
    await reconcile(before.ctx, db, {});
    expect(getCursor(db, 4663)).toBe(4000);
    expect(getSprout(db, THIRD_VAULT)).toBeNull();

    const after = chain(env({ factory: THIRD_FACTORY, venue: THIRD_VENUE, start: 3000 }, legacyBoth), logs, 4200);
    const result = await reconcile(after.ctx, db, {});
    expect(result.backfilled).toEqual([{ factory: THIRD_FACTORY, fromBlock: 3000, toBlock: 4000 }]);
    // Nothing before the shared cursor is read again for the first two factories.
    for (const q of after.queries.filter((q) => q.from <= 4000)) {
      expect(q.addresses).not.toContain(OLD_FACTORY);
      expect(q.addresses).not.toContain(NEW_FACTORY);
    }
    expect(getSprout(db, THIRD_VAULT)?.factory).toBe(THIRD_FACTORY);
    expect(names(db, THIRD_VAULT)).toEqual(['SproutCreated@3100', 'Funded@3900']);
    expect(names(db, NEW_VAULT)).toEqual(['SproutCreated@2100', 'Funded@4100']);
    expect(getCursor(db, 4663)).toBe(4200);
  });
});
