import { describe, expect, test } from 'bun:test';
import { loadServerConfig } from '../src/config';
import type { ChainContext } from '../src/chain';
import { reconcile } from '../src/indexer';
import { getCursor } from '../src/repo';
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
    // First chunk committed; cursor did not advance past the failed chunk.
    expect(getCursor(db, 4663)).toBe(1999);
    expect(calls).toEqual([
      [1000, 1999],
      [2000, 2500],
    ]);

    failSecond = false;
    calls.length = 0;
    await reconcile(ctx, db, {});
    // Retry begins at the failed chunk, not genesis or the start block.
    expect(calls[0]).toEqual([2000, 2500]);
    expect(getCursor(db, 4663)).toBe(2500);
  });
});
