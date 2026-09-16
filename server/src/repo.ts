import type { SproutDb } from './db';

export interface SproutRecord {
  id: string;
  chainId: number;
  parent: string;
  beneficiary: string;
  settlementToken: string;
  graduationTimestamp: number;
  assets: string[];
  weights: number[];
  createdTxHash: string | null;
  createdBlock: number | null;
  createdAt: number;
}

export interface GiftRecord {
  id: string;
  vaultId: string;
  label: string | null;
  acceptedAssets: string[];
  status: string;
  createdAt: number;
}

export interface GiftPaymentRecord {
  id: number;
  giftId: string;
  vaultId: string;
  chainId: number;
  txHash: string;
  logIndex: number;
  gifter: string;
  token: string;
  amount: string;
  blockNumber: number | null;
  createdAt: number;
}

export type MilestoneStatus = 'created' | 'released' | 'cancelled';

export interface MilestoneRecord {
  id: string;
  vaultId: string;
  chainId: number;
  token: string;
  amount: string;
  unlockTime: number;
  status: MilestoneStatus;
  descriptionHash: string | null;
  createdTxHash: string | null;
  releasedTxHash: string | null;
  createdAt: number;
  updatedAt: number;
}

export interface GrowthSnapshotRecord {
  id: number;
  vaultId: string;
  chainId: number;
  takenAt: number;
  blockNumber: number | null;
  valueUsd: string;
  feedDecimals: number;
  holdings: unknown;
  source: string;
  note: string | null;
}

export type JobStatus = 'active' | 'cancelled' | 'paused' | 'unavailable';

export interface JobRecord {
  id: string;
  vaultId: string;
  chainId: number;
  kind: string;
  amount: string;
  periodSeconds: number;
  nextRunAt: number;
  lastRunAt: number | null;
  lastTxHash: string | null;
  status: JobStatus;
  attempts: number;
  consecutiveFailures: number;
  lastError: string | null;
  createdAt: number;
  updatedAt: number;
}

export interface ChainEventInput {
  chainId: number;
  txHash: string;
  logIndex: number;
  blockNumber: number;
  address: string;
  eventName: string;
  vaultId?: string | null;
  payload: unknown;
}

export interface NonceRecord {
  nonce: string;
  address: string;
  purpose: string;
  message: string;
  expiresAt: number;
  usedAt: number | null;
  createdAt: number;
}

const now = () => Date.now();

export function milestoneUid(chainId: number, vaultId: string, milestoneId: string): string {
  return `${chainId}:${vaultId.toLowerCase()}:${milestoneId.toLowerCase()}`;
}

// ---- sprouts --------------------------------------------------------------

export function upsertSprout(db: SproutDb, s: Omit<SproutRecord, 'createdAt'> & { createdAt?: number }): void {
  db.prepare(
    `INSERT INTO sprouts
      (id, chain_id, parent, beneficiary, settlement_token, graduation_timestamp, assets_json, weights_json, created_tx_hash, created_block, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       parent=excluded.parent,
       beneficiary=excluded.beneficiary,
       settlement_token=excluded.settlement_token,
       graduation_timestamp=excluded.graduation_timestamp,
       assets_json=excluded.assets_json,
       weights_json=excluded.weights_json,
       created_tx_hash=excluded.created_tx_hash,
       created_block=excluded.created_block`,
  ).run(
    s.id,
    s.chainId,
    s.parent,
    s.beneficiary,
    s.settlementToken,
    s.graduationTimestamp,
    JSON.stringify(s.assets),
    JSON.stringify(s.weights),
    s.createdTxHash,
    s.createdBlock,
    s.createdAt ?? now(),
  );
}

function mapSprout(row: Record<string, unknown>): SproutRecord {
  return {
    id: row.id as string,
    chainId: row.chain_id as number,
    parent: row.parent as string,
    beneficiary: row.beneficiary as string,
    settlementToken: row.settlement_token as string,
    graduationTimestamp: row.graduation_timestamp as number,
    assets: JSON.parse(row.assets_json as string) as string[],
    weights: JSON.parse(row.weights_json as string) as number[],
    createdTxHash: row.created_tx_hash as string | null,
    createdBlock: row.created_block as number | null,
    createdAt: row.created_at as number,
  };
}

export function getSprout(db: SproutDb, id: string): SproutRecord | null {
  const row = db.prepare('SELECT * FROM sprouts WHERE lower(id) = lower(?)').get(id) as Record<string, unknown> | null;
  return row ? mapSprout(row) : null;
}

export function listSproutsByParent(db: SproutDb, parent: string): SproutRecord[] {
  const rows = db.prepare('SELECT * FROM sprouts WHERE lower(parent) = lower(?) ORDER BY created_at ASC').all(parent) as Record<
    string,
    unknown
  >[];
  return rows.map(mapSprout);
}

export function listSproutsByBeneficiary(db: SproutDb, beneficiary: string): SproutRecord[] {
  const rows = db
    .prepare('SELECT * FROM sprouts WHERE lower(beneficiary) = lower(?) ORDER BY created_at ASC')
    .all(beneficiary) as Record<string, unknown>[];
  return rows.map(mapSprout);
}

// ---- gifts ----------------------------------------------------------------

export function insertGift(db: SproutDb, g: Omit<GiftRecord, 'createdAt'> & { createdAt?: number }): void {
  db.prepare(
    `INSERT INTO gifts (id, vault_id, label, accepted_assets_json, status, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
  ).run(g.id, g.vaultId, g.label, JSON.stringify(g.acceptedAssets), g.status, g.createdAt ?? now());
}

function mapGift(row: Record<string, unknown>): GiftRecord {
  return {
    id: row.id as string,
    vaultId: row.vault_id as string,
    label: row.label as string | null,
    acceptedAssets: JSON.parse(row.accepted_assets_json as string) as string[],
    status: row.status as string,
    createdAt: row.created_at as number,
  };
}

export function getGift(db: SproutDb, id: string): GiftRecord | null {
  const row = db.prepare('SELECT * FROM gifts WHERE lower(id) = lower(?)').get(id) as Record<string, unknown> | null;
  return row ? mapGift(row) : null;
}

export function listGiftsByVault(db: SproutDb, vaultId: string): GiftRecord[] {
  const rows = db.prepare('SELECT * FROM gifts WHERE lower(vault_id) = lower(?) ORDER BY created_at DESC').all(vaultId) as Record<
    string,
    unknown
  >[];
  return rows.map(mapGift);
}

/** Insert a gift payment keyed by the chain log identity. Returns false on replay. */
export function insertGiftPayment(db: SproutDb, p: Omit<GiftPaymentRecord, 'id' | 'createdAt'>): boolean {
  const info = db
    .prepare(
      `INSERT OR IGNORE INTO gift_payments
        (gift_id, vault_id, chain_id, tx_hash, log_index, gifter, token, amount, block_number, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(p.giftId, p.vaultId, p.chainId, p.txHash, p.logIndex, p.gifter, p.token, p.amount, p.blockNumber, now());
  return info.changes > 0;
}

export function listGiftPayments(db: SproutDb, giftId: string): GiftPaymentRecord[] {
  return db.prepare('SELECT * FROM gift_payments WHERE lower(gift_id) = lower(?) ORDER BY id ASC').all(giftId).map((row) => {
    const r = row as Record<string, unknown>;
    return {
      id: r.id as number,
      giftId: r.gift_id as string,
      vaultId: r.vault_id as string,
      chainId: r.chain_id as number,
      txHash: r.tx_hash as string,
      logIndex: r.log_index as number,
      gifter: r.gifter as string,
      token: r.token as string,
      amount: r.amount as string,
      blockNumber: r.block_number as number | null,
      createdAt: r.created_at as number,
    };
  });
}

// ---- gift campaigns and notes ---------------------------------------------

export interface GiftCampaignRecord {
  giftId: string;
  title: string;
  goalCents: number;
  endsAt: number;
  createdAt: number;
}

export function insertGiftCampaign(db: SproutDb, c: Omit<GiftCampaignRecord, 'createdAt'>): void {
  db.prepare('INSERT INTO gift_campaigns (gift_id, title, goal_cents, ends_at, created_at) VALUES (?, ?, ?, ?, ?)').run(
    c.giftId,
    c.title,
    c.goalCents,
    c.endsAt,
    now(),
  );
}

export function getGiftCampaign(db: SproutDb, giftId: string): GiftCampaignRecord | null {
  const r = db.prepare('SELECT * FROM gift_campaigns WHERE lower(gift_id) = lower(?)').get(giftId) as Record<string, unknown> | null;
  if (!r) return null;
  return {
    giftId: r.gift_id as string,
    title: r.title as string,
    goalCents: r.goal_cents as number,
    endsAt: r.ends_at as number,
    createdAt: r.created_at as number,
  };
}

export interface GiftNoteRecord {
  chainId: number;
  txHash: string;
  logIndex: number;
  giftId: string;
  gifter: string;
  name: string | null;
  note: string | null;
  hidden: boolean;
  token: string | null;
  amount: string | null;
  blockNumber: number | null;
  createdAt: number;
}

/** Store or replace a gifter's name and note for one of their verified gifts. Hidden stays hidden. */
export function upsertGiftNote(
  db: SproutDb,
  n: { chainId: number; txHash: string; logIndex: number; giftId: string; gifter: string; name: string | null; note: string | null },
): void {
  db.prepare(
    `INSERT INTO gift_notes (chain_id, tx_hash, log_index, gift_id, gifter, name, note, hidden, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?)
     ON CONFLICT(chain_id, tx_hash, log_index) DO UPDATE SET name = excluded.name, note = excluded.note`,
  ).run(n.chainId, n.txHash.toLowerCase(), n.logIndex, n.giftId, n.gifter, n.name, n.note, now());
}

/** Notes for a gift link, newest first, with the gift they came with. */
export function listGiftNotes(db: SproutDb, giftId: string, opts: { includeHidden?: boolean } = {}): GiftNoteRecord[] {
  return db
    .prepare(
      `SELECT n.*, p.token AS p_token, p.amount AS p_amount, p.block_number AS p_block
         FROM gift_notes n
         LEFT JOIN gift_payments p
           ON p.chain_id = n.chain_id AND lower(p.tx_hash) = n.tx_hash AND p.log_index = n.log_index
        WHERE lower(n.gift_id) = lower(?) ${opts.includeHidden ? '' : 'AND n.hidden = 0'}
        ORDER BY n.created_at DESC, n.log_index DESC`,
    )
    .all(giftId)
    .map((row) => {
      const r = row as Record<string, unknown>;
      return {
        chainId: r.chain_id as number,
        txHash: r.tx_hash as string,
        logIndex: r.log_index as number,
        giftId: r.gift_id as string,
        gifter: r.gifter as string,
        name: (r.name as string | null) ?? null,
        note: (r.note as string | null) ?? null,
        hidden: (r.hidden as number) === 1,
        token: (r.p_token as string | null) ?? null,
        amount: (r.p_amount as string | null) ?? null,
        blockNumber: (r.p_block as number | null) ?? null,
        createdAt: r.created_at as number,
      };
    });
}

export function countHiddenGiftNotes(db: SproutDb, giftId: string): number {
  const r = db.prepare('SELECT COUNT(*) AS n FROM gift_notes WHERE lower(gift_id) = lower(?) AND hidden = 1').get(giftId) as { n: number } | null;
  return r?.n ?? 0;
}

export function setGiftNoteHidden(db: SproutDb, key: { giftId: string; txHash: string; logIndex: number }, hidden: boolean): boolean {
  const info = db
    .prepare('UPDATE gift_notes SET hidden = ? WHERE lower(gift_id) = lower(?) AND tx_hash = ? AND log_index = ?')
    .run(hidden ? 1 : 0, key.giftId, key.txHash.toLowerCase(), key.logIndex);
  return info.changes > 0;
}

// ---- milestones -----------------------------------------------------------

export function upsertMilestone(
  db: SproutDb,
  m: Omit<MilestoneRecord, 'createdAt' | 'updatedAt'> & { createdAt?: number; updatedAt?: number },
): void {
  const uid = milestoneUid(m.chainId, m.vaultId, m.id);
  db.prepare(
    `INSERT INTO milestones
      (uid, milestone_id, vault_id, chain_id, token, amount, unlock_time, status, description_hash, created_tx_hash, released_tx_hash, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(uid) DO UPDATE SET
       token=excluded.token,
       amount=excluded.amount,
       unlock_time=excluded.unlock_time,
       status=CASE WHEN milestones.status IN ('released', 'cancelled') THEN milestones.status ELSE excluded.status END,
       description_hash=COALESCE(excluded.description_hash, milestones.description_hash),
       created_tx_hash=COALESCE(excluded.created_tx_hash, milestones.created_tx_hash),
       released_tx_hash=COALESCE(excluded.released_tx_hash, milestones.released_tx_hash),
       updated_at=excluded.updated_at`,
  ).run(
    uid,
    m.id,
    m.vaultId,
    m.chainId,
    m.token,
    m.amount,
    m.unlockTime,
    m.status,
    m.descriptionHash,
    m.createdTxHash,
    m.releasedTxHash,
    m.createdAt ?? now(),
    m.updatedAt ?? now(),
  );
}

function mapMilestone(row: Record<string, unknown>): MilestoneRecord {
  return {
    id: row.milestone_id as string,
    vaultId: row.vault_id as string,
    chainId: row.chain_id as number,
    token: row.token as string,
    amount: row.amount as string,
    unlockTime: row.unlock_time as number,
    status: row.status as MilestoneStatus,
    descriptionHash: row.description_hash as string | null,
    createdTxHash: row.created_tx_hash as string | null,
    releasedTxHash: row.released_tx_hash as string | null,
    createdAt: row.created_at as number,
    updatedAt: row.updated_at as number,
  };
}

export function getMilestone(db: SproutDb, chainId: number, vaultId: string, id: string): MilestoneRecord | null {
  const row = db
    .prepare('SELECT * FROM milestones WHERE uid = ?')
    .get(milestoneUid(chainId, vaultId, id)) as Record<string, unknown> | null;
  return row ? mapMilestone(row) : null;
}

export function listMilestonesByVault(db: SproutDb, chainId: number, vaultId: string): MilestoneRecord[] {
  const rows = db
    .prepare('SELECT * FROM milestones WHERE chain_id = ? AND lower(vault_id) = lower(?) ORDER BY created_at ASC')
    .all(chainId, vaultId) as Record<string, unknown>[];
  return rows.map(mapMilestone);
}

/**
 * Status changes are scoped to chain + vault + milestone id and are monotonic:
 * a milestone can only leave `created` once, so an old receipt or a late
 * indexer pass can never regress a released/cancelled milestone.
 */
export function setMilestoneStatus(
  db: SproutDb,
  key: { chainId: number; vaultId: string; id: string },
  status: Exclude<MilestoneStatus, 'created'>,
  releasedTxHash?: string,
): boolean {
  const info = db
    .prepare(
      `UPDATE milestones
         SET status = ?, released_tx_hash = COALESCE(?, released_tx_hash), updated_at = ?
       WHERE uid = ? AND status = 'created'`,
    )
    .run(status, releasedTxHash ?? null, now(), milestoneUid(key.chainId, key.vaultId, key.id));
  return info.changes > 0;
}

// ---- chain events / cursor ------------------------------------------------

export function insertChainEvent(db: SproutDb, e: ChainEventInput): boolean {
  const info = db
    .prepare(
      `INSERT OR IGNORE INTO chain_events
        (chain_id, tx_hash, log_index, block_number, address, event_name, vault_id, payload_json, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      e.chainId,
      e.txHash,
      e.logIndex,
      e.blockNumber,
      e.address,
      e.eventName,
      (e.vaultId ?? null)?.toLowerCase() ?? null,
      JSON.stringify(e.payload),
      now(),
    );
  return info.changes > 0;
}

export function listChainEvents(
  db: SproutDb,
  vaultId: string,
): Array<{ eventName: string; blockNumber: number; logIndex: number; payload: unknown }> {
  return db
    .prepare(
      'SELECT event_name, block_number, log_index, payload_json FROM chain_events WHERE lower(vault_id) = lower(?) ORDER BY block_number ASC, log_index ASC',
    )
    .all(vaultId)
    .map((row) => {
      const r = row as Record<string, unknown>;
      return {
        eventName: r.event_name as string,
        blockNumber: r.block_number as number,
        logIndex: r.log_index as number,
        payload: JSON.parse(r.payload_json as string),
      };
    });
}

/** Indexed activity totals for the public stats endpoint. */
export function activityTotals(db: SproutDb, chainId: number): {
  sprouts: number;
  fundedSprouts: number;
  gifts: number;
  purchases: number;
} {
  const one = (sql: string, ...args: unknown[]) =>
    ((db.prepare(sql).get(...(args as never[])) as { n: number } | null)?.n ?? 0);
  return {
    sprouts: one('SELECT COUNT(*) AS n FROM sprouts WHERE chain_id = ?', chainId),
    fundedSprouts: one(
      "SELECT COUNT(DISTINCT lower(vault_id)) AS n FROM chain_events WHERE chain_id = ? AND event_name IN ('Funded', 'GiftReceived')",
      chainId,
    ),
    gifts: one("SELECT COUNT(*) AS n FROM chain_events WHERE chain_id = ? AND event_name = 'GiftReceived'", chainId),
    // One purchase buys several assets (one event each); count transactions.
    purchases: one(
      "SELECT COUNT(DISTINCT tx_hash) AS n FROM chain_events WHERE chain_id = ? AND event_name = 'InvestmentExecuted'",
      chainId,
    ),
  };
}

/** Every indexed event for a vault, in chain order, with its transaction. */
export function listChainEventRows(
  db: SproutDb,
  vaultId: string,
): Array<{ eventName: string; blockNumber: number; logIndex: number; txHash: string; payload: unknown }> {
  return db
    .prepare(
      'SELECT event_name, block_number, log_index, tx_hash, payload_json FROM chain_events WHERE lower(vault_id) = lower(?) ORDER BY block_number ASC, log_index ASC',
    )
    .all(vaultId)
    .map((row) => {
      const r = row as Record<string, unknown>;
      return {
        eventName: r.event_name as string,
        blockNumber: r.block_number as number,
        logIndex: r.log_index as number,
        txHash: r.tx_hash as string,
        payload: JSON.parse(r.payload_json as string),
      };
    });
}

export function getCursor(db: SproutDb, chainId: number): number {
  const row = db.prepare('SELECT last_block FROM indexer_cursor WHERE chain_id = ?').get(chainId) as { last_block: number } | null;
  return row?.last_block ?? 0;
}

export function setCursor(db: SproutDb, chainId: number, lastBlock: number): void {
  db.prepare(
    `INSERT INTO indexer_cursor (chain_id, last_block, updated_at) VALUES (?, ?, ?)
     ON CONFLICT(chain_id) DO UPDATE SET last_block = excluded.last_block, updated_at = excluded.updated_at`,
  ).run(chainId, lastBlock, now());
}

// ---- growth ---------------------------------------------------------------

export function insertSnapshot(
  db: SproutDb,
  s: {
    vaultId: string;
    chainId: number;
    takenAt: number;
    blockNumber: number | null;
    valueUsd: string;
    feedDecimals: number;
    holdings: unknown;
    source: string;
    note?: string | null;
  },
): void {
  db.prepare(
    `INSERT OR IGNORE INTO growth_snapshots
      (vault_id, chain_id, taken_at, block_number, value_usd, feed_decimals, holdings_json, source, note)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(s.vaultId, s.chainId, s.takenAt, s.blockNumber, s.valueUsd, s.feedDecimals, JSON.stringify(s.holdings), s.source, s.note ?? null);
}

export function listSnapshots(db: SproutDb, vaultId: string): GrowthSnapshotRecord[] {
  return db
    .prepare('SELECT * FROM growth_snapshots WHERE lower(vault_id) = lower(?) ORDER BY taken_at ASC')
    .all(vaultId)
    .map((row) => {
      const r = row as Record<string, unknown>;
      return {
        id: r.id as number,
        vaultId: r.vault_id as string,
        chainId: r.chain_id as number,
        takenAt: r.taken_at as number,
        blockNumber: r.block_number as number | null,
        valueUsd: r.value_usd as string,
        feedDecimals: r.feed_decimals as number,
        holdings: JSON.parse(r.holdings_json as string),
        source: r.source as string,
        note: (r.note as string | null) ?? null,
      };
    });
}

// ---- jobs -----------------------------------------------------------------

export function upsertJob(
  db: SproutDb,
  j: Omit<JobRecord, 'createdAt' | 'updatedAt'> & { createdAt?: number; updatedAt?: number },
): void {
  db.prepare(
    `INSERT INTO investment_jobs
      (id, vault_id, chain_id, kind, amount, period_seconds, next_run_at, last_run_at, last_tx_hash, status, attempts, consecutive_failures, last_error, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       amount=excluded.amount,
       period_seconds=excluded.period_seconds,
       next_run_at=excluded.next_run_at,
       last_run_at=COALESCE(excluded.last_run_at, investment_jobs.last_run_at),
       last_tx_hash=COALESCE(excluded.last_tx_hash, investment_jobs.last_tx_hash),
       status=excluded.status,
       attempts=excluded.attempts,
       consecutive_failures=excluded.consecutive_failures,
       last_error=excluded.last_error,
       updated_at=excluded.updated_at`,
  ).run(
    j.id,
    j.vaultId,
    j.chainId,
    j.kind,
    j.amount,
    j.periodSeconds,
    j.nextRunAt,
    j.lastRunAt,
    j.lastTxHash,
    j.status,
    j.attempts,
    j.consecutiveFailures,
    j.lastError,
    j.createdAt ?? now(),
    j.updatedAt ?? now(),
  );
}

function mapJob(row: Record<string, unknown>): JobRecord {
  return {
    id: row.id as string,
    vaultId: row.vault_id as string,
    chainId: row.chain_id as number,
    kind: row.kind as string,
    amount: row.amount as string,
    periodSeconds: row.period_seconds as number,
    nextRunAt: row.next_run_at as number,
    lastRunAt: row.last_run_at as number | null,
    lastTxHash: row.last_tx_hash as string | null,
    status: row.status as JobStatus,
    attempts: row.attempts as number,
    consecutiveFailures: row.consecutive_failures as number,
    lastError: row.last_error as string | null,
    createdAt: row.created_at as number,
    updatedAt: row.updated_at as number,
  };
}

export function getJob(db: SproutDb, id: string): JobRecord | null {
  const row = db.prepare('SELECT * FROM investment_jobs WHERE lower(id) = lower(?)').get(id) as Record<string, unknown> | null;
  return row ? mapJob(row) : null;
}

export function listJobsByVault(db: SproutDb, vaultId: string): JobRecord[] {
  return db
    .prepare('SELECT * FROM investment_jobs WHERE lower(vault_id) = lower(?) ORDER BY created_at ASC')
    .all(vaultId)
    .map((row) => mapJob(row as Record<string, unknown>));
}

export function dueJobs(db: SproutDb, at: number): JobRecord[] {
  return db
    .prepare("SELECT * FROM investment_jobs WHERE status = 'active' AND next_run_at <= ? ORDER BY next_run_at ASC")
    .all(at)
    .map((row) => mapJob(row as Record<string, unknown>));
}

/** Record a run. A null error counts as success and resets the failure streak. */
export function recordJobRun(db: SproutDb, id: string, input: { nextRunAt: number; txHash?: string; error?: string }): void {
  db.prepare(
    `UPDATE investment_jobs
       SET last_run_at = ?, next_run_at = ?, last_tx_hash = COALESCE(?, last_tx_hash),
           attempts = attempts + 1,
           consecutive_failures = CASE WHEN ? IS NULL THEN 0 ELSE consecutive_failures + 1 END,
           last_error = ?, updated_at = ?
     WHERE id = ?`,
  ).run(now(), input.nextRunAt, input.txHash ?? null, input.error ?? null, input.error ?? null, now(), id);
}

export function setJobStatus(db: SproutDb, id: string, status: JobStatus): void {
  db.prepare('UPDATE investment_jobs SET status = ?, updated_at = ? WHERE id = ?').run(status, now(), id);
}

export function listActiveJobs(db: SproutDb): JobRecord[] {
  return db
    .prepare("SELECT * FROM investment_jobs WHERE status = 'active' ORDER BY created_at ASC")
    .all()
    .map((row) => mapJob(row as Record<string, unknown>));
}

/** Jobs whose chain schedule should be reconciled (active or awaiting a keeper). */
export function listResyncableJobs(db: SproutDb): JobRecord[] {
  return db
    .prepare("SELECT * FROM investment_jobs WHERE status IN ('active','unavailable') ORDER BY created_at ASC")
    .all()
    .map((row) => mapJob(row as Record<string, unknown>));
}

export function setJobNextRun(db: SproutDb, id: string, nextRunAt: number): void {
  db.prepare('UPDATE investment_jobs SET next_run_at = ?, updated_at = ? WHERE id = ?').run(nextRunAt, now(), id);
}

// ---- nonces ---------------------------------------------------------------

export function createNonce(db: SproutDb, n: NonceRecord): void {
  db.prepare(
    'INSERT INTO nonces (nonce, address, purpose, message, expires_at, used_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
  ).run(n.nonce, n.address, n.purpose, n.message, n.expiresAt, n.usedAt, n.createdAt);
}

export function getNonce(db: SproutDb, nonce: string): NonceRecord | null {
  const row = db.prepare('SELECT * FROM nonces WHERE nonce = ?').get(nonce) as Record<string, unknown> | null;
  if (!row) return null;
  return {
    nonce: row.nonce as string,
    address: row.address as string,
    purpose: row.purpose as string,
    message: row.message as string,
    expiresAt: row.expires_at as number,
    usedAt: row.used_at as number | null,
    createdAt: row.created_at as number,
  };
}

/**
 * Atomically consume a nonce. Returns false if it was already used, which makes
 * concurrent reuse of one signed challenge impossible: only one UPDATE can win.
 */
export function consumeNonce(db: SproutDb, nonce: string, at: number = now()): boolean {
  const info = db.prepare('UPDATE nonces SET used_at = ? WHERE nonce = ? AND used_at IS NULL').run(at, nonce);
  return info.changes === 1;
}

export function purgeExpiredNonces(db: SproutDb, at: number): void {
  db.prepare('DELETE FROM nonces WHERE expires_at < ?').run(at);
}

// ---- keeper transactions --------------------------------------------------

export type KeeperTxStatus = 'signed' | 'sent' | 'mined' | 'reverted' | 'unknown_fee';

export interface KeeperTxRecord {
  id: string;
  jobId: string;
  vaultId: string;
  chainId: number;
  signer: string | null;
  nonce: number;
  gas: string;
  maxFeePerGas: string;
  maxPriorityFeePerGas: string;
  rawTx: string | null;
  txHash: string | null;
  status: KeeperTxStatus;
  blockNumber: string | null;
  gasUsed: string | null;
  effectiveGasPrice: string | null;
  error: string | null;
  createdAt: number;
  updatedAt: number;
}

function mapKeeperTx(row: Record<string, unknown>): KeeperTxRecord {
  return {
    id: row.id as string,
    jobId: row.job_id as string,
    vaultId: row.vault_id as string,
    chainId: row.chain_id as number,
    signer: row.signer as string | null,
    nonce: row.nonce as number,
    gas: row.gas as string,
    maxFeePerGas: row.max_fee_per_gas as string,
    maxPriorityFeePerGas: row.max_priority_fee_per_gas as string,
    rawTx: row.raw_tx as string | null,
    txHash: row.tx_hash as string | null,
    status: row.status as KeeperTxStatus,
    blockNumber: row.block_number as string | null,
    gasUsed: row.gas_used as string | null,
    effectiveGasPrice: row.effective_gas_price as string | null,
    error: row.error as string | null,
    createdAt: row.created_at as number,
    updatedAt: row.updated_at as number,
  };
}

export function insertKeeperTx(db: SproutDb, k: Omit<KeeperTxRecord, 'createdAt' | 'updatedAt'>): void {
  const at = now();
  db.prepare(
    `INSERT INTO keeper_txs
      (id, job_id, vault_id, chain_id, signer, nonce, gas, max_fee_per_gas, max_priority_fee_per_gas, raw_tx, tx_hash, status, block_number, gas_used, effective_gas_price, error, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    k.id,
    k.jobId,
    k.vaultId,
    k.chainId,
    k.signer,
    k.nonce,
    k.gas,
    k.maxFeePerGas,
    k.maxPriorityFeePerGas,
    k.rawTx,
    k.txHash,
    k.status,
    k.blockNumber,
    k.gasUsed,
    k.effectiveGasPrice,
    k.error,
    at,
    at,
  );
}

export function getKeeperTx(db: SproutDb, id: string): KeeperTxRecord | null {
  const row = db.prepare('SELECT * FROM keeper_txs WHERE id = ?').get(id) as Record<string, unknown> | null;
  return row ? mapKeeperTx(row) : null;
}

/** The single in-flight (signed/sent) tx for a job, if any. */
export function getInFlightKeeperTx(db: SproutDb, jobId: string): KeeperTxRecord | null {
  const row = db
    .prepare("SELECT * FROM keeper_txs WHERE job_id = ? AND status IN ('signed','sent','unknown_fee') ORDER BY created_at DESC LIMIT 1")
    .get(jobId) as Record<string, unknown> | null;
  return row ? mapKeeperTx(row) : null;
}

/** Any in-flight tx for a given chain + signer, across all jobs (nonce safety). */
export function getInFlightKeeperTxForAccount(db: SproutDb, chainId: number, signer: string): KeeperTxRecord | null {
  const row = db
    .prepare(
      "SELECT * FROM keeper_txs WHERE chain_id = ? AND lower(signer) = lower(?) AND status IN ('signed','sent','unknown_fee') ORDER BY created_at DESC LIMIT 1",
    )
    .get(chainId, signer) as Record<string, unknown> | null;
  return row ? mapKeeperTx(row) : null;
}

export function markKeeperTx(
  db: SproutDb,
  id: string,
  status: KeeperTxStatus,
  patch: { blockNumber?: string; gasUsed?: string; effectiveGasPrice?: string; error?: string | null } = {},
): void {
  db.prepare(
    `UPDATE keeper_txs
       SET status = ?, block_number = COALESCE(?, block_number), gas_used = COALESCE(?, gas_used),
           effective_gas_price = COALESCE(?, effective_gas_price), error = ?, updated_at = ?
     WHERE id = ?`,
  ).run(status, patch.blockNumber ?? null, patch.gasUsed ?? null, patch.effectiveGasPrice ?? null, patch.error ?? null, now(), id);
}

export function listInFlightKeeperTxs(db: SproutDb): KeeperTxRecord[] {
  return db
    .prepare("SELECT * FROM keeper_txs WHERE status IN ('signed','sent','unknown_fee') ORDER BY created_at ASC")
    .all()
    .map((row) => mapKeeperTx(row as Record<string, unknown>));
}

export interface KeeperAccounting {
  spentWei: bigint;
  pendingWei: bigint;
  count: number;
}

/**
 * Native spend accounting: `pendingWei` reserves worst-case gas*maxFee for every
 * in-flight tx; `spentWei` sums actual gasUsed*effectiveGasPrice for finalized
 * txs since `sinceMs`.
 */
export function keeperAccounting(db: SproutDb, chainId: number, sinceMs: number): KeeperAccounting {
  const rows = db.prepare('SELECT status, gas, max_fee_per_gas, gas_used, effective_gas_price, updated_at FROM keeper_txs WHERE chain_id = ?').all(chainId) as Array<Record<string, unknown>>;
  let spentWei = 0n;
  let pendingWei = 0n;
  for (const r of rows) {
    const status = r.status as KeeperTxStatus;
    if (status === 'signed' || status === 'sent' || status === 'unknown_fee') {
      pendingWei += BigInt(r.gas as string) * BigInt(r.max_fee_per_gas as string);
    } else if ((status === 'mined' || status === 'reverted') && r.gas_used && r.effective_gas_price && (r.updated_at as number) >= sinceMs) {
      spentWei += BigInt(r.gas_used as string) * BigInt(r.effective_gas_price as string);
    }
  }
  return { spentWei, pendingWei, count: rows.length };
}
