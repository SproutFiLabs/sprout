import type { Address } from 'viem';

export const ROBINHOOD_CHAIN_ID = 4663;
export const ROBINHOOD_TESTNET_CHAIN_ID = 46630;
export const ANVIL_CHAIN_ID = 31337;

export interface ChainDefinition {
  chainId: number;
  name: string;
  explorerUrl?: string;
}

export const KNOWN_CHAINS: Record<number, ChainDefinition> = {
  [ROBINHOOD_CHAIN_ID]: { chainId: ROBINHOOD_CHAIN_ID, name: 'Robinhood Chain', explorerUrl: 'https://robinhoodchain.blockscout.com' },
  [ROBINHOOD_TESTNET_CHAIN_ID]: { chainId: ROBINHOOD_TESTNET_CHAIN_ID, name: 'Robinhood Chain Testnet' },
  [ANVIL_CHAIN_ID]: { chainId: ANVIL_CHAIN_ID, name: 'Local Anvil' },
};

export interface StockTokenConfig {
  symbol: string;
  address: Address;
  decimals: number;
  multiplier: bigint;
  feedAddress?: Address;
  heartbeatSeconds?: number;
}

export interface ContractAddresses {
  factory?: Address;
  settlementToken?: Address;
  /**
   * Ticker for the settlement token, e.g. USDG. Without it the UI can only say
   * "Settlement", which reads as jargon next to AAPL and NVDA and leaves people
   * unsure what they are actually depositing.
   */
  settlementSymbol?: string;
  venue?: Address;
  stockTokens: StockTokenConfig[];
}

export interface ChainConfig {
  chainId: number;
  name: string;
  rpcUrl?: string;
  /** Extra endpoints tried, in order, when the primary one fails. */
  rpcFallbackUrls?: string[];
  explorerUrl?: string;
  isLocal: boolean;
  localDemo: boolean;
  contracts: ContractAddresses;
  configured: boolean;
  missing: string[];
}

export type EnvLike = Record<string, string | undefined>;

function isAddress(value: string | undefined): value is Address {
  return typeof value === 'string' && /^0x[0-9a-fA-F]{40}$/.test(value);
}

function parseStockTokens(raw: string | undefined): StockTokenConfig[] {
  if (!raw) return [];
  const tokens: StockTokenConfig[] = [];
  for (const entry of raw.split(',')) {
    const trimmed = entry.trim();
    if (!trimmed) continue;
    const [symbol, address, decimals, multiplier, feed, heartbeat] = trimmed.split(':');
    if (!symbol || !isAddress(address)) continue;
    tokens.push({
      symbol,
      address,
      decimals: decimals ? Number(decimals) : 18,
      multiplier: multiplier ? BigInt(multiplier) : 10n ** 18n,
      feedAddress: isAddress(feed) ? feed : undefined,
      heartbeatSeconds: heartbeat ? Number(heartbeat) : undefined,
    });
  }
  return tokens;
}

/**
 * Build a chain configuration from an environment record. Missing values are
 * reported rather than replaced with guessed addresses. Local demo mode is
 * explicit and never implied by a live chain id.
 */
export function loadChainConfig(env: EnvLike): ChainConfig {
  const chainId = Number(env.SPROUT_CHAIN_ID ?? ANVIL_CHAIN_ID);
  const known = KNOWN_CHAINS[chainId];
  const isLocal = chainId === ANVIL_CHAIN_ID;
  const rpcUrl = env.SPROUT_RPC_URL;
  // Comma-separated. Providers differ in what they are good at: the public node
  // serves wide eth_getLogs ranges but prunes state, while Alchemy's free tier
  // keeps archive state but caps eth_getLogs at ten blocks. Listing more than
  // one means a rate limit or an unsupported request on the first endpoint does
  // not take the whole service down with it.
  const rpcFallbackUrls = (env.SPROUT_RPC_FALLBACK_URLS ?? '')
    .split(',')
    .map((url) => url.trim())
    .filter(Boolean);
  const factory = env.SPROUT_FACTORY_ADDRESS;
  const settlementToken = env.SPROUT_SETTLEMENT_TOKEN;
  const settlementSymbol = env.SPROUT_SETTLEMENT_SYMBOL?.trim() || undefined;
  const venue = env.SPROUT_VENUE_ADDRESS;
  const stockTokens = parseStockTokens(env.SPROUT_STOCK_TOKENS);

  const missing: string[] = [];
  if (!rpcUrl) missing.push('SPROUT_RPC_URL');
  if (!isAddress(factory)) missing.push('SPROUT_FACTORY_ADDRESS');
  if (!isAddress(settlementToken)) missing.push('SPROUT_SETTLEMENT_TOKEN');
  if (stockTokens.length === 0) missing.push('SPROUT_STOCK_TOKENS');
  if (!isAddress(venue) && !isLocal) missing.push('SPROUT_VENUE_ADDRESS');

  const configured = missing.length === 0;

  return {
    chainId,
    name: known?.name ?? `Unknown chain ${chainId}`,
    rpcUrl,
    rpcFallbackUrls,
    explorerUrl: known?.explorerUrl,
    isLocal,
    localDemo: env.SPROUT_LOCAL_DEMO === '1',
    contracts: {
      factory: isAddress(factory) ? factory : undefined,
      settlementToken: isAddress(settlementToken) ? settlementToken : undefined,
      settlementSymbol,
      venue: isAddress(venue) ? venue : undefined,
      stockTokens,
    },
    configured,
    missing,
  };
}

/** Refuse to combine local development keys with a non-local RPC. */
export function assertRuntimeChainGuard(config: ChainConfig, env: EnvLike): void {
  const usesLocalKey = env.SPROUT_USE_LOCAL_KEYS === '1';
  if (usesLocalKey && !config.isLocal) {
    throw new Error(
      `Refusing to use local development keys against chain ${config.chainId} (${config.name}). ` +
        'Local Anvil accounts must never sign for a public network.',
    );
  }
}
