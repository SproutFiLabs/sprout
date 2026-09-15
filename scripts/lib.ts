import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  createPublicClient,
  createWalletClient,
  http,
  type Abi,
  type Address,
  type Chain,
  type Hex,
  type PublicClient,
  type WalletClient,
} from 'viem';
import { privateKeyToAccount, type PrivateKeyAccount } from 'viem/accounts';

export const ROOT = join(import.meta.dir, '..');
export const CONTRACTS_OUT = join(ROOT, 'contracts', 'out');

export const anvilChain: Chain = {
  id: 31337,
  name: 'Anvil',
  nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
  rpcUrls: { default: { http: ['http://127.0.0.1:18545'] } },
  testnet: true,
};

/** Well-known Anvil development keys. Local chain only. */
export const ANVIL_KEYS = [
  '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80',
  '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d',
  '0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a',
] as const;

export const deployerAccount = privateKeyToAccount(ANVIL_KEYS[0]);
export const parentAccount = privateKeyToAccount(ANVIL_KEYS[0]);
export const beneficiaryAccount = privateKeyToAccount(ANVIL_KEYS[1]);
export const gifterAccount = privateKeyToAccount(ANVIL_KEYS[2]);

/**
 * A forking Anvil answers the first touch of any mainnet account or storage
 * slot by fetching it upstream, which can exceed viem's 10s default. Callers
 * that fork (see mainnet-fork-test) raise this; local Anvil runs keep the
 * default so a genuinely hung node still fails fast.
 */
export function transportFor(rpcUrl: string) {
  const timeout = Number(process.env.SPROUT_RPC_TIMEOUT_MS ?? '');
  return Number.isFinite(timeout) && timeout > 0 ? http(rpcUrl, { timeout }) : http(rpcUrl);
}

export function rpcClients(rpcUrl: string): { publicClient: PublicClient; walletClient: WalletClient } {
  const chain: Chain = { ...anvilChain, rpcUrls: { default: { http: [rpcUrl] } } };
  const publicClient = createPublicClient({ chain, transport: transportFor(rpcUrl) });
  const walletClient = createWalletClient({ account: deployerAccount, chain, transport: transportFor(rpcUrl) });
  return { publicClient, walletClient };
}

export function accountClient(rpcUrl: string, account: PrivateKeyAccount): WalletClient {
  const chain: Chain = { ...anvilChain, rpcUrls: { default: { http: [rpcUrl] } } };
  return createWalletClient({ account, chain, transport: transportFor(rpcUrl) });
}

export interface Artifact {
  abi: Abi;
  bytecode: Hex;
}

export function artifact(contractFile: string, contractName: string): Artifact {
  const raw = JSON.parse(readFileSync(join(CONTRACTS_OUT, contractFile, `${contractName}.json`), 'utf8')) as {
    abi: Abi;
    bytecode: { object: Hex };
  };
  return { abi: raw.abi, bytecode: raw.bytecode.object };
}

export async function deploy(
  publicClient: PublicClient,
  walletClient: WalletClient,
  contractFile: string,
  contractName: string,
  args: readonly unknown[] = [],
): Promise<Address> {
  const { abi, bytecode } = artifact(contractFile, contractName);
  const hash = await walletClient.deployContract({
    account: deployerAccount,
    abi,
    bytecode,
    args,
  } as never);
  const receipt = await publicClient.waitForTransactionReceipt({ hash: hash as Hex });
  if (!receipt.contractAddress) throw new Error(`deployment of ${contractName} produced no address`);
  return receipt.contractAddress;
}

export async function signedPost<T>(
  baseUrl: string,
  path: string,
  signer: PrivateKeyAccount,
  purpose: string,
  body: unknown,
): Promise<T> {
  const nonceRes = await fetch(`${baseUrl}/api/auth/nonce`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ address: signer.address, purpose }),
  });
  if (!nonceRes.ok) throw new Error(`nonce request failed: ${nonceRes.status}`);
  const challenge = (await nonceRes.json()) as { nonce: string; message: string };
  const signature = await signer.signMessage({ message: challenge.message });
  const res = await fetch(`${baseUrl}${path}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-sprout-address': signer.address,
      'x-sprout-nonce': challenge.nonce,
      'x-sprout-signature': signature,
    },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${path} -> ${res.status} ${text}`);
  return JSON.parse(text) as T;
}

export async function post<T>(baseUrl: string, path: string, body: unknown): Promise<T> {
  const res = await fetch(`${baseUrl}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${path} -> ${res.status} ${text}`);
  return JSON.parse(text) as T;
}

export async function getJson<T>(baseUrl: string, path: string): Promise<T> {
  const res = await fetch(`${baseUrl}${path}`);
  const text = await res.text();
  if (!res.ok) throw new Error(`${path} -> ${res.status} ${text}`);
  return JSON.parse(text) as T;
}

export async function waitForRpc(rpcUrl: string, timeoutMs = 20_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(rpcUrl, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_blockNumber', params: [] }),
      });
      if (res.ok) return;
    } catch {
      // retry
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error(`RPC at ${rpcUrl} did not become ready`);
}
