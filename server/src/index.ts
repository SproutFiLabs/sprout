import { loadServerConfig, type ServerConfig } from './config';
import { openDb, type SproutDb } from './db';
import { createChainContext, verifyRpcChain, type ChainContext } from './chain';
import { createApp } from './app';
import { reconcile, snapshotAll } from './indexer';
import { runDueJobs } from './jobs';
import { purgeExpiredNonces } from './repo';
import { createMutex } from './lock';

export interface SproutServer {
  config: ServerConfig;
  db: SproutDb;
  chain: ChainContext;
  httpPort: number;
  stop: () => Promise<void>;
  runMaintenance: () => Promise<void>;
}

export function createServer(config: ServerConfig = loadServerConfig()): SproutServer {
  const db = openDb(config.dbPath);
  const chain = createChainContext(config);
  const serialize = createMutex();
  const app = createApp({
    db,
    chain,
    localDemo: config.allowFixtures,
    adminToken: config.adminToken,
    runExclusive: serialize,
    serveWeb: config.serveWeb,
    webDistPath: config.webDistPath,
  });

  const runMaintenance = async (): Promise<void> => {
    await serialize(async () => {
      purgeExpiredNonces(db, Date.now());
      if (!chain.publicClient || !chain.config.chain.configured) return;
      try {
        await verifyRpcChain(chain);
      } catch (error) {
        console.warn('rpc chain verification failed', error instanceof Error ? error.message : error);
        return;
      }
      try {
        const result = await reconcile(chain, db, {});
        if (result.eventsNew > 0) console.info('indexed events', result);
      } catch (error) {
        console.warn('reconcile failed', error instanceof Error ? error.message : error);
      }
      try {
        await snapshotAll(chain, db);
      } catch (error) {
        console.warn('snapshot failed', error instanceof Error ? error.message : error);
      }
      // Always run: with no keeper/budget this reconciles any in-flight tx and
      // marks schedules unavailable rather than leaving them looking active.
      try {
        const results = await runDueJobs(chain, db);
        if (results.length > 0) console.info('jobs', results);
      } catch (error) {
        console.warn('job run failed', error instanceof Error ? error.message : error);
      }
    });
  };

  const interval = setInterval(() => {
    void runMaintenance();
  }, 30_000);

  const server = Bun.serve({
    port: config.port,
    hostname: config.bind,
    fetch: app.fetch,
  });

  const stop = async (): Promise<void> => {
    clearInterval(interval);
    await server.stop(true);
    db.close();
  };

  if (!config.chain.configured) {
    console.warn(
      `Live chain configuration is incomplete (${config.chain.missing.join(', ')}). ` +
        'Read endpoints still work; on-chain mutations will report missing configuration.',
    );
  }
  if (config.allowFixtures) {
    console.warn('SPROUT_LOCAL_DEMO=1: local fixtures enabled and clearly labeled.');
  }

  return { config, db, chain, httpPort: server.port ?? config.port, stop, runMaintenance };
}

if (import.meta.main) {
  const server = createServer();
  console.info(`Sprout backend listening on http://localhost:${server.config.port}`);

  const shutdown = async () => {
    await server.stop();
    process.exit(0);
  };
  process.on('SIGINT', () => void shutdown());
  process.on('SIGTERM', () => void shutdown());
}
