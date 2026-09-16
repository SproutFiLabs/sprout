import type { ChainContext } from './chain';
import { chainCache, requirePublic } from './chain';
import { FOREVER_MS } from './readCache';

/** How many uncached block headers are fetched at the same time. */
export const BLOCK_TIME_CONCURRENCY = 4;

/**
 * Cache key for a block's timestamp. It must not start with "block": the
 * shared chain clock is dropped with invalidateChainReads(ctx, 'block'), and a
 * prefix match would throw these permanent values away with it.
 */
function blockTimeKey(blockNumber: number): string {
  return `time:block:${blockNumber}`;
}

/**
 * Unix timestamps (seconds) for the given block numbers, keyed by block number.
 *
 * A mined block's timestamp never changes, so each successful read is kept in
 * the chain read cache for good; only blocks not seen before cost an RPC call,
 * and at most `concurrency` of those run at once so a long history does not
 * burst past a free RPC tier's rate limit. A failed read is not cached and
 * rejects the whole call, so the next caller retries.
 */
export async function blockTimestamps(
  ctx: ChainContext,
  blockNumbers: Iterable<number>,
  concurrency = BLOCK_TIME_CONCURRENCY,
): Promise<Map<number, number>> {
  const unique = [...new Set(blockNumbers)];
  const times = new Map<number, number>();
  if (unique.length === 0) return times;
  const client = requirePublic(ctx);
  const cache = chainCache(ctx);
  let next = 0;
  const worker = async (): Promise<void> => {
    while (next < unique.length) {
      const blockNumber = unique[next++]!;
      const timestamp = await cache.get(blockTimeKey(blockNumber), FOREVER_MS, async () => {
        const block = await client.getBlock({ blockNumber: BigInt(blockNumber) });
        return Number(block.timestamp);
      });
      times.set(blockNumber, timestamp);
    }
  };
  const workers = Math.max(1, Math.min(concurrency, unique.length));
  await Promise.all(Array.from({ length: workers }, worker));
  return times;
}
