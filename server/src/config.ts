import { join } from 'node:path';
import { assertRuntimeChainGuard, loadChainConfig, type ChainConfig, type EnvLike } from '@sprout/shared';

export interface ServerConfig {
  chain: ChainConfig;
  dbPath: string;
  port: number;
  bind: string;
  adminToken?: string;
  keeperPrivateKey?: `0x${string}`;
  useLocalKeys: boolean;
  allowFixtures: boolean;
  /** Serve the built web app from the same origin. */
  serveWeb: boolean;
  webDistPath: string;
  /** First block to index; avoids scanning from genesis on a public chain. */
  startBlock: number;
  /** Max block span per getLogs request (bounded, resumable). */
  maxLogRange: number;
  /**
   * Seconds between growth snapshots of every sprout. Vaults with new events
   * are snapshotted on the next maintenance pass regardless. Optional so
   * hand-built test configs keep working; defaults to 300.
   */
  snapshotIntervalSeconds?: number;
  /** RPC URL that is safe to hand to a browser wallet, if explicitly public. */
  publicWalletRpcUrl?: string;
  /** Decimals of the settlement token, if known without a chain read. */
  settlementDecimals?: number;
  /** Keeper gas policy. All of maxFeePerGas, gasLimitCap and dailyFeeBudget are
   *  required before automation may send a transaction. */
  keeperMaxFeePerGasWei?: bigint;
  keeperMaxPriorityFeePerGasWei?: bigint;
  keeperGasLimitCap?: bigint;
  keeperDailyFeeBudgetWei?: bigint;
}

/**
 * A full snapshot pass reads every sprout. Every thirty seconds (the old
 * cadence) that was the service's largest RPC cost, for chart points nobody
 * needs at that resolution.
 */
export const DEFAULT_SNAPSHOT_INTERVAL_SECONDS = 300;

export interface KeeperBudgetConfig {
  maxFeePerGasWei: bigint;
  maxPriorityFeePerGasWei: bigint;
  gasLimitCap: bigint;
  dailyFeeBudgetWei: bigint;
}

/** Automation requires a keeper key AND an explicit, complete gas budget. */
export function keeperBudget(config: ServerConfig): KeeperBudgetConfig | null {
  const { keeperMaxFeePerGasWei: maxFee, keeperMaxPriorityFeePerGasWei: priority, keeperGasLimitCap: gasCap, keeperDailyFeeBudgetWei: daily } = config;
  // All four caps are required and must be positive; zero/invalid budgets disable.
  if (maxFee === undefined || priority === undefined || gasCap === undefined || daily === undefined) return null;
  if (maxFee <= 0n || priority <= 0n || gasCap <= 0n || daily <= 0n) return null;
  return { maxFeePerGasWei: maxFee, maxPriorityFeePerGasWei: priority, gasLimitCap: gasCap, dailyFeeBudgetWei: daily };
}

function parseWei(value: string | undefined): bigint | undefined {
  return value && /^\d+$/.test(value) ? BigInt(value) : undefined;
}

function isPrivateKey(value: string | undefined): value is `0x${string}` {
  return typeof value === 'string' && /^0x[0-9a-fA-F]{64}$/.test(value);
}

export function loadServerConfig(env: EnvLike = process.env): ServerConfig {
  const chain = loadChainConfig(env);
  assertRuntimeChainGuard(chain, env);

  const dataDir = env.SPROUT_DATA_DIR ?? join(process.cwd(), 'data');
  const dbPath = env.SPROUT_DB_PATH ?? join(dataDir, 'sprout.sqlite');

  const isProduction = env.NODE_ENV === 'production';
  const useLocalKeys = env.SPROUT_USE_LOCAL_KEYS === '1';
  const allowFixtures = env.SPROUT_LOCAL_DEMO === '1';

  // Hard guards: local demo fixtures/tools/keys are never allowed in production
  // or on a non-local chain, even if the flag is set accidentally.
  if (isProduction && (allowFixtures || useLocalKeys)) {
    throw new Error('Refusing SPROUT_LOCAL_DEMO / SPROUT_USE_LOCAL_KEYS with NODE_ENV=production');
  }
  if (chain.chainId !== 31337 && (allowFixtures || useLocalKeys)) {
    throw new Error(`Refusing local demo/keys on a non-local chain (${chain.chainId})`);
  }

  const startBlock = Number(env.SPROUT_START_BLOCK ?? 0);
  if (!Number.isInteger(startBlock) || startBlock < 0) {
    throw new Error('SPROUT_START_BLOCK must be a non-negative integer');
  }
  const maxLogRange = Number(env.SPROUT_MAX_LOG_RANGE ?? 2000);
  if (!Number.isInteger(maxLogRange) || maxLogRange < 1 || maxLogRange > 100_000) {
    throw new Error('SPROUT_MAX_LOG_RANGE must be an integer between 1 and 100000');
  }

  const snapshotIntervalSeconds = Number(env.SPROUT_SNAPSHOT_INTERVAL_SECONDS ?? DEFAULT_SNAPSHOT_INTERVAL_SECONDS);
  if (!Number.isInteger(snapshotIntervalSeconds) || snapshotIntervalSeconds < 0 || snapshotIntervalSeconds > 86_400) {
    throw new Error('SPROUT_SNAPSHOT_INTERVAL_SECONDS must be an integer between 0 and 86400');
  }

  return {
    chain,
    dbPath,
    port: Number(env.PORT ?? env.SPROUT_PORT ?? 4317),
    bind: env.SPROUT_BIND ?? env.HOST ?? '127.0.0.1',
    adminToken: env.SPROUT_ADMIN_TOKEN,
    // A configured keeper key is a server-side secret. It is allowed on a live
    // chain; createChainContext separately refuses well-known Anvil dev keys
    // unless the RPC is loopback on chain 31337.
    keeperPrivateKey: isPrivateKey(env.SPROUT_KEEPER_PRIVATE_KEY) ? env.SPROUT_KEEPER_PRIVATE_KEY : undefined,
    useLocalKeys,
    allowFixtures,
    serveWeb: env.SPROUT_SERVE_WEB ? env.SPROUT_SERVE_WEB === '1' : isProduction,
    webDistPath: env.SPROUT_WEB_DIST ?? join(process.cwd(), 'web', 'dist'),
    startBlock,
    maxLogRange,
    snapshotIntervalSeconds,
    publicWalletRpcUrl: env.SPROUT_PUBLIC_WALLET_RPC_URL,
    settlementDecimals: env.SPROUT_SETTLEMENT_DECIMALS ? Number(env.SPROUT_SETTLEMENT_DECIMALS) : undefined,
    keeperMaxFeePerGasWei: parseWei(env.SPROUT_KEEPER_MAX_FEE_PER_GAS_WEI),
    keeperMaxPriorityFeePerGasWei: parseWei(env.SPROUT_KEEPER_MAX_PRIORITY_FEE_PER_GAS_WEI),
    keeperGasLimitCap: parseWei(env.SPROUT_KEEPER_GAS_LIMIT_CAP),
    keeperDailyFeeBudgetWei: parseWei(env.SPROUT_KEEPER_DAILY_FEE_BUDGET_WEI),
  };
}
