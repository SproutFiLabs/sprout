import {
  decodeAbiParameters,
  decodeFunctionData,
  encodeAbiParameters,
  encodeFunctionData,
  encodePacked,
  erc20Abi,
  getAddress,
  keccak256,
  type Address,
  type Hex,
} from 'viem';

/**
 * "Buy & burn": a voluntary way for anyone to spend a little USDG from their
 * own wallet to buy SPROUT on the open market and send it to the dead address.
 * Nothing here touches a sprout: the wallet pays, the router swaps, and the
 * SPROUT goes straight from the pool to 0x…dEaD.
 *
 * The route, in one Uniswap UniversalRouter transaction:
 *
 *   1. V3_SWAP_EXACT_IN   USDG -> WETH on the Uniswap v3 USDG/WETH 0.01% pool,
 *                         paid from the wallet through Permit2, WETH kept by the router
 *   2. UNWRAP_WETH        WETH -> ETH, kept by the router
 *   3. V4_SWAP            SETTLE the router's ETH into the v4 PoolManager,
 *                         SWAP_EXACT_IN_SINGLE ETH -> SPROUT on the SPROUT/ETH pool,
 *                         TAKE all the SPROUT to 0x…dEaD
 *
 * The browser encodes it, the server decodes it to check a burn really took
 * this route, and the mainnet-fork rehearsal runs these exact bytes through the
 * real router. Addresses were read from Uniswap's deployment list and confirmed
 * on chain (see scripts/fork-buy-and-burn.ts).
 */

export const DEAD_ADDRESS: Address = '0x000000000000000000000000000000000000dEaD';
export const NATIVE_CURRENCY: Address = '0x0000000000000000000000000000000000000000';

/** UniversalRouter's "the router itself" recipient (ActionConstants.ADDRESS_THIS). */
export const ROUTER_SELF: Address = '0x0000000000000000000000000000000000000002';
/** v4 "use the router's whole balance" amount (ActionConstants.CONTRACT_BALANCE). */
export const CONTRACT_BALANCE = 1n << 255n;
/** v4 "use the open delta" amount (ActionConstants.OPEN_DELTA). */
export const OPEN_DELTA = 0n;

/** UniversalRouter command bytes (contracts/libraries/Commands.sol). */
export const UR_COMMANDS = { V3_SWAP_EXACT_IN: 0x00, UNWRAP_WETH: 0x0c, V4_SWAP: 0x10 } as const;
/** v4-periphery action bytes (libraries/Actions.sol). */
export const V4_ACTIONS = { SWAP_EXACT_IN_SINGLE: 0x06, SETTLE: 0x0b, TAKE: 0x0e } as const;

/** The only command string a Sprout buy & burn sends: v3 swap, unwrap, v4 swap. */
export const BURN_COMMANDS: Hex = '0x000c10';
/** The v4 actions inside it: settle ETH, swap, take SPROUT. */
export const BURN_ACTIONS: Hex = '0x0b060e';

export interface BurnPoolKey {
  currency0: Address;
  currency1: Address;
  fee: number;
  tickSpacing: number;
  hooks: Address;
}

export interface BurnRoute {
  chainId: number;
  /** Uniswap UniversalRouter: the only contract a burn transaction calls. */
  router: Address;
  permit2: Address;
  poolManager: Address;
  /** Uniswap v4 V4Quoter and v3 QuoterV2, for quotes (never for sending). */
  v4Quoter: Address;
  v3Quoter: Address;
  usdg: Address;
  usdgDecimals: number;
  weth: Address;
  sprout: Address;
  sproutDecimals: number;
  /** The USDG/WETH v3 pool fee (hundredths of a basis point). */
  v3Fee: number;
  /** The v4 SPROUT/ETH pool. currency0 is native ETH. */
  sproutPool: BurnPoolKey;
}

/**
 * Robinhood Chain (4663), confirmed on chain 2026-09-19:
 *  - v4 PoolManager / UniversalRouter / V4Quoter / Permit2 from Uniswap's v4 deployment list;
 *  - the SPROUT pool (id 0x159fdcd4…1062d) from PoolManager's Initialize event at block 66762015:
 *    native ETH / SPROUT, LP fee 0, tick spacing 200, hook PonsV2MemeHook 0xE5e7…e044, which
 *    takes 2% of each swap's output (1% hook fee + 1% creator tax, frozen for this pool);
 *  - USDG/WETH: the Uniswap v3 0.01% pool 0x52e65B17…71Ca, by far the deepest.
 */
export const ROBINHOOD_BURN_ROUTE: BurnRoute = {
  chainId: 4663,
  router: '0x8876789976dEcBfCbBbe364623C63652db8C0904',
  permit2: '0x000000000022D473030F116dDEE9F6B43aC78BA3',
  poolManager: '0x8366a39CC670B4001A1121B8F6A443A643e40951',
  v4Quoter: '0x8Dc178eFB8111BB0973Dd9d722ebeFF267c98F94',
  v3Quoter: '0x33e885eD0Ec9bF04EcfB19341582aADCb4c8A9E7',
  usdg: '0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168',
  usdgDecimals: 6,
  weth: '0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73',
  sprout: '0x5Ec27C931Fb49911128dddf7d914C1754dA9f49F',
  sproutDecimals: 18,
  v3Fee: 100,
  sproutPool: {
    currency0: NATIVE_CURRENCY,
    currency1: '0x5Ec27C931Fb49911128dddf7d914C1754dA9f49F',
    fee: 0,
    tickSpacing: 200,
    hooks: '0xE5e702641Ea86F4ae6cC3cDaeD2B886f976Be044',
  },
};
export const ROBINHOOD_SPROUT_POOL_ID: Hex = '0x159fdcd49eb8cc02caf78b260fbf80c2627e50ecb5d49c468020d4f8fbd1062d';

/** Amounts a person can pick, in whole US dollars (USDG). */
export const BURN_PRESETS_USD = [1, 5, 20] as const;
export const BURN_MIN_USD = 1;
export const BURN_MAX_USD = 500;
/** Default floor under the quote: the swap is refused if it would burn 3% less than quoted. */
export const BURN_DEFAULT_SLIPPAGE_BPS = 300;
/** How long the router accepts a signed burn, and how long the Permit2 allowance lives. */
export const BURN_DEADLINE_SECONDS = 20 * 60;
export const BURN_PERMIT_SECONDS = 30 * 60;

// ---------------------------------------------------------------------------
// ABIs (only what the route needs)

export const universalRouterAbi = [
  {
    type: 'function',
    name: 'execute',
    stateMutability: 'payable',
    inputs: [
      { name: 'commands', type: 'bytes' },
      { name: 'inputs', type: 'bytes[]' },
      { name: 'deadline', type: 'uint256' },
    ],
    outputs: [],
  },
] as const;

export const permit2Abi = [
  {
    type: 'function',
    name: 'approve',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'token', type: 'address' },
      { name: 'spender', type: 'address' },
      { name: 'amount', type: 'uint160' },
      { name: 'expiration', type: 'uint48' },
    ],
    outputs: [],
  },
  {
    type: 'function',
    name: 'allowance',
    stateMutability: 'view',
    inputs: [
      { name: 'user', type: 'address' },
      { name: 'token', type: 'address' },
      { name: 'spender', type: 'address' },
    ],
    outputs: [
      { name: 'amount', type: 'uint160' },
      { name: 'expiration', type: 'uint48' },
      { name: 'nonce', type: 'uint48' },
    ],
  },
] as const;

const poolKeyComponents = [
  { name: 'currency0', type: 'address' },
  { name: 'currency1', type: 'address' },
  { name: 'fee', type: 'uint24' },
  { name: 'tickSpacing', type: 'int24' },
  { name: 'hooks', type: 'address' },
] as const;

/**
 * The quoters simulate a swap and revert internally, so they are not `view` on
 * chain; they are declared `view` here because they are only ever eth_call'ed.
 */
export const quoterV2Abi = [
  {
    type: 'function',
    name: 'quoteExactInputSingle',
    stateMutability: 'view',
    inputs: [
      {
        name: 'params',
        type: 'tuple',
        components: [
          { name: 'tokenIn', type: 'address' },
          { name: 'tokenOut', type: 'address' },
          { name: 'amountIn', type: 'uint256' },
          { name: 'fee', type: 'uint24' },
          { name: 'sqrtPriceLimitX96', type: 'uint160' },
        ],
      },
    ],
    outputs: [
      { name: 'amountOut', type: 'uint256' },
      { name: 'sqrtPriceX96After', type: 'uint160' },
      { name: 'initializedTicksCrossed', type: 'uint32' },
      { name: 'gasEstimate', type: 'uint256' },
    ],
  },
] as const;

export const v4QuoterAbi = [
  {
    type: 'function',
    name: 'quoteExactInputSingle',
    stateMutability: 'view',
    inputs: [
      {
        name: 'params',
        type: 'tuple',
        components: [
          { name: 'poolKey', type: 'tuple', components: poolKeyComponents },
          { name: 'zeroForOne', type: 'bool' },
          { name: 'exactAmount', type: 'uint128' },
          { name: 'hookData', type: 'bytes' },
        ],
      },
    ],
    outputs: [
      { name: 'amountOut', type: 'uint256' },
      { name: 'gasEstimate', type: 'uint256' },
    ],
  },
] as const;

// ---------------------------------------------------------------------------
// Encoding

const v3SwapParams = [
  { name: 'recipient', type: 'address' },
  { name: 'amountIn', type: 'uint256' },
  { name: 'amountOutMin', type: 'uint256' },
  { name: 'path', type: 'bytes' },
  { name: 'payerIsUser', type: 'bool' },
  // This router generation reads a sixth field (per-hop price floors); empty means none.
  { name: 'minHopPriceX36', type: 'uint256[]' },
] as const;
const unwrapParams = [
  { name: 'recipient', type: 'address' },
  { name: 'amountMin', type: 'uint256' },
] as const;
const v4SwapParams = [
  { name: 'actions', type: 'bytes' },
  { name: 'params', type: 'bytes[]' },
] as const;
const settleParams = [
  { name: 'currency', type: 'address' },
  { name: 'amount', type: 'uint256' },
  { name: 'payerIsUser', type: 'bool' },
] as const;
const takeParams = [
  { name: 'currency', type: 'address' },
  { name: 'recipient', type: 'address' },
  { name: 'amount', type: 'uint256' },
] as const;
const exactInputSingleParams = [
  {
    name: 'params',
    type: 'tuple',
    components: [
      { name: 'poolKey', type: 'tuple', components: poolKeyComponents },
      { name: 'zeroForOne', type: 'bool' },
      { name: 'amountIn', type: 'uint128' },
      { name: 'amountOutMinimum', type: 'uint128' },
      // Per-hop price floor in this router generation; 0 = off (amountOutMinimum is the floor).
      { name: 'minHopPriceX36', type: 'uint256' },
      { name: 'hookData', type: 'bytes' },
    ],
  },
] as const;

/** keccak256(abi.encode(PoolKey)): the v4 pool id. */
export function burnPoolId(key: BurnPoolKey): Hex {
  return keccak256(
    encodeAbiParameters(
      [{ type: 'tuple', components: poolKeyComponents }],
      [{ ...key, fee: key.fee, tickSpacing: key.tickSpacing }],
    ),
  );
}

/** The v3 path USDG -(fee)-> WETH. */
export function v3BurnPath(route: BurnRoute): Hex {
  return encodePacked(['address', 'uint24', 'address'], [route.usdg, route.v3Fee, route.weth]);
}

export interface EncodedBurn {
  commands: Hex;
  inputs: Hex[];
  deadline: bigint;
  /** Calldata for UniversalRouter.execute(commands, inputs, deadline); send with value 0. */
  data: Hex;
}

/**
 * The buy & burn transaction for `usdgIn` (base units) with a floor of
 * `minSproutOut` SPROUT (base units) reaching the dead address.
 */
export function encodeBurnRoute(input: { route: BurnRoute; usdgIn: bigint; minSproutOut: bigint; deadline: bigint }): EncodedBurn {
  const { route, usdgIn, minSproutOut, deadline } = input;
  if (usdgIn <= 0n) throw new Error('usdgIn must be positive');
  if (minSproutOut <= 0n) throw new Error('minSproutOut must be positive');
  if (minSproutOut >= 1n << 128n || usdgIn >= 1n << 128n) throw new Error('amount out of range');
  const pool = route.sproutPool;
  if (getAddress(pool.currency0) !== NATIVE_CURRENCY || getAddress(pool.currency1) !== getAddress(route.sprout)) {
    throw new Error('the SPROUT pool must pair native ETH (currency0) with SPROUT (currency1)');
  }
  const v3 = encodeAbiParameters(v3SwapParams, [ROUTER_SELF, usdgIn, 0n, v3BurnPath(route), true, []]);
  const unwrap = encodeAbiParameters(unwrapParams, [ROUTER_SELF, 0n]);
  const settle = encodeAbiParameters(settleParams, [NATIVE_CURRENCY, CONTRACT_BALANCE, false]);
  const swap = encodeAbiParameters(exactInputSingleParams, [
    {
      poolKey: pool,
      zeroForOne: true,
      amountIn: OPEN_DELTA,
      amountOutMinimum: minSproutOut,
      minHopPriceX36: 0n,
      hookData: '0x',
    },
  ]);
  const take = encodeAbiParameters(takeParams, [route.sprout, DEAD_ADDRESS, OPEN_DELTA]);
  const v4 = encodeAbiParameters(v4SwapParams, [BURN_ACTIONS, [settle, swap, take]]);
  const inputs: Hex[] = [v3, unwrap, v4];
  const data = encodeFunctionData({ abi: universalRouterAbi, functionName: 'execute', args: [BURN_COMMANDS, inputs, deadline] });
  return { commands: BURN_COMMANDS, inputs, deadline, data };
}

export interface DecodedBurn {
  usdgIn: bigint;
  minSproutOut: bigint;
  deadline: bigint;
  /** Who the SPROUT is taken to (the dead address for a Sprout burn). */
  recipient: Address;
  poolKey: BurnPoolKey;
  tokenIn: Address;
  v3Fee: number;
}

/**
 * Reads UniversalRouter.execute calldata back into a buy & burn, or null when it
 * is anything else: other commands or actions, another pool or token, or SPROUT
 * sent anywhere but the dead address.
 */
export function decodeBurnCalldata(data: Hex, route: BurnRoute): DecodedBurn | null {
  try {
    const call = decodeFunctionData({ abi: universalRouterAbi, data });
    if (call.functionName !== 'execute') return null;
    const [commands, inputs, deadline] = call.args;
    if (commands.toLowerCase() !== BURN_COMMANDS || inputs.length !== 3) return null;
    const [recipient3, usdgIn, , path, payerIsUser] = decodeAbiParameters(v3SwapParams, inputs[0]!);
    if (getAddress(recipient3) !== ROUTER_SELF || !payerIsUser) return null;
    if (path.toLowerCase() !== v3BurnPath(route).toLowerCase()) return null;
    const [recipientUnwrap] = decodeAbiParameters(unwrapParams, inputs[1]!);
    if (getAddress(recipientUnwrap) !== ROUTER_SELF) return null;
    const [actions, params] = decodeAbiParameters(v4SwapParams, inputs[2]!);
    if (actions.toLowerCase() !== BURN_ACTIONS || params.length !== 3) return null;
    const [settleCurrency, , settleFromUser] = decodeAbiParameters(settleParams, params[0]!);
    if (getAddress(settleCurrency) !== NATIVE_CURRENCY || settleFromUser) return null;
    const [swap] = decodeAbiParameters(exactInputSingleParams, params[1]!);
    if (burnPoolId(swap.poolKey) !== burnPoolId(route.sproutPool) || !swap.zeroForOne) return null;
    const [takeCurrency, takeRecipient] = decodeAbiParameters(takeParams, params[2]!);
    if (getAddress(takeCurrency) !== getAddress(route.sprout)) return null;
    return {
      usdgIn,
      minSproutOut: swap.amountOutMinimum,
      deadline,
      recipient: getAddress(takeRecipient),
      poolKey: swap.poolKey as BurnPoolKey,
      tokenIn: route.usdg,
      v3Fee: route.v3Fee,
    };
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Amounts

/** The lowest SPROUT a burn may reach the dead address with: the quote less `slippageBps`, rounded down. */
export function minOutFor(quoted: bigint, slippageBps: number): bigint {
  if (!Number.isInteger(slippageBps) || slippageBps < 0 || slippageBps >= 10_000) throw new Error('slippage must be 0-9999 basis points');
  return (quoted * BigInt(10_000 - slippageBps)) / 10_000n;
}

/**
 * Dollars a person typed ("5", "$20", "12.50") in USDG base units, or null when
 * it is not an amount with at most two decimals inside [min, max].
 */
export function parseBurnUsd(input: string, decimals: number, min = BURN_MIN_USD, max = BURN_MAX_USD): bigint | null {
  const clean = input.trim().replace(/^\$/, '').replace(/,/g, '').trim();
  if (!/^\d{1,6}(\.\d{1,2})?$/.test(clean)) return null;
  const [whole, frac = ''] = clean.split('.');
  const cents = BigInt(whole!) * 100n + BigInt(frac.padEnd(2, '0'));
  if (cents < BigInt(Math.round(min * 100)) || cents > BigInt(Math.round(max * 100))) return null;
  return decimals >= 2 ? cents * 10n ** BigInt(decimals - 2) : cents / 10n ** BigInt(2 - decimals);
}

// ---------------------------------------------------------------------------
// Quotes

interface QuoteClient {
  readContract(args: { address: Address; abi: readonly unknown[]; functionName: string; args?: readonly unknown[]; blockNumber?: bigint }): Promise<unknown>;
}

export interface BurnQuote {
  usdgIn: bigint;
  /** WETH (= ETH) the first leg returns. */
  ethMid: bigint;
  /** SPROUT that would reach the dead address, after the pool hook's cut. */
  sproutOut: bigint;
  gasEstimate: bigint;
}

/** Quotes both legs with the Uniswap quoters (eth_call only), at `blockNumber` if given. */
export async function quoteBurn(client: QuoteClient, route: BurnRoute, usdgIn: bigint, blockNumber?: bigint): Promise<BurnQuote> {
  const at = blockNumber === undefined ? {} : { blockNumber };
  const v3 = (await client.readContract({
    address: route.v3Quoter,
    abi: quoterV2Abi,
    functionName: 'quoteExactInputSingle',
    args: [{ tokenIn: route.usdg, tokenOut: route.weth, amountIn: usdgIn, fee: route.v3Fee, sqrtPriceLimitX96: 0n }],
    ...at,
  })) as readonly [bigint, bigint, number, bigint];
  const ethMid = v3[0];
  if (ethMid <= 0n) throw new Error('the USDG/ETH pool returned nothing');
  const v4 = (await client.readContract({
    address: route.v4Quoter,
    abi: v4QuoterAbi,
    functionName: 'quoteExactInputSingle',
    args: [{ poolKey: route.sproutPool, zeroForOne: true, exactAmount: ethMid, hookData: '0x' }],
    ...at,
  })) as readonly [bigint, bigint];
  return { usdgIn, ethMid, sproutOut: v4[0], gasEstimate: v3[3] + v4[1] };
}

// ---------------------------------------------------------------------------
// The wallet flow (shared by the browser and the mainnet-fork rehearsal)

export type BurnStep = 'check' | 'approve-sign' | 'approve-wait' | 'permit-sign' | 'permit-wait' | 'burn-sign' | 'burn-wait';

export interface BurnWallet {
  address: Address;
  read(args: { address: Address; abi: readonly unknown[]; functionName: string; args?: readonly unknown[] }): Promise<unknown>;
  /** Sends a contract call from the wallet; resolves to the transaction hash. */
  write(args: { address: Address; abi: readonly unknown[]; functionName: string; args: readonly unknown[] }): Promise<Hex>;
  /** Waits for a successful receipt; resolves to its block number. */
  wait(hash: Hex): Promise<number>;
  /** Unix seconds (chain time where it matters, e.g. on a fork). */
  now(): number;
}

export class BurnFlowError extends Error {
  constructor(
    readonly code: 'balance' | 'quote',
    message: string,
    readonly detail?: bigint,
  ) {
    super(message);
    this.name = 'BurnFlowError';
  }
}

export interface BurnPlan {
  /** The USDG approval to Permit2 is missing (or too small). */
  needsApprove: boolean;
  /** The Permit2 allowance for the router is missing, too small or about to expire. */
  needsPermit: boolean;
  /** Wallet confirmations the burn will take (1 to 3). */
  signatures: number;
}

/** What a burn of `usdgIn` from this wallet will ask for, read from the chain. */
export async function planBurn(wallet: BurnWallet, route: BurnRoute, usdgIn: bigint): Promise<BurnPlan & { balance: bigint }> {
  const [balance, allowance, permit] = await Promise.all([
    wallet.read({ address: route.usdg, abi: erc20Abi, functionName: 'balanceOf', args: [wallet.address] }) as Promise<bigint>,
    wallet.read({ address: route.usdg, abi: erc20Abi, functionName: 'allowance', args: [wallet.address, route.permit2] }) as Promise<bigint>,
    wallet.read({ address: route.permit2, abi: permit2Abi, functionName: 'allowance', args: [wallet.address, route.usdg, route.router] }) as Promise<
      readonly [bigint, number, number]
    >,
  ]);
  const needsApprove = allowance < usdgIn;
  // A Permit2 allowance that expires within a minute could lapse before the burn lands.
  const needsPermit = permit[0] < usdgIn || Number(permit[1]) <= wallet.now() + 60;
  return { balance, needsApprove, needsPermit, signatures: 1 + (needsApprove ? 1 : 0) + (needsPermit ? 1 : 0) };
}

/**
 * Buy & burn from the wallet: approve exactly `usdgIn` to Permit2 and exactly
 * that to the router through Permit2 (each only when missing), then one router
 * transaction. `quote` is asked again just before the swap, so the floor is set
 * against fresh prices. Nothing stays approved afterwards: both allowances are
 * spent by the swap.
 */
export async function runBuyAndBurn(input: {
  wallet: BurnWallet;
  route: BurnRoute;
  usdgIn: bigint;
  slippageBps: number;
  quote: (usdgIn: bigint) => Promise<bigint>;
  onStep?: (step: BurnStep, n: number, total: number) => void;
}): Promise<{ hash: Hex; block: number; minSproutOut: bigint; quoted: bigint; plan: BurnPlan }> {
  const { wallet, route, usdgIn, slippageBps, quote } = input;
  const plan = await planBurn(wallet, route, usdgIn);
  if (plan.balance < usdgIn) throw new BurnFlowError('balance', 'not enough USDG in this wallet', plan.balance);
  let n = 0;
  const total = plan.signatures;
  const step = (s: BurnStep, next = false) => input.onStep?.(s, next ? ++n : n, total);
  if (plan.needsApprove) {
    step('approve-sign', true);
    const hash = await wallet.write({ address: route.usdg, abi: erc20Abi, functionName: 'approve', args: [route.permit2, usdgIn] });
    step('approve-wait');
    await wallet.wait(hash);
  }
  if (plan.needsPermit) {
    step('permit-sign', true);
    const expiration = wallet.now() + BURN_PERMIT_SECONDS;
    const hash = await wallet.write({ address: route.permit2, abi: permit2Abi, functionName: 'approve', args: [route.usdg, route.router, usdgIn, expiration] });
    step('permit-wait');
    await wallet.wait(hash);
  }
  step('check');
  const quoted = await quote(usdgIn);
  if (quoted <= 0n) throw new BurnFlowError('quote', 'no SPROUT quote');
  const minSproutOut = minOutFor(quoted, slippageBps);
  const { inputs, commands, deadline } = encodeBurnRoute({ route, usdgIn, minSproutOut, deadline: BigInt(wallet.now() + BURN_DEADLINE_SECONDS) });
  step('burn-sign', true);
  const hash = await wallet.write({ address: route.router, abi: universalRouterAbi, functionName: 'execute', args: [commands, inputs, deadline] });
  step('burn-wait');
  const block = await wallet.wait(hash);
  return { hash, block, minSproutOut, quoted, plan };
}
