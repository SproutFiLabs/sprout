import { describe, expect, test } from 'bun:test';
import { keccak256, parseTransaction, type Hex } from 'viem';
import type { ChainContext } from '../src/chain';
import { createApp } from '../src/app';
import { createHolderChecker, loadPerksConfig, type HolderChecker, type TierId } from '../src/holders';
import { resyncJobs } from '../src/indexer';
import { AUTOINVEST_PERK, holderAutoInvestGate, runDueJobs } from '../src/jobs';
import { getJob, upsertJob, upsertSprout } from '../src/repo';
import { account, memoryDb, testConfig } from './helpers';

// Automatic weekly investing as a SPROUT holder perk: the keeper only runs a
// due plan when the sprout's parent holds the required tier.

const NOW = 2_000_000_000;
const PERIOD = 604_800;
const TOKEN = '0x5ec27c931fb49911128dddf7d914c1754da9f49f';
const SETTLEMENT = '0x00000000000000000000000000000000000000b2';
const STOCK = '0x00000000000000000000000000000000000000a3';
const HOLDER_VAULT = '0x00000000000000000000000000000000000000a1';
const OTHER_VAULT = '0x00000000000000000000000000000000000000a2';
const HOLDER = '0x00000000000000000000000000000000000000d4';
const NEWCOMER = '0x00000000000000000000000000000000000000d5';

/** A local chain with a keeper and a gas budget, where every vault's weekly plan is due. */
function keeperChain() {
  const config = testConfig({
    SPROUT_CHAIN_ID: '31337',
    SPROUT_RPC_URL: 'http://127.0.0.1:18545',
    SPROUT_FACTORY_ADDRESS: '0x00000000000000000000000000000000000000aa',
    SPROUT_SETTLEMENT_TOKEN: SETTLEMENT,
    SPROUT_VENUE_ADDRESS: '0x00000000000000000000000000000000000000bb',
    SPROUT_STOCK_TOKENS: `S0:${STOCK}:18:1000000000000000000:0x00000000000000000000000000000000000000f1:86400`,
    SPROUT_KEEPER_MAX_FEE_PER_GAS_WEI: '2000000000',
    SPROUT_KEEPER_MAX_PRIORITY_FEE_PER_GAS_WEI: '100000000',
    SPROUT_KEEPER_GAS_LIMIT_CAP: '6000000',
    SPROUT_KEEPER_DAILY_FEE_BUDGET_WEI: '10000000000000000',
  });
  const nextExecution = new Map<string, number>([
    [HOLDER_VAULT, NOW - 60],
    [OTHER_VAULT, NOW - 60],
  ]);
  const sent: Array<{ vault: string }> = [];
  const publicClient = {
    getChainId: async () => 31337,
    getBlock: async () => ({ number: 100n, timestamp: BigInt(NOW) }),
    readContract: async ({ address, functionName }: { address: string; functionName: string }) => {
      switch (functionName) {
        case 'schedule':
          return [true, 1_000_000n, BigInt(PERIOD), BigInt(nextExecution.get(address.toLowerCase())!), 100n];
        case 'assets':
          return [STOCK];
        case 'weights':
          return [10_000];
        case 'settlementToken':
          return SETTLEMENT;
        case 'quote':
          return 10n ** 18n;
        default:
          throw new Error(`unexpected readContract ${functionName}`);
      }
    },
    getTransactionCount: async () => sent.length,
    getBalance: async () => 10n ** 18n,
    estimateGas: async () => 900_000n,
    estimateFeesPerGas: async () => ({ maxFeePerGas: 1_000_000_000n, maxPriorityFeePerGas: 1_000_000n }),
    sendRawTransaction: async ({ serializedTransaction }: { serializedTransaction: Hex }) => {
      const vault = parseTransaction(serializedTransaction).to!.toLowerCase();
      sent.push({ vault });
      nextExecution.set(vault, NOW + PERIOD);
      return keccak256(serializedTransaction);
    },
    getTransactionReceipt: async () => ({ status: 'success', blockNumber: 101n, gasUsed: 880_000n, effectiveGasPrice: 1_000_000_000n }),
  };
  const ctx = {
    config,
    publicClient,
    walletClient: { account },
    walletAddress: account.address,
    walletIsAnvilDev: false,
  } as unknown as ChainContext;
  return { ctx, sent };
}

function familyDb(chainId: number) {
  const db = memoryDb();
  for (const [vault, parent] of [
    [HOLDER_VAULT, HOLDER],
    [OTHER_VAULT, NEWCOMER],
  ] as const) {
    upsertSprout(db, {
      id: vault,
      chainId,
      parent,
      beneficiary: '0x00000000000000000000000000000000000000e5',
      settlementToken: SETTLEMENT,
      graduationTimestamp: NOW + 10 * 365 * 86_400,
      assets: [STOCK],
      weights: [10000],
      createdTxHash: null,
      createdBlock: null,
    });
    upsertJob(db, {
      id: `${vault}:investment`,
      vaultId: vault,
      chainId,
      kind: 'scheduled_investment',
      amount: '1000000',
      periodSeconds: PERIOD,
      nextRunAt: NOW - 60,
      lastRunAt: null,
      lastTxHash: null,
      status: 'active',
      attempts: 0,
      consecutiveFailures: 0,
      lastError: null,
    });
  }
  return db;
}

/** Tiers by wallet; like the real checker, no tier at all when perks are off. */
function holders(tiers: Record<string, TierId | null>, env: Record<string, string> = { SPROUT_AUTOINVEST_TIER: 'sapling' }, token: string | null = TOKEN): HolderChecker {
  const config = loadPerksConfig(env, token ?? undefined);
  return {
    config,
    status: async () => {
      throw new Error('not used');
    },
    tier: async (address) => (config.token ? tiers[address.toLowerCase()] ?? null : null),
  };
}

const run = (ctx: ChainContext, db: ReturnType<typeof memoryDb>, checker: HolderChecker) =>
  runDueJobs(ctx, db, { nowSeconds: NOW, sinceMs: 0, mayAutoInvest: holderAutoInvestGate(db, checker) });

describe('auto-invest as a holder perk', () => {
  test("a qualifying parent's due plan runs as before", async () => {
    const { ctx, sent } = keeperChain();
    const db = familyDb(ctx.config.chain.chainId);
    const results = await run(ctx, db, holders({ [HOLDER]: 'bloom', [NEWCOMER]: 'sapling' }));
    expect(results.map((r) => r.status)).toEqual(['executed', 'executed']);
    expect(sent).toHaveLength(2);
    const job = getJob(db, `${HOLDER_VAULT}:investment`)!;
    expect(job.status).toBe('active');
    expect(job.nextRunAt).toBe(NOW + PERIOD);
    expect(job.lastError).toBeNull();
  });

  test("a non-qualifying parent's plan is kept, not executed, and resumes once the tier is reached", async () => {
    const { ctx, sent } = keeperChain();
    const db = familyDb(ctx.config.chain.chainId);
    const tiers: Record<string, TierId | null> = { [HOLDER]: 'grove', [NEWCOMER]: 'seedling' };
    const checker = holders(tiers);

    const first = await run(ctx, db, checker);
    expect(first.find((r) => r.vaultId === HOLDER_VAULT)?.status).toBe('executed');
    expect(first.find((r) => r.vaultId === OTHER_VAULT)).toMatchObject({ status: 'paused', error: AUTOINVEST_PERK });
    expect(sent.map((s) => s.vault)).toEqual([HOLDER_VAULT]);
    let job = getJob(db, `${OTHER_VAULT}:investment`)!;
    // Scheduled but not run automatically: same week, not cancelled.
    expect(job.status).toBe('unavailable');
    expect(job.nextRunAt).toBe(NOW - 60);
    expect(job.lastError).toBe(AUTOINVEST_PERK);
    expect(job.consecutiveFailures).toBe(1);

    // Resync re-activates it; still short of the tier, it waits again without piling up failures.
    await resyncJobs(ctx, db);
    expect(getJob(db, job.id)!.status).toBe('active');
    await run(ctx, db, checker);
    job = getJob(db, job.id)!;
    expect(job.status).toBe('unavailable');
    expect(job.consecutiveFailures).toBe(1);
    expect(sent).toHaveLength(1);

    // The parent now holds a sapling: the same week's purchase runs.
    tiers[NEWCOMER] = 'sapling';
    await resyncJobs(ctx, db);
    const resumed = await run(ctx, db, checker);
    expect(resumed).toMatchObject([{ vaultId: OTHER_VAULT, status: 'executed' }]);
    expect(sent.map((s) => s.vault)).toEqual([HOLDER_VAULT, OTHER_VAULT]);
    job = getJob(db, job.id)!;
    expect(job.status).toBe('active');
    expect(job.nextRunAt).toBe(NOW + PERIOD);
    expect(job.lastError).toBeNull();
    expect(job.consecutiveFailures).toBe(0);
  });

  test('with no required tier every plan runs, holder or not', async () => {
    const { ctx, sent } = keeperChain();
    const db = familyDb(ctx.config.chain.chainId);
    const checker = holders({}, {});
    expect(holderAutoInvestGate(db, checker)).toBeUndefined();
    const results = await run(ctx, db, checker);
    expect(results.map((r) => r.status)).toEqual(['executed', 'executed']);
    expect(sent).toHaveLength(2);
  });

  test('with perks off (no holder token) every plan runs, even with a tier set', async () => {
    const { ctx, sent } = keeperChain();
    const db = familyDb(ctx.config.chain.chainId);
    const checker = createHolderChecker(null, loadPerksConfig({ SPROUT_AUTOINVEST_TIER: 'grove' }, undefined));
    expect(holderAutoInvestGate(db, checker)).toBeUndefined();
    const results = await run(ctx, db, checker);
    expect(results.map((r) => r.status)).toEqual(['executed', 'executed']);
    expect(sent).toHaveLength(2);
  });

  test('health reports the required tier, and the admin job run applies it', async () => {
    const { ctx, sent } = keeperChain();
    const db = familyDb(ctx.config.chain.chainId);
    const app = createApp({ db, chain: ctx, localDemo: true, holders: holders({ [HOLDER]: 'sapling' }) });
    const health = (await (await app.request('/api/health')).json()) as { automation: { enabled: boolean; autoInvestTier: string | null } };
    expect(health.automation).toMatchObject({ enabled: true, autoInvestTier: 'sapling' });

    const res = (await (await app.request('/api/jobs/run', { method: 'POST' })).json()) as { results: Array<{ vaultId: string; status: string }> };
    expect(res.results.find((r) => r.vaultId === OTHER_VAULT)?.status).toBe('paused');
    expect(sent.map((s) => s.vault)).toEqual([HOLDER_VAULT]);

    for (const off of [holders({}, {}), holders({}, { SPROUT_AUTOINVEST_TIER: 'sapling' }, null)]) {
      const plain = createApp({ db: memoryDb(), chain: ctx, localDemo: true, holders: off });
      const h = (await (await plain.request('/api/health')).json()) as { automation: { autoInvestTier: string | null } };
      expect(h.automation.autoInvestTier).toBeNull();
    }
  });
});
