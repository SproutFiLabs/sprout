import { dirname, join } from 'node:path';
import { privateKeyToAccount } from 'viem/accounts';
import { ROBINHOOD_BURN_ROUTE } from '@sprout/shared';
import { openDb } from './db';
import { keeperChain } from './keeper';
import type { ChainContext } from './chain';
import type { BurnService } from './burns';
import { initRecurringBurn, recurringBurnView, recurringQuote, runRecurringBurn, type RecurringBurnView } from './recurringBurn';

export interface RecurringBurnRuntime {
  view: () => RecurringBurnView;
  tick: () => Promise<void>;
  close: () => void;
}
export function createRecurringBurnRuntime(
  ctx: ChainContext,
  burns: BurnService,
  env: Record<string, string | undefined>,
): RecurringBurnRuntime {
  const enabled = /^(1|true|yes|on)$/i.test(env.SPROUT_RECURRING_BURN_ENABLED ?? '');
  if (!enabled)
    return {
      view: () => ({
        enabled: false,
        wallet: null,
        usd: 5,
        periodSeconds: 86400,
        status: 'disabled',
        nextRunAt: null,
        lastTx: null,
        count: 0,
      }),
      tick: async () => {},
      close: () => {},
    };
  const key = env.SPROUT_RECURRING_BURN_PRIVATE_KEY;
  if (!key || !/^0x[0-9a-fA-F]{64}$/.test(key)) throw new Error('Recurring burn needs its dedicated signer');
  const account = privateKeyToAccount(key as `0x${string}`);
  if (account.address.toLowerCase() !== env.SPROUT_RECURRING_BURN_WALLET?.toLowerCase())
    throw new Error('Recurring burn signer must match configured dedicated wallet');
  if (account.address.toLowerCase() === ctx.walletAddress?.toLowerCase())
    throw new Error('Recurring burn cannot use the family investment keeper wallet');
  if (!ctx.publicClient || ctx.config.chain.chainId !== ROBINHOOD_BURN_ROUTE.chainId || !burns.config.enabled)
    throw new Error('Recurring burn needs live Robinhood Chain buy & burn');
  const positive = (name: string) => {
    const value = env[name];
    if (!value || !/^\d+$/.test(value) || BigInt(value) <= 0n) throw new Error(`Recurring burn requires positive ${name}`);
    return BigInt(value);
  };
  const budget = {
    maxFeePerGasWei: positive('SPROUT_RECURRING_BURN_MAX_FEE_WEI'),
    maxPriorityFeePerGasWei: positive('SPROUT_RECURRING_BURN_PRIORITY_FEE_WEI'),
    gasLimitCap: positive('SPROUT_RECURRING_BURN_GAS_LIMIT'),
    dailyFeeBudgetWei: positive('SPROUT_RECURRING_BURN_DAILY_GAS_WEI'),
  };
  // Own durable ledger: family keeper recovery cannot broadcast recurring-burn transactions.
  const db = openDb(ctx.config.dbPath === ':memory:' ? ':memory:' : join(dirname(ctx.config.dbPath), 'recurring-burn.sqlite'));
  initRecurringBurn(db);
  let problem: string | null = null;
  const view = () => {
    const v = recurringBurnView(db, true, account.address);
    return problem ? { ...v, status: 'temporarily-unavailable' } : v;
  };
  return {
    view,
    close: () => db.close(),
    tick: async () => {
      try {
        const block = await ctx.publicClient!.getBlock({ blockTag: 'latest' });
        await runRecurringBurn({
          db,
          client: ctx.publicClient!,
          chain: keeperChain(ctx),
          signer: { address: account.address, signTransaction: (tx) => account.signTransaction(tx as never) },
          budget,
          now: () => Number(block.timestamp),
          quote: recurringQuote(ctx.publicClient!),
          record: async (hash) => (await burns.record(hash, account.address)).burn,
        });
        problem = null;
      } catch {
        problem = 'temporarily-unavailable';
      }
    },
  };
}
