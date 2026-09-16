import { describe, expect, test } from 'bun:test';
import { loadChainConfig } from '@sprout/shared';
import type { ChainContext } from '../src/chain';
import { insertChainEvent, upsertSprout } from '../src/repo';
import { memoryDb, testApp } from './helpers';

const VAULT = '0x00000000000000000000000000000000000000a1';
const USDG = '0x00000000000000000000000000000000000000b2';
const NVDA = '0x00000000000000000000000000000000000000c3';
const PARENT = '0x00000000000000000000000000000000000000d4';
const GRANDMA = '0x00000000000000000000000000000000000000e5';
const BLOCK_TIME = 1_789_000_000; // 2026-09-10T00:26:40Z

function ctx(getBlockCalls: number[]): ChainContext {
  const chain = loadChainConfig({
    SPROUT_CHAIN_ID: '31337',
    SPROUT_RPC_URL: 'http://127.0.0.1:18545',
    SPROUT_FACTORY_ADDRESS: '0x00000000000000000000000000000000000000aa',
    SPROUT_SETTLEMENT_TOKEN: USDG,
    SPROUT_SETTLEMENT_SYMBOL: 'USDG',
    SPROUT_VENUE_ADDRESS: '0x00000000000000000000000000000000000000bb',
    SPROUT_STOCK_TOKENS: `NVDA:${NVDA}:18:1000000000000000000:0x00000000000000000000000000000000000000f1:86400`,
  });
  return {
    config: { chain, dbPath: ':memory:', port: 0, allowFixtures: true, useLocalKeys: true },
    publicClient: {
      getBlock: async ({ blockNumber }: { blockNumber: bigint }) => {
        getBlockCalls.push(Number(blockNumber));
        return { number: blockNumber, timestamp: BigInt(BLOCK_TIME + Number(blockNumber)) };
      },
      readContract: async ({ functionName }: { functionName: string }) => {
        if (functionName === 'decimals') return 6;
        throw new Error(`unexpected ${functionName}`);
      },
    },
    walletClient: null,
    walletAddress: null,
    walletIsAnvilDev: false,
  } as unknown as ChainContext;
}

function seed() {
  const db = memoryDb();
  upsertSprout(db, {
    id: VAULT,
    chainId: 31337,
    parent: PARENT,
    beneficiary: GRANDMA,
    settlementToken: USDG,
    graduationTimestamp: 2_000_000_000,
    assets: [NVDA],
    weights: [10_000],
    createdTxHash: null,
    createdBlock: null,
  });
  let n = 0;
  const event = (block: number, eventName: string, payload: Record<string, unknown>) =>
    insertChainEvent(db, {
      chainId: 31337,
      txHash: `0x${(++n).toString(16).padStart(64, '0')}`,
      logIndex: 0,
      blockNumber: block,
      address: VAULT,
      eventName,
      vaultId: VAULT,
      payload,
    });
  event(10, 'SproutCreated', { vault: VAULT, parent: PARENT });
  event(10, 'Initialized', { version: '1' });
  event(11, 'Funded', { from: PARENT, token: USDG, amount: '25000000' });
  event(12, 'GiftReceived', { gifter: GRANDMA, token: USDG, amount: '10500000', giftRef: '0x01' });
  event(13, 'InvestmentExecuted', { token: NVDA, amountIn: '10000000', amountOut: '46192538531495987' });
  event(14, 'AllocationUpdated', { assets: [NVDA], weights: [10000] });
  event(15, 'Withdrawn', { token: USDG, amount: '1', to: '=HYPERLINK("http://x")' });
  return db;
}

describe('history download', () => {
  test('lists every family event in whole units with its transaction', async () => {
    const calls: number[] = [];
    const app = testApp(seed(), ctx(calls));
    const res = await app.request(`/api/sprouts/${VAULT}/history.csv`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/csv');
    expect(res.headers.get('content-disposition')).toBe('attachment; filename="sprout-000000-history.csv"');
    const lines = (await res.text()).trimEnd().split('\r\n');
    expect(lines[0]).toBe('date_utc,event,asset,amount,paid_with,paid_amount,counterparty,details,block,tx_hash');
    expect(lines).toHaveLength(7); // header + 6 rows; Initialized is left out
    expect(lines[1]).toStartWith('2026-09-10T00:26:50Z,Planted,');
    expect(lines[2]).toContain(`,Deposit,USDG,25,,,${PARENT},`);
    expect(lines[3]).toContain(`,Gift,USDG,10.5,,,${GRANDMA},`);
    expect(lines[4]).toContain(',Purchase,NVDA,0.046192538531495987,USDG,10,,');
    expect(lines[5]).toContain(',Mix changed,,,,,,NVDA 100%,14,');
    expect(lines[2]).toEndWith(`,11,0x${'3'.padStart(64, '0')}`); // the skipped Initialized event was tx 2
    // One chain read per distinct block, no matter how many events share it.
    expect(calls.sort()).toEqual([10, 11, 12, 13, 14, 15]);
  });

  test('a value that looks like a formula is neutralized', async () => {
    const app = testApp(seed(), ctx([]));
    const text = await (await app.request(`/api/sprouts/${VAULT}/history.csv`)).text();
    const withdrawal = text.split('\r\n').find((l) => l.includes(',Withdrawal,'))!;
    expect(withdrawal).toContain(`"'=HYPERLINK(""http://x"")"`);
  });

  test('unknown sprouts are a 404', async () => {
    const app = testApp(memoryDb(), ctx([]));
    expect((await app.request(`/api/sprouts/${VAULT}/history.csv`)).status).toBe(404);
  });
});
