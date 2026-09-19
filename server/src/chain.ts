import {
  createPublicClient,
  fallback,
  createWalletClient,
  decodeEventLog,
  erc20Abi,
  http,
  type Address,
  type Chain,
  type Hex,
  type PublicClient,
  type WalletClient,
} from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import {
  mockPriceFeedAbi,
  sproutFactoryAbi,
  sproutVaultAbi,
  stockTokenAbi,
  type ChainConfig,
  type StockTokenConfig,
} from '@sprout/shared';
import { listDeployments, type ServerConfig } from './config';
import { createReadCache, FOREVER_MS, type ReadCache } from './readCache';

export interface LocalDevAccount {
  address: Address;
  label: string;
  role: 'parent' | 'beneficiary' | 'gifter' | 'extra';
}

/**
 * Public, well-known Anvil development accounts. These are not secrets and are
 * only ever signable against a loopback RPC on chain 31337.
 */
export const LOCAL_DEV_ACCOUNTS: readonly LocalDevAccount[] = [
  { address: '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266', label: 'Anvil #0', role: 'parent' },
  { address: '0x70997970C51812dc3A010C7d01b50e0d17dc79C8', label: 'Anvil #1', role: 'beneficiary' },
  { address: '0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC', label: 'Anvil #2', role: 'gifter' },
  { address: '0x90F79bf6EB2c4f870365E785982E1f101E93b906', label: 'Anvil #3', role: 'extra' },
  { address: '0x15d34AAf54267DB7D7c367839AAf71A00a2C6A65', label: 'Anvil #4', role: 'extra' },
  { address: '0x9965507D1a55bcC2695C58ba16FB37d819B0A4dc', label: 'Anvil #5', role: 'extra' },
  { address: '0x976EA74026E726554dB657fA54763abd0C3a0aa9', label: 'Anvil #6', role: 'extra' },
  { address: '0x14dC79964da2C08b23698B3D3cc7Ca32193d9955', label: 'Anvil #7', role: 'extra' },
  { address: '0x23618e81E3f5cdF7f54C3d65f7FBc0aBf5B21E8f', label: 'Anvil #8', role: 'extra' },
  { address: '0xa0Ee7A142d267C1f36714E4a8F75612F20a79720', label: 'Anvil #9', role: 'extra' },
] as const;

const ANVIL_DEV_ADDRESSES = new Set(LOCAL_DEV_ACCOUNTS.map((a) => a.address.toLowerCase()));

export function isKnownDevAccount(address: string): boolean {
  return ANVIL_DEV_ADDRESSES.has(address.toLowerCase());
}

export interface ChainContext {
  config: ServerConfig;
  publicClient: PublicClient | null;
  walletClient: WalletClient | null;
  walletAddress: Address | null;
  walletIsAnvilDev: boolean;
}

function toViemChain(chainId: number, name: string, rpcUrl: string, multicall3?: Address): Chain {
  return {
    id: chainId,
    name,
    nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
    rpcUrls: { default: { http: [rpcUrl] } },
    testnet: chainId !== 4663,
    ...(multicall3 ? { contracts: { multicall3: { address: multicall3 } } } : {}),
  };
}

// ---------------------------------------------------------------------------
// Read cache
// ---------------------------------------------------------------------------

/** How long each kind of chain read may be served from memory. */
export const READ_TTL = {
  /** Latest block. Short: it is the clock graduation and feed staleness use. */
  block: 2_000,
  /** A vault's full holdings response. Callers can demand newer with `afterBlock`. */
  holdings: 10_000,
  /** Public landing-page totals. */
  stats: 60_000,
  /** A price feed round. Shared by every vault holding that token. */
  feedRound: 10_000,
  oraclePaused: 15_000,
  /** Stock token multiplier; changes only on a corporate action. */
  multiplier: 60_000,
  chainId: 10_000,
  /** An invest-now preview; short because it feeds a signature. */
  investQuote: 3_000,
} as const;

const caches = new WeakMap<ChainContext, ReadCache>();

/**
 * The read cache for a chain context. Kept outside ChainContext so the many
 * hand-built contexts in tests work unchanged, each with its own cache.
 */
export function chainCache(ctx: ChainContext): ReadCache {
  let cache = caches.get(ctx);
  if (!cache) {
    cache = createReadCache();
    caches.set(ctx, cache);
  }
  return cache;
}

/**
 * Drop cached chain reads. Local demo tools call this after moving the chain
 * (advancing time, minting, refreshing feeds), and the indexer calls it for
 * vaults that just emitted events.
 */
export function invalidateChainReads(ctx: ChainContext, prefix?: string): void {
  chainCache(ctx).invalidate(prefix);
}

export interface ChainClock {
  number: number;
  timestamp: number;
}

/** The latest block's number and timestamp, shared by every request for a moment. */
export async function chainClock(ctx: ChainContext): Promise<ChainClock> {
  const client = requirePublic(ctx);
  return chainCache(ctx).get('block', READ_TTL.block, async () => {
    const block = await client.getBlock({ blockTag: 'latest' });
    return { number: Number(block.number ?? 0n), timestamp: Number(block.timestamp) };
  });
}

/**
 * SproutVault.graduated() is `block.timestamp >= graduationTimestamp`, so it can
 * be answered from the shared chain clock instead of one call per sprout.
 * Falls back to wall time when the chain cannot be read.
 */
export async function isGraduated(ctx: ChainContext, graduationTimestamp: number, fallbackNowMs: number): Promise<boolean> {
  if (ctx.publicClient && ctx.config.chain.configured) {
    try {
      const clock = await chainClock(ctx);
      return clock.timestamp >= graduationTimestamp;
    } catch {
      // fall through to wall time
    }
  }
  return fallbackNowMs / 1000 >= graduationTimestamp;
}

export function isLoopbackRpcUrl(rpcUrl?: string): boolean {
  if (!rpcUrl) return false;
  try {
    const host = new URL(rpcUrl).hostname;
    return host === '127.0.0.1' || host === 'localhost' || host === '::1' || host === '0.0.0.0';
  } catch {
    return false;
  }
}

export function isLoopbackHost(host?: string): boolean {
  if (!host) return false;
  const bare = host.replace(/^\[/, '').split(']')[0]?.split(':')[0] ?? host;
  return bare === '127.0.0.1' || bare === 'localhost' || bare === '::1' || bare === '0.0.0.0';
}

export function createChainContext(config: ServerConfig): ChainContext {
  const { chain } = config;
  if (!chain.rpcUrl) {
    return { config, publicClient: null, walletClient: null, walletAddress: null, walletIsAnvilDev: false };
  }

  const viemChain = toViemChain(chain.chainId, chain.name, chain.rpcUrl, chain.multicall3);
  // Try the primary endpoint first and fall through to any configured backups.
  // rank:false keeps the declared order, so the endpoint chosen for its
  // capabilities stays primary instead of being reordered by latency.
  const endpoints = [chain.rpcUrl, ...(chain.rpcFallbackUrls ?? [])].filter(Boolean) as string[];
  // retryCount 0 inside a fallback list: retrying a rate-limited endpoint two
  // more times before moving on multiplies the wait by every endpoint, and the
  // holdings read makes ~9 chain calls. Failing over immediately is the whole
  // point of having a list. A single endpoint still retries, since there is
  // nowhere else to go.
  const transport = endpoints.length > 1
    ? fallback(endpoints.map((url) => http(url, { retryCount: 0, timeout: 8_000 })), { rank: false })
    : http(chain.rpcUrl, { retryCount: 2 });
  // With Multicall3 available, reads issued in the same tick (the Promise.all
  // blocks below) go out as one eth_call instead of one request each.
  const publicClient = createPublicClient({
    chain: viemChain,
    transport,
    cacheTime: 0,
    ...(chain.multicall3 ? { batch: { multicall: true } } : {}),
  });

  let walletClient: WalletClient | null = null;
  let walletAddress: Address | null = null;
  let walletIsAnvilDev = false;
  if (config.keeperPrivateKey) {
    const account = privateKeyToAccount(config.keeperPrivateKey);
    walletAddress = account.address;
    walletIsAnvilDev = ANVIL_DEV_ADDRESSES.has(account.address.toLowerCase());
    if (walletIsAnvilDev && !isLoopbackRpcUrl(chain.rpcUrl)) {
      throw new Error('Refusing to use a well-known Anvil development key against a non-loopback RPC');
    }
    walletClient = createWalletClient({ account, chain: viemChain, transport: http(chain.rpcUrl) });
  }

  return { config, publicClient, walletClient, walletAddress, walletIsAnvilDev };
}

/** Verify the configured chain id matches the RPC before any signing. */
export async function verifyRpcChain(ctx: ChainContext): Promise<void> {
  if (!ctx.publicClient) return;
  const actual = await ctx.publicClient.getChainId();
  if (actual !== ctx.config.chain.chainId) {
    throw new Error(`RPC chain id ${actual} does not match configured chain id ${ctx.config.chain.chainId}`);
  }
  if (ctx.walletIsAnvilDev && ctx.config.chain.chainId !== 31337) {
    throw new Error('Anvil development key requires chain id 31337');
  }
}

export class ChainConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ChainConfigError';
  }
}

export function requirePublic(ctx: ChainContext): PublicClient {
  if (!ctx.publicClient) throw new ChainConfigError('SPROUT_RPC_URL is not configured');
  return ctx.publicClient;
}

/** Every configured factory (current first, then legacy); throws when there is none. */
function requireFactories(ctx: ChainContext): Address[] {
  const factories = listDeployments(ctx.config).map((d) => d.factory);
  if (factories.length === 0) throw new ChainConfigError('SPROUT_FACTORY_ADDRESS is not configured');
  return factories;
}

export interface DecodedLog {
  eventName: string;
  args: Record<string, unknown>;
  logIndex: number;
  address: Address;
  txHash: Hex;
  blockNumber: bigint;
}

/** Decode logs for a transaction against a set of contract addresses. */
export async function decodeReceiptLogs(
  publicClient: PublicClient,
  abi: readonly unknown[],
  addresses: Address[],
  txHash: Hex,
): Promise<DecodedLog[]> {
  const receipt = await publicClient.getTransactionReceipt({ hash: txHash });
  if (receipt.status !== 'success') throw new Error('transaction reverted');
  const wanted = new Set(addresses.map((a) => a.toLowerCase()));
  const decoded: DecodedLog[] = [];
  for (const log of receipt.logs) {
    if (!wanted.has(log.address.toLowerCase())) continue;
    try {
      const event = decodeEventLog({ abi, data: log.data, topics: log.topics });
      decoded.push({
        eventName: event.eventName,
        args: event.args as Record<string, unknown>,
        logIndex: log.logIndex,
        address: log.address as Address,
        txHash,
        blockNumber: receipt.blockNumber,
      });
    } catch {
      // skip logs that do not match the ABI
    }
  }
  return decoded;
}

export interface VaultState {
  vault: Address;
  parent: Address;
  beneficiary: Address;
  settlementToken: Address;
  graduationTimestamp: number;
  assets: Address[];
  weights: number[];
  graduated: boolean;
}

export async function getVaultState(ctx: ChainContext, vault: Address): Promise<VaultState> {
  const client = requirePublic(ctx);
  const [parent, beneficiary, settlementToken, graduationTimestamp, assets, weights, graduated] = await Promise.all([
    client.readContract({ address: vault, abi: sproutVaultAbi, functionName: 'parent' }) as Promise<Address>,
    client.readContract({ address: vault, abi: sproutVaultAbi, functionName: 'beneficiary' }) as Promise<Address>,
    client.readContract({ address: vault, abi: sproutVaultAbi, functionName: 'settlementToken' }) as Promise<Address>,
    client.readContract({ address: vault, abi: sproutVaultAbi, functionName: 'graduationTimestamp' }) as Promise<bigint>,
    client.readContract({ address: vault, abi: sproutVaultAbi, functionName: 'assets' }) as Promise<readonly Address[]>,
    client.readContract({ address: vault, abi: sproutVaultAbi, functionName: 'weights' }) as Promise<readonly number[]>,
    client.readContract({ address: vault, abi: sproutVaultAbi, functionName: 'graduated' }) as Promise<boolean>,
  ]);
  return {
    vault,
    parent,
    beneficiary,
    settlementToken,
    graduationTimestamp: Number(graduationTimestamp),
    assets: [...assets],
    weights: weights.map((w) => Number(w)),
    graduated,
  };
}

export interface AllowanceEntry {
  token: Address;
  bucket: string;
}

export interface BeneficiaryState {
  graduated: boolean;
  settlementToken: Address;
  allowances: AllowanceEntry[];
}

export async function getBeneficiaryState(ctx: ChainContext, vault: Address): Promise<BeneficiaryState> {
  const client = requirePublic(ctx);
  const [state, settlementToken] = await Promise.all([
    getVaultState(ctx, vault),
    client.readContract({ address: vault, abi: sproutVaultAbi, functionName: 'settlementToken' }) as Promise<Address>,
  ]);
  const tokens = [settlementToken, ...state.assets];
  const buckets = await Promise.all(
    tokens.map(
      (token) =>
        client.readContract({ address: vault, abi: sproutVaultAbi, functionName: 'allowanceBucket', args: [token] }) as Promise<bigint>,
    ),
  );
  const allowances: AllowanceEntry[] = tokens.map((token, i) => ({ token, bucket: buckets[i]!.toString() }));
  return { graduated: state.graduated, settlementToken, allowances };
}

export async function getSettlementDecimals(ctx: ChainContext): Promise<number> {
  const token = ctx.config.chain.contracts.settlementToken;
  if (!token) return 6;
  try {
    return await tokenDecimals(ctx, token);
  } catch {
    return 6;
  }
}

/** ERC-20 decimals never change, so a successful read is kept for good. */
function tokenDecimals(ctx: ChainContext, token: Address): Promise<number> {
  const client = requirePublic(ctx);
  return chainCache(ctx).get(`token:${token.toLowerCase()}:decimals`, FOREVER_MS, async () =>
    Number(await client.readContract({ address: token, abi: erc20Abi, functionName: 'decimals' })),
  );
}

export interface Holding {
  symbol: string;
  address: Address;
  kind: 'stock' | 'settlement';
  rawBalance: string;
  decimals: number;
  multiplier: string;
  price: string | null;
  feedDecimals: number;
  valueUsd: string | null;
  shareEquivalent: string | null;
  status: 'ok' | 'stale' | 'paused' | 'missing-feed';
  note?: string;
}

export interface HoldingsSnapshot {
  available: boolean;
  reason?: string;
  blockNumber: number | null;
  feedDecimals: number;
  totalValueUsd: string | null;
  settlementAssumption: string;
  holdings: Holding[];
}

const USD_DECIMALS = 8;
const TEN_8 = 10n ** 8n;

/** Normalize a feed-scaled USD value to 8 decimals. */
function normalizeUsd(rawValue: bigint, feedDecimals: number): bigint {
  if (feedDecimals === USD_DECIMALS) return rawValue;
  if (feedDecimals < USD_DECIMALS) return rawValue * 10n ** BigInt(USD_DECIMALS - feedDecimals);
  return rawValue / 10n ** BigInt(feedDecimals - USD_DECIMALS);
}

export interface ReadHoldingsOptions {
  /** Only accept a chain clock at or after this block (see cachedHoldings). */
  minBlock?: number;
}

/**
 * Read a vault's holdings from the chain. Token-level values (decimals, feed
 * rounds, multipliers) come from the shared read cache; the vault's own
 * balances are always read fresh. Use cachedHoldings() from request handlers.
 */
export async function readHoldings(
  ctx: ChainContext,
  vault: Address,
  options: ReadHoldingsOptions = {},
): Promise<HoldingsSnapshot> {
  const chain = ctx.config.chain;
  const settlementAssumption =
    'Settlement token is treated as $1.00 because no settlement/USD feed is configured.';
  if (!chain.configured) {
    return {
      available: false,
      reason: `Missing configuration: ${chain.missing.join(', ')}`,
      blockNumber: null,
      feedDecimals: USD_DECIMALS,
      totalValueUsd: null,
      settlementAssumption,
      holdings: [],
    };
  }
  const client = requirePublic(ctx);
  const cache = chainCache(ctx);
  // A vault's settlement token is fixed at initialization. Reading it also
  // confirms the address is a vault: anything else reverts here.
  const settlementTokenRead = cache.get(`vault:${vault.toLowerCase()}:settlement`, FOREVER_MS, () =>
    client.readContract({ address: vault, abi: sproutVaultAbi, functionName: 'settlementToken' }) as Promise<Address>,
  );
  // One chain clock for the whole read: feed freshness must be compared against
  // the same timestamp that local time advancement moves, not wall-clock time.
  const [settlementToken, clock] = await Promise.all([settlementTokenRead, chainClockAtLeast(ctx, options.minBlock)]);
  const chainNow = clock.timestamp;
  const blockNumber = clock.number;

  // Issued together so a Multicall3-enabled client sends them as one request.
  const stockTokens = chain.contracts.stockTokens;
  const [settlementDecimals, settlementBalance, ...stockBalances] = await Promise.all([
    tokenDecimals(ctx, settlementToken),
    client.readContract({ address: settlementToken, abi: erc20Abi, functionName: 'balanceOf', args: [vault] }) as Promise<bigint>,
    ...stockTokens.map(
      (token) =>
        client.readContract({ address: token.address, abi: erc20Abi, functionName: 'balanceOf', args: [vault] }) as Promise<bigint>,
    ),
  ]);

  const holdings: Holding[] = [];
  let total = 0n;
  let badFeed = false;

  const settlementValue = normalizeUsd((settlementBalance * TEN_8) / 10n ** BigInt(settlementDecimals), USD_DECIMALS);
  holdings.push({
    symbol: 'SETTLEMENT',
    address: settlementToken,
    kind: 'settlement',
    rawBalance: settlementBalance.toString(),
    decimals: settlementDecimals,
    multiplier: (10n ** 18n).toString(),
    price: (10n ** 8n).toString(),
    feedDecimals: USD_DECIMALS,
    valueUsd: settlementValue.toString(),
    shareEquivalent: settlementBalance.toString(),
    status: 'ok',
    note: settlementAssumption,
  });
  total += settlementValue;

  const stockHoldings = await Promise.all(
    stockTokens.map((token, i) => readStockHolding(ctx, token, stockBalances[i] ?? 0n, chainNow)),
  );
  for (const holding of stockHoldings) {
    holdings.push(holding);
    if (holding.valueUsd !== null) {
      total += BigInt(holding.valueUsd);
    } else if (holding.rawBalance !== '0') {
      // A nonzero holding with no trustworthy price makes the whole total unknown.
      badFeed = true;
    }
  }

  if (badFeed) {
    const bad = holdings.filter((h) => h.kind === 'stock' && h.valueUsd === null && h.rawBalance !== '0');
    return {
      available: false,
      reason: `Valuation unavailable: ${bad.map((h) => `${h.symbol} (${h.status})`).join(', ')}`,
      blockNumber,
      feedDecimals: USD_DECIMALS,
      totalValueUsd: null,
      settlementAssumption,
      holdings,
    };
  }

  return {
    available: true,
    blockNumber,
    feedDecimals: USD_DECIMALS,
    totalValueUsd: total.toString(),
    settlementAssumption,
    holdings,
  };
}

/** The shared clock, re-read if it is older than `minBlock`. */
export async function chainClockAtLeast(ctx: ChainContext, minBlock?: number): Promise<ChainClock> {
  const clock = await chainClock(ctx);
  if (!minBlock || clock.number >= minBlock) return clock;
  chainCache(ctx).invalidate('block');
  return chainClock(ctx);
}

export interface CachedHoldingsOptions {
  /**
   * The block a client's own transaction confirmed in. A cached response from
   * an earlier block is not served, so a parent who just added funds sees them
   * immediately rather than up to READ_TTL.holdings later.
   */
  afterBlock?: number;
}

/** Minimum gap between forced re-reads of one vault, however often clients ask. */
const FORCED_REFRESH_GAP_MS = 1_000;

/**
 * Holdings for request handlers: shared across callers for READ_TTL.holdings,
 * with a bounded way for a client to ask for something newer.
 */
export async function cachedHoldings(
  ctx: ChainContext,
  vault: Address,
  options: CachedHoldingsOptions = {},
): Promise<HoldingsSnapshot> {
  const cache = chainCache(ctx);
  const id = vault.toLowerCase();
  const key = `holdings:${id}`;
  const after = options.afterBlock && options.afterBlock > 0 ? Math.floor(options.afterBlock) : 0;
  const cached = cache.peek<HoldingsSnapshot>(key);
  if (cached && after > 0 && (cached.blockNumber ?? 0) < after) {
    // Stale for this caller. Re-read, but at most once a second per vault so a
    // client passing an unreachable block cannot turn the cache off.
    const gateKey = `holdings-forced:${id}`;
    if (cache.peek(gateKey) === undefined) {
      cache.set(gateKey, true, FORCED_REFRESH_GAP_MS);
      cache.invalidate(key);
    }
  }
  return cache.get(key, READ_TTL.holdings, () => readHoldings(ctx, vault, { minBlock: after }));
}

/** Store a freshly read snapshot so request handlers can serve it. */
export function primeHoldings(ctx: ChainContext, vault: Address | string, snapshot: HoldingsSnapshot): void {
  chainCache(ctx).set(`holdings:${vault.toLowerCase()}`, snapshot, READ_TTL.holdings);
}

async function readStockHolding(
  ctx: ChainContext,
  token: StockTokenConfig,
  rawBalance: bigint,
  chainNow: number,
): Promise<Holding> {
  const client = requirePublic(ctx);
  const cache = chainCache(ctx);
  const tokenKey = `token:${token.address.toLowerCase()}`;

  // Optional token extensions resolve to null when a token does not expose
  // them, and that answer is cached like any other.
  const multiplierRead = cache.get(`${tokenKey}:multiplier`, READ_TTL.multiplier, async () => {
    try {
      return (await client.readContract({ address: token.address, abi: stockTokenAbi, functionName: 'uiMultiplier' })) as bigint;
    } catch {
      return null;
    }
  });
  const pausedRead = token.feedAddress
    ? cache.get(`${tokenKey}:oraclePaused`, READ_TTL.oraclePaused, async () => {
        try {
          return (await client.readContract({ address: token.address, abi: stockTokenAbi, functionName: 'oraclePaused' })) as boolean;
        } catch {
          return null;
        }
      })
    : Promise.resolve(null);
  const feed = token.feedAddress;
  const feedKey = feed ? `feed:${feed.toLowerCase()}` : '';
  // Feed failures are not swallowed here: they reject, are not cached, and are
  // classified below exactly as before.
  const feedRead = feed
    ? Promise.all([
        cache.get(`${feedKey}:decimals`, FOREVER_MS, async () =>
          Number(await client.readContract({ address: feed, abi: mockPriceFeedAbi, functionName: 'decimals' })),
        ),
        cache.get(`${feedKey}:round`, READ_TTL.feedRound, () =>
          client.readContract({ address: feed, abi: mockPriceFeedAbi, functionName: 'latestRoundData' }) as Promise<
            readonly [bigint, bigint, bigint, bigint, bigint]
          >,
        ),
      ])
    : null;
  // Attach the handler now so a rejection is never briefly unhandled while the
  // other reads settle.
  const feedResult = feedRead?.then(
    (value) => ({ ok: true as const, value }),
    (error: unknown) => ({ ok: false as const, error }),
  );

  const [onChainMultiplier, paused] = await Promise.all([multiplierRead, pausedRead]);
  // uiMultiplier is 1e18-scaled; fall back to the configured multiplier when the
  // token does not expose one.
  const multiplier = onChainMultiplier !== null && onChainMultiplier > 0n ? onChainMultiplier : token.multiplier;
  const shareEquivalent = (rawBalance * multiplier) / 10n ** 18n;

  const base: Holding = {
    symbol: token.symbol,
    address: token.address,
    kind: 'stock',
    rawBalance: rawBalance.toString(),
    decimals: token.decimals,
    multiplier: multiplier.toString(),
    price: null,
    feedDecimals: USD_DECIMALS,
    valueUsd: null,
    shareEquivalent: shareEquivalent.toString(),
    status: 'missing-feed',
  };
  if (!feedResult) return base;
  if (paused === true) return { ...base, status: 'paused' };

  const result = await feedResult;
  if (!result.ok) {
    const message = result.error instanceof Error ? result.error.message : String(result.error);
    return { ...base, status: /PAUSED/i.test(message) ? 'paused' : 'missing-feed' };
  }
  const [feedDecimals, round] = result.value;
  const [roundId, answer, , updatedAt, answeredInRound] = round;
  const heartbeat = token.heartbeatSeconds ?? 3600;

  // Fail closed: invalid rounds, nonpositive prices and feeds that are in the
  // future or older than the heartbeat all yield no valuation.
  let status: Holding['status'] = 'ok';
  if (answer <= 0n) status = 'missing-feed';
  else if (answeredInRound < roundId || updatedAt === 0n) status = 'missing-feed';
  else if (Number(updatedAt) > chainNow || chainNow - Number(updatedAt) > heartbeat) status = 'stale';

  const feedValue = (rawBalance * answer) / 10n ** BigInt(token.decimals);
  return {
    ...base,
    feedDecimals,
    price: answer.toString(),
    valueUsd: status === 'ok' ? normalizeUsd(feedValue, feedDecimals).toString() : null,
    status,
  };
}

export interface SproutCreatedEvent {
  /** The configured factory that emitted the event, i.e. the vault's factory(). */
  factory: Address;
  vault: Address;
  parent: Address;
  beneficiary: Address;
  settlementToken: Address;
  graduationTimestamp: number;
}

export async function verifySproutCreated(ctx: ChainContext, txHash: Hex): Promise<SproutCreatedEvent> {
  const client = requirePublic(ctx);
  const factories = new Set(requireFactories(ctx).map((f) => f.toLowerCase()));
  const receipt = await client.getTransactionReceipt({ hash: txHash });
  if (receipt.status !== 'success') throw new Error('transaction reverted');
  for (const log of receipt.logs) {
    if (!factories.has(log.address.toLowerCase())) continue;
    try {
      const event = decodeEventLog({ abi: sproutFactoryAbi, data: log.data, topics: log.topics });
      if (event.eventName !== 'SproutCreated') continue;
      const args = event.args as unknown as {
        vault: Address;
        parent: Address;
        beneficiary: Address;
        settlementToken: Address;
        graduationTimestamp: bigint;
      };
      return {
        factory: log.address as Address,
        vault: args.vault,
        parent: args.parent,
        beneficiary: args.beneficiary,
        settlementToken: args.settlementToken,
        graduationTimestamp: Number(args.graduationTimestamp),
      };
    } catch {
      // keep scanning
    }
  }
  throw new Error('SproutCreated event not found in transaction');
}

/** A parent's sprouts across every configured factory, current first. */
export async function getFactorySprouts(ctx: ChainContext, parent: Address): Promise<Address[]> {
  const client = requirePublic(ctx);
  const lists = await Promise.all(
    requireFactories(ctx).map(
      (factory) =>
        client.readContract({ address: factory, abi: sproutFactoryAbi, functionName: 'sproutsOf', args: [parent] }) as Promise<
          readonly Address[]
        >,
    ),
  );
  return lists.flat();
}

export async function sendKeeperTransaction(
  ctx: ChainContext,
  request: { address: Address; abi: readonly unknown[]; functionName: string; args: readonly unknown[] },
): Promise<Hex> {
  if (!ctx.walletClient || !ctx.walletAddress) throw new ChainConfigError('keeper key is not configured');
  await verifyRpcChain(ctx);
  const hash = (await ctx.walletClient.writeContract({
    account: ctx.walletAddress,
    address: request.address,
    abi: request.abi,
    functionName: request.functionName,
    args: request.args,
  } as never)) as Hex;
  const receipt = await ctx.publicClient!.waitForTransactionReceipt({ hash });
  if (receipt.status !== 'success') throw new Error(`keeper transaction ${hash} reverted`);
  return hash;
}
