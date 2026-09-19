import { describe, expect, test } from 'bun:test';
import { getAddress } from 'viem';
import { loadChainConfig, parseLegacyDeployments } from '@sprout/shared';
import { ChainConfigError, type ChainContext } from '../src/chain';
import { deploymentFor, listDeployments, loadServerConfig } from '../src/config';
import { UnknownFactoryError, resolveVaultVenue } from '../src/deployments';
import { investQuote } from '../src/invest';
import { computeMinOuts } from '../src/jobs';
import { getSprout, upsertSprout } from '../src/repo';
import { issueNonce } from '../src/auth';
import { account, memoryDb, testApp } from './helpers';

// The production legacy entry, exactly as documented in docs/DEPLOY-RAILWAY.md.
const PROD_LEGACY = '0x399c4cbf1884a958d20259c53f11e81a11db201d:0xc7366f864cac8d97a89e57957ae949fafb17e520:61625416';

const NEW_FACTORY = '0x00000000000000000000000000000000000000aa';
const NEW_VENUE = '0x00000000000000000000000000000000000000bb';
const OLD_FACTORY = '0x00000000000000000000000000000000000000a1';
const OLD_VENUE = '0x00000000000000000000000000000000000000b1';
const ROGUE_FACTORY = '0x00000000000000000000000000000000000000a9';
const SETTLEMENT = '0x00000000000000000000000000000000000000c2';
const STOCK_A = '0x0000000000000000000000000000000000000d01';
const STOCK_B = '0x0000000000000000000000000000000000000d02';
const STOCK_C = '0x0000000000000000000000000000000000000d03';
const FEED = '0x00000000000000000000000000000000000000f1';

const VAULT_NEW = '0x0000000000000000000000000000000000000e01';
const VAULT_OLD = '0x0000000000000000000000000000000000000e02';
const VAULT_ROGUE = '0x0000000000000000000000000000000000000e03';
const PARENT = '0x0000000000000000000000000000000000000f0a';
const KID = '0x0000000000000000000000000000000000000f0b';

const FACTORY_OF: Record<string, string> = {
  [VAULT_NEW]: NEW_FACTORY,
  [VAULT_OLD]: OLD_FACTORY,
  [VAULT_ROGUE]: ROGUE_FACTORY,
};

function liveEnv(extra: Record<string, string> = {}): Record<string, string> {
  return {
    SPROUT_CHAIN_ID: '4663',
    SPROUT_RPC_URL: 'https://rpc.example.invalid',
    SPROUT_FACTORY_ADDRESS: NEW_FACTORY,
    SPROUT_SETTLEMENT_TOKEN: SETTLEMENT,
    SPROUT_VENUE_ADDRESS: NEW_VENUE,
    SPROUT_STOCK_TOKENS: [STOCK_A, STOCK_B, STOCK_C].map((t, i) => `S${i}:${t}:18:1000000000000000000:${FEED}:86400`).join(','),
    SPROUT_START_BLOCK: '2000',
    SPROUT_LEGACY_DEPLOYMENTS: `${OLD_FACTORY}:${OLD_VENUE}:1000`,
    ...extra,
  };
}

interface ReadCall {
  address: string;
  functionName: string;
  args?: readonly unknown[];
}

/** A chain where each vault reports its own factory and each factory admits only its own venue. */
function liveCtx(env: Record<string, string> = liveEnv(), extra: Record<string, (call: ReadCall) => unknown> = {}) {
  const config = loadServerConfig(env);
  const calls: ReadCall[] = [];
  const admitted: Record<string, { venue: string; assets: string[] }> = {
    [NEW_FACTORY]: { venue: NEW_VENUE, assets: [STOCK_A, STOCK_B, STOCK_C] },
    [OLD_FACTORY]: { venue: OLD_VENUE, assets: [STOCK_A] },
  };
  const publicClient = {
    getBlock: async () => ({ number: 100n, timestamp: 1_000_000n }),
    getBlockNumber: async () => 100n,
    getChainId: async () => 4663,
    readContract: async (call: ReadCall) => {
      calls.push(call);
      const address = call.address.toLowerCase();
      if (extra[call.functionName]) return extra[call.functionName]!(call);
      switch (call.functionName) {
        case 'factory': {
          const factory = FACTORY_OF[address];
          if (!factory) throw new Error('execution reverted');
          return factory;
        }
        case 'isAdmittedVenue':
          return admitted[address]?.venue === String(call.args?.[0]).toLowerCase();
        case 'admittedAssets':
          return admitted[address]?.assets ?? [];
        case 'totalSprouts':
          return address === NEW_FACTORY ? 2n : address === OLD_FACTORY ? 5n : 0n;
        default:
          throw new Error(`unexpected readContract ${call.functionName}`);
      }
    },
  };
  const ctx = { config, publicClient, walletClient: null, walletAddress: null, walletIsAnvilDev: false } as unknown as ChainContext;
  return { ctx, calls, config };
}

describe('SPROUT_LEGACY_DEPLOYMENTS configuration', () => {
  test('the production legacy entry parses', () => {
    expect(parseLegacyDeployments(PROD_LEGACY)).toEqual([
      {
        factory: '0x399c4cbf1884a958d20259c53f11e81a11db201d',
        venue: '0xc7366f864cac8d97a89e57957ae949fafb17e520',
        startBlock: 61625416,
      },
    ]);
  });

  test('several entries, spaces and a trailing comma are accepted; blank means none', () => {
    const two = parseLegacyDeployments(` ${OLD_FACTORY}:${OLD_VENUE}:1000 , ${ROGUE_FACTORY}:${OLD_VENUE}:1500,`);
    expect(two.map((d) => d.startBlock)).toEqual([1000, 1500]);
    expect(parseLegacyDeployments(undefined)).toEqual([]);
    expect(parseLegacyDeployments('')).toEqual([]);
    expect(loadChainConfig({}).contracts.legacyDeployments).toEqual([]);
  });

  test('malformed entries are refused, never skipped', () => {
    for (const bad of [
      `${OLD_FACTORY}:${OLD_VENUE}`,
      `${OLD_FACTORY}:${OLD_VENUE}:1000:9`,
      `0x1234:${OLD_VENUE}:1000`,
      `${OLD_FACTORY}:not-a-venue:1000`,
      `${OLD_FACTORY}:${OLD_VENUE}:-5`,
      `${OLD_FACTORY}:${OLD_VENUE}:12abc`,
      `${OLD_FACTORY}:${OLD_VENUE}:1000,${OLD_FACTORY}:${NEW_VENUE}:2000`,
    ]) {
      expect(() => parseLegacyDeployments(bad)).toThrow(/SPROUT_LEGACY_DEPLOYMENTS/);
      // The server refuses to start, so a deploy fails and the previous version keeps running.
      expect(() => loadServerConfig(liveEnv({ SPROUT_LEGACY_DEPLOYMENTS: bad }))).toThrow(/SPROUT_LEGACY_DEPLOYMENTS/);
      // The shared loader reports it instead of dropping the entry.
      const chain = loadChainConfig(liveEnv({ SPROUT_LEGACY_DEPLOYMENTS: bad }));
      expect(chain.configured).toBe(false);
      expect(chain.missing).toContain('SPROUT_LEGACY_DEPLOYMENTS');
    }
  });

  test('the current factory cannot also be listed as legacy', () => {
    const env = liveEnv({ SPROUT_LEGACY_DEPLOYMENTS: `${NEW_FACTORY.toUpperCase().replace('0X', '0x')}:${OLD_VENUE}:1000` });
    expect(() => loadServerConfig(env)).toThrow(/must not list the current/);
    expect(loadChainConfig(env).missing).toContain('SPROUT_LEGACY_DEPLOYMENTS');
  });

  test('a public chain needs a positive start block for every legacy deployment', () => {
    expect(() => loadServerConfig(liveEnv({ SPROUT_LEGACY_DEPLOYMENTS: `${OLD_FACTORY}:${OLD_VENUE}:0` }))).toThrow(/start block/);
    // Local Anvil keeps 0 for convenience.
    expect(() =>
      loadServerConfig({ SPROUT_CHAIN_ID: '31337', SPROUT_LEGACY_DEPLOYMENTS: `${OLD_FACTORY}:${OLD_VENUE}:0` }),
    ).not.toThrow();
  });

  test('deployments list the current one first, each with its own venue and start block', () => {
    const config = loadServerConfig(liveEnv());
    expect(config.chain.configured).toBe(true);
    expect(listDeployments(config)).toEqual([
      { factory: NEW_FACTORY, venue: NEW_VENUE, startBlock: 2000, current: true },
      { factory: OLD_FACTORY, venue: OLD_VENUE, startBlock: 1000, current: false },
    ]);
    expect(deploymentFor(config, getAddress(OLD_FACTORY))?.venue).toBe(OLD_VENUE);
    expect(deploymentFor(config, ROGUE_FACTORY)).toBeNull();
  });

  test('without legacy deployments (local dev) only the single factory is served', () => {
    const config = loadServerConfig({
      SPROUT_CHAIN_ID: '31337',
      SPROUT_RPC_URL: 'http://127.0.0.1:18545',
      SPROUT_FACTORY_ADDRESS: NEW_FACTORY,
      SPROUT_SETTLEMENT_TOKEN: SETTLEMENT,
      SPROUT_VENUE_ADDRESS: NEW_VENUE,
      SPROUT_STOCK_TOKENS: `AAA:${STOCK_A}:18:1000000000000000000:${FEED}:86400,BBB:${STOCK_B}:18:1000000000000000000:${FEED}:86400`,
    });
    expect(config.chain.configured).toBe(true);
    expect(listDeployments(config)).toEqual([{ factory: NEW_FACTORY, venue: NEW_VENUE, startBlock: 0, current: true }]);
  });

  test('stock names come from SPROUT_STOCK_NAMES when set', () => {
    const chain = loadChainConfig(liveEnv({ SPROUT_STOCK_NAMES: 'S0:Apple,S2:S&P 500, BAD' }));
    expect(chain.contracts.stockTokens.map((t) => t.name)).toEqual(['Apple', undefined, 'S&P 500']);
  });
});

describe('per-vault venue resolution', () => {
  test('a current-factory sprout buys through the current venue, a legacy one through the legacy venue', async () => {
    const { ctx } = liveCtx();
    const current = await resolveVaultVenue(ctx, VAULT_NEW);
    expect(current.venue).toBe(NEW_VENUE);
    expect(current.deployment.current).toBe(true);
    const legacy = await resolveVaultVenue(ctx, VAULT_OLD);
    expect(legacy.venue).toBe(OLD_VENUE);
    expect(legacy.factory).toBe(OLD_FACTORY);
    expect(legacy.deployment.current).toBe(false);
  });

  test('an unknown factory fails closed with a clear error', async () => {
    const { ctx } = liveCtx();
    const error = await resolveVaultVenue(ctx, VAULT_ROGUE).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(UnknownFactoryError);
    expect(error).toBeInstanceOf(ChainConfigError);
    expect(String((error as Error).message)).toContain(getAddress(ROGUE_FACTORY));
    expect(String((error as Error).message)).toContain('SPROUT_LEGACY_DEPLOYMENTS');
  });

  test('without legacy deployments a legacy sprout is refused rather than sent to the new venue', async () => {
    const env = liveEnv();
    delete env.SPROUT_LEGACY_DEPLOYMENTS;
    const { ctx } = liveCtx(env);
    await expect(resolveVaultVenue(ctx, VAULT_OLD)).rejects.toBeInstanceOf(UnknownFactoryError);
  });

  test('a configured venue its factory does not admit is refused', async () => {
    const { ctx } = liveCtx(liveEnv({ SPROUT_LEGACY_DEPLOYMENTS: `${OLD_FACTORY}:${NEW_VENUE}:1000` }));
    await expect(resolveVaultVenue(ctx, VAULT_OLD)).rejects.toThrow(/not admitted by factory/);
  });

  test('vault.factory() is read once and then served from memory', async () => {
    const { ctx, calls } = liveCtx();
    await resolveVaultVenue(ctx, VAULT_OLD);
    await resolveVaultVenue(ctx, VAULT_OLD);
    expect(calls.filter((c) => c.functionName === 'factory')).toHaveLength(1);
    expect(calls.filter((c) => c.functionName === 'isAdmittedVenue')).toHaveLength(1);
  });

  test('keeper minimums quote the legacy venue for a legacy sprout', async () => {
    const quoted: string[] = [];
    const { ctx } = liveCtx(liveEnv(), {
      assets: () => [STOCK_A],
      weights: () => [10_000],
      schedule: () => [true, 1_000_000n, 604_800n, 0n, 100n],
      settlementToken: () => SETTLEMENT,
      quote: (call) => {
        quoted.push(call.address);
        return 5n * 10n ** 18n;
      },
    });
    const mins = await computeMinOuts(ctx, VAULT_OLD, 1_000_000n);
    expect(quoted).toEqual([OLD_VENUE]);
    expect(mins).toEqual([(5n * 10n ** 18n * 9_900n) / 10_000n]);
    await expect(computeMinOuts(ctx, VAULT_ROGUE, 1_000_000n)).rejects.toBeInstanceOf(UnknownFactoryError);
  });

  test('the invest-now preview carries the vault\'s own venue, and refuses an unknown factory', async () => {
    const venueAllowedArgs: unknown[] = [];
    const quoted: string[] = [];
    const vaultReads = {
      settlementToken: () => SETTLEMENT,
      assets: () => [STOCK_A],
      weights: () => [10_000],
      schedule: () => [false, 0n, 0n, 0n, 100n],
      availableSettlement: () => 5_000_000n,
      graduationTimestamp: () => 2_000_000_000n,
      parent: () => PARENT,
      venueAllowed: (call: ReadCall) => {
        venueAllowedArgs.push(call.args?.[0]);
        return true;
      },
      quote: (call: ReadCall) => {
        quoted.push(call.address);
        return 10n ** 18n;
      },
    };
    const { ctx } = liveCtx(liveEnv(), vaultReads);

    const legacy = await investQuote(ctx, VAULT_OLD, 1_000_000n);
    expect(legacy.blocker).toBeNull();
    expect(legacy.venue).toBe(OLD_VENUE);
    expect(venueAllowedArgs).toEqual([OLD_VENUE]);
    expect(quoted).toEqual([OLD_VENUE]);

    const current = await investQuote(ctx, VAULT_NEW, 1_000_000n);
    expect(current.venue).toBe(NEW_VENUE);

    const rogue = await investQuote(ctx, VAULT_ROGUE, 1_000_000n);
    expect(rogue.venue).toBeNull();
    expect(rogue.minOuts).toBeNull();
    expect(rogue.blocker?.code).toBe('unknown-factory');
  });
});

describe('API: factory and admitted assets per sprout', () => {
  function seed(db: ReturnType<typeof memoryDb>, id: string, factory: string | null, createdAt = 1, parent = PARENT) {
    upsertSprout(db, {
      id,
      chainId: 4663,
      createdAt,
      parent,
      beneficiary: KID,
      settlementToken: SETTLEMENT,
      graduationTimestamp: 2_000_000_000,
      assets: [STOCK_A],
      weights: [10_000],
      createdTxHash: null,
      createdBlock: null,
      factory,
    });
  }

  test('GET /api/sprouts/:id reports the sprout\'s factory and only what that factory admits', async () => {
    const db = memoryDb();
    const { ctx } = liveCtx();
    seed(db, VAULT_OLD, OLD_FACTORY, 1);
    seed(db, VAULT_NEW, null, 2);
    seed(db, VAULT_ROGUE, ROGUE_FACTORY, 3);
    const app = testApp(db, ctx);

    const old = (await (await app.request(`/api/sprouts/${VAULT_OLD}`)).json()) as { sprout: Record<string, unknown> };
    expect(old.sprout.factory).toBe(getAddress(OLD_FACTORY));
    expect(old.sprout.admittedAssets).toEqual([getAddress(STOCK_A)]);

    // Unknown to the index: read from vault.factory() and remembered.
    const fresh = (await (await app.request(`/api/sprouts/${VAULT_NEW}`)).json()) as { sprout: Record<string, unknown> };
    expect(fresh.sprout.factory).toBe(getAddress(NEW_FACTORY));
    expect(fresh.sprout.admittedAssets).toEqual([STOCK_A, STOCK_B, STOCK_C].map((a) => getAddress(a)));
    expect(getSprout(db, VAULT_NEW)?.factory?.toLowerCase()).toBe(NEW_FACTORY);

    // A factory this server does not serve offers nothing.
    const rogue = (await (await app.request(`/api/sprouts/${VAULT_ROGUE}`)).json()) as { sprout: Record<string, unknown> };
    expect(rogue.sprout.factory).toBe(getAddress(ROGUE_FACTORY));
    expect(rogue.sprout.admittedAssets).toBeNull();

    const list = (await (await app.request(`/api/sprouts?parent=${PARENT}`)).json()) as { sprouts: Array<Record<string, unknown>> };
    expect(list.sprouts.map((s) => s.factory)).toEqual([OLD_FACTORY, NEW_FACTORY, ROGUE_FACTORY].map((f) => getAddress(f)));
    expect(list.sprouts[0]!.admittedAssets).toEqual([getAddress(STOCK_A)]);
  });

  test('without a chain the fields are null rather than guessed', async () => {
    const db = memoryDb();
    seed(db, VAULT_OLD, null);
    const config = loadServerConfig({});
    const ctx = { config, publicClient: null, walletClient: null, walletAddress: null, walletIsAnvilDev: false } as unknown as ChainContext;
    const body = (await (await testApp(db, ctx).request(`/api/sprouts/${VAULT_OLD}`)).json()) as { sprout: Record<string, unknown> };
    expect(body.sprout.factory).toBeNull();
    expect(body.sprout.admittedAssets).toBeNull();
  });

  test('/api/config lists legacy deployments and every stock token', async () => {
    const { ctx } = liveCtx(liveEnv({ SPROUT_STOCK_NAMES: 'S0:Apple' }));
    const body = (await (await testApp(memoryDb(), ctx).request('/api/config')).json()) as {
      chain: { contracts: { legacyDeployments: unknown[]; stockTokens: Array<{ symbol: string; name?: string }> } };
    };
    expect(body.chain.contracts.legacyDeployments).toEqual([{ factory: OLD_FACTORY, venue: OLD_VENUE, startBlock: 1000 }]);
    expect(body.chain.contracts.stockTokens.map((t) => t.symbol)).toEqual(['S0', 'S1', 'S2']);
    expect(body.chain.contracts.stockTokens[0]!.name).toBe('Apple');
  });

  test('readiness requires every factory to admit the venue configured for it', async () => {
    const good = await (await testApp(memoryDb(), liveCtx().ctx).request('/api/ready')).json() as {
      ready: boolean;
      checks: { venuesAdmitted: boolean; deployments: Array<{ factory: string; venueAdmitted: boolean }> };
    };
    expect(good.ready).toBe(true);
    expect(good.checks.deployments.map((d) => [d.factory, d.venueAdmitted])).toEqual([
      [NEW_FACTORY, true],
      [OLD_FACTORY, true],
    ]);

    // The legacy factory paired with the new venue by mistake: not ready, so the deploy fails.
    const { ctx } = liveCtx(liveEnv({ SPROUT_LEGACY_DEPLOYMENTS: `${OLD_FACTORY}:${NEW_VENUE}:1000` }));
    const res = await testApp(memoryDb(), ctx).request('/api/ready');
    expect(res.status).toBe(503);
    const bad = (await res.json()) as { checks: { venuesAdmitted: boolean } };
    expect(bad.checks.venuesAdmitted).toBe(false);
  });

  test('/api/stats counts sprouts from every factory', async () => {
    const { ctx } = liveCtx(liveEnv(), { decimals: () => 6 });
    const body = (await (await testApp(memoryDb(), ctx).request('/api/stats')).json()) as { sproutsPlanted: number; source: string };
    expect(body).toMatchObject({ sproutsPlanted: 7, source: 'chain' });
  });

  test('gift links accept the settlement token plus five stocks', async () => {
    const db = memoryDb();
    const { ctx } = liveCtx();
    seed(db, VAULT_OLD, OLD_FACTORY, 1, account.address);
    const app = testApp(db, ctx);
    const create = async (count: number) => {
      const challenge = issueNonce(db, { address: account.address, purpose: 'gift-create' });
      const signature = await account.signMessage({ message: challenge.message });
      return app.request('/api/gifts', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-sprout-address': account.address,
          'x-sprout-nonce': challenge.nonce,
          'x-sprout-signature': signature,
        },
        body: JSON.stringify({ vaultId: VAULT_OLD, acceptedAssets: [SETTLEMENT, STOCK_A, STOCK_B, STOCK_C, FEED, KID, PARENT].slice(0, count) }),
      });
    };
    expect((await create(6)).status).toBe(201);
    expect((await create(7)).status).toBe(400);
  });
});
