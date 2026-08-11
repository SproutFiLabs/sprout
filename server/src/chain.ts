import {
  createPublicClient,
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
import type { ServerConfig } from './config';

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

function toViemChain(chainId: number, name: string, rpcUrl: string): Chain {
  return {
    id: chainId,
    name,
    nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
    rpcUrls: { default: { http: [rpcUrl] } },
    testnet: chainId !== 4663,
  };
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

  const viemChain = toViemChain(chain.chainId, chain.name, chain.rpcUrl);
  const publicClient = createPublicClient({ chain: viemChain, transport: http(chain.rpcUrl), cacheTime: 0 });

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

function requireFactory(ctx: ChainContext): Address {
  const factory = ctx.config.chain.contracts.factory;
  if (!factory) throw new ChainConfigError('SPROUT_FACTORY_ADDRESS is not configured');
  return factory;
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
  const allowances: AllowanceEntry[] = [];
  for (const token of tokens) {
    const bucket = (await client.readContract({
      address: vault,
      abi: sproutVaultAbi,
      functionName: 'allowanceBucket',
      args: [token],
    })) as bigint;
    allowances.push({ token, bucket: bucket.toString() });
  }
  return { graduated: state.graduated, settlementToken, allowances };
}

export async function getSettlementDecimals(ctx: ChainContext): Promise<number> {
  const token = ctx.config.chain.contracts.settlementToken;
  if (!token) return 6;
  const client = requirePublic(ctx);
  try {
    return Number(await client.readContract({ address: token, abi: erc20Abi, functionName: 'decimals' }));
  } catch {
    return 6;
  }
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

export async function readHoldings(ctx: ChainContext, vault: Address): Promise<HoldingsSnapshot> {
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
  const state = await getVaultState(ctx, vault);
  // One chain clock for the whole read: feed freshness must be compared against
  // the same timestamp that local time advancement moves, not wall-clock time.
  const block = await client.getBlock({ blockTag: 'latest' });
  const chainNow = Number(block.timestamp);
  const blockNumber = Number(block.number ?? 0n);
  const holdings: Holding[] = [];

  const settlementDecimals = Number(
    await client.readContract({ address: state.settlementToken, abi: erc20Abi, functionName: 'decimals' }),
  );
  const settlementBalance = (await client.readContract({
    address: state.settlementToken,
    abi: erc20Abi,
    functionName: 'balanceOf',
    args: [vault],
  })) as bigint;

  let total = 0n;
  let badFeed = false;

  const settlementValue = normalizeUsd((settlementBalance * TEN_8) / 10n ** BigInt(settlementDecimals), USD_DECIMALS);
  holdings.push({
    symbol: 'SETTLEMENT',
    address: state.settlementToken,
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

  for (const token of chain.contracts.stockTokens) {
    const raw = (await client.readContract({
      address: token.address,
      abi: erc20Abi,
      functionName: 'balanceOf',
      args: [vault],
    })) as bigint;
    const holding = await readStockHolding(ctx, token, raw, chainNow);
    holdings.push(holding);
    if (holding.valueUsd !== null) {
      total += BigInt(holding.valueUsd);
    } else if (raw !== 0n) {
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

async function readStockHolding(
  ctx: ChainContext,
  token: StockTokenConfig,
  rawBalance: bigint,
  chainNow: number,
): Promise<Holding> {
  const client = requirePublic(ctx);

  let multiplier = token.multiplier;
  try {
    const onChain = (await client.readContract({
      address: token.address,
      abi: stockTokenAbi,
      functionName: 'uiMultiplier',
    })) as bigint;
    if (onChain > 0n) multiplier = onChain;
  } catch {
    // fall back to configured multiplier (normalized by 1e18)
  }
  // uiMultiplier is 1e18-scaled; share-equivalent display normalizes by 1e18.
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
  if (!token.feedAddress) return base;

  // Some stock tokens expose an oracle pause flag.
  try {
    const paused = (await client.readContract({
      address: token.address,
      abi: stockTokenAbi,
      functionName: 'oraclePaused',
    })) as boolean;
    if (paused) return { ...base, status: 'paused' };
  } catch {
    // not all tokens expose it
  }

  try {
    const feedDecimals = Number(
      await client.readContract({ address: token.feedAddress, abi: mockPriceFeedAbi, functionName: 'decimals' }),
    );
    const round = (await client.readContract({
      address: token.feedAddress,
      abi: mockPriceFeedAbi,
      functionName: 'latestRoundData',
    })) as readonly [bigint, bigint, bigint, bigint, bigint];
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
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { ...base, status: /PAUSED/i.test(message) ? 'paused' : 'missing-feed' };
  }
}

export interface SproutCreatedEvent {
  vault: Address;
  parent: Address;
  beneficiary: Address;
  settlementToken: Address;
  graduationTimestamp: number;
}

export async function verifySproutCreated(ctx: ChainContext, txHash: Hex): Promise<SproutCreatedEvent> {
  const client = requirePublic(ctx);
  const factory = requireFactory(ctx);
  const receipt = await client.getTransactionReceipt({ hash: txHash });
  if (receipt.status !== 'success') throw new Error('transaction reverted');
  for (const log of receipt.logs) {
    if (log.address.toLowerCase() !== factory.toLowerCase()) continue;
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

export async function getFactorySprouts(ctx: ChainContext, parent: Address): Promise<Address[]> {
  const client = requirePublic(ctx);
  const factory = requireFactory(ctx);
  const result = (await client.readContract({
    address: factory,
    abi: sproutFactoryAbi,
    functionName: 'sproutsOf',
    args: [parent],
  })) as readonly Address[];
  return [...result];
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
