import { describe, expect, test } from 'bun:test';
import type { Holding, HoldingsSnapshot } from '../src/chain';
import { portfolioPerformance } from '../src/performance';
import { primeHoldings } from '../src/chain';
import { insertChainEvent, setCursor, upsertSprout } from '../src/repo';
import { memoryDb, testimonialChain, testApp } from './helpers';

const cash = '0x1111111111111111111111111111111111111111';
const stock = '0x2222222222222222222222222222222222222222';
const usd = (value: number) => BigInt(Math.round(value * 1e8)).toString();
const raw = (value: number) => BigInt(Math.round(value * 1e6)).toString();
const event = (eventName: string, payload: unknown = {}, blockNumber = 10) => ({ eventName, payload, blockNumber, logIndex: 0 });
const initialized = event('SproutInitialized');
const deposit = (value: number) => event('Funded', { token: cash, amount: raw(value) });
const purchase = event('InvestmentExecuted', { token: stock, amountIn: raw(100), amountOut: '1000000000000000000' });
function holdings(cashValue: number, stockValue = 0, stockBalance = stockValue ? '1000000000000000000' : '0'): HoldingsSnapshot {
  const holding = (address: typeof cash | typeof stock, kind: Holding['kind'], balance: string, value: number): Holding => ({
    address, kind, rawBalance: balance, valueUsd: usd(value), symbol: kind, decimals: kind === 'settlement' ? 6 : 18,
    multiplier: '1000000000000000000', price: usd(value), feedDecimals: 8, shareEquivalent: balance, status: 'ok',
  });
  return {
    available: true, blockNumber: 10, feedDecimals: 8, totalValueUsd: usd(cashValue + stockValue), settlementAssumption: '$1',
    holdings: [holding(cash, 'settlement', raw(cashValue), cashValue), holding(stock, 'stock', stockBalance, stockValue)],
  };
}

describe('contribution-adjusted lifetime performance', () => {
  test('a deposit alone has zero gain', () => {
    expect(portfolioPerformance(holdings(100), [initialized, deposit(100)], 10)).toEqual({
      available: true, contributedUsd: usd(100), withdrawnUsd: '0', gainUsd: '0', feedDecimals: 8,
    });
  });
  test('gifts and later deposits do not inflate market growth', () => {
    const history = [initialized, deposit(100), purchase, deposit(50), event('GiftReceived', { token: cash, amount: raw(25) })];
    expect(portfolioPerformance(holdings(75, 120), history, 10)).toMatchObject({ available: true, contributedUsd: usd(175), gainUsd: usd(20) });
  });
  test('market losses remain negative after a new deposit', () => {
    expect(portfolioPerformance(holdings(100, 80), [initialized, deposit(100), purchase, deposit(100)], 10))
      .toMatchObject({ available: true, gainUsd: usd(-20) });
  });
  test.each(['Withdrawn', 'AllowanceClaimed'])('%s does not look like an investment loss', (name) => {
    expect(portfolioPerformance(holdings(30, 120), [initialized, deposit(150), purchase, event(name, { token: cash, amount: raw(20) })], 10))
      .toMatchObject({ available: true, contributedUsd: usd(150), withdrawnUsd: usd(20), gainUsd: usd(20) });
  });
  test('a fully withdrawn sprout preserves its contribution history', () => {
    expect(portfolioPerformance(holdings(0), [initialized, deposit(100), event('Withdrawn', { token: cash, amount: raw(100) })], 10))
      .toMatchObject({ available: true, contributedUsd: usd(100), withdrawnUsd: usd(100), gainUsd: '0' });
  });
  test('reserving and releasing rewards are not external cash flows', () => {
    expect(portfolioPerformance(holdings(100), [initialized, deposit(100), event('MilestoneCreated'), event('MilestoneReleased')], 10))
      .toMatchObject({ available: true, gainUsd: '0', withdrawnUsd: '0' });
  });
  test('an empty new sprout has zero contributions and zero gain', () => {
    expect(portfolioPerformance(holdings(0), [initialized], 10)).toMatchObject({ available: true, contributedUsd: '0', gainUsd: '0' });
  });
  test('an incomplete index cannot publish a gain', () => {
    expect(portfolioPerformance(holdings(100), [initialized, deposit(100)], 9)).toMatchObject({ available: false });
    expect(portfolioPerformance(holdings(100), [deposit(100)], 10)).toMatchObject({ available: false });
  });
  test('activity newer than the holdings snapshot is excluded', () => {
    expect(portfolioPerformance(holdings(100), [initialized, deposit(100), event('Funded', { token: cash, amount: raw(50) }, 11)], 11))
      .toMatchObject({ available: true, contributedUsd: usd(100), gainUsd: '0' });
  });
  test('unrecorded transfers do not become gains', () => {
    expect(portfolioPerformance(holdings(110), [initialized, deposit(100)], 10)).toMatchObject({ available: false });
  });
  test.each(['Funded', 'GiftReceived', 'Withdrawn', 'AllowanceClaimed'])('%s in stock tokens requires historical pricing', (name) => {
    expect(portfolioPerformance(holdings(0, 120), [initialized, event(name, { token: stock, amount: '1000000000000000000' })], 10))
      .toMatchObject({ available: false, reason: expect.stringContaining('historical prices') });
  });
  test('missing prices and malformed events fail closed', () => {
    expect(portfolioPerformance({ ...holdings(100), available: false, totalValueUsd: null }, [initialized, deposit(100)], 10)).toMatchObject({ available: false });
    expect(portfolioPerformance(holdings(100), [initialized, event('Funded', { token: cash, amount: 'bad' })], 10)).toMatchObject({ available: false });
    expect(portfolioPerformance(holdings(100), [initialized, event('Funded', null)], 10)).toMatchObject({ available: false });
  });
  test('18-decimal settlement amounts keep precision until USD conversion', () => {
    const snapshot = holdings(1);
    snapshot.holdings[0] = { ...snapshot.holdings[0]!, decimals: 18, rawBalance: '1000000000000000001' };
    expect(portfolioPerformance(snapshot, [initialized, event('Funded', { token: cash, amount: '1000000000000000001' })], 10))
      .toMatchObject({ available: true, contributedUsd: usd(1), gainUsd: '0' });
  });
  test('the holdings API attaches performance and waits for the index to catch up', async () => {
    const db = memoryDb();
    try {
      const chain = testimonialChain();
      const vault = '0x3333333333333333333333333333333333333333';
      const chainId = chain.config.chain.chainId;
      upsertSprout(db, {
        id: vault, chainId, parent: cash, beneficiary: stock, settlementToken: cash,
        graduationTimestamp: 2_000_000_000, assets: [stock], weights: [10000], createdTxHash: null, createdBlock: 10,
      });
      for (const [index, item] of [initialized, deposit(100), purchase].entries()) {
        insertChainEvent(db, {
          ...item, chainId, vaultId: vault, address: vault, txHash: `0x${'ab'.repeat(32)}`, logIndex: index,
        });
      }
      primeHoldings(chain, vault, holdings(0, 120));
      const app = testApp(db, chain);
      const pending = await app.request(`/api/sprouts/${vault}/holdings`);
      expect(pending.status).toBe(200);
      expect((await pending.json()).performance).toMatchObject({ available: false });
      setCursor(db, chainId, 10);
      const ready = await app.request(`/api/sprouts/${vault}/holdings`);
      expect(ready.status).toBe(200);
      expect(await ready.json()).toMatchObject({
        totalValueUsd: usd(120), performance: { available: true, contributedUsd: usd(100), gainUsd: usd(20) },
      });
    } finally {
      db.close();
    }
  });
});
