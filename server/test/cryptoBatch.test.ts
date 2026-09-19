import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadChainConfig } from '@sprout/shared';
import { readHoldings, type ChainContext } from '../src/chain';
import { listDeployments, loadServerConfig } from '../src/config';
import { BaseError, ContractFunctionRevertedError, encodeErrorResult, parseAbi } from 'viem';
import { isPoolShortfall, priceBlocker } from '../src/invest';
import { memoryDb, testApp } from './helpers';

/**
 * The third factory's batch: WETH, CBBTC (8 decimals), CRCL and SGOV next to
 * the 21 stocks, and three factories served at once.
 */

const stocks = JSON.parse(readFileSync(join(import.meta.dir, '..', '..', 'config', 'stocks.json'), 'utf8')) as {
  settlement: string;
  legacy: Array<{ factory: string; venue: string; startBlock: number }>;
  stocks: Array<{ symbol: string; token: string; feed: string; decimals: number }>;
};
const cbbtc = stocks.stocks.find((s) => s.symbol === 'CBBTC')!;
const weth = stocks.stocks.find((s) => s.symbol === 'WETH')!;
const THIRD_FACTORY = '0x00000000000000000000000000000000000000ac';
const THIRD_VENUE = '0x00000000000000000000000000000000000000bc';
const VAULT = '0x0000000000000000000000000000000000000e03';
const NOW = 2_000_000_000;

/** SPROUT_STOCK_TOKENS as scripts/deploy-executor.ts stockTokenEntry() writes it, with each token's own decimals. */
const entry = (s: { symbol: string; token: string; feed: string; decimals: number }, decimals = s.decimals) =>
  `${s.symbol}:${s.token}:${decimals}:1000000000000000000:${s.feed}:86400`;

function liveEnv(tokens = stocks.stocks.map((s) => entry(s)).join(',')): Record<string, string> {
  return {
    SPROUT_CHAIN_ID: '4663',
    SPROUT_RPC_URL: 'https://rpc.example.invalid',
    SPROUT_FACTORY_ADDRESS: THIRD_FACTORY,
    SPROUT_VENUE_ADDRESS: THIRD_VENUE,
    SPROUT_SETTLEMENT_TOKEN: stocks.settlement,
    SPROUT_START_BLOCK: '67200000',
    SPROUT_STOCK_TOKENS: tokens,
    SPROUT_LEGACY_DEPLOYMENTS: stocks.legacy.map((l) => `${l.factory}:${l.venue}:${l.startBlock}`).join(','),
  };
}

/**
 * A chain where the vault holds 0.00036761 CBBTC (8 decimals) at $81,465.50
 * and 0.011365695 WETH (18 decimals) at $2,639.89, plus $20 USDG.
 */
function chainCtx(env: Record<string, string>, opts: { failDecimals?: boolean } = {}) {
  const config = loadServerConfig(env);
  const token = (a: string) => stocks.stocks.find((s) => s.token.toLowerCase() === a);
  const feed = (a: string) => stocks.stocks.find((s) => s.feed.toLowerCase() === a);
  const publicClient = {
    getBlock: async () => ({ number: 42n, timestamp: BigInt(NOW) }),
    getBlockNumber: async () => 42n,
    getChainId: async () => 4663,
    readContract: async ({ address, functionName, args }: { address: string; functionName: string; args?: readonly unknown[] }) => {
      const a = address.toLowerCase();
      switch (functionName) {
        case 'settlementToken':
          return stocks.settlement;
        case 'decimals':
          if (a === stocks.settlement.toLowerCase()) return 6;
          if (feed(a)) return 8;
          if (opts.failDecimals) throw new Error('rate limited');
          return token(a)!.decimals;
        case 'balanceOf':
          if (a === stocks.settlement.toLowerCase()) return 20_000_000n;
          if (a === cbbtc.token.toLowerCase()) return 36_761n;
          if (a === weth.token.toLowerCase()) return 11_365_695_041_249_144n;
          return 0n;
        case 'uiMultiplier':
        case 'oraclePaused':
          // WETH and cbBTC expose neither; the server tolerates that.
          if (a === cbbtc.token.toLowerCase() || a === weth.token.toLowerCase()) throw new Error('execution reverted');
          return functionName === 'uiMultiplier' ? 10n ** 18n : false;
        case 'latestRoundData': {
          const price = a === cbbtc.feed.toLowerCase() ? 8_146_550_220_179n : a === weth.feed.toLowerCase() ? 263_989_043_205n : 100n * 10n ** 8n;
          return [1n, price, BigInt(NOW), BigInt(NOW - 3600), 1n];
        }
        case 'isAdmittedVenue':
          return true;
        default:
          throw new Error(`unexpected readContract ${functionName} ${String(args)}`);
      }
    },
  };
  return { config, publicClient, walletClient: null, walletAddress: null, walletIsAnvilDev: false } as unknown as ChainContext;
}

const holding = (snap: Awaited<ReturnType<typeof readHoldings>>, symbol: string) => snap.holdings.find((h) => h.symbol === symbol)!;

describe('an 8-decimal asset is valued by its own decimals', () => {
  test('the Railway value parses CBBTC at 8 decimals and every other asset at 18', () => {
    const chain = loadChainConfig(liveEnv());
    expect(chain.contracts.stockTokens).toHaveLength(25);
    expect(chain.contracts.stockTokens.find((t) => t.symbol === 'CBBTC')!.decimals).toBe(8);
    expect(chain.contracts.stockTokens.filter((t) => t.symbol !== 'CBBTC').every((t) => t.decimals === 18)).toBe(true);
  });

  test('CBBTC and WETH holdings are valued at the oracle price, by their decimals', async () => {
    const snap = await readHoldings(chainCtx(liveEnv()), VAULT);
    expect(snap.available).toBe(true);
    // 36761e-8 x $81,465.50220179 = $29.9475... ; 8-decimal USD values.
    expect(holding(snap, 'CBBTC')).toMatchObject({ decimals: 8, rawBalance: '36761', status: 'ok', valueUsd: String((36_761n * 8_146_550_220_179n) / 10n ** 8n) });
    expect(Number(holding(snap, 'CBBTC').valueUsd) / 1e8).toBeCloseTo(29.9475, 3);
    expect(holding(snap, 'WETH')).toMatchObject({ decimals: 18, status: 'ok' });
    expect(Number(holding(snap, 'WETH').valueUsd) / 1e8).toBeCloseTo(30.0042, 3);
    expect(Number(snap.totalValueUsd) / 1e8).toBeCloseTo(20 + 29.9475 + 30.0042, 3);
  });

  test('a wrong decimals value in the env does not misprice it: the chain’s own decimals win', async () => {
    const wrong = liveEnv(stocks.stocks.map((s) => entry(s, 18)).join(','));
    const [right, misconfigured] = await Promise.all([readHoldings(chainCtx(liveEnv()), VAULT), readHoldings(chainCtx(wrong), VAULT)]);
    expect(holding(misconfigured, 'CBBTC').decimals).toBe(8);
    expect(misconfigured.totalValueUsd).toBe(right.totalValueUsd);
  });

  test('while decimals() cannot be read, the configured value is used', async () => {
    const snap = await readHoldings(chainCtx(liveEnv(), { failDecimals: true }), VAULT);
    expect(holding(snap, 'CBBTC').decimals).toBe(8);
    expect(holding(snap, 'CBBTC').valueUsd).toBe(String((36_761n * 8_146_550_220_179n) / 10n ** 8n));
  });

  test('readiness fails when SPROUT_STOCK_TOKENS gives a token the wrong decimals', async () => {
    const good = await testApp(memoryDb(), chainCtx(liveEnv())).request('/api/ready');
    expect(((await good.json()) as { checks: { stockDecimalsMatch: boolean } }).checks.stockDecimalsMatch).toBe(true);
    const bad = await testApp(memoryDb(), chainCtx(liveEnv(stocks.stocks.map((s) => entry(s, 18)).join(',')))).request('/api/ready');
    expect(bad.status).toBe(503);
    const body = (await bad.json()) as { checks: { stockDecimalsMatch: boolean; stockDecimalsMismatch: unknown } };
    expect(body.checks.stockDecimalsMatch).toBe(false);
    expect(body.checks.stockDecimalsMismatch).toEqual([{ symbol: 'CBBTC', configured: 18, onChain: 8 }]);
  });
});

describe('three factories', () => {
  test('the new factory is current and both earlier ones stay served, each with its own venue', () => {
    const deployments = listDeployments(loadServerConfig(liveEnv()));
    expect(deployments.map((d) => [d.factory.toLowerCase(), d.venue?.toLowerCase(), d.current])).toEqual([
      [THIRD_FACTORY, THIRD_VENUE, true],
      ['0x399c4cbf1884a958d20259c53f11e81a11db201d', '0xc7366f864cac8d97a89e57957ae949fafb17e520', false],
      ['0x10e70171a79c4e13b61ce37e81dc3a63be3b3a9d', '0x78998deb89e804aea5c71ddccf3ebd743d7919ad', false],
    ]);
    expect(deployments.map((d) => d.startBlock)).toEqual([67200000, 61625416, 66804053]);
  });
});

describe('a pool too far from the oracle', () => {
  const revert = (data: `0x${string}`) =>
    new BaseError('simulation failed', { cause: new ContractFunctionRevertedError({ abi: parseAbi(['error Shortfall()']), data, functionName: 'executeInvestment' }) });

  test('the router’s "Too little received" reads as pool-too-far, like the adapter’s Shortfall', () => {
    const errorString = encodeErrorResult({ abi: parseAbi(['error Error(string)']), errorName: 'Error', args: ['Too little received'] });
    expect(isPoolShortfall(revert(errorString))).toBe(true);
    expect(isPoolShortfall(revert(encodeErrorResult({ abi: parseAbi(['error Shortfall()']), errorName: 'Shortfall' })))).toBe(true);
    const other = encodeErrorResult({ abi: parseAbi(['error Error(string)']), errorName: 'Error', args: ['STF'] });
    expect(isPoolShortfall(revert(other))).toBe(false);
    expect(isPoolShortfall(new Error('network'))).toBe(false);
  });
});

describe('crypto wording', () => {
  test('a stale crypto price does not blame closed US markets', () => {
    const asset = cbbtc.token as `0x${string}`;
    expect(priceBlocker('StalePrice', 'CBBTC', asset).message).toContain('Crypto prices normally update around the clock');
    expect(priceBlocker('StalePrice', 'CBBTC', asset).message).not.toContain('US markets');
    expect(priceBlocker('StalePrice', 'WETH', asset).code).toBe('stale-price');
    expect(priceBlocker('StalePrice', 'AAPL', asset).message).toContain('This usually means US markets are closed');
    expect(priceBlocker('StalePrice', 'CRCL', asset).message).toContain('US markets are closed');
  });
});
