import {
  createPublicClient,
  createWalletClient,
  custom,
  getAddress,
  http,
  type Address,
  type Chain,
  type Hex,
  type PublicClient,
  type WalletClient,
} from 'viem';
import { t } from './i18n';

export interface Eip1193Provider {
  request: (args: { method: string; params?: unknown[] | object }) => Promise<unknown>;
  on?: (event: string, handler: (...args: unknown[]) => void) => void;
  removeListener?: (event: string, handler: (...args: unknown[]) => void) => void;
}

export interface WalletState {
  address: Address;
  /** Chain the user is expected to be on; every write re-checks and binds it. */
  chain: Chain;
  expectedChainId: number;
  chainName: string;
  walletClient: WalletClient;
  publicClient: PublicClient;
  provider: Eip1193Provider;
}

export interface ChainInput {
  chainId: number;
  name: string;
  rpcUrl?: string;
}

export function injectedProvider(): Eip1193Provider | null {
  const eth = (window as unknown as { ethereum?: Eip1193Provider }).ethereum;
  return eth ?? null;
}

/**
 * Build a viem Chain for the expected network. A public RPC URL is optional: the
 * injected wallet transport does not need one, but viem writes must always carry
 * a chain so a mid-flight network switch cannot retarget them.
 */
export function toChain(input: ChainInput): Chain {
  return {
    id: input.chainId,
    name: input.name,
    nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
    rpcUrls: { default: { http: input.rpcUrl ? [input.rpcUrl] : [] } },
    testnet: input.chainId !== 4663,
  };
}

export async function connectWallet(input: ChainInput): Promise<WalletState> {
  const provider = injectedProvider();
  if (!provider) throw new Error(t('No injected EIP-1193 wallet found. Install a browser wallet to connect.'));
  const accounts = (await provider.request({ method: 'eth_requestAccounts' })) as string[];
  if (!accounts[0]) throw new Error(t('Wallet returned no accounts'));
  const chain = toChain(input);
  const walletClient = createWalletClient({ account: getAddress(accounts[0]), chain, transport: custom(provider) });
  const publicClient = createPublicClient({ chain, transport: custom(provider) });
  return {
    address: getAddress(accounts[0]),
    chain,
    expectedChainId: input.chainId,
    chainName: input.name,
    walletClient,
    publicClient,
    provider,
  };
}

/**
 * Narrowed EIP-1193 transport for local demo mode. It never sees a private key:
 * writes are forwarded to the backend proxy, which only signs with allowlisted
 * Anvil development accounts against allowlisted local contracts.
 */
export function createLocalProvider(account: Address, chainId: number): Eip1193Provider {
  return {
    request: async ({ method, params }) => {
      if (method === 'eth_requestAccounts' || method === 'eth_accounts') return [account];
      if (method === 'eth_chainId') return `0x${chainId.toString(16)}`;
      const res = await fetch('/api/local/rpc', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-sprout-local-account': account },
        body: JSON.stringify({ jsonrpc: '2.0', id: Date.now(), method, params: params ?? [] }),
      });
      const json = (await res.json()) as { result?: unknown; error?: { message?: string } };
      if (!res.ok || json.error) {
        throw new Error(json.error?.message ?? `local wallet request failed (${res.status})`);
      }
      return json.result;
    },
  };
}

/** Connect a local demo role using an unlocked Anvil account through the proxy. */
export async function connectLocalWallet(input: {
  address: Address;
  chainId: number;
  name: string;
  rpcUrl?: string;
}): Promise<WalletState> {
  const provider = createLocalProvider(getAddress(input.address), input.chainId);
  const chain = toChain(input);
  const walletClient = createWalletClient({ account: getAddress(input.address), chain, transport: custom(provider) });
  const publicClient = input.rpcUrl
    ? createPublicClient({ chain, transport: http(input.rpcUrl) })
    : createPublicClient({ chain, transport: custom(provider) });
  return {
    address: getAddress(input.address),
    chain,
    expectedChainId: input.chainId,
    chainName: input.name,
    walletClient,
    publicClient,
    provider,
  };
}

export async function ensureChain(wallet: WalletState, input: ChainInput): Promise<void> {
  const target = `0x${input.chainId.toString(16)}`;
  const current = (await wallet.provider.request({ method: 'eth_chainId' })) as string;
  if (current.toLowerCase() === target.toLowerCase()) return;
  try {
    await wallet.provider.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: target }] });
  } catch (error) {
    const code = (error as { code?: number }).code;
    if (code === 4902 && input.rpcUrl) {
      await wallet.provider.request({
        method: 'wallet_addEthereumChain',
        params: [
          {
            chainId: target,
            chainName: input.name,
            nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
            rpcUrls: [input.rpcUrl],
          },
        ],
      });
    } else {
      throw error;
    }
  }
}

/** Re-check the live account and chain before every signature or write. */
export async function assertWalletReady(wallet: WalletState): Promise<void> {
  const [accounts, chainHex] = await Promise.all([
    wallet.provider.request({ method: 'eth_accounts' }) as Promise<string[]>,
    wallet.provider.request({ method: 'eth_chainId' }) as Promise<string>,
  ]);
  if (!accounts.some((a) => a.toLowerCase() === wallet.address.toLowerCase())) {
    throw new Error(t('The connected account changed. Reconnect the wallet.'));
  }
  const liveChain = Number.parseInt(chainHex, 16);
  if (liveChain !== wallet.expectedChainId) {
    throw new Error(t('Wrong network: expected chain {expected}, wallet is on {actual}.', { expected: wallet.expectedChainId, actual: liveChain }));
  }
}

export type ContractWriter = (params: {
  address: Address;
  abi: readonly unknown[];
  functionName: string;
  args?: readonly unknown[];
  value?: bigint;
}) => Promise<Hex>;

export function contractWriter(wallet: WalletState): ContractWriter {
  return async (params) => {
    await assertWalletReady(wallet);
    // Always pass the expected chain, never null, so an intervening switch cannot
    // silently submit the write to a different network.
    return (await wallet.walletClient.writeContract({ ...params, chain: wallet.chain } as never)) as Hex;
  };
}

export async function readContract(
  wallet: WalletState,
  params: { address: Address; abi: readonly unknown[]; functionName: string; args?: readonly unknown[] },
): Promise<unknown> {
  return wallet.publicClient.readContract(params as never);
}

export async function sign(message: string, wallet: WalletState): Promise<Hex> {
  await assertWalletReady(wallet);
  return wallet.walletClient.signMessage({ account: wallet.address, message });
}

let lastConfirmedBlock = 0;

/**
 * The newest block any transaction from this page confirmed in. Holdings
 * requests pass it along so the server does not answer from a cache that
 * predates the user's own deposit.
 */
export function latestConfirmedBlock(): number {
  return lastConfirmedBlock;
}

/** Wait for a receipt and reject reverted transactions. Resolves to the block number. */
export async function waitForSuccess(publicClient: PublicClient, hash: Hex): Promise<number> {
  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  if (receipt.status !== 'success') throw new Error(t('Transaction reverted: {hash}', { hash }));
  const block = Number(receipt.blockNumber);
  if (block > lastConfirmedBlock) lastConfirmedBlock = block;
  return block;
}
