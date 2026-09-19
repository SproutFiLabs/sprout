import { BaseError, ContractFunctionRevertedError, type Abi, type Address } from 'viem';
import { sproutVaultAbi, sproutVenueAbi, uniswapV3AdapterAbi } from '@sprout/shared';
import { ChainConfigError, chainCache, chainClockAtLeast, requirePublic, type ChainClock, type ChainContext } from './chain';
import { UnknownFactoryError, resolveVaultVenue } from './deployments';
import { FOREVER_MS } from './readCache';

/**
 * "Invest now": a parent-signed purchase, available while automatic investing
 * is switched off.
 *
 * SproutVault.executeInvestment is permissionless: anyone may run a purchase
 * that is due. It spends the scheduled amount, only when the schedule is
 * active and due, and only with a per-asset minimum at or above the oracle
 * floor. So a parent-run purchase is: schedule the amount (due immediately),
 * then execute. This module answers the two questions the dashboard needs for
 * that: what would the purchase look like, and, once the schedule is due,
 * which minimums should the parent sign.
 */

export type InvestBlockerCode =
  | 'not-configured'
  | 'unknown-factory'
  | 'graduated'
  | 'venue-not-allowed'
  | 'nothing-to-buy'
  | 'insufficient-funds'
  | 'stale-price'
  | 'price-paused'
  | 'price-unavailable'
  | 'pool-too-far'
  | 'unknown';

export interface InvestBlocker {
  code: InvestBlockerCode;
  message: string;
  asset?: Address;
}

export interface InvestLeg {
  asset: Address;
  symbol: string;
  weightBps: number;
  amountIn: string;
  /** Oracle-priced output, before pool fees. */
  expectedOut: string;
  /** The least the vault will accept: expectedOut less the vault's max slippage. */
  floorOut: string;
  /** What the pool would actually return now (only once the purchase is due). */
  simulatedOut: string | null;
  /** The minimum to sign: halfway between the floor and the simulated output. */
  minOut: string | null;
}

export interface InvestQuote {
  vault: Address;
  /**
   * The venue this sprout's own factory admits (legacy sprouts: the legacy
   * venue). The purchase must be signed with exactly this address.
   */
  venue: Address | null;
  amount: string;
  /** Settlement the vault can spend (balance less earmarked and unclaimed allowance). */
  available: string;
  chainTime: number;
  blockNumber: number;
  schedule: {
    active: boolean;
    amount: string;
    periodSeconds: number;
    nextExecution: number;
    maxSlippageBps: number;
  };
  /** The schedule is active, due and set to `amount`: the purchase can run now. */
  due: boolean;
  legs: InvestLeg[];
  /** Present only when `due` and nothing blocks the purchase. */
  minOuts: string[] | null;
  blocker: InvestBlocker | null;
}

type Schedule = readonly [boolean, bigint, bigint, bigint, bigint];

const adapterErrors = uniswapV3AdapterAbi.filter((item) => item.type === 'error');
/** The venue interface plus the adapter's errors, so reverts decode by name. */
const venueAbi = [...sproutVenueAbi, ...adapterErrors] as Abi;
/** Vault calls bubble up the adapter's revert data unchanged. */
const vaultAbi = [...sproutVaultAbi, ...adapterErrors] as Abi;

const BPS = 10_000n;

/** The custom error name inside a viem contract error, if any. */
export function revertName(error: unknown): string | null {
  if (!(error instanceof BaseError)) return null;
  const revert = error.walk((e) => e instanceof ContractFunctionRevertedError);
  if (revert instanceof ContractFunctionRevertedError) return revert.data?.errorName ?? revert.reason ?? null;
  return null;
}

function priceBlocker(name: string | null, symbol: string, asset: Address): InvestBlocker {
  if (name === 'StalePrice') {
    return {
      code: 'stale-price',
      asset,
      message:
        `The ${symbol} price has not updated recently, so buying is paused to protect the price you get. ` +
        'This usually means US markets are closed; try again once they reopen.',
    };
  }
  if (name === 'BadPrice') {
    return {
      code: 'price-paused',
      asset,
      message: `The ${symbol} price feed is paused right now, so ${symbol} cannot be bought. Try again later.`,
    };
  }
  return { code: 'price-unavailable', asset, message: `The ${symbol} price could not be read just now. Try again in a minute.` };
}

/** Wait (briefly) for the server's RPC to reach the block the wallet already saw. */
async function clockAtLeast(ctx: ChainContext, minBlock?: number): Promise<ChainClock> {
  let clock = await chainClockAtLeast(ctx, minBlock);
  for (let attempt = 0; minBlock && clock.number < minBlock && attempt < 5; attempt++) {
    await Bun.sleep(1_000);
    clock = await chainClockAtLeast(ctx, minBlock);
  }
  return clock;
}

export interface InvestQuoteOptions {
  /** The block the caller's own schedule transaction confirmed in. */
  minBlock?: number;
  /** Retries left when a new price round lands between quoting and simulating. */
  retries?: number;
}

export async function investQuote(
  ctx: ChainContext,
  vault: Address,
  amount: bigint,
  options: InvestQuoteOptions = {},
): Promise<InvestQuote> {
  const chain = ctx.config.chain;
  const client = requirePublic(ctx);
  const cache = chainCache(ctx);
  // Each sprout trades only through the venue its own factory admits, so the
  // venue comes from vault.factory(), never from the server's current venue.
  let venue: Address | null = null;
  let venueBlocker: InvestBlocker | null = null;
  if (chain.configured) {
    try {
      venue = (await resolveVaultVenue(ctx, vault)).venue;
    } catch (error) {
      if (error instanceof UnknownFactoryError) {
        venueBlocker = {
          code: 'unknown-factory',
          message: 'This sprout was planted by a Sprout factory this server does not recognize, so it cannot buy stocks here.',
        };
      } else if (error instanceof ChainConfigError) {
        venueBlocker = { code: 'not-configured', message: 'Buying is not configured on this server.' };
      } else {
        throw error;
      }
    }
  }
  const clock = await clockAtLeast(ctx, options.minBlock);

  const settlementRead = cache.get(`vault:${vault.toLowerCase()}:settlement`, FOREVER_MS, () =>
    client.readContract({ address: vault, abi: sproutVaultAbi, functionName: 'settlementToken' }) as Promise<Address>,
  );
  const [settlement, assets, weights, schedule, available, graduationTimestamp, parent, venueAllowed] = await Promise.all([
    settlementRead,
    client.readContract({ address: vault, abi: sproutVaultAbi, functionName: 'assets' }) as Promise<readonly Address[]>,
    client.readContract({ address: vault, abi: sproutVaultAbi, functionName: 'weights' }) as Promise<readonly number[]>,
    client.readContract({ address: vault, abi: sproutVaultAbi, functionName: 'schedule' }) as Promise<Schedule>,
    client.readContract({ address: vault, abi: sproutVaultAbi, functionName: 'availableSettlement' }) as Promise<bigint>,
    client.readContract({ address: vault, abi: sproutVaultAbi, functionName: 'graduationTimestamp' }) as Promise<bigint>,
    client.readContract({ address: vault, abi: sproutVaultAbi, functionName: 'parent' }) as Promise<Address>,
    venue
      ? (client.readContract({ address: vault, abi: sproutVaultAbi, functionName: 'venueAllowed', args: [venue] }) as Promise<boolean>)
      : Promise.resolve(false),
  ]);

  const [active, scheduledAmount, period, nextExecution, maxSlippage] = schedule;
  const symbolOf = (asset: Address) =>
    chain.contracts.stockTokens.find((t) => t.address.toLowerCase() === asset.toLowerCase())?.symbol ?? asset.slice(0, 8);

  const quote: InvestQuote = {
    vault,
    venue,
    amount: amount.toString(),
    available: available.toString(),
    chainTime: clock.timestamp,
    blockNumber: clock.number,
    schedule: {
      active,
      amount: scheduledAmount.toString(),
      periodSeconds: Number(period),
      nextExecution: Number(nextExecution),
      maxSlippageBps: Number(maxSlippage),
    },
    due: active && scheduledAmount === amount && Number(nextExecution) <= clock.timestamp,
    legs: [],
    minOuts: null,
    blocker: null,
  };
  const block = (blocker: InvestBlocker): InvestQuote => ({ ...quote, blocker, minOuts: null });

  if (venueBlocker) return block(venueBlocker);
  if (!chain.configured || !venue) {
    return block({ code: 'not-configured', message: 'Buying is not configured on this server.' });
  }
  if (clock.timestamp >= Number(graduationTimestamp)) {
    return block({ code: 'graduated', message: 'This sprout has graduated, so it no longer buys anything.' });
  }
  if (!venueAllowed) {
    return block({ code: 'venue-not-allowed', message: 'This sprout was planted without a trading venue, so it cannot buy stocks.' });
  }

  const legAmounts = assets.map((_, i) => (amount * BigInt(weights[i] ?? 0)) / BPS);
  // Quote every leg together (one batched request) and keep failures per leg.
  const quotes = await Promise.all(
    assets.map((asset, i) =>
      legAmounts[i] === 0n
        ? Promise.resolve({ ok: true as const, value: 0n })
        : (client.readContract({ address: venue, abi: venueAbi, functionName: 'quote', args: [settlement, asset, legAmounts[i]!] }) as Promise<bigint>).then(
            (value) => ({ ok: true as const, value }),
            (error: unknown) => ({ ok: false as const, error }),
          ),
    ),
  );

  quote.legs = assets.map((asset, i) => {
    const q = quotes[i]!;
    const expected = q.ok ? q.value : 0n;
    return {
      asset,
      symbol: symbolOf(asset),
      weightBps: Number(weights[i] ?? 0),
      amountIn: legAmounts[i]!.toString(),
      expectedOut: expected.toString(),
      floorOut: ((expected * (BPS - maxSlippage)) / BPS).toString(),
      simulatedOut: null,
      minOut: null,
    };
  });

  const failed = quotes.findIndex((q) => !q.ok);
  if (failed >= 0) {
    const q = quotes[failed] as { ok: false; error: unknown };
    return block(priceBlocker(revertName(q.error), symbolOf(assets[failed]!), assets[failed]!));
  }
  if (amount <= 0n || legAmounts.every((a) => a === 0n)) {
    return block({ code: 'nothing-to-buy', message: 'Enter an amount large enough to buy something.' });
  }
  if (amount > available) {
    return block({
      code: 'insufficient-funds',
      message: 'That is more than this sprout has available to invest. Add funds first, or choose a smaller amount.',
    });
  }
  if (!quote.due) return quote;

  // Due: simulate the real purchase at the oracle floors to learn what the pool
  // returns, then sign halfway between. That leaves room on both sides: for the
  // oracle floor to rise if a new price round lands before the transaction
  // does, and for the pool to move slightly against the purchase.
  const floors = quote.legs.map((leg) => BigInt(leg.floorOut));
  let simulated: readonly bigint[];
  try {
    const { result } = await client.simulateContract({
      address: vault,
      abi: vaultAbi,
      functionName: 'executeInvestment',
      args: [venue, floors],
      // Any caller may execute; simulating as the parent keeps this out of a
      // Multicall3 batch, where msg.sender would be the batching contract.
      account: parent,
    });
    simulated = result as readonly bigint[];
  } catch (error) {
    const name = revertName(error);
    if (name === 'BadArguments' && (options.retries ?? 1) > 0) {
      // A new oracle round raised a floor between the quote and the simulation.
      cache.invalidate('block');
      return investQuote(ctx, vault, amount, { ...options, retries: (options.retries ?? 1) - 1 });
    }
    if (name === 'Shortfall' || name === 'Slippage') {
      return block({
        code: 'pool-too-far',
        message:
          'The trading pool is pricing these stocks too far from the market price right now, so the purchase would be refused. Try again shortly.',
      });
    }
    if (name === 'StalePrice' || name === 'BadPrice') {
      const i = Math.max(0, quote.legs.findIndex((leg) => leg.amountIn !== '0'));
      return block(priceBlocker(name, quote.legs[i]!.symbol, quote.legs[i]!.asset));
    }
    return block({ code: 'unknown', message: `The purchase could not be prepared${name ? ` (${name})` : ''}. Try again in a minute.` });
  }

  quote.legs = quote.legs.map((leg, i) => {
    const floor = floors[i]!;
    const out = simulated[i] ?? 0n;
    const min = leg.amountIn === '0' ? 0n : floor + (out > floor ? (out - floor) / 2n : 0n);
    return { ...leg, simulatedOut: out.toString(), minOut: min.toString() };
  });
  quote.minOuts = quote.legs.map((leg) => leg.minOut!);
  return quote;
}
