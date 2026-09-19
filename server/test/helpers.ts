import { createFamilySession } from '../src/privacy';
import { privateKeyToAccount } from 'viem/accounts';
import { loadChainConfig } from '@sprout/shared';
import { openDb, type SproutDb } from '../src/db';
import { createChainContext, type ChainContext } from '../src/chain';
import { createApp } from '../src/app';
import { loadServerConfig } from '../src/config';

export const TEST_KEY = '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d' as const;
export const OTHER_KEY = '0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a' as const;

export const account = privateKeyToAccount(TEST_KEY);
export const otherAccount = privateKeyToAccount(OTHER_KEY);

export function testConfig(env: Record<string, string> = {}) {
  return loadServerConfig({ SPROUT_DB_PATH: ':memory:', ...env });
}

export function memoryDb(): SproutDb {
  return openDb(':memory:');
}

export function testimonialChain(): ChainContext {
  const chain = loadChainConfig({});
  return createChainContext({
    chain,
    dbPath: ':memory:',
    port: 0,
    bind: '127.0.0.1',
    useLocalKeys: false,
    allowFixtures: true,
    serveWeb: false,
    webDistPath: ':memory:',
    startBlock: 0,
    maxLogRange: 2000,
  });
}

export function testApp(db: SproutDb, chain: ChainContext, opts: { localDemo?: boolean; adminToken?: string; now?: () => number } = {}) {
  return createApp({ db, chain, localDemo: opts.localDemo ?? true, adminToken: opts.adminToken, now: opts.now });
}

export function readHeaders(db: SproutDb, address: string = account.address) { return { authorization: `Bearer ${createFamilySession(db, address, Date.now()).token}` }; }
