import { describe, expect, test } from 'bun:test';
import { loadChainConfig } from '@sprout/shared';
import { keeperBudget, loadServerConfig } from '../src/config';
import { createChainContext } from '../src/chain';

const TOKEN = '0x00000000000000000000000000000000000000b2';
const FEED = '0x00000000000000000000000000000000000000f1';
const FACTORY = '0x00000000000000000000000000000000000000aa';
const VENUE = '0x00000000000000000000000000000000000000bb';

describe('chain configuration honesty', () => {
  test('missing live configuration is reported, not guessed', () => {
    const config = loadChainConfig({ SPROUT_CHAIN_ID: '4663', SPROUT_RPC_URL: 'https://example.invalid' });
    expect(config.configured).toBe(false);
    expect(config.missing).toContain('SPROUT_FACTORY_ADDRESS');
    expect(config.missing).toContain('SPROUT_SETTLEMENT_TOKEN');
    expect(config.missing).toContain('SPROUT_STOCK_TOKENS');
    expect(config.contracts.factory).toBeUndefined();
  });

  test('a complete configuration parses and reports configured', () => {
    const config = loadChainConfig({
      SPROUT_CHAIN_ID: '4663',
      SPROUT_RPC_URL: 'https://example.invalid',
      SPROUT_FACTORY_ADDRESS: FACTORY,
      SPROUT_SETTLEMENT_TOKEN: TOKEN,
      SPROUT_VENUE_ADDRESS: VENUE,
      SPROUT_STOCK_TOKENS: `AAA:${TOKEN}:18:1000000000000000000:${FEED}`,
    });
    expect(config.configured).toBe(true);
    expect(config.missing).toEqual([]);
    expect(config.contracts.stockTokens[0]?.multiplier).toBe(10n ** 18n);
  });

  test('local development keys are rejected against a public chain', () => {
    expect(() => loadServerConfig({ SPROUT_CHAIN_ID: '4663', SPROUT_USE_LOCAL_KEYS: '1' })).toThrow(/Refusing to use local/);
  });

  test('local Anvil with local keys is allowed', () => {
    const config = loadServerConfig({ SPROUT_CHAIN_ID: '31337', SPROUT_USE_LOCAL_KEYS: '1' });
    expect(config.chain.isLocal).toBe(true);
    expect(config.useLocalKeys).toBe(true);
  });

  test('a normal keeper key is allowed on a live chain', () => {
    const keeper = '0x1111111111111111111111111111111111111111111111111111111111111111';
    const config = loadServerConfig({
      SPROUT_CHAIN_ID: '4663',
      SPROUT_RPC_URL: 'https://rpc.example.invalid',
      SPROUT_KEEPER_PRIVATE_KEY: keeper,
    });
    expect(config.keeperPrivateKey).toBe(keeper);
    expect(() => createChainContext(config)).not.toThrow();
  });

  test('production refuses local demo and local keys', () => {
    expect(() => loadServerConfig({ NODE_ENV: 'production', SPROUT_CHAIN_ID: '4663', SPROUT_LOCAL_DEMO: '1' })).toThrow(
      /production/,
    );
    expect(() => loadServerConfig({ NODE_ENV: 'production', SPROUT_CHAIN_ID: '4663', SPROUT_USE_LOCAL_KEYS: '1' })).toThrow(
      /Refusing/,
    );
  });

  test('a non-local chain refuses local demo fixtures', () => {
    expect(() => loadServerConfig({ SPROUT_CHAIN_ID: '4663', SPROUT_LOCAL_DEMO: '1' })).toThrow(/non-local/);
  });

  test('start block and log range are validated', () => {
    expect(() => loadServerConfig({ SPROUT_START_BLOCK: '-1' })).toThrow(/START_BLOCK/);
    expect(() => loadServerConfig({ SPROUT_MAX_LOG_RANGE: '0' })).toThrow(/MAX_LOG_RANGE/);
    expect(() => loadServerConfig({ SPROUT_MAX_LOG_RANGE: '999999' })).toThrow(/MAX_LOG_RANGE/);
  });

  test('keeper automation requires positive, complete gas budgets', () => {
    const base = {
      SPROUT_CHAIN_ID: '4663',
      SPROUT_KEEPER_MAX_FEE_PER_GAS_WEI: '5',
      SPROUT_KEEPER_MAX_PRIORITY_FEE_PER_GAS_WEI: '2',
      SPROUT_KEEPER_GAS_LIMIT_CAP: '21000',
      SPROUT_KEEPER_DAILY_FEE_BUDGET_WEI: '1000',
    };
    expect(keeperBudget(loadServerConfig(base))).not.toBeNull();
    expect(keeperBudget(loadServerConfig({ ...base, SPROUT_KEEPER_DAILY_FEE_BUDGET_WEI: '0' }))).toBeNull();
    expect(keeperBudget(loadServerConfig({ ...base, SPROUT_KEEPER_MAX_FEE_PER_GAS_WEI: '0' }))).toBeNull();
    expect(keeperBudget(loadServerConfig({ ...base, SPROUT_KEEPER_MAX_PRIORITY_FEE_PER_GAS_WEI: '0' }))).toBeNull();
    const missingPriority = { ...base } as Record<string, string>;
    delete missingPriority.SPROUT_KEEPER_MAX_PRIORITY_FEE_PER_GAS_WEI;
    expect(keeperBudget(loadServerConfig(missingPriority))).toBeNull();
  });

  test('a well-known Anvil key is refused against a non-loopback RPC', () => {
    const anvilKey = '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80';
    const config = loadServerConfig({
      SPROUT_CHAIN_ID: '4663',
      SPROUT_RPC_URL: 'https://rpc.example.invalid',
      SPROUT_KEEPER_PRIVATE_KEY: anvilKey,
    });
    expect(() => createChainContext(config)).toThrow(/Anvil/);
  });
});

describe('snapshot interval', () => {
  test('defaults to five minutes, including when the variable is blank', () => {
    expect(loadServerConfig({}).snapshotIntervalSeconds).toBe(300);
    expect(loadServerConfig({ SPROUT_SNAPSHOT_INTERVAL_SECONDS: '' }).snapshotIntervalSeconds).toBe(300);
    expect(loadServerConfig({ SPROUT_SNAPSHOT_INTERVAL_SECONDS: '60' }).snapshotIntervalSeconds).toBe(60);
    expect(() => loadServerConfig({ SPROUT_SNAPSHOT_INTERVAL_SECONDS: '-1' })).toThrow();
  });
});
