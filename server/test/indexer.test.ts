import { describe, expect, test } from 'bun:test';
import { loadServerConfig } from '../src/config';
import type { ChainContext } from '../src/chain';
import { reconcile } from '../src/indexer';
import { encodeAbiParameters, encodeEventTopics } from 'viem';
import { sproutFactoryAbi, sproutVaultAbi } from '@sprout/shared';
import { getCursor, listChainEvents } from '../src/repo';
import { memoryDb } from './helpers';

const FACTORY = '0x00000000000000000000000000000000000000aa';
const SETTLEMENT = '0x00000000000000000000000000000000000000b2';
const VENUE = '0x00000000000000000000000000000000000000bb';
const FEED = '0x00000000000000000000000000000000000000f1';

function evmCtx(opts: { startBlock: number; getLogs: (from: number, to: number) => unknown }): ChainContext {
  const config = loadServerConfig({
    SPROUT_CHAIN_ID: '4663',
    SPROUT_RPC_URL: 'https://rpc.example.invalid',
    SPROUT_FACTORY_ADDRESS: FACTORY,
    SPROUT_SETTLEMENT_TOKEN: SETTLEMENT,
    SPROUT_VENUE_ADDRESS: VENUE,
    SPROUT_STOCK_TOKENS: `AAA:${SETTLEMENT}:18:1000000000000000000:${FEED}`,
    SPROUT_START_BLOCK: String(opts.startBlock),
    SPROUT_MAX_LOG_RANGE: '1000',
  });
  const publicClient = {
    getBlockNumber: async () => 2500n,
    getLogs: async ({ fromBlock, toBlock }: { fromBlock: bigint; toBlock: bigint }) => {
      return opts.getLogs(Number(fromBlock), Number(toBlock));
    },
  };
  return {
    config,
    publicClient,
    walletClient: null,
    walletAddress: null,
    walletIsAnvilDev: false,
  } as unknown as ChainContext;
}

describe('indexer chunking and cursor', () => {
  test('a public chain without a positive start block refuses to reconcile', async () => {
    const ctx = evmCtx({ startBlock: 0, getLogs: () => [] });
    await expect(reconcile(ctx, memoryDb(), {})).rejects.toThrow(/START_BLOCK/);
  });

  test('completed chunks are retained and retry resumes at the failed chunk', async () => {
    const db = memoryDb();
    const calls: Array<[number, number]> = [];
    let failSecond = true;
    const ctx = evmCtx({
      startBlock: 1000,
      getLogs: (from, to) => {
        calls.push([from, to]);
        if (failSecond && from === 2000) throw new Error('rate limited');
        return [];
      },
    });

    await expect(reconcile(ctx, db, {})).rejects.toThrow(/rate limited/);
    // First chunk committed; cursor did not advance past the failed chunk,
    // which was retried with smaller ranges (down to 10 blocks) before giving up.
    expect(getCursor(db, 4663)).toBe(1999);
    expect(calls).toEqual([
      [1000, 1999],
      [2000, 2500],
      [2000, 2249],
      [2000, 2061],
      [2000, 2014],
      [2000, 2009],
    ]);

    failSecond = false;
    calls.length = 0;
    await reconcile(ctx, db, {});
    // Retry begins at the failed chunk, not genesis or the start block.
    expect(calls[0]![0]).toBe(2000);
    expect(getCursor(db, 4663)).toBe(2500);
  });

  test('a range the provider refuses is narrowed, and the working range is remembered', async () => {
    const db = memoryDb();
    const calls: Array<[number, number]> = [];
    const ctx = evmCtx({
      startBlock: 1000,
      getLogs: (from, to) => {
        calls.push([from, to]);
        // Like drpc's free plan: nothing wider than 100 blocks.
        if (to - from + 1 > 100) throw new Error('ranges over 10000 blocks are not supported on free plan');
        return [];
      },
    });
    await reconcile(ctx, db, {});
    expect(getCursor(db, 4663)).toBe(2500);
    // 1000 is refused, 250 is refused, 62 works from then on (growing to 124
    // after eight successes is refused once and falls back to 31).
    expect(calls.slice(0, 3)).toEqual([
      [1000, 1999],
      [1000, 1249],
      [1000, 1061],
    ]);
    expect(calls.every(([from, to]) => to - from + 1 <= 1000)).toBe(true);
    const refused = calls.filter(([from, to]) => to - from + 1 > 100).length;
    expect(refused).toBeLessThanOrEqual(4);

    // The next pass starts from the range that worked instead of relearning it.
    calls.length = 0;
    const next = evmCtxSame(ctx, 2600);
    await reconcile(next, db, {});
    expect(calls.filter(([from, to]) => to - from + 1 > 100)).toHaveLength(0);
    expect(getCursor(db, 4663)).toBe(2600);
  });
});

/** The same context (and so the same learned range) with the chain head moved. */
function evmCtxSame(ctx: ChainContext, head: number): ChainContext {
  (ctx.publicClient as unknown as { getBlockNumber: () => Promise<bigint> }).getBlockNumber = async () => BigInt(head);
  return ctx;
}

describe('indexer discovery with one query per range', () => {
  const VAULT = '0x00000000000000000000000000000000000000c1';
  const PARENT = '0x00000000000000000000000000000000000000d1';
  const KID = '0x00000000000000000000000000000000000000e1';

  function log(address: string, abi: typeof sproutFactoryAbi | typeof sproutVaultAbi, eventName: string, args: Record<string, unknown>, blockNumber: number) {
    const event = (abi as readonly { type: string; name?: string; inputs?: readonly { name: string; type: string; indexed?: boolean }[] }[]).find(
      (e) => e.type === 'event' && e.name === eventName,
    )!;
    const topics = encodeEventTopics({ abi, eventName, args } as never);
    const data = encodeAbiParameters(
      event.inputs!.filter((i) => !i.indexed) as never,
      event.inputs!.filter((i) => !i.indexed).map((i) => args[i.name]) as never,
    );
    return { address, topics, data, blockNumber: BigInt(blockNumber), logIndex: 0, transactionHash: `0x${blockNumber.toString(16).padStart(64, '0')}` };
  }

  test('a vault created and funded inside one range is discovered and its events indexed', async () => {
    const db = memoryDb();
    const all = [
      log(FACTORY, sproutFactoryAbi, 'SproutCreated', { vault: VAULT, parent: PARENT, beneficiary: KID, settlementToken: SETTLEMENT, graduationTimestamp: 2_000_000_000n }, 1100),
      log(VAULT, sproutVaultAbi, 'Funded', { from: PARENT, token: SETTLEMENT, amount: 5_000_000n }, 1200),
    ];
    const queried: string[][] = [];
    const ctx = evmCtx({ startBlock: 1000, getLogs: () => [] });
    const client = ctx.publicClient as unknown as Record<string, unknown>;
    client.getLogs = async ({ address }: { address: string[] }) => {
      const wanted = address.map((a) => a.toLowerCase());
      queried.push(wanted);
      return all.filter((l) => wanted.includes(l.address.toLowerCase()));
    };
    client.readContract = async ({ functionName }: { functionName: string }) =>
      ({ parent: PARENT, beneficiary: KID, settlementToken: SETTLEMENT, graduationTimestamp: 2_000_000_000n, assets: [SETTLEMENT], weights: [10000], graduated: false })[functionName];

    const result = await reconcile(ctx, db, {});
    expect(result.sproutsIndexed).toBe(1);
    // Factory query first, then one follow-up for the vault it just discovered.
    expect(queried[0]).toEqual([FACTORY]);
    expect(queried[1]).toEqual([VAULT]);
    const names = listChainEvents(db, VAULT).map((e) => e.eventName);
    expect(names).toEqual(['SproutCreated', 'Funded']);

    // Later ranges ask about the factory and the vault in a single query.
    queried.length = 0;
    (client as { getBlockNumber: () => Promise<bigint> }).getBlockNumber = async () => 3000n;
    await reconcile(ctx, db, {});
    expect(queried.every((q) => q.length === 2 && q[0] === FACTORY && q[1] === VAULT)).toBe(true);
  });
});
