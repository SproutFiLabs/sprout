import { describe, expect, test } from 'bun:test';
import { getAddress, type Address, type PublicClient } from 'viem';
import { generatePrivateKey, privateKeyToAccount, type PrivateKeyAccount } from 'viem/accounts';
import { issueNonce } from '../src/auth';
import { createApp } from '../src/app';
import { loadPerksConfig, type HolderStatus } from '../src/holders';
import { applyLocks, createRootedHolderChecker, loadRootConfig, type RawLock } from '../src/roots';
import { VOTE_WEIGHTS } from '../src/votes';
import { memoryDb, testimonialChain } from './helpers';

const TOKEN = '0x5ec27c931fb49911128dddf7d914c1754da9f49f';
const LOCK = '0x00000000000000000000000000000000000f10cc';
const ALICE = getAddress('0x00000000000000000000000000000000000a11ce');
const BOB = getAddress('0x0000000000000000000000000000000000000b0b');
const E18 = 10n ** 18n;
const DAY = 86_400;
const HEAD = 10_000_000n; // 10 blocks a second: timestamp = block / 10
const NOW = Number(HEAD / 10n);
const ENV = { SPROUT_HOLDER_TOKEN: TOKEN, SPROUT_ROOT_LOCK_ADDRESS: LOCK };
const TIERS = loadPerksConfig(ENV).tiers;

interface ChainLock {
  owner: Address;
  amount: bigint;
  unlockAt: number;
  days: number;
  withdrawn: boolean;
}

/**
 * A chain with the SPROUT token (launched at block 500) and one lock contract.
 * Balances are functions of the block; locks can be added and withdrawn.
 */
function fakeChain() {
  const balances = new Map<string, (block: bigint) => bigint>();
  const locks = new Map<bigint, ChainLock>();
  const calls = { balanceOf: 0, activeLocksOf: 0, total: 0 };
  const state = { head: HEAD, lockedToken: TOKEN as string, supply: 1_000_000_000n * E18 };
  const client = {
    async readContract(args: { address: string; functionName: string; args?: readonly unknown[]; blockNumber?: bigint }) {
      calls.total++;
      const at = args.blockNumber ?? state.head;
      switch (args.functionName) {
        case 'decimals':
          return 18;
        case 'totalSupply':
          return state.supply;
        case 'balanceOf':
          calls.balanceOf++;
          return (balances.get(getAddress(args.args![0] as string)) ?? (() => 0n))(at);
        case 'token':
          return state.lockedToken;
        case 'activeLocksOf':
          calls.activeLocksOf++;
          return [...locks].filter(([, l]) => !l.withdrawn && l.owner === getAddress(args.args![0] as string)).map(([id]) => id);
        case 'getLock': {
          const l = locks.get(args.args![0] as bigint)!;
          return { owner: l.owner, unlockAt: BigInt(l.unlockAt), lockDays: l.days, withdrawn: l.withdrawn, amount: l.amount };
        }
        case 'totalLocked':
          return [...locks.values()].filter((l) => !l.withdrawn).reduce((s, l) => s + l.amount, 0n);
        default:
          throw new Error(`unexpected ${args.functionName}`);
      }
    },
    async getCode({ blockNumber }: { blockNumber: bigint }) {
      return blockNumber >= 500n ? '0x60' : undefined;
    },
    async getBlock(args?: { blockNumber?: bigint }) {
      const n = args?.blockNumber ?? state.head;
      return { number: n, timestamp: n / 10n };
    },
  } as unknown as PublicClient;
  let nextId = 1n;
  return {
    client,
    calls,
    state,
    balance: (who: Address, fn: (block: bigint) => bigint) => void balances.set(who, fn),
    lock: (owner: Address, amount: bigint, days: 30 | 90 | 180, lockedAt = NOW - 60) => {
      const id = nextId++;
      locks.set(id, { owner, amount, days, unlockAt: lockedAt + days * DAY, withdrawn: false });
      return id;
    },
    withdraw: (id: bigint) => void (locks.get(id)!.withdrawn = true),
  };
}

const base = (over: Partial<HolderStatus> = {}): HolderStatus => ({
  address: ALICE,
  enabled: true,
  decimals: 18,
  balance: '0',
  heldBalance: '0',
  tier: null,
  currentTier: null,
  holdDays: 7,
  holdSeconds: 7 * DAY,
  windowStart: 0,
  checkedAt: NOW,
  ...over,
});
const lock = (amount: bigint, days: 30 | 90 | 180, unlockAt = NOW + days * DAY, id = 1n): RawLock => ({ id, owner: ALICE, amount, days, unlockAt });

describe('root config', () => {
  test('off unless SPROUT_ROOT_LOCK_ADDRESS is set; a bad value fails loudly', () => {
    expect(loadRootConfig({}).lock).toBeNull();
    expect(loadRootConfig({ SPROUT_ROOT_LOCK_ADDRESS: LOCK }).lock).toBe(getAddress(LOCK));
    expect(() => loadRootConfig({ SPROUT_ROOT_LOCK_ADDRESS: 'nope' })).toThrow();
  });
});

describe('tier math with locks', () => {
  test('locked SPROUT counts x1.25 (30 days), x1.5 (90) and x2 (180)', () => {
    const r30 = applyLocks(base(), [lock(800_000n * E18, 30)], NOW, TIERS);
    expect(r30.lockCredit).toBe((1_000_000n * E18).toString());
    expect(r30.tier).toBe('sapling');
    const r90 = applyLocks(base(), [lock(800_000n * E18, 90)], NOW, TIERS);
    expect(r90.lockCredit).toBe((1_200_000n * E18).toString());
    const r180 = applyLocks(base(), [lock(2_500_000n * E18, 180)], NOW, TIERS);
    expect(r180.lockCredit).toBe((5_000_000n * E18).toString());
    expect(r180.tier).toBe('bloom');
    expect(r180.heldTier).toBeNull();
    expect(r180.rooted).toBe(true);
    // Just under a threshold stays below it.
    expect(applyLocks(base(), [lock(799_999n * E18, 30)], NOW, TIERS).tier).toBe('seedling');
  });

  test('held and locked add up, and several locks add up', () => {
    const r = applyLocks(base({ heldBalance: (2_000_000n * E18).toString(), balance: (2_000_000n * E18).toString(), tier: 'sapling' }), [lock(3_000_000n * E18, 30, NOW + 30 * DAY, 1n), lock(1_000_000n * E18, 180, NOW + 180 * DAY, 2n)], NOW, TIERS);
    // 2M + 3.75M + 2M = 7.75M
    expect(r.effectiveBalance).toBe((7_750_000n * E18).toString());
    expect(r.lockedBalance).toBe((4_000_000n * E18).toString());
    expect(r.tier).toBe('bloom');
    expect(r.heldTier).toBe('sapling');
    expect(r.locks!.map((l) => l.multiplierBps)).toEqual([12_500, 20_000]);
  });

  test('a lock past its date counts x1 until withdrawn, and is no longer "rooted"', () => {
    const r = applyLocks(base(), [lock(800_000n * E18, 30, NOW - 1)], NOW, TIERS);
    expect(r.lockCredit).toBe((800_000n * E18).toString());
    expect(r.tier).toBe('seedling');
    expect(r.rooted).toBe(false);
    expect(r.locks![0]!.due).toBe(true);
    // Exactly at the unlock time it is due (the contract allows withdrawal then).
    expect(applyLocks(base(), [lock(E18, 30, NOW)], NOW, TIERS).locks![0]!.due).toBe(true);
  });

  test('no locks changes nothing', () => {
    const b = base({ heldBalance: (1_500_000n * E18).toString(), balance: (1_500_000n * E18).toString(), tier: 'sapling', currentTier: 'sapling' });
    const r = applyLocks(b, [], NOW, TIERS);
    expect(r.tier).toBe('sapling');
    expect(r.rooted).toBe(false);
    expect(r.lockCredit).toBe('0');
  });
});

describe('rooted holder checker (chain reads)', () => {
  test('a lock counts immediately, with no hold wait', async () => {
    const chain = fakeChain();
    // Bought an hour ago (36,000 blocks), then locked 800k of it for 30 days just now.
    chain.balance(ALICE, (b) => (b > HEAD - 36_000n ? 200_000n * E18 : 0n));
    chain.lock(ALICE, 800_000n * E18, 30);
    const s = await createRootedHolderChecker(chain.client, ENV).status(ALICE);
    expect(s.heldBalance).toBe('0'); // the hold rule alone gives nothing yet
    expect(s.heldTier).toBeNull();
    expect(s.tier).toBe('sapling'); // 0 + 800k x 1.25 = 1M
    expect(s.rooted).toBe(true);
    expect(s.locks).toHaveLength(1);
    expect(s.locks![0]!.counts).toBe((1_000_000n * E18).toString());
  });

  test('other people’s locks never change a non-locker’s tier', async () => {
    const chain = fakeChain();
    chain.balance(BOB, () => 2_000_000n * E18);
    const checker = createRootedHolderChecker(chain.client, ENV);
    const before = await checker.status(BOB);
    chain.lock(ALICE, 50_000_000n * E18, 180);
    chain.lock(ALICE, 9_000_000n * E18, 30);
    const after = await createRootedHolderChecker(chain.client, ENV).status(BOB);
    for (const s of [before, after]) {
      expect(s.tier).toBe('sapling');
      expect(s.effectiveBalance).toBe((2_000_000n * E18).toString());
      expect(s.rooted).toBe(false);
      expect(s.locks).toEqual([]);
    }
  });

  test('withdrawing drops the boost; the tokens then follow the hold rule again', async () => {
    const chain = fakeChain();
    // Held 1M all along, locked 4M (180 days) since then; 4M came back one hour ago.
    const lockedId = chain.lock(ALICE, 4_000_000n * E18, 180, NOW - 181 * DAY);
    chain.balance(ALICE, () => 1_000_000n * E18);
    const checker = createRootedHolderChecker(chain.client, ENV);
    const due = await checker.status(ALICE);
    expect(due.locks![0]!.due).toBe(true);
    expect(due.tier).toBe('bloom'); // 1M + 4M (x1 once due)
    chain.withdraw(lockedId);
    chain.balance(ALICE, (b) => (b > HEAD - 36_000n ? 5_000_000n * E18 : 1_000_000n * E18));
    const after = await createRootedHolderChecker(chain.client, ENV).status(ALICE);
    expect(after.locks).toEqual([]);
    expect(after.lockCredit).toBe('0');
    expect(after.tier).toBe('sapling'); // held over the week: 1M
    expect(after.currentTier).toBe('bloom'); // once the 5M has been held for the week
  });

  test('a lock or withdrawal re-reads a held balance that is still cached', async () => {
    const chain = fakeChain();
    chain.balance(ALICE, () => 2_000_000n * E18);
    const checker = createRootedHolderChecker(chain.client, ENV);
    expect((await checker.status(ALICE)).tier).toBe('sapling');
    const balanceReads = chain.calls.balanceOf;
    // Locks 1M for 90 days: 1M leaves the wallet now.
    chain.balance(ALICE, (b) => (b >= HEAD - 10n ? 1_000_000n * E18 : 2_000_000n * E18));
    chain.lock(ALICE, 1_000_000n * E18, 90);
    chain.state.head = HEAD + 5n; // the lock confirmed in a newer block
    const s = await checker.status(ALICE, { afterBlock: Number(HEAD + 1n) });
    expect(chain.calls.balanceOf).toBeGreaterThan(balanceReads);
    expect(s.lockedBalance).toBe((1_000_000n * E18).toString());
    // Held is now 1M (not the cached 2M), plus 1.5M: counted once, not twice.
    expect(s.effectiveBalance).toBe((2_500_000n * E18).toString());
    expect(s.tier).toBe('sapling');
  });

  test('a lock contract for another token is refused: its locks never count, holding still does', async () => {
    const chain = fakeChain();
    chain.state.lockedToken = '0x000000000000000000000000000000000000dead';
    chain.balance(ALICE, () => 2_000_000n * E18);
    chain.lock(ALICE, 20_000_000n * E18, 180);
    const warn = console.warn;
    const warnings: unknown[] = [];
    console.warn = (...args: unknown[]) => void warnings.push(args);
    try {
      const checker = createRootedHolderChecker(chain.client, ENV);
      const s = await checker.status(ALICE);
      expect(s.tier).toBe('sapling'); // 2M held; the 40M "credit" is ignored
      expect('rooted' in s).toBe(false);
      expect(await checker.tier(ALICE)).toBe('sapling');
      expect(JSON.stringify(warnings)).toContain('not the holder token');
    } finally {
      console.warn = warn;
    }
  });

  test('without SPROUT_ROOT_LOCK_ADDRESS, statuses carry no root fields', async () => {
    const chain = fakeChain();
    chain.balance(ALICE, () => 2_000_000n * E18);
    chain.lock(ALICE, 9_000_000n * E18, 180);
    const s = await createRootedHolderChecker(chain.client, { SPROUT_HOLDER_TOKEN: TOKEN }).status(ALICE);
    expect(s.tier).toBe('sapling');
    expect('rooted' in s).toBe(false);
    expect(chain.calls.activeLocksOf).toBe(0);
  });
});

describe('API', () => {
  const START_MS = 1_789_000_000_000;

  function setup(env: Record<string, string> = ENV) {
    const chain = fakeChain();
    const db = memoryDb();
    const app = createApp({ db, chain: testimonialChain(), localDemo: false, adminToken: 'secret', now: () => START_MS, holders: createRootedHolderChecker(chain.client, env) });
    return { chain, db, app };
  }

  test('/api/perks shows the rooted counter; /api/holders shows a wallet’s locks', async () => {
    const { chain, app } = setup();
    chain.lock(ALICE, 12_500_000n * E18, 90);
    chain.lock(BOB, 500_000n * E18, 30);
    const perks = (await (await app.request('/api/perks')).json()) as { enabled: boolean; root: { contract: string; rootedTotal: string; rootedShare: number; durations: Array<{ days: number; multiplierBps: number }> } };
    expect(perks.enabled).toBe(true);
    expect(perks.root.contract).toBe(getAddress(LOCK));
    expect(perks.root.rootedTotal).toBe((13_000_000n * E18).toString());
    expect(perks.root.rootedShare).toBe(0.013);
    expect(perks.root.durations).toEqual([
      { days: 30, multiplierBps: 12_500 },
      { days: 90, multiplierBps: 15_000 },
      { days: 180, multiplierBps: 20_000 },
    ]);
    const status = (await (await app.request(`/api/holders/${ALICE}`)).json()) as { rooted: boolean; locks: Array<{ days: number; due: boolean }>; tier: string };
    expect(status.rooted).toBe(true);
    expect(status.locks).toEqual([expect.objectContaining({ days: 90, due: false })]);
    expect(status.tier).toBe('grove'); // 12.5M x 1.5
  });

  test('the whole feature is hidden when the lock address is unset', async () => {
    const { app } = setup({ SPROUT_HOLDER_TOKEN: TOKEN });
    const perks = (await (await app.request('/api/perks')).json()) as Record<string, unknown>;
    expect(perks.enabled).toBe(true);
    expect('root' in perks).toBe(false);
  });

  test('vote weight follows the effective balance, locks included', async () => {
    const { chain, db, app } = setup();
    const voter: PrivateKeyAccount = privateKeyToAccount(generatePrivateKey());
    const plain: PrivateKeyAccount = privateKeyToAccount(generatePrivateKey());
    chain.balance(voter.address, () => 1_000_000n * E18); // sapling by holding
    chain.lock(voter.address, 2_000_000n * E18, 180); // +4M: bloom
    chain.balance(plain.address, () => 1_000_000n * E18); // sapling, no locks
    const created = await app.request('/api/polls', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-sprout-admin-token': 'secret' },
      body: JSON.stringify({ question: 'Next stock?', options: [{ id: 'COIN', label: 'Coinbase' }, { id: 'HOOD', label: 'Robinhood' }], closesAt: START_MS / 1000 + 7 * DAY }),
    });
    const poll = ((await created.json()) as { poll: { id: string } }).poll;
    const vote = async (who: PrivateKeyAccount) => {
      const challenge = issueNonce(db, { address: who.address, purpose: 'vote', now: START_MS });
      const res = await app.request(`/api/polls/${poll.id}/vote`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-sprout-address': who.address,
          'x-sprout-nonce': challenge.nonce,
          'x-sprout-signature': await who.signMessage({ message: challenge.message }),
        },
        body: JSON.stringify({ optionId: 'COIN' }),
      });
      return ((await res.json()) as { vote: { tier: string; weight: number } }).vote;
    };
    expect(await vote(voter)).toEqual(expect.objectContaining({ tier: 'bloom', weight: VOTE_WEIGHTS.bloom }));
    expect(await vote(plain)).toEqual(expect.objectContaining({ tier: 'sapling', weight: VOTE_WEIGHTS.sapling }));
  });
});
