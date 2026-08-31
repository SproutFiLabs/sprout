import { describe, expect, test } from 'bun:test';
import type { Address } from 'viem';
import { connectWallet, contractWriter, assertWalletReady, type Eip1193Provider } from '../src/wallet';

const ADDRESS = '0x00000000000000000000000000000000000000a1' as Address;

function fakeProvider(options: { chainId: number; accounts: string[] }) {
  const calls: string[] = [];
  const provider: Eip1193Provider = {
    request: async ({ method }) => {
      calls.push(method);
      if (method === 'eth_requestAccounts' || method === 'eth_accounts') return options.accounts;
      if (method === 'eth_chainId') return `0x${options.chainId.toString(16)}`;
      if (method === 'eth_sendTransaction') return `0x${'ab'.repeat(32)}`;
      return '0x0';
    },
  };
  return { provider, calls, options };
}

function setWindow(provider: Eip1193Provider): void {
  (globalThis as unknown as { window: { ethereum: Eip1193Provider } }).window = { ethereum: provider };
}

function stubWrite(wallet: Awaited<ReturnType<typeof connectWallet>>): {
  seen: () => Record<string, unknown> | null;
  writes: () => number;
} {
  const state = { seen: null as Record<string, unknown> | null, count: 0 };
  (wallet.walletClient as unknown as { writeContract: unknown }).writeContract = async (params: unknown) => {
    state.seen = params as Record<string, unknown>;
    state.count += 1;
    return `0x${'ab'.repeat(32)}`;
  };
  return { seen: () => state.seen, writes: () => state.count };
}

describe('wallet chain binding', () => {
  test('keeps a chain object even when no public RPC URL is supplied', async () => {
    const { provider } = fakeProvider({ chainId: 31337, accounts: [ADDRESS] });
    setWindow(provider);
    const wallet = await connectWallet({ chainId: 31337, name: 'Anvil' });
    expect(wallet.chain.id).toBe(31337);
    expect(wallet.walletClient.chain?.id).toBe(31337);
  });

  test('wrong live chain is rejected before any write is submitted', async () => {
    const { provider, calls } = fakeProvider({ chainId: 1, accounts: [ADDRESS] });
    setWindow(provider);
    const wallet = await connectWallet({ chainId: 31337, name: 'Anvil' });
    const spy = stubWrite(wallet);
    await expect(contractWriter(wallet)({ address: ADDRESS, abi: [], functionName: 'x' })).rejects.toThrow(/Wrong network/);
    expect(spy.writes()).toBe(0);
    expect(calls).not.toContain('eth_sendTransaction');
  });

  test('binds the expected chain into the write params', async () => {
    const { provider } = fakeProvider({ chainId: 31337, accounts: [ADDRESS] });
    setWindow(provider);
    const wallet = await connectWallet({ chainId: 31337, name: 'Anvil' });
    const spy = stubWrite(wallet);
    await contractWriter(wallet)({ address: ADDRESS, abi: [], functionName: 'x' });
    expect(spy.writes()).toBe(1);
    expect((spy.seen()?.chain as { id?: number } | undefined)?.id).toBe(31337);
  });

  test('rejects a changed account', async () => {
    const { provider, options } = fakeProvider({ chainId: 31337, accounts: [ADDRESS] });
    setWindow(provider);
    const wallet = await connectWallet({ chainId: 31337, name: 'Anvil' });
    options.accounts = [];
    await expect(assertWalletReady(wallet)).rejects.toThrow(/account changed/);
    const spy = stubWrite(wallet);
    await expect(contractWriter(wallet)({ address: ADDRESS, abi: [], functionName: 'x' })).rejects.toThrow(/account changed/);
    expect(spy.writes()).toBe(0);
  });
});
