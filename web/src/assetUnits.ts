import { parseUnits } from 'viem';

/**
 * Token units for what a person types and sees. Every token has its own
 * decimals: USDG 6, CBBTC (Bitcoin) 8, the stock tokens and WETH 18. The server
 * serves them with each stock token (SPROUT_STOCK_TOKENS); an amount parsed
 * with the wrong one is off by a power of ten.
 */
export interface TokenUnits {
  settlementToken?: string;
  settlementDecimals: number;
  stockTokens: ReadonlyArray<{ address: string; decimals: number }>;
}

/** The token's own decimals; 18 for a token the server did not list. */
export function assetDecimals(contracts: TokenUnits, asset: string): number {
  const key = asset.toLowerCase();
  if (key === contracts.settlementToken?.toLowerCase()) return contracts.settlementDecimals;
  return contracts.stockTokens.find((t) => t.address.toLowerCase() === key)?.decimals ?? 18;
}

/** A typed amount ("0.001") in the token's base units. Throws on text that is not a number. */
export function parseAssetAmount(contracts: TokenUnits, asset: string, typed: string): bigint {
  return parseUnits(typed.trim() || '0', assetDecimals(contracts, asset));
}
