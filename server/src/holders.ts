import { erc20Abi, getAddress, isAddress, type Address, type PublicClient } from 'viem';

/**
 * SPROUT holder tiers. A wallet's tier comes from the smallest SPROUT balance
 * it held across the last `holdDays`, sampled from the chain's own history, so
 * a balance borrowed for a minute doesn't unlock anything. While the token is
 * younger than `holdDays`, nobody could have held that long, so the hold is 24
 * hours instead.
 *
 * Tiers only unlock things inside this app. Nothing here moves money.
 */

export type TierId = 'seedling' | 'sapling' | 'bloom' | 'grove';
export const TIER_ORDER: readonly TierId[] = ['seedling', 'sapling', 'bloom', 'grove'];

export interface HolderTier {
  id: TierId;
  /** Whole tokens (not base units). */
  min: string;
}

export interface PerksConfig {
  token: Address | null;
  tiers: HolderTier[];
  holdDays: number;
  earlyAccess: { symbols: string[]; until: number | null; tier: TierId };
  /** Lowest tier whose weekly plans the keeper runs; null means everyone's. */
  autoInvestTier: TierId | null;
}

type EnvLike = Record<string, string | undefined>;

const DEFAULT_TIERS = 'seedling:100000,sapling:1000000,bloom:5000000,grove:10000000';

function tierId(value: string | undefined, name: string): TierId {
  const v = (value ?? '').trim().toLowerCase();
  if (!(TIER_ORDER as readonly string[]).includes(v)) throw new Error(`${name} must be one of ${TIER_ORDER.join(', ')}`);
  return v as TierId;
}

/** Reads the perks settings; a bad value fails the deploy instead of silently unlocking or locking things. */
export function loadPerksConfig(env: EnvLike, publicCa?: string): PerksConfig {
  const tokenRaw = env.SPROUT_HOLDER_TOKEN?.trim() || (publicCa && isAddress(publicCa) ? publicCa : '');
  if (tokenRaw && !isAddress(tokenRaw)) throw new Error('SPROUT_HOLDER_TOKEN must be a 0x token address');
  const token = tokenRaw ? getAddress(tokenRaw) : null;

  const tiers: HolderTier[] = [];
  for (const part of (env.SPROUT_HOLDER_TIERS?.trim() || DEFAULT_TIERS).split(',')) {
    const [id, min] = part.split(':').map((s) => s.trim());
    const t = tierId(id, 'SPROUT_HOLDER_TIERS tier');
    if (!min || !/^\d+$/.test(min) || BigInt(min) <= 0n) throw new Error('SPROUT_HOLDER_TIERS amounts must be positive whole numbers');
    tiers.push({ id: t, min });
  }
  tiers.sort((a, b) => TIER_ORDER.indexOf(a.id) - TIER_ORDER.indexOf(b.id));
  for (let i = 1; i < tiers.length; i++) {
    if (BigInt(tiers[i]!.min) <= BigInt(tiers[i - 1]!.min)) throw new Error('SPROUT_HOLDER_TIERS must rise from seedling to grove');
  }

  const holdDays = Number(env.SPROUT_HOLDER_HOLD_DAYS?.trim() || 7);
  if (!Number.isInteger(holdDays) || holdDays < 0 || holdDays > 30) throw new Error('SPROUT_HOLDER_HOLD_DAYS must be a whole number from 0 to 30');

  const symbols = (env.SPROUT_EARLY_ACCESS_SYMBOLS ?? '')
    .split(',')
    .map((s) => s.trim().toUpperCase())
    .filter(Boolean);
  const untilRaw = env.SPROUT_EARLY_ACCESS_UNTIL?.trim();
  let until: number | null = null;
  if (untilRaw) {
    until = /^\d+$/.test(untilRaw) ? Number(untilRaw) : Math.floor(Date.parse(untilRaw) / 1000);
    if (!Number.isFinite(until) || until <= 0) throw new Error('SPROUT_EARLY_ACCESS_UNTIL must be a date (2026-09-26T00:00:00Z) or unix seconds');
  }
  if (symbols.length > 0 && until === null) throw new Error('SPROUT_EARLY_ACCESS_UNTIL is required with SPROUT_EARLY_ACCESS_SYMBOLS');

  const autoRaw = env.SPROUT_AUTOINVEST_TIER?.trim();
  return {
    token,
    tiers,
    holdDays,
    earlyAccess: { symbols, until, tier: env.SPROUT_EARLY_ACCESS_TIER?.trim() ? tierId(env.SPROUT_EARLY_ACCESS_TIER, 'SPROUT_EARLY_ACCESS_TIER') : 'sapling' },
    autoInvestTier: autoRaw ? tierId(autoRaw, 'SPROUT_AUTOINVEST_TIER') : null,
  };
}

/** The highest tier an amount (base units) reaches, or null. */
export function tierFor(amount: bigint, decimals: number, tiers: readonly HolderTier[]): TierId | null {
  const unit = 10n ** BigInt(decimals);
  let best: TierId | null = null;
  for (const t of tiers) if (amount >= BigInt(t.min) * unit) best = t.id;
  return best;
}

export function tierAtLeast(tier: TierId | null, required: TierId): boolean {
  return tier !== null && TIER_ORDER.indexOf(tier) >= TIER_ORDER.indexOf(required);
}

/** Blocks to sample: the head and every `stepSeconds` back to the window start (never before launch). */
export function sampleBlocks(head: bigint, windowStart: bigint, blocksPerStep: bigint): bigint[] {
  const out: bigint[] = [head];
  if (blocksPerStep <= 0n) return out;
  for (let b = head - blocksPerStep; b > windowStart; b -= blocksPerStep) out.push(b);
  if (windowStart < head) out.push(windowStart);
  return out;
}

export interface HolderStatus {
  address: Address;
  enabled: boolean;
  decimals: number;
  /** Base units, now. */
  balance: string;
  /** Base units: the smallest balance across the hold window. */
  heldBalance: string;
  /** Tier earned by holding through the window. */
  tier: TierId | null;
  /** Tier the current balance would earn once held through the window. */
  currentTier: TierId | null;
  holdDays: number;
  /** The hold that applied: `holdDays` in seconds, or 24 hours while the token is new. */
  holdSeconds: number;
  /** Unix seconds the window starts. */
  windowStart: number;
  checkedAt: number;
}

const STATUS_TTL_MS = 10 * 60 * 1000;
const STEP_SECONDS = 12 * 60 * 60;
/** The hold while the token is younger than the full hold period. */
export const LAUNCH_HOLD_SECONDS = 24 * 60 * 60;

/** Seconds a wallet must have held, given the token's age. */
export function requiredHoldSeconds(holdDays: number, tokenAgeSeconds: number): number {
  const full = holdDays * 86_400;
  return tokenAgeSeconds < full ? Math.min(full, LAUNCH_HOLD_SECONDS) : full;
}

export interface HolderChecker {
  config: PerksConfig;
  status(address: string): Promise<HolderStatus>;
  /** Tier for a wallet, or null when perks are off or the check fails. */
  tier(address: string): Promise<TierId | null>;
}

export function createHolderChecker(client: PublicClient | null, config: PerksConfig, nowMs: () => number = Date.now): HolderChecker {
  const cache = new Map<string, { at: number; status: HolderStatus }>();
  let decimals: number | null = null;
  let deployBlock: bigint | null = null;
  let blocksPerSecond: number | null = null;
  let launchTimestamp: bigint | null = null;

  async function tokenDecimals(): Promise<number> {
    decimals ??= Number(await client!.readContract({ address: config.token!, abi: erc20Abi, functionName: 'decimals' }));
    return decimals;
  }

  async function launchBlock(head: bigint): Promise<bigint> {
    if (deployBlock !== null) return deployBlock;
    let lo = 0n;
    let hi = head;
    while (lo < hi) {
      const mid = (lo + hi) / 2n;
      const code = await client!.getCode({ address: config.token!, blockNumber: mid });
      if (code && code !== '0x') hi = mid;
      else lo = mid + 1n;
    }
    deployBlock = lo;
    return lo;
  }

  async function rate(head: { number: bigint; timestamp: bigint }): Promise<number> {
    if (blocksPerSecond !== null) return blocksPerSecond;
    const back = head.number > 100_000n ? 100_000n : head.number;
    const older = await client!.getBlock({ blockNumber: head.number - back });
    const seconds = Number(head.timestamp - older.timestamp);
    blocksPerSecond = seconds > 0 ? Number(back) / seconds : 1;
    return blocksPerSecond;
  }

  async function compute(address: Address): Promise<HolderStatus> {
    const now = Math.floor(nowMs() / 1000);
    if (!client || !config.token) {
      return { address, enabled: false, decimals: 18, balance: '0', heldBalance: '0', tier: null, currentTier: null, holdDays: config.holdDays, holdSeconds: config.holdDays * 86_400, windowStart: now, checkedAt: now };
    }
    const dec = await tokenDecimals();
    const headBlock = await client.getBlock();
    const perSecond = await rate({ number: headBlock.number, timestamp: headBlock.timestamp });
    const launch = await launchBlock(headBlock.number);
    launchTimestamp ??= (await client.getBlock({ blockNumber: launch })).timestamp;
    const holdSeconds = requiredHoldSeconds(config.holdDays, Number(headBlock.timestamp - launchTimestamp));
    const windowBlocks = BigInt(Math.ceil(holdSeconds * perSecond));
    const windowStart = headBlock.number - windowBlocks > launch ? headBlock.number - windowBlocks : launch;
    const step = Math.min(STEP_SECONDS, Math.max(60, holdSeconds / 4));
    const blocks = sampleBlocks(headBlock.number, windowStart, BigInt(Math.max(1, Math.round(step * perSecond))));
    const balances = await Promise.all(
      blocks.map((blockNumber) => client.readContract({ address: config.token!, abi: erc20Abi, functionName: 'balanceOf', args: [address], blockNumber }) as Promise<bigint>),
    );
    const balance = balances[0]!;
    const held = balances.reduce((min, b) => (b < min ? b : min), balance);
    const windowStartSeconds = Number(headBlock.timestamp) - Math.round(Number(headBlock.number - windowStart) / perSecond);
    return {
      address,
      enabled: true,
      decimals: dec,
      balance: balance.toString(),
      heldBalance: held.toString(),
      tier: tierFor(held, dec, config.tiers),
      currentTier: tierFor(balance, dec, config.tiers),
      holdDays: config.holdDays,
      holdSeconds,
      windowStart: windowStartSeconds,
      checkedAt: now,
    };
  }

  async function status(raw: string): Promise<HolderStatus> {
    if (!isAddress(raw)) throw new Error('not an address');
    const address = getAddress(raw);
    const hit = cache.get(address);
    if (hit && nowMs() - hit.at < STATUS_TTL_MS) return hit.status;
    const fresh = await compute(address);
    cache.set(address, { at: nowMs(), status: fresh });
    return fresh;
  }

  return {
    config,
    status,
    async tier(address) {
      try {
        return (await status(address)).tier;
      } catch {
        return null;
      }
    },
  };
}

/** What the browser needs to show tiers and locks. */
export function publicPerks(config: PerksConfig) {
  return {
    enabled: config.token !== null,
    token: config.token,
    tiers: config.tiers,
    holdDays: config.holdDays,
    earlyAccess: config.earlyAccess,
    autoInvestTier: config.autoInvestTier,
  };
}
