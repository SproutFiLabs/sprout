import { Database } from 'bun:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

const SCHEMA = `
CREATE TABLE IF NOT EXISTS zk_milestone_certificates (
 id TEXT PRIMARY KEY, vault_id TEXT NOT NULL, commitment TEXT NOT NULL,
 threshold_cents TEXT NOT NULL, scope TEXT NOT NULL, issued_at INTEGER NOT NULL,
 expires_at INTEGER NOT NULL, revoked INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_zk_milestone_vault ON zk_milestone_certificates(vault_id,issued_at);

CREATE TABLE IF NOT EXISTS family_gift_keys (address TEXT PRIMARY KEY, public_key TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS family_sessions (token_hash TEXT PRIMARY KEY, address TEXT NOT NULL, expires_at INTEGER NOT NULL);
CREATE INDEX IF NOT EXISTS idx_family_session_address ON family_sessions(address);
CREATE TABLE IF NOT EXISTS kid_invites (
 id TEXT PRIMARY KEY, vault_id TEXT NOT NULL, secret_hash TEXT NOT NULL,
 expires_at INTEGER NOT NULL, redeemed INTEGER NOT NULL DEFAULT 0, revoked INTEGER NOT NULL DEFAULT 0,
 show_balance INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS kid_sessions (token_hash TEXT PRIMARY KEY, invite_id TEXT NOT NULL, expires_at INTEGER NOT NULL);

CREATE TABLE IF NOT EXISTS sprouts (
  id TEXT PRIMARY KEY,
  chain_id INTEGER NOT NULL,
  parent TEXT NOT NULL,
  beneficiary TEXT NOT NULL,
  settlement_token TEXT NOT NULL,
  graduation_timestamp INTEGER NOT NULL,
  assets_json TEXT NOT NULL,
  weights_json TEXT NOT NULL,
  created_tx_hash TEXT,
  created_block INTEGER,
  created_at INTEGER NOT NULL,
  -- The factory that created the vault (vault.factory()); decides its venue.
  factory TEXT
);
CREATE INDEX IF NOT EXISTS idx_sprouts_parent ON sprouts(parent);
CREATE INDEX IF NOT EXISTS idx_sprouts_beneficiary ON sprouts(beneficiary);

CREATE TABLE IF NOT EXISTS gifts (
  id TEXT PRIMARY KEY,
  vault_id TEXT NOT NULL,
  label TEXT,
  accepted_assets_json TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open',
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_gifts_vault ON gifts(vault_id);

CREATE TABLE IF NOT EXISTS gift_payments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  gift_id TEXT NOT NULL,
  vault_id TEXT NOT NULL,
  chain_id INTEGER NOT NULL,
  tx_hash TEXT NOT NULL,
  log_index INTEGER NOT NULL,
  gifter TEXT NOT NULL,
  token TEXT NOT NULL,
  amount TEXT NOT NULL,
  block_number INTEGER,
  created_at INTEGER NOT NULL,
  UNIQUE(chain_id, tx_hash, log_index)
);

-- A gift link can be a time-boxed campaign with a goal ("Maya turns 8").
CREATE TABLE IF NOT EXISTS gift_campaigns (
  gift_id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  goal_cents INTEGER NOT NULL,
  ends_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);

-- A gifter's name and note, keyed to their verified on-chain gift.
CREATE TABLE IF NOT EXISTS gift_notes (
  chain_id INTEGER NOT NULL,
  tx_hash TEXT NOT NULL,
  log_index INTEGER NOT NULL,
  gift_id TEXT NOT NULL,
  gifter TEXT NOT NULL,
  name TEXT,
  note TEXT,
  hidden INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (chain_id, tx_hash, log_index)
);
CREATE INDEX IF NOT EXISTS idx_gift_notes_gift ON gift_notes(gift_id);

CREATE TABLE IF NOT EXISTS milestones (
  uid TEXT PRIMARY KEY,
  milestone_id TEXT NOT NULL,
  vault_id TEXT NOT NULL,
  chain_id INTEGER NOT NULL,
  token TEXT NOT NULL,
  amount TEXT NOT NULL,
  unlock_time INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'created',
  description_hash TEXT,
  created_tx_hash TEXT,
  released_tx_hash TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  UNIQUE(chain_id, vault_id, milestone_id)
);
CREATE INDEX IF NOT EXISTS idx_milestones_vault ON milestones(vault_id);

CREATE TABLE IF NOT EXISTS chain_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  chain_id INTEGER NOT NULL,
  tx_hash TEXT NOT NULL,
  log_index INTEGER NOT NULL,
  block_number INTEGER NOT NULL,
  address TEXT NOT NULL,
  event_name TEXT NOT NULL,
  vault_id TEXT,
  payload_json TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  UNIQUE(chain_id, tx_hash, log_index)
);
CREATE INDEX IF NOT EXISTS idx_chain_events_vault ON chain_events(vault_id);

CREATE TABLE IF NOT EXISTS indexer_cursor (
  chain_id INTEGER PRIMARY KEY,
  last_block INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL
);

-- How far each factory's own logs have been read. indexer_cursor stays the
-- cursor of the shared pass over every factory and vault; a factory behind it
-- (one newly added to the configuration) is caught up on its own first.
CREATE TABLE IF NOT EXISTS indexer_factory_cursor (
  chain_id INTEGER NOT NULL,
  factory TEXT NOT NULL,
  last_block INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (chain_id, factory)
);

CREATE TABLE IF NOT EXISTS growth_snapshots (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  vault_id TEXT NOT NULL,
  chain_id INTEGER NOT NULL,
  taken_at INTEGER NOT NULL,
  block_number INTEGER,
  value_usd TEXT NOT NULL,
  feed_decimals INTEGER NOT NULL,
  holdings_json TEXT NOT NULL,
  source TEXT NOT NULL,
  note TEXT,
  UNIQUE(vault_id, taken_at)
);
CREATE INDEX IF NOT EXISTS idx_growth_vault ON growth_snapshots(vault_id, taken_at);

CREATE TABLE IF NOT EXISTS investment_jobs (
  id TEXT PRIMARY KEY,
  vault_id TEXT NOT NULL,
  chain_id INTEGER NOT NULL,
  kind TEXT NOT NULL,
  amount TEXT NOT NULL,
  period_seconds INTEGER NOT NULL,
  next_run_at INTEGER NOT NULL,
  last_run_at INTEGER,
  last_tx_hash TEXT,
  status TEXT NOT NULL DEFAULT 'active',
  attempts INTEGER NOT NULL DEFAULT 0,
  consecutive_failures INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_jobs_due ON investment_jobs(status, next_run_at);

CREATE TABLE IF NOT EXISTS keeper_txs (
  id TEXT PRIMARY KEY,
  job_id TEXT NOT NULL,
  vault_id TEXT NOT NULL,
  chain_id INTEGER NOT NULL,
  signer TEXT,
  nonce INTEGER NOT NULL,
  gas TEXT NOT NULL,
  max_fee_per_gas TEXT NOT NULL,
  max_priority_fee_per_gas TEXT NOT NULL,
  raw_tx TEXT,
  tx_hash TEXT,
  status TEXT NOT NULL,
  block_number TEXT,
  gas_used TEXT,
  effective_gas_price TEXT,
  error TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_keeper_job ON keeper_txs(job_id, status);
CREATE INDEX IF NOT EXISTS idx_keeper_status ON keeper_txs(chain_id, status, updated_at);

CREATE TABLE IF NOT EXISTS nonces (
  nonce TEXT PRIMARY KEY,
  address TEXT NOT NULL,
  purpose TEXT NOT NULL,
  message TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  used_at INTEGER,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_nonces_address ON nonces(address);
`;

export type SproutDb = Database;

function hasColumn(db: SproutDb, table: string, column: string): boolean {
  const rows = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
  return rows.some((r) => r.name === column);
}

/** Idempotent column/table migrations for databases created by earlier builds. */
function migrate(db: SproutDb): void {
  if (!hasColumn(db, 'investment_jobs', 'consecutive_failures')) {
    db.exec('ALTER TABLE investment_jobs ADD COLUMN consecutive_failures INTEGER NOT NULL DEFAULT 0;');
  }
  if (!hasColumn(db, 'growth_snapshots', 'note')) {
    db.exec('ALTER TABLE growth_snapshots ADD COLUMN note TEXT;');
  }
  if (!hasColumn(db, 'keeper_txs', 'signer')) {
    db.exec('ALTER TABLE keeper_txs ADD COLUMN signer TEXT;');
  }
  if (!hasColumn(db, 'sprouts', 'factory')) {
    db.exec('ALTER TABLE sprouts ADD COLUMN factory TEXT;');
  }
  // A sprout's factory is the address that emitted its SproutCreated event.
  // Only configured factories are ever indexed, so this needs no chain read.
  db.exec(`
    UPDATE sprouts SET factory = (
      SELECT e.address FROM chain_events e
      WHERE e.event_name = 'SproutCreated' AND e.chain_id = sprouts.chain_id AND lower(e.vault_id) = lower(sprouts.id)
      ORDER BY e.block_number ASC LIMIT 1
    )
    WHERE factory IS NULL;
  `);
  if (!hasColumn(db, 'milestones', 'uid')) {
    db.exec(`
      ALTER TABLE milestones RENAME TO milestones_legacy;
      CREATE TABLE milestones (
        uid TEXT PRIMARY KEY,
        milestone_id TEXT NOT NULL,
        vault_id TEXT NOT NULL,
        chain_id INTEGER NOT NULL,
        token TEXT NOT NULL,
        amount TEXT NOT NULL,
        unlock_time INTEGER NOT NULL DEFAULT 0,
        status TEXT NOT NULL DEFAULT 'created',
        description_hash TEXT,
        created_tx_hash TEXT,
        released_tx_hash TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        UNIQUE(chain_id, vault_id, milestone_id)
      );
    `);
    db.exec(`
      INSERT INTO milestones
        (uid, milestone_id, vault_id, chain_id, token, amount, unlock_time, status, description_hash, created_tx_hash, released_tx_hash, created_at, updated_at)
      SELECT
        chain_id || ':' || lower(vault_id) || ':' || lower(id),
        id, vault_id, chain_id, token, amount, unlock_time, status, description_hash, created_tx_hash, released_tx_hash, created_at, updated_at
      FROM milestones_legacy;
    `);
    db.exec('DROP TABLE milestones_legacy;');
  }
}

export function openDb(dbPath: string): SproutDb {
  if (dbPath !== ':memory:') {
    mkdirSync(dirname(dbPath), { recursive: true });
  }
  const db = new Database(dbPath);
  db.exec('PRAGMA journal_mode = WAL;');
  db.exec('PRAGMA foreign_keys = ON;');
  db.exec(SCHEMA);
  migrate(db);
  return db;
}
