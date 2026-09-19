import { DEFAULT_SNAPSHOT_INTERVAL_SECONDS, loadServerConfig, type ServerConfig } from './config';
import { openDb, type SproutDb } from './db';
import { createChainContext, verifyRpcChain, type ChainContext } from './chain';
import { createApp } from './app';
import { listAllVaults, reconcile, snapshotAll } from './indexer';
import { holderAutoInvestGate, runDueJobs } from './jobs';
import { createHolderChecker, loadPerksConfig } from './holders';
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
  // Shared by the API and the keeper loop, so both see the same tiers (and cache).
  const holders = createHolderChecker(chain.publicClient, loadPerksConfig(process.env, config.publicCa));
  const app = createApp({
    db,
    chain,
    holders,
    localDemo: config.allowFixtures,
    adminToken: config.adminToken,
    runExclusive: serialize,
    serveWeb: config.serveWeb,
    webDistPath: config.webDistPath,
    publicOrigin: config.publicOrigin,
  });

  const snapshotIntervalMs = (config.snapshotIntervalSeconds ?? DEFAULT_SNAPSHOT_INTERVAL_SECONDS) * 1000;
  let lastFullSnapshotAt = 0;

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
      let touched: string[] = [];
      try {
        const result = await reconcile(chain, db, {});
        touched = result.vaultsTouched;
        if (result.eventsNew > 0) console.info('indexed events', result);
      } catch (error) {
        console.warn('reconcile failed', error instanceof Error ? error.message : error);
      }
      try {
        // Every sprout on the slow cadence; sprouts that just changed right away,
        // so a new deposit shows up in the chart without waiting.
        const now = Date.now();
        if (now - lastFullSnapshotAt >= snapshotIntervalMs) {
          await snapshotAll(chain, db);
          lastFullSnapshotAt = now;
        } else if (touched.length > 0) {
          // Keep the stored spelling of each vault id for the snapshot rows.
          const ids = listAllVaults(db, chain.config.chain.chainId).filter((id) => touched.includes(id.toLowerCase()));
          await snapshotAll(chain, db, ids);
        }
      } catch (error) {
        console.warn('snapshot failed', error instanceof Error ? error.message : error);
      }
      // Always run: with no keeper/budget this reconciles any in-flight tx and
      // marks schedules unavailable rather than leaving them looking active.
      try {
        const results = await runDueJobs(chain, db, { mayAutoInvest: holderAutoInvestGate(db, holders) });
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
