import { isAddress, type Address } from 'viem';
import { quoterV2Abi, uniswapV3AdapterAbi } from '@sprout/shared';
import { chainCache, requirePublic, tokenDecimals, type ChainContext } from './chain';
import { revertName } from './invest';

export type MarketStatus = 'available' | 'stale-price' | 'price-paused' | 'pool-too-far' | 'unavailable';
export interface AssetMarket { symbol: string; status: MarketStatus }
export function classifyMarket(expected: bigint, received: bigint): MarketStatus {
  if (expected <= 0n || received <= 0n) return 'unavailable';
  return received * 10000n < expected * 9900n ? 'pool-too-far' : 'available';
}
/** Indicative $100 probes, never a substitute for the actual basket's atomic simulation. */
export async function marketAvailability(ctx: ChainContext, quoter: string | undefined) {
  const { venue, settlementToken: settlement, stockTokens } = ctx.config.chain.contracts;
  if (!venue || !settlement || !quoter || !isAddress(quoter)) return { checkedAt: null, probeUsd: 100, assets: stockTokens.map(t => ({ symbol: t.symbol, status: 'unavailable' as const })) };
  return chainCache(ctx).get(`markets:${venue.toLowerCase()}:${quoter.toLowerCase()}`, 30_000, async () => {
    const client = requirePublic(ctx);
    const block = await client.getBlock({blockTag: 'latest'});
    const amount = 100n * 10n ** BigInt(await tokenDecimals(ctx, settlement));
    const assets: AssetMarket[] = [];
    // Bounded batches avoid turning one public request into an RPC burst.
    for (let i = 0; i < stockTokens.length; i += 4) {
      assets.push(...await Promise.all(stockTokens.slice(i, i + 4).map(async t => {
        try {
          const expected = await client.readContract({address: venue, abi: uniswapV3AdapterAbi, functionName: 'quote', args: [settlement, t.address, amount], blockNumber: block.number!});
          const [, fee, configured] = await client.readContract({address: venue, abi: uniswapV3AdapterAbi, functionName: 'tokenConfig', args: [t.address], blockNumber: block.number!});
          if (!configured) return {symbol: t.symbol, status: 'unavailable' as const};
          const [received] = await client.readContract({address: quoter as Address, abi: quoterV2Abi, functionName: 'quoteExactInputSingle', args: [{tokenIn:settlement,tokenOut:t.address,amountIn:amount,fee,sqrtPriceLimitX96:0n}], blockNumber: block.number!});
          return { symbol: t.symbol, status: classifyMarket(expected, received) };
        } catch (error) {
          const name = revertName(error);
          return {symbol: t.symbol, status: (name === 'StalePrice' ? 'stale-price' : name === 'BadPrice' ? 'price-paused' : 'unavailable') as MarketStatus};
        }
      })));
    }
    return {checkedAt: Number(block.timestamp), probeUsd: 100, assets};
  });
}
