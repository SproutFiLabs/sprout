import { describe, expect, test } from 'bun:test';
import { decodeFunctionData, erc20Abi, type Hex } from 'viem';
import { ROBINHOOD_BURN_ROUTE as R, decodeBurnCalldata, permit2Abi } from '@sprout/shared';
import { openDb } from '../src/db';
import { runRecurringBurn, recurringBurnView, RECURRING_BURN_USDG, type RecurringBurnDeps } from '../src/recurringBurn';
import { createRecurringBurnRuntime } from '../src/recurringBurnRuntime';
const wallet = '0x0000000000000000000000000000000000000042';
function setup() {
  const db = openDb(':memory:');
  let now = 2000000000,
    nonce = 0,
    balance = 50000000n,
    gas = 100000000n,
    allowance = 5000000n,
    permit = 5000000n,
    expiry = now + 10000;
  let pending = false,
    reverted = false,
    broadcastError = false,
    recordError = false,
    fee = 2n;
  const signed: any[] = [];
  const sent: Hex[] = [];
  const d: RecurringBurnDeps = {
    db,
    now: () => now,
    client: {
      readContract: async ({ address, functionName }: any) =>
        functionName === 'balanceOf' ? balance : address === R.usdg ? allowance : [permit, expiry, 0],
    } as never,
    chain: {
      chainId: async () => 4663,
      nonce: async () => nonce,
      balance: async () => gas,
      estimateGas: async () => 100n,
      feePerGas: async () => ({ maxFeePerGas: fee, maxPriorityFeePerGas: 1n }),
      sendRawTransaction: async (raw) => {
        sent.push(raw);
        if (broadcastError) throw new Error('timeout');
        nonce++;
        const tx = signed.at(-1);
        if (tx.to === R.usdg) {
          const c = decodeFunctionData({ abi: erc20Abi, data: tx.data });
          allowance = c.args![1] as bigint;
        } else if (tx.to === R.permit2) {
          const c = decodeFunctionData({ abi: permit2Abi, data: tx.data });
          permit = c.args![2] as bigint;
          expiry = Number(c.args![3]);
        }
        return ('0x' + '1'.repeat(64)) as Hex;
      },
      receipt: async () =>
        pending ? null : { status: reverted ? 'reverted' : 'success', blockNumber: 1n, gasUsed: 100n, effectiveGasPrice: 2n },
    },
    signer: {
      address: wallet,
      signTransaction: async (tx) => {
        signed.push(tx);
        return ('0x' + signed.length.toString(16).padStart(4, '0')) as Hex;
      },
    },
    budget: { maxFeePerGasWei: 10n, maxPriorityFeePerGasWei: 2n, gasLimitCap: 200n, dailyFeeBudgetWei: 10000n },
    quote: async () => 1000000n,
    record: async () => {
      if (recordError) throw new Error('temporarily unreadable receipt');
      return { usdg: '5000000', at: now };
    },
  };
  return {
    d,
    db,
    signed,
    sent,
    tick: () => runRecurringBurn(d),
    view: () => recurringBurnView(db, true, wallet),
    time: (t: number) => {
      now = t;
    },
    now: () => now,
    usd: (b: bigint) => {
      balance = b;
    },
    gas: (g: bigint) => {
      gas = g;
    },
    allow: () => {
      allowance = 0n;
      permit = 0n;
    },
    pending: (p: boolean) => {
      pending = p;
    },
    revert: () => {
      reverted = true;
    },
    broadcastError: (b: boolean) => {
      broadcastError = b;
    },
    recordError: (b: boolean) => {
      recordError = b;
    },
    fee: () => {
      fee = 20n;
    },
  };
}
describe('daily project buy and burn', () => {
  test('spends exactly $5 with a positive floor and the fixed dead-address route; no early or catch-up runs', async () => {
    const s = setup();
    await s.tick();
    expect(s.signed).toHaveLength(1);
    const decoded = decodeBurnCalldata(s.signed[0].data, R)!;
    expect(decoded.usdgIn).toBe(RECURRING_BURN_USDG);
    expect(decoded.minSproutOut).toBeGreaterThan(0n);
    await s.tick();
    expect(s.view().count).toBe(1);
    expect(s.view().nextRunAt).toBe(s.now() + 86400);
    s.time(s.now() + 86399);
    await s.tick();
    expect(s.signed).toHaveLength(1);
    s.time(s.now() + 86400 * 40);
    await s.tick();
    expect(s.signed).toHaveLength(2);
    s.db.close();
  });
  test('restart after mined swap records the existing burn without another transaction', async () => {
    const s = setup();
    await s.tick();
    s.recordError(true);
    await expect(s.tick()).rejects.toThrow();
    s.recordError(false);
    await s.tick();
    expect(s.signed).toHaveLength(1);
    expect(s.view().count).toBe(1);
    s.db.close();
  });
  test('uncertain broadcasts only retry identical signed bytes and never allocate another nonce', async () => {
    const s = setup();
    s.pending(true);
    s.broadcastError(true);
    await s.tick();
    await s.tick();
    expect(s.signed).toHaveLength(1);
    expect(new Set(s.sent).size).toBe(1);
    s.broadcastError(false);
    s.pending(false);
    await s.tick();
    await s.tick();
    expect(s.signed).toHaveLength(1);
    expect(s.view().count).toBe(1);
    s.db.close();
  });
  test('no funding or gas means no signing', async () => {
    const s = setup();
    s.usd(4999999n);
    await s.tick();
    expect(s.view().status).toBe('awaiting-usdg');
    s.usd(5000000n);
    s.gas(0n);
    await s.tick();
    expect(s.view().status).toBe('awaiting-gas');
    expect(s.signed).toHaveLength(0);
    s.db.close();
  });
  test('reverts defer the next attempt by a full day', async () => {
    const s = setup();
    s.revert();
    await s.tick();
    await s.tick();
    expect(s.signed).toHaveLength(1);
    expect(s.view().count).toBe(0);
    expect(s.view().nextRunAt).toBe(s.now() + 86400);
    s.db.close();
  });
  test('duplicate ticks do not double-spend', async () => {
    const s = setup();
    await Promise.all([s.tick(), s.tick(), s.tick()]);
    expect(s.signed).toHaveLength(1);
    expect(s.view().count).toBe(1);
    s.db.close();
  });
  test('approvals are exact and precede the swap', async () => {
    const s = setup();
    s.allow();
    await s.tick();
    await s.tick();
    await s.tick();
    await s.tick();
    expect(s.signed.map((t) => t.to)).toEqual([R.usdg, R.permit2, R.router]);
    expect(s.view().count).toBe(1);
    s.db.close();
  });
  test('expired approved run is deferred instead of repeatedly spending gas', async () => {
    const s = setup();
    s.allow();
    await s.tick();
    await s.tick();
    s.time(s.now() + 2000);
    await s.tick();
    expect(s.signed).toHaveLength(2);
    expect(s.view().count).toBe(0);
    s.db.close();
  });
  test('gas caps refuse signing', async () => {
    const s = setup();
    s.fee();
    await s.tick();
    expect(s.signed).toHaveLength(0);
    expect(s.view().status).toBe('fee-cap-exceeded');
    s.db.close();
  });
  test('disabled runtime does not load a signer or initiate a run', async () => {
    const r = createRecurringBurnRuntime({} as never, {} as never, {});
    await r.tick();
    expect(r.view().enabled).toBe(false);
    r.close();
  });
});
