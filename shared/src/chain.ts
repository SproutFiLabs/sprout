import type { Address } from 'viem';

export const ROBINHOOD_CHAIN_ID = 4663;
export const ROBINHOOD_TESTNET_CHAIN_ID = 46630;
export const ANVIL_CHAIN_ID = 31337;

/** Multicall3's address is the same on every chain it has been deployed to. */
export const CANONICAL_MULTICALL3: Address = '0xcA11bde05977b3631167028862bE2a173976CA11';

export interface ChainDefinition {
  chainId: number;
  name: string;
  explorerUrl?: string;
  /** Set only where the contract has been confirmed deployed on-chain. */
  multicall3?: Address;
}

export const KNOWN_CHAINS: Record<number, ChainDefinition> = {
  [ROBINHOOD_CHAIN_ID]: {
    chainId: ROBINHOOD_CHAIN_ID,
    name: 'Robinhood Chain',
    explorerUrl: 'https://robinhoodchain.blockscout.com',
    multicall3: CANONICAL_MULTICALL3,
  },
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
  /** Display name ("Apple"), from SPROUT_STOCK_NAMES when set. */
  name?: string;
}

/**
 * An earlier factory whose sprouts are still served. Contracts cannot change
 * after deployment, so each factory admits a fixed menu of assets and venues:
 * a sprout it created can only ever trade through that deployment's venue.
 */
export interface LegacyDeployment {
  factory: Address;
  venue: Address;
  /** Block the factory was deployed in; its sprouts are indexed from here. */
  startBlock: number;
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
  /**
   * Earlier deployments (SPROUT_LEGACY_DEPLOYMENTS). `factory`/`venue` above are
   * the current deployment, the one new sprouts are planted with.
   */
  legacyDeployments: LegacyDeployment[];
}

export interface ChainConfig {
  chainId: number;
  name: string;
  rpcUrl?: string;
  /** Extra endpoints tried, in order, when the primary one fails. */
  rpcFallbackUrls?: string[];
  explorerUrl?: string;
  /**
   * Multicall3 lets the server fold a page's worth of contract reads into one
   * RPC request. Undefined where it is not deployed (a plain Anvil node).
   */
  multicall3?: Address;
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

/**
 * Parse SPROUT_LEGACY_DEPLOYMENTS: `factory:venue:startBlock`, comma separated.
 * Throws on anything malformed rather than dropping it: a silently skipped
 * entry would leave every sprout of that factory unindexed and unable to buy.
 */
export function parseLegacyDeployments(raw: string | undefined): LegacyDeployment[] {
  const deployments: LegacyDeployment[] = [];
  for (const entry of (raw ?? '').split(',')) {
    const trimmed = entry.trim();
    if (!trimmed) continue;
    const parts = trimmed.split(':').map((part) => part.trim());
    const [factory, venue, startBlock] = parts;
    if (parts.length !== 3 || !isAddress(factory) || !isAddress(venue) || !/^\d+$/.test(startBlock ?? '')) {
      throw new Error(
        `SPROUT_LEGACY_DEPLOYMENTS entry "${trimmed}" must be factory:venue:startBlock (two 0x addresses and a block number)`,
      );
    }
    if (deployments.some((d) => d.factory.toLowerCase() === factory.toLowerCase())) {
      throw new Error(`SPROUT_LEGACY_DEPLOYMENTS lists factory ${factory} more than once`);
    }
    deployments.push({ factory, venue, startBlock: Number(startBlock) });
  }
  return deployments;
}

/** SPROUT_STOCK_NAMES: `SYM:Name`, comma separated. Names may contain spaces. */
function parseStockNames(raw: string | undefined): Map<string, string> {
  const names = new Map<string, string>();
  for (const entry of (raw ?? '').split(',')) {
    const at = entry.indexOf(':');
    if (at <= 0) continue;
    const symbol = entry.slice(0, at).trim();
    const name = entry.slice(at + 1).trim();
    if (symbol && name) names.set(symbol, name);
  }
  return names;
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
  const names = parseStockNames(env.SPROUT_STOCK_NAMES);
  const stockTokens = parseStockTokens(env.SPROUT_STOCK_TOKENS).map((token) => {
    const name = names.get(token.symbol);
    return name ? { ...token, name } : token;
  });
  let legacyDeployments: LegacyDeployment[] = [];
  let legacyValid = true;
  try {
    legacyDeployments = parseLegacyDeployments(env.SPROUT_LEGACY_DEPLOYMENTS);
  } catch {
    legacyValid = false;
  }
  // A legacy entry naming the current factory would give one factory two venues.
  if (isAddress(factory) && legacyDeployments.some((d) => d.factory.toLowerCase() === factory.toLowerCase())) {
    legacyValid = false;
    legacyDeployments = [];
  }
  // SPROUT_MULTICALL3_ADDRESS overrides the known deployment; "off" disables
  // batching entirely, e.g. to rule it out while debugging an RPC provider.
  const multicallEnv = env.SPROUT_MULTICALL3_ADDRESS?.trim();
  const multicall3 =
    multicallEnv === 'off' ? undefined : isAddress(multicallEnv) ? multicallEnv : known?.multicall3;

  const missing: string[] = [];
  if (!rpcUrl) missing.push('SPROUT_RPC_URL');
  if (!isAddress(factory)) missing.push('SPROUT_FACTORY_ADDRESS');
  if (!isAddress(settlementToken)) missing.push('SPROUT_SETTLEMENT_TOKEN');
  if (stockTokens.length === 0) missing.push('SPROUT_STOCK_TOKENS');
  if (!isAddress(venue) && !isLocal) missing.push('SPROUT_VENUE_ADDRESS');
  if (!legacyValid) missing.push('SPROUT_LEGACY_DEPLOYMENTS');

  const configured = missing.length === 0;

  return {
    chainId,
    name: known?.name ?? `Unknown chain ${chainId}`,
    rpcUrl,
    rpcFallbackUrls,
    explorerUrl: known?.explorerUrl,
    multicall3,
    isLocal,
    localDemo: env.SPROUT_LOCAL_DEMO === '1',
    contracts: {
      factory: isAddress(factory) ? factory : undefined,
      settlementToken: isAddress(settlementToken) ? settlementToken : undefined,
      settlementSymbol,
      venue: isAddress(venue) ? venue : undefined,
      stockTokens,
      legacyDeployments,
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
