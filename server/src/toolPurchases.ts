import { randomUUID } from 'node:crypto';
import type { SproutDb } from './db';
import { allocationReport, comparisonReport, goalReport } from '../../shared/src/toolReports';

export type ToolKind = 'goal' | 'comparison' | 'portfolio';
export const TOOL_CATALOG = [
  { id: 'goal', title: 'Savings goal planner', description: 'A monthly path toward your chosen goal, with your assumptions shown.' },
  {
    id: 'comparison',
    title: 'Contribution comparison',
    description: 'Compare two contribution amounts using the same time horizon and assumed return.',
  },
  {
    id: 'portfolio',
    title: 'Portfolio allocation report',
    description: 'A downloadable allocation snapshot from the holding values you enter.',
  },
] as const;

export interface ToolPurchase {
  id: string;
  wallet: string;
  kind: ToolKind;
  amount: string;
  issued_at: number;
  expires_at: number;
  issued_block: string;
  result_json: string | null;
  tx_hash: string | null;
  paid_at: number | null;
}

export function ensureToolTables(db: SproutDb) {
  db.exec(`CREATE TABLE IF NOT EXISTS tool_purchases (
    id TEXT PRIMARY KEY, wallet TEXT NOT NULL, kind TEXT NOT NULL, amount TEXT NOT NULL,
    issued_at INTEGER NOT NULL, expires_at INTEGER NOT NULL, issued_block TEXT NOT NULL,
    result_json TEXT, tx_hash TEXT UNIQUE, paid_at INTEGER
  );
  CREATE INDEX IF NOT EXISTS tool_purchases_wallet ON tool_purchases(wallet, issued_at);
  CREATE TABLE IF NOT EXISTS tool_burn_redemptions (
    tx_hash TEXT PRIMARY KEY, purchase_id TEXT NOT NULL UNIQUE, amount TEXT NOT NULL, at INTEGER NOT NULL
  );`);
}

export function generateToolReport(kind: ToolKind, input: unknown): unknown {
  switch (kind) {
    case 'goal':
      return goalReport(input as Parameters<typeof goalReport>[0]);
    case 'comparison':
      return comparisonReport(input as Parameters<typeof comparisonReport>[0]);
    case 'portfolio':
      return allocationReport(input as Parameters<typeof allocationReport>[0]);
    default:
      throw new Error('Unknown tool.');
  }
}

export function createToolPurchase(
  db: SproutDb,
  input: {
    wallet: string;
    kind: ToolKind;
    result: unknown;
    amount: bigint;
    now: number;
    issuedBlock: bigint;
  },
): ToolPurchase {
  if (input.amount <= 0n) throw new Error('A positive SPROUT amount is required.');
  const result = JSON.stringify(input.result);
  if (result.length > 250_000) throw new Error('This report is too large.');
  const row: ToolPurchase = {
    id: randomUUID(),
    wallet: input.wallet.toLowerCase(),
    kind: input.kind,
    amount: String(input.amount),
    issued_at: input.now,
    expires_at: input.now + 900,
    issued_block: String(input.issuedBlock),
    result_json: result,
    tx_hash: null,
    paid_at: null,
  };
  db.transaction(() => {
    // Retain prepared results: a transfer may have mined without the browser
    // recording it yet. Expiry stops new payment, not recovery of an old receipt.
    const count = db
      .query<{ n: number }, [string, number]>('SELECT COUNT(*) AS n FROM tool_purchases WHERE wallet=? AND issued_at > ?')
      .get(row.wallet, input.now - 3600)!.n;
    if (count >= 20) throw new Error('You have prepared several reports. Try again later.');
    db.run('INSERT INTO tool_purchases VALUES (?,?,?,?,?,?,?,?,?,?)', [
      row.id,
      row.wallet,
      row.kind,
      row.amount,
      row.issued_at,
      row.expires_at,
      row.issued_block,
      row.result_json,
      null,
      null,
    ]);
  }).immediate();
  return row;
}

export function ownedToolPurchase(db: SproutDb, id: string, wallet: string): ToolPurchase {
  const row = db
    .query<ToolPurchase, [string, string]>('SELECT * FROM tool_purchases WHERE id=? AND wallet=?')
    .get(id, wallet.toLowerCase());
  if (!row) throw new Error('This purchase is unavailable for this wallet.');
  return row;
}

export function purchaseView(row: ToolPurchase) {
  return {
    id: row.id,
    kind: row.kind,
    amount: row.amount,
    issuedAt: row.issued_at,
    expiresAt: row.expires_at,
    txHash: row.tx_hash,
    paidAt: row.paid_at,
    // Computing before payment does not expose the protected output.
    result: row.paid_at !== null && row.result_json !== null ? JSON.parse(row.result_json) : null,
  };
}

/** Call only after receipt verification. The unique ledger survives deletion of private reports. */
export function redeemToolPurchase(db: SproutDb, id: string, wallet: string, txHash: string, at: number) {
  return db
    .transaction(() => {
      const row = ownedToolPurchase(db, id, wallet);
      const hash = txHash.toLowerCase();
      if (row.tx_hash === hash) return purchaseView(row);
      if (row.paid_at !== null) throw new Error('This report is already paid for.');
      if (!row.result_json) throw new Error('This report was deleted.');
      const used = db.query('SELECT tx_hash FROM tool_burn_redemptions WHERE tx_hash=?').get(hash);
      if (used) throw new Error('This burn has already paid for another purchase.');
      db.run('INSERT INTO tool_burn_redemptions VALUES (?,?,?,?)', [hash, id, row.amount, at]);
      db.run('UPDATE tool_purchases SET tx_hash=?, paid_at=? WHERE id=? AND paid_at IS NULL', [hash, at, id]);
      return purchaseView(ownedToolPurchase(db, id, wallet));
    })
    .immediate();
}

export function eraseToolReports(db: SproutDb, wallet: string) {
  // Public transaction hashes remain reserved, without the wallet or report data,
  // so deleting private data cannot make the same burn spendable a second time.
  if (db.query("SELECT name FROM sqlite_master WHERE type='table' AND name='tool_purchases'").get())
    db.run('DELETE FROM tool_purchases WHERE wallet=?', [wallet.toLowerCase()]);
}
