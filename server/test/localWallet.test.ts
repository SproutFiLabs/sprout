import { afterEach, describe, expect, test } from 'bun:test';
import { loadChainConfig } from '@sprout/shared';
import type { ChainContext } from '../src/chain';
import { advanceLocalTime, assertLoopbackRequest, fundLocalAccount, handleLocalRpc, localWalletStatus } from '../src/localWallet';
import { memoryDb } from './helpers';

const DEV = '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266';
const OTHER_DEV = '0x70997970C51812dc3A010C7d01b50e0d17dc79C8';
const TOKEN = '0x00000000000000000000000000000000000000b2';
const FEED = '0x00000000000000000000000000000000000000f1';
const VAULT = '0x00000000000000000000000000000000000000a1';
const HASH = `0x${'ab'.repeat(32)}`;

function fakeCtx(
  opts: {
    chainId?: number;
    rpcUrl?: string;
    actual?: number;
    allowFixtures?: boolean;
    receiptStatus?: 'success' | 'reverted';
  } = {},
): ChainContext {
  const chainId = opts.chainId ?? 31337;
  const chain = loadChainConfig({
    SPROUT_CHAIN_ID: String(chainId),
    SPROUT_RPC_URL: opts.rpcUrl ?? 'http://127.0.0.1:18545',
    SPROUT_FACTORY_ADDRESS: '0x00000000000000000000000000000000000000aa',
    SPROUT_SETTLEMENT_TOKEN: TOKEN,
    SPROUT_VENUE_ADDRESS: '0x00000000000000000000000000000000000000bb',
    SPROUT_STOCK_TOKENS: `AAA:${TOKEN}:18:1000000000000000000:${FEED}`,
  });
  const publicClient = {
    getChainId: async () => opts.actual ?? 31337,
    readContract: async ({ functionName }: { functionName: string }) => {
      if (functionName === 'decimals') return 6;
      if (functionName === 'latestAnswer') return 100n * 10n ** 8n;
      return 1n;
    },
    waitForTransactionReceipt: async () => ({ status: opts.receiptStatus ?? 'success' }),
    getBlock: async () => ({ timestamp: 123 }),
    request: async () => '0x1',
  };
  const walletClient = {
    account: { address: DEV },
    chain: null,
    writeContract: async () => HASH,
  };
  return {
    config: {
      chain,
      dbPath: ':memory:',
      port: 0,
      allowFixtures: opts.allowFixtures ?? true,
      useLocalKeys: true,
    },
    publicClient,
    walletClient,
    walletAddress: DEV,
    walletIsAnvilDev: false,
  } as unknown as ChainContext;
}

const originalFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe('local wallet guards', () => {
  test('enabled only for local demo on a loopback 31337 RPC', async () => {
    expect((await localWalletStatus(fakeCtx(), memoryDb())).enabled).toBe(true);
    expect((await localWalletStatus(fakeCtx({ chainId: 4663 }), memoryDb())).enabled).toBe(false);
    expect((await localWalletStatus(fakeCtx({ actual: 1 }), memoryDb())).enabled).toBe(false);
    expect((await localWalletStatus(fakeCtx({ rpcUrl: 'https://rpc.example.invalid' }), memoryDb())).enabled).toBe(false);
    expect((await localWalletStatus(fakeCtx({ allowFixtures: false }), memoryDb())).enabled).toBe(false);
  });

  test('rejects non-loopback origins and accepts loopback', () => {
    expect(() => assertLoopbackRequest('https://evil.example.com', '127.0.0.1:4317')).toThrow(/loopback/);
    expect(() => assertLoopbackRequest(undefined, '192.168.1.20:4317')).toThrow(/loopback/);
    expect(() => assertLoopbackRequest('http://127.0.0.1:5174', '127.0.0.1:4317')).not.toThrow();
    expect(() => assertLoopbackRequest(undefined, '127.0.0.1:4317')).not.toThrow();
  });

  test('rejects unknown accounts and disallowed methods without any upstream call', async () => {
    const db = memoryDb();
    let fetched = 0;
    globalThis.fetch = (async () => {
      fetched += 1;
      throw new Error('should not forward');
    }) as unknown as typeof fetch;
    await expect(handleLocalRpc(fakeCtx(), db, '0x0000000000000000000000000000000000000001', { method: 'eth_call' })).rejects.toThrow(/unknown/);
    await expect(handleLocalRpc(fakeCtx(), db, DEV, { method: 'eth_sign' })).rejects.toThrow(/not allowed/);
    await expect(handleLocalRpc(fakeCtx(), db, DEV, { method: 'eth_signTypedData_v4' })).rejects.toThrow(/not allowed/);
    expect(fetched).toBe(0);
  });

  test('sendTransaction must match the account and target an allowlisted contract', async () => {
    const db = memoryDb();
    await expect(
      handleLocalRpc(fakeCtx(), db, DEV, {
        method: 'eth_sendTransaction',
        params: [{ from: OTHER_DEV, to: TOKEN, data: '0x' }],
      }),
    ).rejects.toThrow(/from does not match/);
    await expect(
      handleLocalRpc(fakeCtx(), db, DEV, {
        method: 'eth_sendTransaction',
        params: [{ from: DEV, to: '0x0000000000000000000000000000000000000099', data: '0x' }],
      }),
    ).rejects.toThrow(/not an allowlisted contract/);
    await expect(
      handleLocalRpc(fakeCtx(), db, DEV, {
        method: 'eth_sendTransaction',
        params: [{ from: DEV, to: TOKEN, data: '0x', value: '0x1' }],
      }),
    ).rejects.toThrow(/value transfers/);
  });

  test('personal_sign binds the signing address with no upstream call on mismatch', async () => {
    const db = memoryDb();
    let fetched = 0;
    globalThis.fetch = (async () => {
      fetched += 1;
      return { ok: true, json: async () => ({ result: '0xsig' }) } as unknown as Response;
    }) as unknown as typeof fetch;

    await expect(
      handleLocalRpc(fakeCtx(), db, DEV, { method: 'personal_sign', params: ['0x1234', OTHER_DEV] }),
    ).rejects.toThrow(/does not match/);
    await expect(handleLocalRpc(fakeCtx(), db, DEV, { method: 'personal_sign', params: ['0x1234'] })).rejects.toThrow(/expects/);
    await expect(handleLocalRpc(fakeCtx(), db, DEV, { method: 'personal_sign', params: [1234, DEV] })).rejects.toThrow(/hex/);
    await expect(handleLocalRpc(fakeCtx(), db, DEV, { method: 'personal_sign', params: ['0x1234', 'not-an-address'] })).rejects.toThrow(/malformed/);
    expect(fetched).toBe(0);

    // A correctly bound request does forward upstream.
    const result = await handleLocalRpc(fakeCtx(), db, DEV, { method: 'personal_sign', params: ['0x1234', DEV] });
    expect(fetched).toBe(1);
    expect(result).toEqual({ result: '0xsig' });
  });

  test('fund tool only mints configured mock tokens', async () => {
    const db = memoryDb();
    await expect(fundLocalAccount(fakeCtx(), db, { account: DEV, token: VAULT, amount: '1' })).rejects.toThrow(/configured mock/);
    const result = await fundLocalAccount(fakeCtx(), db, { account: DEV, amount: '1' });
    expect(result.token.toLowerCase()).toBe(TOKEN.toLowerCase());
  });

  test('advance time reports truthful partial feed-refresh failures', async () => {
    const db = memoryDb();
    const result = await advanceLocalTime(fakeCtx({ receiptStatus: 'reverted' }), db, 3600);
    expect(result.refreshedFeeds).toHaveLength(0);
    expect(result.failedFeeds).toHaveLength(1);
    expect(result.label).toContain('failed');
  });
});
