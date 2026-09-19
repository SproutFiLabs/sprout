import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { decodeAbiParameters, encodeAbiParameters, encodeEventTopics, erc20Abi, getAddress, pad, type Address, type Hex } from 'viem';
import {
  BURN_ACTIONS,
  BURN_COMMANDS,
  CONTRACT_BALANCE,
  DEAD_ADDRESS,
  ROBINHOOD_BURN_ROUTE as ROUTE,
  ROBINHOOD_SPROUT_POOL_ID,
  ROUTER_SELF,
  burnPoolId,
  decodeBurnCalldata,
  encodeBurnRoute,
  minOutFor,
  parseBurnUsd,
  v3BurnPath,
} from '@sprout/shared';
import { createApp } from '../src/app';
import {
  BurnError,
  burnTotals,
  createBurnService,
  createWindowLimiter,
  ensureBurnTable,
  insertBurn,
  loadBurnConfig,
  shortWallet,
  verifyBurn,
  type BurnChainClient,
  type BurnRecord,
  type BurnTxEvidence,
} from '../src/burns';
import { memoryDb, testimonialChain } from './helpers';

/**
 * A $5 burn that ran through the real UniversalRouter on a mainnet fork
 * (scripts/fork-buy-and-burn.ts, SPROUT_BURN_WRITE_FIXTURE=1): its calldata is
 * the app's encoding, its logs are what the real pools emitted.
 */
const FIXTURE = JSON.parse(readFileSync(join(import.meta.dir, 'fixtures', 'burn-fork-receipt.json'), 'utf8')) as {
  usdgIn: string;
  minSproutOut: string;
  sproutBurned: string;
  evidence: Omit<BurnTxEvidence, 'blockNumber'> & { blockNumber: string };
};
const EVIDENCE: BurnTxEvidence = { ...FIXTURE.evidence, blockNumber: BigInt(FIXTURE.evidence.blockNumber) };
const PAYER = getAddress(EVIDENCE.from);
const NOW = EVIDENCE.timestamp + 60;
const OPTS = { nowSeconds: NOW, maxAgeSeconds: 72 * 3600 };
const ENABLED = { SPROUT_BURN_ENABLED: '1', SPROUT_BURN_ROUTER: ROUTE.router };
const E18 = 10n ** 18n;
const OTHER: Address = '0x000000000000000000000000000000000000b0b0';

const transferLog = (token: Address, from: Address, to: Address, value: bigint) => ({
  address: token,
  topics: encodeEventTopics({ abi: erc20Abi, eventName: 'Transfer', args: { from, to } }) as Hex[],
  data: pad(`0x${value.toString(16)}`, { size: 32 }),
});

describe('route encoding', () => {
  test('re-encodes the exact bytes that burned on the mainnet fork', () => {
    const decoded = decodeBurnCalldata(EVIDENCE.input, ROUTE)!;
    expect(decoded).not.toBeNull();
    const again = encodeBurnRoute({ route: ROUTE, usdgIn: BigInt(FIXTURE.usdgIn), minSproutOut: BigInt(FIXTURE.minSproutOut), deadline: decoded.deadline });
    expect(again.data).toBe(EVIDENCE.input);
  });

  test('commands and inputs, field by field', () => {
    const r = encodeBurnRoute({ route: ROUTE, usdgIn: 5_000_000n, minSproutOut: 39_000n * E18, deadline: 1_900_000_000n });
    expect(r.commands).toBe('0x000c10'); // V3_SWAP_EXACT_IN, UNWRAP_WETH, V4_SWAP
    expect(r.data.slice(0, 10)).toBe('0x3593564c'); // execute(bytes,bytes[],uint256)
    const [recipient, amountIn, amountOutMin, path, payerIsUser, hops] = decodeAbiParameters(
      [{ type: 'address' }, { type: 'uint256' }, { type: 'uint256' }, { type: 'bytes' }, { type: 'bool' }, { type: 'uint256[]' }],
      r.inputs[0]!,
    );
    expect([recipient, amountIn, amountOutMin, payerIsUser, hops]).toEqual([ROUTER_SELF, 5_000_000n, 0n, true, []]);
    expect(path).toBe(`0x5fc5360d0400a0fd4f2af552add042d716f1d168000064${'0bd7d308f8e1639fab988df18a8011f41eacad73'}`);
    expect(path).toBe(v3BurnPath(ROUTE).toLowerCase() as Hex);
    expect(decodeAbiParameters([{ type: 'address' }, { type: 'uint256' }], r.inputs[1]!)).toEqual([ROUTER_SELF, 0n]);
    const [actions, params] = decodeAbiParameters([{ type: 'bytes' }, { type: 'bytes[]' }], r.inputs[2]!);
    expect(actions).toBe('0x0b060e'); // SETTLE, SWAP_EXACT_IN_SINGLE, TAKE
    expect(decodeAbiParameters([{ type: 'address' }, { type: 'uint256' }, { type: 'bool' }], params[0]!)).toEqual([
      '0x0000000000000000000000000000000000000000',
      CONTRACT_BALANCE,
      false,
    ]);
    const [swap] = decodeAbiParameters(
      [
        {
          type: 'tuple',
          components: [
            { name: 'poolKey', type: 'tuple', components: [{ name: 'currency0', type: 'address' }, { name: 'currency1', type: 'address' }, { name: 'fee', type: 'uint24' }, { name: 'tickSpacing', type: 'int24' }, { name: 'hooks', type: 'address' }] },
            { name: 'zeroForOne', type: 'bool' },
            { name: 'amountIn', type: 'uint128' },
            { name: 'amountOutMinimum', type: 'uint128' },
            { name: 'minHopPriceX36', type: 'uint256' },
            { name: 'hookData', type: 'bytes' },
          ],
        },
      ],
      params[1]!,
    );
    expect(swap).toEqual({ poolKey: ROUTE.sproutPool, zeroForOne: true, amountIn: 0n, amountOutMinimum: 39_000n * E18, minHopPriceX36: 0n, hookData: '0x' });
    expect(decodeAbiParameters([{ type: 'address' }, { type: 'address' }, { type: 'uint256' }], params[2]!)).toEqual([ROUTE.sprout, DEAD_ADDRESS, 0n]);
  });

  test('the pool key is the live SPROUT/ETH pool', () => {
    expect(burnPoolId(ROUTE.sproutPool)).toBe(ROBINHOOD_SPROUT_POOL_ID);
  });

  test('decodes its own route and nothing else', () => {
    const r = encodeBurnRoute({ route: ROUTE, usdgIn: 20_000_000n, minSproutOut: 1n, deadline: 5n });
    expect(decodeBurnCalldata(r.data, ROUTE)).toMatchObject({ usdgIn: 20_000_000n, minSproutOut: 1n, deadline: 5n, recipient: DEAD_ADDRESS });
    // The same swap, but the SPROUT taken to the sender instead of burned.
    const toWallet = r.data.replace(DEAD_ADDRESS.slice(2).toLowerCase(), OTHER.slice(2)) as Hex;
    expect(decodeBurnCalldata(toWallet, ROUTE)).toMatchObject({ recipient: getAddress(OTHER) });
    // Another pool (a different hook), another token path, other commands: not a Sprout burn.
    const otherPool = encodeBurnRoute({ route: { ...ROUTE, sproutPool: { ...ROUTE.sproutPool, hooks: OTHER } }, usdgIn: 1n, minSproutOut: 1n, deadline: 5n });
    expect(decodeBurnCalldata(otherPool.data, ROUTE)).toBeNull();
    const otherPath = encodeBurnRoute({ route: { ...ROUTE, v3Fee: 500 }, usdgIn: 1n, minSproutOut: 1n, deadline: 5n });
    expect(decodeBurnCalldata(otherPath.data, ROUTE)).toBeNull();
    expect(decodeBurnCalldata(r.data.replace('000c10', '000c04') as Hex, ROUTE)).toBeNull();
    expect(decodeBurnCalldata(r.data.replace(BURN_ACTIONS.slice(2), '0b060f') as Hex, ROUTE)).toBeNull();
    expect(decodeBurnCalldata('0xa9059cbb', ROUTE)).toBeNull();
    expect(BURN_COMMANDS).toBe('0x000c10');
  });

  test('refuses nonsense amounts', () => {
    expect(() => encodeBurnRoute({ route: ROUTE, usdgIn: 0n, minSproutOut: 1n, deadline: 5n })).toThrow();
    expect(() => encodeBurnRoute({ route: ROUTE, usdgIn: 1n, minSproutOut: 0n, deadline: 5n })).toThrow();
    expect(() => encodeBurnRoute({ route: ROUTE, usdgIn: 1n, minSproutOut: 1n << 128n, deadline: 5n })).toThrow();
  });

  test('floors and amounts', () => {
    expect(minOutFor(40_000n * E18, 300)).toBe(38_800n * E18);
    expect(minOutFor(999n, 300)).toBe(969n); // rounds down, never up
    expect(() => minOutFor(1n, 10_000)).toThrow();
    expect(parseBurnUsd('5', 6)).toBe(5_000_000n);
    expect(parseBurnUsd('$12.50', 6)).toBe(12_500_000n);
    expect(parseBurnUsd('0.99', 6)).toBeNull();
    expect(parseBurnUsd('500', 6)).toBe(500_000_000n);
    expect(parseBurnUsd('500.01', 6)).toBeNull();
    expect(parseBurnUsd('1.234', 6)).toBeNull();
    expect(parseBurnUsd('1e3', 6)).toBeNull();
  });
});

describe('receipt verification', () => {
  test('the fork burn: wallet from the transaction, SPROUT from the pool to 0x…dEaD, USDG from the wallet', () => {
    const rec = verifyBurn(EVIDENCE, ROUTE, OPTS);
    expect(rec.wallet).toBe(PAYER);
    expect(rec.sproutBurned).toBe(BigInt(FIXTURE.sproutBurned));
    expect(rec.sproutBurned).toBeGreaterThanOrEqual(BigInt(FIXTURE.minSproutOut));
    expect(rec.usdgIn).toBe(5_000_000n);
    expect(rec.txHash).toBe(EVIDENCE.hash.toLowerCase() as Hex);
    expect(verifyBurn(EVIDENCE, ROUTE, { ...OPTS, claimedWallet: PAYER.toLowerCase() }).wallet).toBe(PAYER);
  });

  const refuses = (evidence: BurnTxEvidence, status: number, text: RegExp, opts: Parameters<typeof verifyBurn>[2] = OPTS) => {
    try {
      verifyBurn(evidence, ROUTE, opts);
      throw new Error('accepted');
    } catch (e) {
      expect(e).toBeInstanceOf(BurnError);
      expect((e as BurnError).status).toBe(status as never);
      expect((e as BurnError).message).toMatch(text);
    }
  };

  test('a transaction to another contract', () => refuses({ ...EVIDENCE, to: OTHER }, 422, /router/));
  test('a failed transaction', () => refuses({ ...EVIDENCE, status: 'reverted' }, 422, /did not go through/));
  test('no SPROUT reached the dead address', () => {
    const logs = EVIDENCE.logs.filter((l) => getAddress(l.address) !== ROUTE.sprout);
    refuses({ ...EVIDENCE, logs }, 422, /No SPROUT reached the dead address/);
  });
  test('SPROUT to the dead address that did not come from the pool', () => {
    const logs = [...EVIDENCE.logs.filter((l) => getAddress(l.address) !== ROUTE.sprout), transferLog(ROUTE.sprout, OTHER, DEAD_ADDRESS, 10n ** 24n)];
    refuses({ ...EVIDENCE, logs }, 422, /No SPROUT reached the dead address/);
  });
  test('the wallet sending its own SPROUT in the same transaction', () => {
    refuses({ ...EVIDENCE, logs: [...EVIDENCE.logs, transferLog(ROUTE.sprout, PAYER, ROUTE.poolManager, 1n)] }, 422, /moved SPROUT from the wallet/);
  });
  test('no USDG from the wallet', () => {
    const logs = EVIDENCE.logs.filter((l) => getAddress(l.address) !== ROUTE.usdg);
    refuses({ ...EVIDENCE, logs }, 422, /spent no USDG/);
  });
  test('the route with the SPROUT sent anywhere but the dead address', () => {
    refuses({ ...EVIDENCE, input: EVIDENCE.input.replace(DEAD_ADDRESS.slice(2).toLowerCase(), OTHER.slice(2)) as Hex }, 422, /other than the dead address/);
  });
  test('some other router call', () => refuses({ ...EVIDENCE, input: '0x3593564c' }, 422, /not a Sprout buy & burn/));
  test('too old, or from the future', () => {
    refuses(EVIDENCE, 422, /too old/, { ...OPTS, nowSeconds: EVIDENCE.timestamp + 72 * 3600 + 1 });
    refuses(EVIDENCE, 422, /future/, { ...OPTS, nowSeconds: EVIDENCE.timestamp - 3600 });
  });
  test('another wallet claiming it', () => refuses(EVIDENCE, 403, /different wallet/, { ...OPTS, claimedWallet: OTHER }));
});

/** A chain that knows the fork burn and quotes $1 = 0.00038 ETH = 8,000 SPROUT. */
function fakeChain(opts: { pending?: boolean } = {}) {
  const calls = { receipt: 0, quote: 0, dead: 0 };
  const client = {
    async getTransactionReceipt({ hash }: { hash: Hex }) {
      calls.receipt++;
      if (opts.pending || hash.toLowerCase() !== EVIDENCE.hash.toLowerCase()) {
        const e = new Error('not found');
        e.name = 'TransactionReceiptNotFoundError';
        throw e;
      }
      return { status: EVIDENCE.status, from: EVIDENCE.from, to: EVIDENCE.to, blockNumber: EVIDENCE.blockNumber, logs: EVIDENCE.logs };
    },
    async getTransaction() {
      return { input: EVIDENCE.input };
    },
    async getBlock() {
      return { timestamp: BigInt(EVIDENCE.timestamp) };
    },
    async readContract(args: { address: Address; functionName: string; args?: readonly unknown[] }) {
      if (args.functionName === 'balanceOf') {
        calls.dead++;
        return 81_000_000n * E18;
      }
      calls.quote++;
      const p = args.args![0] as { amountIn?: bigint; exactAmount?: bigint };
      if (getAddress(args.address) === ROUTE.v3Quoter) return [(p.amountIn! * 380_000_000_000_000n) / 1_000_000n, 0n, 1, 90_000n];
      return [(p.exactAmount! * 8_000n * E18) / 380_000_000_000_000n, 85_000n];
    },
  } as unknown as BurnChainClient;
  return { client, calls };
}

function burnApp(env: Record<string, string> = ENABLED, chain = fakeChain(), now = () => NOW * 1000) {
  const db = memoryDb();
  const service = createBurnService({ db, client: chain.client, config: loadBurnConfig(env, 4663), now });
  const app = createApp({ db, chain: testimonialChain(), localDemo: false, burns: service, now });
  const post = (body: unknown, headers: Record<string, string> = {}) =>
    app.request('/api/burns', { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) });
  return { app, db, post, chain };
}

describe('the API', () => {
  test('off: hidden everywhere', async () => {
    const { app, post } = burnApp({});
    expect(await (await app.request('/api/burns/config')).json()).toEqual({ enabled: false });
    expect(await (await app.request('/api/burns/summary')).json()).toEqual({ enabled: false });
    expect((await app.request('/api/burns/quote?usd=5')).status).toBe(404);
    expect((await post({ txHash: EVIDENCE.hash })).status).toBe(404);
  });

  test('records a burn once; a replay records nothing; another wallet cannot claim it', async () => {
    const { app, post, chain } = burnApp();
    const first = await post({ txHash: EVIDENCE.hash, wallet: PAYER });
    expect(first.status).toBe(201);
    const body = (await first.json()) as { recorded: boolean; burn: { wallet: string; sprout: string; usdg: string; tx: string } };
    expect(body.recorded).toBe(true);
    expect(body.burn).toMatchObject({ wallet: shortWallet(PAYER), sprout: FIXTURE.sproutBurned, usdg: '5000000', tx: EVIDENCE.hash.toLowerCase() });
    const again = await post({ txHash: EVIDENCE.hash.toUpperCase().replace('0X', '0x') });
    expect(again.status).toBe(200);
    expect(((await again.json()) as { recorded: boolean }).recorded).toBe(false);
    expect(chain.calls.receipt).toBe(1); // a known burn is answered from the database
    expect((await post({ txHash: EVIDENCE.hash, wallet: OTHER })).status).toBe(403);
    const summary = (await (await app.request('/api/burns/summary')).json()) as { count: number; sproutBurned: string };
    expect(summary.count).toBe(1);
    expect(summary.sproutBurned).toBe(FIXTURE.sproutBurned);
  });

  test('pending, unknown and malformed', async () => {
    const pending = burnApp(ENABLED, fakeChain({ pending: true }));
    expect((await pending.post({ txHash: EVIDENCE.hash })).status).toBe(409);
    const { post } = burnApp();
    expect((await post({ txHash: '0x1234' })).status).toBe(400);
    expect((await post({ txHash: EVIDENCE.hash, extra: 1 })).status).toBe(400);
    expect((await post({ txHash: `0x${'ab'.repeat(32)}` })).status).toBe(409);
  });

  test('config carries the route and the floor', async () => {
    const { app } = burnApp();
    const cfg = (await (await app.request('/api/burns/config')).json()) as Record<string, unknown>;
    expect(cfg).toMatchObject({ enabled: true, chainId: 4663, slippageBps: 300, minUsd: 1, maxUsd: 500, presets: [1, 5, 20], deadAddress: DEAD_ADDRESS });
    expect((cfg.route as { router: string }).router).toBe(ROUTE.router);
  });

  test('quotes: $1-$500 in cents, the floor 3% under, cached briefly', async () => {
    const { app, chain } = burnApp();
    for (const bad of ['0.5', '501', 'abc', '1.234', '']) expect((await app.request(`/api/burns/quote?usd=${bad}`)).status).toBe(400);
    const res = await app.request('/api/burns/quote?usd=5');
    expect(res.status).toBe(200);
    const q = (await res.json()) as { usdgIn: string; sproutOut: string; minSproutOut: string; slippageBps: number };
    expect(q.usdgIn).toBe('5000000');
    expect(BigInt(q.sproutOut)).toBe(40_000n * E18);
    expect(BigInt(q.minSproutOut)).toBe(38_800n * E18);
    const calls = chain.calls.quote;
    await app.request('/api/burns/quote?usd=5.00');
    expect(chain.calls.quote).toBe(calls);
  });

  test('rate limits a client that keeps posting', async () => {
    const { post } = burnApp();
    const headers = { 'x-forwarded-for': '203.0.113.9' };
    for (let i = 0; i < 12; i++) expect((await post({ txHash: EVIDENCE.hash }, headers)).status).toBeLessThan(300);
    expect((await post({ txHash: EVIDENCE.hash }, headers)).status).toBe(429);
    expect((await post({ txHash: EVIDENCE.hash }, { 'x-forwarded-for': '198.51.100.4' })).status).toBe(200);
  });
});

describe('summary math', () => {
  const rec = (i: number, sprout: bigint, usdg: bigint, at: number, wallet: Address = PAYER): BurnRecord => ({
    txHash: `0x${i.toString(16).padStart(64, '0')}`,
    chainId: 4663,
    wallet,
    sproutBurned: sprout,
    usdgIn: usdg,
    blockNumber: 1_000 + i,
    burnedAt: at,
  });

  test('sums exactly, newest first, at most ten', () => {
    const db = memoryDb();
    ensureBurnTable(db);
    const big = 123_456_789_012_345_678_901_234_567n;
    for (let i = 1; i <= 12; i++) expect(insertBurn(db, rec(i, big + BigInt(i), BigInt(i) * 1_000_000n, 100 + i), 0)).toBe(true);
    expect(insertBurn(db, rec(3, 1n, 1n, 1), 0)).toBe(false); // a tx is recorded once
    insertBurn(db, { ...rec(99, 5n, 5n, 1), chainId: 31337 }, 0); // another chain's never counts
    const t = burnTotals(db, 4663);
    expect(t.count).toBe(12);
    expect(t.sproutBurned).toBe(big * 12n + 78n);
    expect(t.usdgSpent).toBe(78_000_000n);
    expect(t.latest.map((r) => r.blockNumber)).toEqual([1012, 1011, 1010, 1009, 1008, 1007, 1006, 1005, 1004, 1003]);
  });

  test('the public summary: short wallets, amounts as strings, the dead balance', async () => {
    const { app, db, chain } = burnApp();
    insertBurn(db, rec(1, 40_000n * E18, 5_000_000n, NOW - 100), NOW);
    insertBurn(db, rec(2, 160_000n * E18, 20_000_000n, NOW - 50, OTHER), NOW);
    const s = (await (await app.request('/api/burns/summary')).json()) as Record<string, unknown> & { latest: Array<Record<string, unknown>> };
    expect(s).toMatchObject({ enabled: true, count: 2, sproutBurned: (200_000n * E18).toString(), usdgSpent: '25000000', deadBalance: (81_000_000n * E18).toString(), decimals: 18, usdgDecimals: 6 });
    expect(s.latest[0]).toEqual({ wallet: '0x0000…b0b0', sprout: (160_000n * E18).toString(), usdg: '20000000', tx: rec(2, 0n, 0n, 0).txHash, at: NOW - 50 });
    const deadReads = chain.calls.dead;
    await app.request('/api/burns/summary');
    expect(chain.calls.dead).toBe(deadReads); // cached
  });
});

describe('settings', () => {
  test('off unless both the flag and the router are set, and only on Robinhood Chain', () => {
    expect(loadBurnConfig({}, 4663).enabled).toBe(false);
    expect(loadBurnConfig({ SPROUT_BURN_ROUTER: ROUTE.router }, 4663).enabled).toBe(false);
    expect(loadBurnConfig({ SPROUT_BURN_ENABLED: '0', SPROUT_BURN_ROUTER: ROUTE.router }, 4663).enabled).toBe(false);
    expect(() => loadBurnConfig({ SPROUT_BURN_ENABLED: '1' }, 4663)).toThrow(/SPROUT_BURN_ROUTER is required/);
    expect(() => loadBurnConfig(ENABLED, 31337)).toThrow(/Robinhood Chain/);
    expect(() => loadBurnConfig({ ...ENABLED, SPROUT_BURN_ROUTER: OTHER }, 4663)).toThrow(/UniversalRouter/);
    expect(() => loadBurnConfig({ ...ENABLED, SPROUT_BURN_ROUTER: 'nope' }, 4663)).toThrow();
    expect(() => loadBurnConfig({ ...ENABLED, SPROUT_BURN_SLIPPAGE_BPS: '5000' }, 4663)).toThrow();
    const on = loadBurnConfig({ ...ENABLED, SPROUT_BURN_ROUTER: ROUTE.router.toLowerCase(), SPROUT_BURN_SLIPPAGE_BPS: '200', SPROUT_BURN_MAX_USD: '100' }, 4663);
    expect(on).toMatchObject({ enabled: true, slippageBps: 200, maxUsd: 100 });
    expect(on.route?.router).toBe(ROUTE.router);
  });

  test('the window limiter', () => {
    let t = 0;
    const allow = createWindowLimiter(2, 1_000, () => t);
    expect([allow('a'), allow('a'), allow('a'), allow('b')]).toEqual([true, true, false, true]);
    t = 1_000;
    expect(allow('a')).toBe(true);
  });

  test('the encoded route is the one the fixture burned with', () => {
    // Guards the fixture itself: a Sprout burn to the router, with the dead address in its TAKE.
    expect(getAddress(EVIDENCE.to!)).toBe(ROUTE.router);
    expect(EVIDENCE.input.toLowerCase()).toContain(encodeAbiParameters([{ type: 'address' }], [DEAD_ADDRESS]).slice(2).toLowerCase());
  });
});
