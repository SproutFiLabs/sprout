import { erc20Abi, parseUnits, type Address, type Hex } from 'viem';
import { LOCAL_DEV_ACCOUNTS, isKnownDevAccount, isLoopbackHost, isLoopbackRpcUrl, type ChainContext } from './chain';
import type { SproutDb } from './db';
import { mockErc20Abi, mockPriceFeedAbi } from '@sprout/shared';
import { listAllVaults } from './indexer';

/**
 * Methods the browser local-demo transport may call. It allows read/estimate
 * calls, `eth_sendTransaction` (validated below), and `personal_sign` bound to
 * the selected known dev account only. Typed-data/raw signing, wallet/admin
 * namespaces and any other state mutation are excluded. `eth_sign` is not
 * allowed because the UI only performs EIP-191 `personal_sign` message signing.
 */
const ALLOWED_METHODS = new Set([
  'eth_chainId',
  'eth_accounts',
  'eth_requestAccounts',
  'eth_call',
  'eth_estimateGas',
  'eth_getTransactionCount',
  'eth_gasPrice',
  'eth_maxPriorityFeePerGas',
  'eth_feeHistory',
  'eth_blockNumber',
  'eth_getCode',
  'eth_getLogs',
  'eth_getBlockByNumber',
  'eth_getTransactionReceipt',
  'eth_getBalance',
  'net_version',
  'web3_clientVersion',
  'eth_sendTransaction',
  // EIP-191 message signing only, and only ever for the selected known dev
  // account on loopback chain 31337. Typed-data and raw signing stay disallowed.
  'personal_sign',
]);

export interface LocalWalletStatus {
  enabled: boolean;
  reason?: string;
  chainId: number;
  accounts: Array<{ address: Address; label: string; role: string }>;
  actualChainId?: number;
}

export class LocalWalletError extends Error {
  status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.name = 'LocalWalletError';
    this.status = status;
  }
}

/**
 * Enabled only when the configured chain is 31337, the configured RPC is
 * loopback, local demo mode is on, and the RPC itself reports chain 31337.
 */
export async function localWalletStatus(ctx: ChainContext, db: SproutDb): Promise<LocalWalletStatus> {
  void db;
  const chain = ctx.config.chain;
  const base: LocalWalletStatus = {
    enabled: false,
    chainId: chain.chainId,
    accounts: LOCAL_DEV_ACCOUNTS.map((a) => ({ address: a.address, label: a.label, role: a.role })),
  };
  if (chain.chainId !== 31337) return { ...base, reason: 'configured chain is not 31337' };
  if (!ctx.config.allowFixtures) return { ...base, reason: 'local demo mode is not enabled' };
  if (!isLoopbackRpcUrl(chain.rpcUrl)) return { ...base, reason: 'RPC is not loopback' };
  if (!ctx.publicClient) return { ...base, reason: 'RPC is not configured' };
  try {
    const actual = await ctx.publicClient.getChainId();
    base.actualChainId = actual;
    if (actual !== 31337) return { ...base, reason: `RPC reports chain ${actual}, not 31337` };
  } catch {
    return { ...base, reason: 'could not read RPC chain id' };
  }
  return { ...base, enabled: true };
}

async function assertEnabled(ctx: ChainContext, db: SproutDb): Promise<void> {
  const status = await localWalletStatus(ctx, db);
  if (!status.enabled) throw new LocalWalletError(`local wallet disabled: ${status.reason}`, 403);
}

export function assertLoopbackRequest(origin: string | undefined, host: string | undefined): void {
  const originLoopback = origin ? isLoopbackHost(new URL(origin).hostname) : false;
  if (origin) {
    if (!originLoopback) throw new LocalWalletError('local wallet is only available from loopback origins', 403);
    return;
  }
  if (!isLoopbackHost(host)) throw new LocalWalletError('local wallet requires a loopback request', 403);
}

/** Mock tokens that the fund tool may mint: the configured settlement and stocks only. */
function configuredMockTokens(ctx: ChainContext): Set<string> {
  const set = new Set<string>();
  const contracts = ctx.config.chain.contracts;
  if (contracts.settlementToken) set.add(contracts.settlementToken.toLowerCase());
  for (const token of contracts.stockTokens) set.add(token.address.toLowerCase());
  return set;
}

function allowedRecipients(ctx: ChainContext, db: SproutDb): Set<string> {
  const set = new Set<string>();
  const contracts = ctx.config.chain.contracts;
  for (const address of [contracts.factory, contracts.settlementToken, contracts.venue]) {
    if (address) set.add(address.toLowerCase());
  }
  for (const legacy of contracts.legacyDeployments ?? []) {
    set.add(legacy.factory.toLowerCase());
    set.add(legacy.venue.toLowerCase());
  }
  for (const token of contracts.stockTokens) set.add(token.address.toLowerCase());
  // Holder perks on the local chain: approve the (mock) SPROUT, then lock or withdraw at the root lock.
  for (const address of [process.env.SPROUT_HOLDER_TOKEN, process.env.SPROUT_ROOT_LOCK_ADDRESS, process.env.SPROUT_V3_FACTORY, process.env.SPROUT_V3_MATCHING, process.env.SPROUT_V3_ROUNDUP_MODULE, process.env.SPROUT_V3_EVENT_BOOK]) {
    if (address && /^0x[0-9a-fA-F]{40}$/.test(address.trim())) set.add(address.trim().toLowerCase());
  }
  for (const vault of listAllVaults(db, ctx.config.chain.chainId)) set.add(vault.toLowerCase());
  for (const account of LOCAL_DEV_ACCOUNTS) set.add(account.address.toLowerCase());
  return set;
}

interface JsonRpcRequest {
  jsonrpc?: string;
  id?: unknown;
  method?: string;
  params?: unknown[];
}

async function forwardRpc(ctx: ChainContext, body: unknown): Promise<unknown> {
  const rpcUrl = ctx.config.chain.rpcUrl;
  if (!rpcUrl) throw new LocalWalletError('RPC is not configured', 503);
  const res = await fetch(rpcUrl, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new LocalWalletError(`RPC responded ${res.status}`, 502);
  return res.json();
}

/**
 * Restricted JSON-RPC proxy for the browser local-demo provider. Forwards only
 * whitelisted read/estimate methods plus `eth_sendTransaction`, which must
 * originate from the selected dev account and target an allowlisted contract.
 */
export async function handleLocalRpc(
  ctx: ChainContext,
  db: SproutDb,
  account: string,
  payload: JsonRpcRequest,
): Promise<unknown> {
  await assertEnabled(ctx, db);
  if (!isKnownDevAccount(account)) throw new LocalWalletError('unknown development account', 403);
  const method = payload?.method;
  if (!method || !ALLOWED_METHODS.has(method)) {
    throw new LocalWalletError(`method not allowed: ${String(method)}`, 403);
  }

  const body = { jsonrpc: '2.0', id: payload.id ?? 1, method, params: payload.params ?? [] };
  if (method === 'eth_sendTransaction') {
    const txs = body.params as Array<Record<string, unknown>>;
    const tx = txs[0];
    if (!tx || typeof tx !== 'object') throw new LocalWalletError('malformed transaction');
    if (tx.from && String(tx.from).toLowerCase() !== account.toLowerCase()) {
      throw new LocalWalletError('transaction from does not match the selected account', 403);
    }
    tx.from = account;
    if (!tx.to || !allowedRecipients(ctx, db).has(String(tx.to).toLowerCase())) {
      throw new LocalWalletError('transaction target is not an allowlisted contract', 403);
    }
    if (tx.value !== undefined && BigInt(String(tx.value)) !== 0n) {
      throw new LocalWalletError('value transfers are not permitted through the local wallet', 403);
    }
  }
  if (method === 'personal_sign') {
    // viem sends [message, address]. Bind the signing address to the selected
    // known dev account and reject malformed params before any upstream call.
    const params = body.params as unknown[];
    if (!Array.isArray(params) || params.length !== 2) {
      throw new LocalWalletError('personal_sign expects [message, address]', 403);
    }
    const [message, signer] = params;
    if (typeof message !== 'string' || !/^0x[0-9a-fA-F]*$/.test(message)) {
      throw new LocalWalletError('personal_sign message must be hex', 403);
    }
    if (typeof signer !== 'string' || !/^0x[0-9a-fA-F]{40}$/.test(signer)) {
      throw new LocalWalletError('personal_sign address is malformed', 403);
    }
    if (signer.toLowerCase() !== account.toLowerCase()) {
      throw new LocalWalletError('personal_sign address does not match the selected account', 403);
    }
  }
  return forwardRpc(ctx, body);
}

export interface FundResult {
  txHash: Hex;
  token: Address;
  to: Address;
  amount: string;
}

/** Mint mock tokens to a development account (local demo only). */
export async function fundLocalAccount(
  ctx: ChainContext,
  db: SproutDb,
  input: { account: string; token?: string; amount: string },
): Promise<FundResult> {
  await assertEnabled(ctx, db);
  if (!isKnownDevAccount(input.account)) throw new LocalWalletError('unknown development account', 403);
  const token = (input.token ?? ctx.config.chain.contracts.settlementToken) as Address | undefined;
  if (!token) throw new LocalWalletError('no token configured', 503);
  // Only configured mock settlement/stock tokens may be minted; the broader
  // allowlist (vaults, factory, accounts) is for transaction targets, not minting.
  if (!configuredMockTokens(ctx).has(token.toLowerCase())) {
    throw new LocalWalletError('token is not a configured mock settlement/stock token', 403);
  }
  if (!ctx.walletClient || !ctx.publicClient) throw new LocalWalletError('keeper wallet is not configured', 503);
  const decimals = (await ctx.publicClient.readContract({ address: token, abi: erc20Abi, functionName: 'decimals' })) as number;
  const amount = parseUnits(input.amount, Number(decimals));
  const hash = (await ctx.walletClient.writeContract({
    account: ctx.walletClient.account!,
    chain: ctx.walletClient.chain ?? null,
    address: token,
    abi: mockErc20Abi,
    functionName: 'mint',
    args: [input.account as Address, amount],
  } as never)) as Hex;
  const receipt = await ctx.publicClient.waitForTransactionReceipt({ hash });
  if (receipt.status !== 'success') throw new LocalWalletError(`mock mint reverted (${hash})`, 502);
  return { txHash: hash, token, to: input.account as Address, amount: amount.toString() };
}

export interface AdvanceTimeResult {
  advancedSeconds: number;
  timestamp: number;
  refreshedFeeds: Address[];
  failedFeeds: Array<{ feed: Address; error: string }>;
  label: string;
}

/**
 * Advance local Anvil time and refresh local mock feeds so they are not stale.
 * The `label` makes the local-only nature explicit in responses.
 */
export async function advanceLocalTime(
  ctx: ChainContext,
  db: SproutDb,
  seconds: number,
): Promise<AdvanceTimeResult> {
  await assertEnabled(ctx, db);
  if (!ctx.publicClient || !ctx.walletClient) throw new LocalWalletError('keeper wallet is not configured', 503);
  if (!Number.isFinite(seconds) || seconds <= 0 || seconds > 30 * 24 * 3600) {
    throw new LocalWalletError('seconds must be between 1 and 2592000');
  }
  await ctx.publicClient.request({ method: 'evm_increaseTime', params: [Math.floor(seconds)] } as never);
  await ctx.publicClient.request({ method: 'evm_mine', params: [] } as never);

  const refreshedFeeds: Address[] = [];
  const failedFeeds: Array<{ feed: Address; error: string }> = [];
  for (const token of ctx.config.chain.contracts.stockTokens) {
    if (!token.feedAddress) continue;
    try {
      const answer = (await ctx.publicClient.readContract({
        address: token.feedAddress,
        abi: mockPriceFeedAbi,
        functionName: 'latestAnswer',
      })) as bigint;
      const hash = (await ctx.walletClient.writeContract({
        account: ctx.walletClient.account!,
        chain: ctx.walletClient.chain ?? null,
        address: token.feedAddress,
        abi: mockPriceFeedAbi,
        functionName: 'setAnswer',
        args: [answer],
      } as never)) as Hex;
      const receipt = await ctx.publicClient.waitForTransactionReceipt({ hash });
      if (receipt.status !== 'success') {
        failedFeeds.push({ feed: token.feedAddress, error: `feed refresh reverted (${hash})` });
      } else {
        refreshedFeeds.push(token.feedAddress);
      }
    } catch (error) {
      failedFeeds.push({ feed: token.feedAddress, error: error instanceof Error ? error.message : String(error) });
    }
  }

  const block = await ctx.publicClient.getBlock({ blockTag: 'latest' });
  return {
    advancedSeconds: Math.floor(seconds),
    timestamp: Number(block.timestamp),
    refreshedFeeds,
    failedFeeds,
    label:
      failedFeeds.length === 0
        ? 'LOCAL DEMO ONLY: Anvil time advanced and mock feeds refreshed.'
        : `LOCAL DEMO ONLY: Anvil time advanced; ${failedFeeds.length} mock feed(s) failed to refresh.`,
  };
}
