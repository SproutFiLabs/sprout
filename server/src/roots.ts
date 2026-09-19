import { erc20Abi, getAddress, isAddress, type Address, type PublicClient } from 'viem';
import { ROOT_DURATIONS, ROOT_MULTIPLIER_BPS, isRootDays, rootCredit, sproutRootLockAbi, type RootDays } from '@sprout/shared';
import { createReadCache } from './readCache';
import { createHolderChecker, loadPerksConfig, tierFor, type HolderChecker, type HolderStatus, type PerksConfig, type TierId } from './holders';

/**
 * "Root your SPROUT": an optional time-lock (contracts/src/SproutRootLock.sol)
 * that counts toward holder tiers. Off unless SPROUT_ROOT_LOCK_ADDRESS is set
 * (and holder perks are on, SPROUT_HOLDER_TOKEN); unset, nothing here runs and
 * no response carries any root field.
 *
 * A wallet's tier comes from its effective balance:
 *
 *   held balance (holders.ts: the smallest balance over the hold window)
 *   + each lock still locked  x 1.25 (30 days), 1.5 (90 days) or 2 (180 days)
 *   + each lock past its date but not yet withdrawn, x 1
 *
 * Locked SPROUT counts from the moment it is locked: nobody can move it until
 * the date, so there is nothing to wait out. Once the date passes the owner can
 * take it back at any moment, so it counts like held SPROUT (x1) until they do.
 * After a withdrawal the tokens are back in the wallet and follow the normal
 * hold rule again. Only a wallet's own locks count toward its tier; nobody
 * else's locks can change it.
 *
 * Locks are read from the contract's views (activeLocksOf + getLock), cached
 * briefly per wallet; a client that just locked passes the block its
 * transaction confirmed in, as it does for holdings. The first read checks the
 * contract locks the holder token; if it does not (or can't be read), locks
 * are not counted and tiers come from holding alone, as without the feature.
 */

export interface RootConfig {
  lock: Address | null;
}

type EnvLike = Record<string, string | undefined>;

export function loadRootConfig(env: EnvLike): RootConfig {
  const raw = env.SPROUT_ROOT_LOCK_ADDRESS?.trim() || '';
  if (raw && !isAddress(raw)) throw new Error('SPROUT_ROOT_LOCK_ADDRESS must be a 0x contract address');
  return { lock: raw ? getAddress(raw) : null };
}

export interface RawLock {
  id: bigint;
  owner: Address;
  amount: bigint;
  unlockAt: number;
  days: RootDays;
}

export interface LockRead {
  /** Block the locks were read at, and its timestamp (chain time, seconds). */
  block: number;
  timestamp: number;
  /** Wall-clock ms when read, to age `timestamp` forward. */
  readAtMs: number;
  locks: RawLock[];
}

export interface RootStats {
  /** Base units of SPROUT in locks not yet withdrawn. */
  totalLocked: bigint;
  supply: bigint;
  decimals: number;
  block: number;
}

export interface RootReader {
  lock: Address;
  locksOf(owner: string, options?: { afterBlock?: number }): Promise<LockRead>;
  stats(options?: { afterBlock?: number }): Promise<RootStats>;
  /** Drop every cached read (local demo time travel). */
  invalidate(): void;
}

/** One lock as the browser sees it. */
export interface RootLockView {
  id: string;
  amount: string;
  days: RootDays;
  unlockAt: number;
  /** The date has passed: the owner can withdraw. */
  due: boolean;
  /** 12500 = 1.25x while locked; 10000 once due. */
  multiplierBps: number;
  /** Base units this lock adds toward the tier right now. */
  counts: string;
}

export interface RootFields {
  /** At least one lock is still locked. */
  rooted: boolean;
  /** Locks not yet withdrawn, oldest first. */
  locks: RootLockView[];
  /** Base units in those locks. */
  lockedBalance: string;
  /** Base units they add toward the tier. */
  lockCredit: string;
  /** heldBalance + lockCredit: what the tier is read from. */
  effectiveBalance: string;
  /** The tier from holding alone. */
  heldTier: TierId | null;
  /** Chain time the locks were judged at (unix seconds). */
  chainTime: number;
}

export type RootedHolderStatus = HolderStatus & Partial<RootFields>;

export interface RootedHolderChecker extends HolderChecker {
  roots: RootReader | null;
  status(address: string, options?: { afterBlock?: number }): Promise<RootedHolderStatus>;
  /** Forget every cached tier and lock read: the local demo calls this after moving chain time. */
  invalidate(): void;
}

const LOCKS_TTL_MS = 30_000;
const STATS_TTL_MS = 30_000;
const SUPPLY_TTL_MS = 10 * 60 * 1000;
/** Minimum gap between forced re-reads for one key, however often clients ask. */
const FORCED_REFRESH_GAP_MS = 1_000;

/** Pure: a holder status plus its locks, judged at `nowSeconds` (chain time). */
export function applyLocks(base: HolderStatus, locks: readonly RawLock[], nowSeconds: number, tiers: PerksConfig['tiers']): RootedHolderStatus {
  let locked = 0n;
  let credit = 0n;
  let rooted = false;
  const views: RootLockView[] = locks.map((l) => {
    const due = nowSeconds >= l.unlockAt;
    const counts = due ? l.amount : rootCredit(l.amount, l.days);
    if (!due) rooted = true;
    locked += l.amount;
    credit += counts;
    return {
      id: l.id.toString(),
      amount: l.amount.toString(),
      days: l.days,
      unlockAt: l.unlockAt,
      due,
      multiplierBps: due ? 10_000 : ROOT_MULTIPLIER_BPS[l.days],
      counts: counts.toString(),
    };
  });
  const held = BigInt(base.heldBalance);
  const effective = held + credit;
  return {
    ...base,
    tier: base.enabled ? tierFor(effective, base.decimals, tiers) : null,
    currentTier: base.enabled ? tierFor(BigInt(base.balance) + credit, base.decimals, tiers) : null,
    rooted,
    locks: views,
    lockedBalance: locked.toString(),
    lockCredit: credit.toString(),
    effectiveBalance: effective.toString(),
    heldTier: base.tier,
    chainTime: nowSeconds,
  };
}

/** Reads one lock contract's views, checking once that it locks the configured token. */
export function createRootReader(client: PublicClient, lock: Address, token: Address, nowMs: () => number = Date.now): RootReader {
  const cache = createReadCache(nowMs);
  let tokenChecked: Promise<void> | null = null;

  function checkToken(): Promise<void> {
    tokenChecked ??= (async () => {
      const locked = (await client.readContract({ address: lock, abi: sproutRootLockAbi, functionName: 'token' })) as Address;
      if (getAddress(locked) !== getAddress(token)) {
        throw new Error(`SPROUT_ROOT_LOCK_ADDRESS locks ${locked}, not the holder token ${token}`);
      }
    })().catch((error: unknown) => {
      tokenChecked = null; // retry on the next read; a mismatch keeps failing loudly
      throw error;
    });
    return tokenChecked;
  }

  /** Drop a cached entry older than `afterBlock`, at most once a second per key. */
  function forceIfOlder(key: string, afterBlock: number | undefined): void {
    if (!afterBlock || afterBlock <= 0) return;
    const cached = cache.peek<{ block: number }>(key);
    if (!cached || cached.block >= afterBlock) return;
    const gate = `forced:${key}`;
    if (cache.peek(gate) !== undefined) return;
    cache.set(gate, true, FORCED_REFRESH_GAP_MS);
    cache.invalidate(key);
  }

  async function head(): Promise<{ number: bigint; timestamp: bigint }> {
    const block = await client.getBlock({ blockTag: 'latest' });
    return { number: block.number!, timestamp: block.timestamp };
  }

  return {
    lock,
    invalidate: () => cache.invalidate(),
    async locksOf(raw, options = {}) {
      const owner = getAddress(raw);
      const key = `locks:${owner}`;
      forceIfOlder(key, options.afterBlock);
      return cache.get(key, LOCKS_TTL_MS, async () => {
        await checkToken();
        const at = await head();
        const ids = (await client.readContract({
          address: lock,
          abi: sproutRootLockAbi,
          functionName: 'activeLocksOf',
          args: [owner],
          blockNumber: at.number,
        })) as readonly bigint[];
        const rows = await Promise.all(
          ids.map(
            (id) =>
              client.readContract({ address: lock, abi: sproutRootLockAbi, functionName: 'getLock', args: [id], blockNumber: at.number }) as Promise<{
                owner: Address;
                unlockAt: bigint;
                lockDays: number;
                withdrawn: boolean;
                amount: bigint;
              }>,
          ),
        );
        const locks: RawLock[] = [];
        rows.forEach((r, i) => {
          const days = Number(r.lockDays);
          // Defensive: the contract only ever stores these, for this owner.
          if (r.withdrawn || getAddress(r.owner) !== owner || !isRootDays(days) || r.amount <= 0n) return;
          locks.push({ id: ids[i]!, owner, amount: r.amount, unlockAt: Number(r.unlockAt), days });
        });
        return { block: Number(at.number), timestamp: Number(at.timestamp), readAtMs: nowMs(), locks };
      });
    },
    async stats(options = {}) {
      forceIfOlder('stats', options.afterBlock);
      const [supply, decimals] = await cache.get('supply', SUPPLY_TTL_MS, async () =>
        Promise.all([
          client.readContract({ address: token, abi: erc20Abi, functionName: 'totalSupply' }) as Promise<bigint>,
          client.readContract({ address: token, abi: erc20Abi, functionName: 'decimals' }).then(Number),
        ]),
      );
      return cache.get('stats', STATS_TTL_MS, async () => {
        await checkToken();
        const at = await head();
        const totalLocked = (await client.readContract({
          address: lock,
          abi: sproutRootLockAbi,
          functionName: 'totalLocked',
          blockNumber: at.number,
        })) as bigint;
        return { totalLocked, supply, decimals, block: Number(at.number) };
      });
    },
  };
}

/**
 * Wraps a holder checker so tiers (and so perks, votes and the keeper's
 * auto-invest gate) come from the effective balance. With no reader it changes
 * nothing.
 */
export function withRoots(inner: HolderChecker, reader: RootReader | null, nowMs: () => number = Date.now): RootedHolderChecker {
  if (!reader || !inner.config.token) {
    return { ...inner, roots: null, status: (address) => inner.status(address), invalidate: () => undefined };
  }
  /** The lock ids each wallet's held balance was last read alongside. */
  const seen = new Map<string, { key: string; checkedAt: number }>();
  /** The last good lock read per wallet, served if a later read fails. */
  const lastGood = new Map<string, LockRead>();

  let warnedAt = 0;
  /** This wallet's locks; the last good read if a new one fails; null if there has never been one. */
  async function readLocks(address: Address, afterBlock?: number): Promise<LockRead | null> {
    try {
      const read = await reader!.locksOf(address, { afterBlock });
      lastGood.set(address, read);
      return read;
    } catch (error) {
      const stale = lastGood.get(address);
      if (stale) return stale;
      // A misconfigured or unreachable lock contract must not take everyone's perks down with
      // it: tiers fall back to holding alone, and the logs say why (at most once a minute).
      if (nowMs() - warnedAt > 60_000) {
        warnedAt = nowMs();
        console.warn('root lock read failed; tiers use held SPROUT only', error instanceof Error ? error.message : error);
      }
      return null;
    }
  }

  async function status(raw: string, options: { afterBlock?: number } = {}): Promise<RootedHolderStatus> {
    if (!isAddress(raw)) throw new Error('not an address');
    const address = getAddress(raw);
    const read = await readLocks(address, options.afterBlock);
    let base = await inner.status(address);
    if (!read) return base;
    const key = read.locks.map((l) => l.id.toString()).join(',');
    const prior = seen.get(address);
    if (prior && prior.checkedAt === base.checkedAt && prior.key !== key && inner.forget) {
      // The wallet locked or withdrew since its held balance was read, so that
      // balance is out of date: read it again rather than count the lock twice.
      inner.forget(address);
      base = await inner.status(address);
    }
    seen.set(address, { key, checkedAt: base.checkedAt });
    const chainNow = read.timestamp + Math.max(0, Math.floor((nowMs() - read.readAtMs) / 1000));
    return applyLocks(base, read.locks, chainNow, inner.config.tiers);
  }

  return {
    config: inner.config,
    forget: inner.forget,
    roots: reader,
    status,
    invalidate() {
      reader!.invalidate();
      for (const address of seen.keys()) inner.forget?.(address);
      seen.clear();
      lastGood.clear();
    },
    async tier(address) {
      try {
        return (await status(address)).tier;
      } catch {
        return null;
      }
    },
  };
}

/** The holder checker the server runs: tiers from holding, plus locks when configured. */
export function createRootedHolderChecker(client: PublicClient | null, env: EnvLike): RootedHolderChecker {
  const perks = loadPerksConfig(env);
  const root = loadRootConfig(env);
  const inner = createHolderChecker(client, perks);
  const reader = client && perks.token && root.lock ? createRootReader(client, root.lock, perks.token) : null;
  return withRoots(inner, reader);
}

/** What /api/perks shows about rooting: null when the feature is off. */
export async function publicRoot(checker: HolderChecker, options: { afterBlock?: number } = {}) {
  const reader = (checker as Partial<RootedHolderChecker>).roots ?? null;
  if (!reader || !checker.config.token) return null;
  let totals: { rootedTotal: string; rootedShare: number; supply: string; decimals: number } | null = null;
  try {
    const s = await reader.stats(options);
    totals = {
      rootedTotal: s.totalLocked.toString(),
      // A fraction of the supply (0..1), to 6 decimal places.
      rootedShare: s.supply > 0n ? Number((s.totalLocked * 1_000_000n) / s.supply) / 1_000_000 : 0,
      supply: s.supply.toString(),
      decimals: s.decimals,
    };
  } catch {
    // The counter shows as unavailable; locking still works from the wallet.
  }
  return {
    contract: reader.lock,
    durations: ROOT_DURATIONS.map((days) => ({ days, multiplierBps: ROOT_MULTIPLIER_BPS[days] })),
    rootedTotal: totals?.rootedTotal ?? null,
    rootedShare: totals?.rootedShare ?? null,
    supply: totals?.supply ?? null,
    decimals: totals?.decimals ?? null,
  };
}
