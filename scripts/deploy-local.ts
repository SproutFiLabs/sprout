import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Address, PublicClient, WalletClient } from 'viem';
import { mockErc20Abi, mockSwapRouterAbi } from '@sprout/shared';
import { ROOT, anvilChain, deploy, deployerAccount, parentAccount, gifterAccount } from './lib';
import { installMulticall3, LOCAL_MULTICALL_ENV } from './lib/multicall3';

/** A fresh id for a new deployment. Anvil redeploys reuse deterministic
 *  addresses, so each deployment gets its own DB to avoid stale cursors/vaults. */
export function newDeploymentId(now: number = Date.now()): string {
  return now.toString(36);
}

/** Deployment-scoped SQLite path. Never the shared legacy `data/sprout.sqlite`. */
export function deploymentDbPath(root: string, deploymentId: string): string {
  return join(root, 'data', `sprout-${deploymentId}.sqlite`);
}

export interface LocalDeployment {
  chainId: number;
  rpcUrl: string;
  settlement: Address;
  stockA: Address;
  stockB: Address;
  feedA: Address;
  feedB: Address;
  router: Address;
  venue: Address;
  vaultImplementation: Address;
  factory: Address;
  /** A mock SPROUT (18 decimals, 1B supply) and a SproutRootLock for it: holder perks and "Root your SPROUT". */
  sproutToken: Address;
  rootLock: Address;
}

/** Mock SPROUT handed out on a local chain: the parent can root some, the gifter just holds. */
export const LOCAL_SPROUT = {
  supply: 1_000_000_000n * 10n ** 18n,
  parent: 3_000_000n * 10n ** 18n,
  gifter: 500_000n * 10n ** 18n,
  /** The rest of the supply sits here, so shares of the supply read like mainnet. */
  rest: '0x000000000000000000000000000000000000dEaD' as Address,
} as const;

async function send(
  publicClient: PublicClient,
  walletClient: WalletClient,
  request: { address: Address; abi: readonly unknown[]; functionName: string; args?: readonly unknown[] },
): Promise<void> {
  const hash = await walletClient.writeContract({ ...request, account: deployerAccount } as never);
  await publicClient.waitForTransactionReceipt({ hash: hash as `0x${string}` });
}

/**
 * Deploy the full local stack: mock settlement + stock tokens, oracle feeds, a
 * mock SwapRouter02 behind the real UniswapV3Adapter, the vault implementation
 * and a factory whose immutable admission policy lists the adapter and stocks.
 */
export async function deployLocal(
  publicClient: PublicClient,
  walletClient: WalletClient,
  rpcUrl: string,
): Promise<LocalDeployment> {
  const now = Math.floor(Date.now() / 1000);
  // Production reads batch through Multicall3; give the local node one too.
  await installMulticall3(publicClient);
  const settlement = await deploy(publicClient, walletClient, 'MockERC20.sol', 'MockERC20', ['USD', 'USD', 6]);
  const stockA = await deploy(publicClient, walletClient, 'MockERC20.sol', 'MockERC20', ['Stock A', 'AAA', 18]);
  const stockB = await deploy(publicClient, walletClient, 'MockERC20.sol', 'MockERC20', ['Stock B', 'BBB', 18]);
  const feedA = await deploy(publicClient, walletClient, 'MockPriceFeed.sol', 'MockPriceFeed', [8, 10_000_000_000n, now]);
  const feedB = await deploy(publicClient, walletClient, 'MockPriceFeed.sol', 'MockPriceFeed', [8, 5_000_000_000n, now]);
  const router = await deploy(publicClient, walletClient, 'MockSwapRouter.sol', 'MockSwapRouter', []);
  const venue = await deploy(publicClient, walletClient, 'UniswapV3Adapter.sol', 'UniswapV3Adapter', [
    router,
    settlement,
    [stockA, stockB],
    [feedA, feedB],
    [3000, 3000],
    3600n,
  ]);
  const vaultImplementation = await deploy(publicClient, walletClient, 'SproutVault.sol', 'SproutVault', []);
  const factory = await deploy(publicClient, walletClient, 'SproutFactory.sol', 'SproutFactory', [
    vaultImplementation,
    settlement,
    [stockA, stockB],
    [venue],
  ]);

  const e18 = 10n ** 18n;
  await send(publicClient, walletClient, { address: stockA, abi: mockErc20Abi, functionName: 'mint', args: [router, 1_000_000n * e18] });
  await send(publicClient, walletClient, { address: stockB, abi: mockErc20Abi, functionName: 'mint', args: [router, 1_000_000n * e18] });
  // 1 settlement = 0.01 AAA and 0.02 BBB, matching the adapter's oracle feeds.
  await send(publicClient, walletClient, { address: router, abi: mockSwapRouterAbi, functionName: 'setRate', args: [settlement, stockA, 10_000_000_000_000_000n] });
  await send(publicClient, walletClient, { address: router, abi: mockSwapRouterAbi, functionName: 'setRate', args: [settlement, stockB, 20_000_000_000_000_000n] });
  await send(publicClient, walletClient, { address: settlement, abi: mockErc20Abi, functionName: 'mint', args: [parentAccount.address, 1_000_000n * 10n ** 6n] });
  await send(publicClient, walletClient, { address: settlement, abi: mockErc20Abi, functionName: 'mint', args: [gifterAccount.address, 100_000n * 10n ** 6n] });

  // Deployed last, so every address above stays where the harnesses expect it.
  const sproutToken = await deploy(publicClient, walletClient, 'MockERC20.sol', 'MockERC20', ['Sprout', 'SPROUT', 18]);
  const rootLock = await deploy(publicClient, walletClient, 'SproutRootLock.sol', 'SproutRootLock', [sproutToken]);
  await send(publicClient, walletClient, { address: sproutToken, abi: mockErc20Abi, functionName: 'mint', args: [parentAccount.address, LOCAL_SPROUT.parent] });
  await send(publicClient, walletClient, { address: sproutToken, abi: mockErc20Abi, functionName: 'mint', args: [gifterAccount.address, LOCAL_SPROUT.gifter] });
  await send(publicClient, walletClient, {
    address: sproutToken,
    abi: mockErc20Abi,
    functionName: 'mint',
    args: [LOCAL_SPROUT.rest, LOCAL_SPROUT.supply - LOCAL_SPROUT.parent - LOCAL_SPROUT.gifter],
  });

  return {
    chainId: anvilChain.id,
    rpcUrl,
    settlement,
    stockA,
    stockB,
    feedA,
    feedB,
    router,
    venue,
    vaultImplementation,
    factory,
    sproutToken,
    rootLock,
  };
}

if (import.meta.main) {
  const rpcUrl = process.env.SPROUT_RPC_URL ?? 'http://127.0.0.1:18545';
  const { publicClient, walletClient } = await import('./lib').then((m) => m.rpcClients(rpcUrl));
  const deployment = await deployLocal(publicClient, walletClient, rpcUrl);
  const outDir = join(ROOT, 'tmp');
  mkdirSync(outDir, { recursive: true });
  const outPath = join(outDir, 'local-deployment.json');
  writeFileSync(outPath, JSON.stringify(deployment, null, 2));

  // Shell-sourceable environment for the local backend. The keeper key is a
  // well-known Anvil development key and is only ever exported to the server.
  const deploymentId = newDeploymentId();
  const envLines = [
    'SPROUT_DEPLOYMENT_VERSION=4',
    `SPROUT_DEPLOYMENT_ID=${deploymentId}`,
    'SPROUT_CHAIN_ID=31337',
    `SPROUT_RPC_URL=${rpcUrl}`,
    `SPROUT_FACTORY_ADDRESS=${deployment.factory}`,
    `SPROUT_SETTLEMENT_TOKEN=${deployment.settlement}`,
    `SPROUT_VENUE_ADDRESS=${deployment.venue}`,
    `SPROUT_STOCK_TOKENS=AAA:${deployment.stockA}:18:1000000000000000000:${deployment.feedA}:86400,BBB:${deployment.stockB}:18:1000000000000000000:${deployment.feedB}:86400`,
    'SPROUT_SETTLEMENT_DECIMALS=6',
    `SPROUT_MULTICALL3_ADDRESS=${LOCAL_MULTICALL_ENV.SPROUT_MULTICALL3_ADDRESS}`,
    'SPROUT_LOCAL_DEMO=1',
    'SPROUT_USE_LOCAL_KEYS=1',
    'SPROUT_KEEPER_PRIVATE_KEY=0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80',
    // Isolated local test budgets only; a live deployment must set its own caps.
    'SPROUT_KEEPER_MAX_FEE_PER_GAS_WEI=5000000000',
    'SPROUT_KEEPER_MAX_PRIORITY_FEE_PER_GAS_WEI=2000000000',
    'SPROUT_KEEPER_GAS_LIMIT_CAP=6000000',
    'SPROUT_KEEPER_DAILY_FEE_BUDGET_WEI=100000000000000000',
    `SPROUT_PUBLIC_WALLET_RPC_URL=${rpcUrl}`,
    // Holder perks against the mock SPROUT, with "Root your SPROUT" on.
    `SPROUT_HOLDER_TOKEN=${deployment.sproutToken}`,
    `SPROUT_ROOT_LOCK_ADDRESS=${deployment.rootLock}`,
    `SPROUT_DB_PATH=${deploymentDbPath(ROOT, deploymentId)}`,
    'SPROUT_PORT=4317',
    '',
  ];
  writeFileSync(join(outDir, 'local.env'), envLines.join('\n'));
  console.log(`deployed local stack, wrote ${outPath} and ${join(outDir, 'local.env')}`);
  console.log(JSON.stringify(deployment, null, 2));
}
