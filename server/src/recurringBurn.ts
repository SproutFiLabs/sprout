import { randomUUID } from 'node:crypto';
import { encodeFunctionData, erc20Abi, type Address, type Hex, type PublicClient } from 'viem';
import {
  BURN_DEFAULT_SLIPPAGE_BPS,
  BURN_PERMIT_SECONDS,
  BURN_DEADLINE_SECONDS,
  ROBINHOOD_BURN_ROUTE as ROUTE,
  encodeBurnRoute,
  minOutFor,
  permit2Abi,
  quoteBurn,
} from '@sprout/shared';
import type { SproutDb } from './db';
import type { KeeperBudgetConfig } from './config';
import { runKeeperJob, withKeeperLock, type KeeperChain, type KeeperSigner } from './keeper';

export const RECURRING_BURN_USDG = 5_000_000n;
export const RECURRING_BURN_PERIOD = 86_400;
const PREFIX = 'recurring-burn:';
interface Run {
  id: string;
  wallet: string;
  started: number;
  status: string;
  tx: string | null;
}
export interface RecurringBurnView {
  enabled: boolean;
  wallet: string | null;
  usd: 5;
  periodSeconds: 86400;
  status: string;
  nextRunAt: number | null;
  lastTx: string | null;
  count: number;
}
export interface RecurringBurnDeps {
  db: SproutDb;
  client: Pick<PublicClient, 'readContract'>;
  chain: KeeperChain;
  signer: KeeperSigner;
  budget: KeeperBudgetConfig;
  now: () => number;
  quote: () => Promise<bigint>;
  record: (hash: Hex) => Promise<{ usdg: string; at: number }>;
}

export function initRecurringBurn(db: SproutDb): void {
  db.exec(`CREATE TABLE IF NOT EXISTS recurring_burn_state (id INTEGER PRIMARY KEY CHECK(id=1), next_at INTEGER NOT NULL DEFAULT 0, status TEXT NOT NULL DEFAULT 'waiting');
    INSERT OR IGNORE INTO recurring_burn_state(id) VALUES(1);
    CREATE TABLE IF NOT EXISTS recurring_burn_runs (id TEXT PRIMARY KEY, wallet TEXT NOT NULL, started INTEGER NOT NULL, status TEXT NOT NULL, tx TEXT);
    CREATE UNIQUE INDEX IF NOT EXISTS one_recurring_active ON recurring_burn_runs(status) WHERE status='active';
    CREATE UNIQUE INDEX IF NOT EXISTS one_recurring_stage ON keeper_txs(job_id) WHERE job_id LIKE 'recurring-burn:%';`);
}
export function recurringBurnView(db: SproutDb, enabled: boolean, wallet: string | null): RecurringBurnView {
  initRecurringBurn(db);
  const state = db.prepare('SELECT * FROM recurring_burn_state WHERE id=1').get() as { next_at: number; status: string };
  const last = db.prepare("SELECT tx FROM recurring_burn_runs WHERE status='completed' ORDER BY started DESC LIMIT 1").get() as {
    tx: string;
  } | null;
  const count = db.prepare("SELECT COUNT(*) AS n FROM recurring_burn_runs WHERE status='completed'").get() as { n: number };
  return {
    enabled,
    wallet,
    usd: 5,
    periodSeconds: 86400,
    status: enabled ? state.status : 'disabled',
    nextRunAt: state.next_at || null,
    lastTx: last?.tx ?? null,
    count: count.n,
  };
}

/** Separate operator database, separate wallet; no family-vault calls or spending. */
export async function runRecurringBurn(d: RecurringBurnDeps): Promise<void> {
  await withKeeperLock(async () => {
    const { db, signer } = d;
    initRecurringBurn(db);
    const now = d.now();
    const status = (s: string) => db.prepare('UPDATE recurring_burn_state SET status=? WHERE id=1').run(s);
    if ((await d.chain.chainId()) !== ROUTE.chainId) {
      status('wrong-chain');
      return;
    }
    let run = db.prepare("SELECT * FROM recurring_burn_runs WHERE status='active'").get() as Run | null;
    if (run && run.wallet.toLowerCase() !== signer.address.toLowerCase()) {
      status('signer-mismatch');
      return;
    }
    if (!run) {
      const state = db.prepare('SELECT next_at FROM recurring_burn_state WHERE id=1').get() as { next_at: number };
      if (now < state.next_at) {
        status('scheduled');
        return;
      }
      const balance = await d.client.readContract({
        address: ROUTE.usdg,
        abi: erc20Abi,
        functionName: 'balanceOf',
        args: [signer.address as Address],
      });
      if (balance < RECURRING_BURN_USDG) {
        status('awaiting-usdg');
        return;
      }
      if ((await d.chain.balance(signer.address)) <= 0n) {
        status('awaiting-gas');
        return;
      }
      // Reserve one run, not one run per missed day. A unique active row handles duplicate invocations.
      run = db
        .transaction(() => {
          const active = db.prepare("SELECT * FROM recurring_burn_runs WHERE status='active'").get() as Run | null;
          if (active) return active;
          const latest = db.prepare('SELECT next_at FROM recurring_burn_state WHERE id=1').get() as { next_at: number };
          if (now < latest.next_at) return null;
          const id = randomUUID();
          db.prepare("INSERT INTO recurring_burn_runs(id,wallet,started,status) VALUES(?,?,?,'active')").run(id, signer.address, now);
          return { id, wallet: signer.address, started: now, status: 'active', tx: null } as Run;
        })
        .immediate();
      if (!run) {
        status('scheduled');
        return;
      }
      if (run.wallet.toLowerCase() !== signer.address.toLowerCase()) {
        status('signer-mismatch');
        return;
      }
    }
    const finish = (state: 'completed' | 'failed', hash?: string, at = now) =>
      db.transaction(() => {
        db.prepare('UPDATE recurring_burn_runs SET status=?,tx=? WHERE id=?').run(state, hash ?? null, run!.id);
        db.prepare('UPDATE recurring_burn_state SET next_at=?,status=? WHERE id=1').run(
          Math.max(now, at) + RECURRING_BURN_PERIOD,
          state === 'completed' ? 'scheduled' : 'failed',
        );
      })();
    const rowFor = (stage: string) =>
      db.prepare('SELECT status,tx_hash FROM keeper_txs WHERE job_id=? LIMIT 1').get(PREFIX + run!.id + ':' + stage) as {
        status: string;
        tx_hash: Hex;
      } | null;
    // Always reconcile the saved swap BEFORE checking balances or preparing another call.
    const swap = rowFor('swap');
    if (swap?.status === 'mined') {
      const burn = await d.record(swap.tx_hash);
      if (BigInt(burn.usdg) !== RECURRING_BURN_USDG) {
        status('verification-failed');
        return;
      }
      finish('completed', swap.tx_hash, burn.at);
      return;
    }
    if (swap?.status === 'reverted') {
      finish('failed', swap.tx_hash);
      return;
    }

    const send = async (stage: string, to: Address, data: Hex) => {
      const prior = rowFor(stage);
      if (prior?.status === 'mined') return 'done';
      if (prior?.status === 'reverted') {
        finish('failed', prior.tx_hash);
        return 'stop';
      }
      // The keeper persists signed bytes before broadcast and retries the same hash.
      const result = await runKeeperJob(d.chain, signer, db, {
        jobId: PREFIX + run!.id + ':' + stage,
        vaultId: to,
        chainId: ROUTE.chainId,
        data,
        nowSeconds: now,
        sinceMs: (now - 86400) * 1000,
        budget: d.budget,
        maxReceiptAttempts: 1,
        delayMs: 0,
      });
      status(result.outcome === 'executed' ? 'running' : result.outcome);
      if (result.outcome === 'reverted') finish('failed', result.txHash);
      return result.outcome === 'executed' ? 'done' : 'stop';
    };
    if (swap) {
      await send('swap', ROUTE.router, '0x');
      return;
    }
    // Prior in-flight approval must reconcile before inspecting allowances.
    for (const [stage, to] of [
      ['approve', ROUTE.usdg],
      ['permit', ROUTE.permit2],
    ] as const) {
      const tx = rowFor(stage);
      if (tx && tx.status !== 'mined') {
        await send(stage, to, '0x');
        return;
      }
    }
    const allowance = await d.client.readContract({
      address: ROUTE.usdg,
      abi: erc20Abi,
      functionName: 'allowance',
      args: [signer.address as Address, ROUTE.permit2],
    });
    if (allowance < RECURRING_BURN_USDG) {
      if (rowFor('approve')) {
        finish('failed');
        return;
      }
      await send(
        'approve',
        ROUTE.usdg,
        encodeFunctionData({ abi: erc20Abi, functionName: 'approve', args: [ROUTE.permit2, RECURRING_BURN_USDG] }),
      );
      return;
    }
    const permit = await d.client.readContract({
      address: ROUTE.permit2,
      abi: permit2Abi,
      functionName: 'allowance',
      args: [signer.address as Address, ROUTE.usdg, ROUTE.router],
    });
    if (permit[0] < RECURRING_BURN_USDG || Number(permit[1]) <= now + 60) {
      // Never blindly re-approve after an outage. Defer to the next day's bounded run.
      if (rowFor('permit')) {
        finish('failed');
        return;
      }
      await send(
        'permit',
        ROUTE.permit2,
        encodeFunctionData({
          abi: permit2Abi,
          functionName: 'approve',
          args: [ROUTE.usdg, ROUTE.router, RECURRING_BURN_USDG, now + BURN_PERMIT_SECONDS],
        }),
      );
      return;
    }
    const quote = await d.quote();
    if (quote <= 0n) {
      status('quote-unavailable');
      return;
    }
    const encoded = encodeBurnRoute({
      route: ROUTE,
      usdgIn: RECURRING_BURN_USDG,
      minSproutOut: minOutFor(quote, BURN_DEFAULT_SLIPPAGE_BPS),
      deadline: BigInt(now + BURN_DEADLINE_SECONDS),
    });
    await send('swap', ROUTE.router, encoded.data);
  });
}
export const recurringQuote = (client: PublicClient) => async () => (await quoteBurn(client, ROUTE, RECURRING_BURN_USDG)).sproutOut;
