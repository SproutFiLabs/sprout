import { randomBytes } from 'node:crypto';
import { z } from 'zod';
import type { SproutDb } from './db';
import type { TierId } from './holders';

/**
 * Holder stock votes: SPROUT holders vote on which stock Sprout adds next.
 *
 * A vote counts by the tier the wallet earned by holding (see holders.ts), so
 * a balance bought an hour before voting counts for nothing. A wallet has one
 * vote per poll and can change it until the poll closes; each change re-reads
 * its tier, so the weight is always the one it held when it last voted.
 *
 * The public totals are per-option sums and voter counts only; which wallet
 * voted for what is never listed. Nothing here moves money or changes what
 * Sprout supports on its own: a result is advice to the people who run it.
 *
 * This module owns its tables (created on first use) so it does not touch the
 * shared schema in db.ts.
 */

export const VOTE_WEIGHTS: Readonly<Record<TierId, number>> = { seedling: 1, sapling: 2, bloom: 5, grove: 10 };

export const QUESTION_MAX = 140;
export const OPTION_LABEL_MAX = 60;
export const OPTIONS_MIN = 2;
export const OPTIONS_MAX = 12;
export const POLL_MAX_DAYS = 90;
/** Closed polls stay listed, with their result, for this long. */
export const CLOSED_LISTED_DAYS = 30;

const SCHEMA = `
CREATE TABLE IF NOT EXISTS polls (
  id TEXT PRIMARY KEY,
  question TEXT NOT NULL,
  options_json TEXT NOT NULL,
  opens_at INTEGER NOT NULL,
  closes_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_polls_closes ON polls(closes_at);

CREATE TABLE IF NOT EXISTS poll_votes (
  poll_id TEXT NOT NULL,
  address TEXT NOT NULL,
  option_id TEXT NOT NULL,
  tier TEXT NOT NULL,
  weight INTEGER NOT NULL,
  voted_at INTEGER NOT NULL,
  PRIMARY KEY (poll_id, address)
);
`;

const ready = new WeakSet<SproutDb>();

function ensureSchema(db: SproutDb): void {
  if (ready.has(db)) return;
  db.exec(SCHEMA);
  ready.add(db);
}

export const optionIdSchema = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._-]{0,31}$/, 'use 1-32 letters, digits, dots, dashes or underscores');

/** Admin input for a new poll; text is cleaned (and link-checked) by the route. */
export const pollInputSchema = z.object({
  question: z.string().min(1).max(QUESTION_MAX * 2),
  options: z
    .array(z.object({ id: optionIdSchema, label: z.string().min(1).max(OPTION_LABEL_MAX * 2) }))
    .min(OPTIONS_MIN)
    .max(OPTIONS_MAX),
  opensAt: z.number().int().min(0).optional(),
  closesAt: z.number().int().min(1),
});

export const voteInputSchema = z.object({ optionId: z.string().min(1).max(32) });

export interface PollOption {
  id: string;
  label: string;
}

export interface PollRecord {
  id: string;
  question: string;
  options: PollOption[];
  opensAt: number;
  closesAt: number;
  createdAt: number;
}

export type PollStatus = 'upcoming' | 'open' | 'closed';

/** What anyone can see about a poll: weighted totals and voter counts, no wallets. */
export interface PollView {
  id: string;
  question: string;
  opensAt: number;
  closesAt: number;
  status: PollStatus;
  options: Array<PollOption & { weight: number; voters: number }>;
  totalWeight: number;
  totalVoters: number;
}

export interface VoteView {
  pollId: string;
  optionId: string;
  tier: TierId;
  weight: number;
  votedAt: number;
}

function pollRow(row: Record<string, unknown>): PollRecord {
  return {
    id: String(row.id),
    question: String(row.question),
    options: JSON.parse(String(row.options_json)) as PollOption[],
    opensAt: Number(row.opens_at),
    closesAt: Number(row.closes_at),
    createdAt: Number(row.created_at),
  };
}

export function pollStatus(poll: Pick<PollRecord, 'opensAt' | 'closesAt'>, nowSeconds: number): PollStatus {
  if (nowSeconds < poll.opensAt) return 'upcoming';
  return nowSeconds < poll.closesAt ? 'open' : 'closed';
}

export function createPoll(
  db: SproutDb,
  input: { question: string; options: PollOption[]; opensAt: number; closesAt: number; createdAt: number },
): PollRecord {
  ensureSchema(db);
  const id = randomBytes(8).toString('hex');
  db.prepare('INSERT INTO polls (id, question, options_json, opens_at, closes_at, created_at) VALUES (?, ?, ?, ?, ?, ?)').run(
    id,
    input.question,
    JSON.stringify(input.options),
    input.opensAt,
    input.closesAt,
    input.createdAt,
  );
  return getPoll(db, id)!;
}

export function getPoll(db: SproutDb, id: string): PollRecord | null {
  ensureSchema(db);
  const row = db.prepare('SELECT * FROM polls WHERE id = ?').get(id) as Record<string, unknown> | null;
  return row ? pollRow(row) : null;
}

/** Open polls (closing soonest first), then polls closed in the last CLOSED_LISTED_DAYS (latest first). */
export function listCurrentPolls(db: SproutDb, nowSeconds: number): PollRecord[] {
  ensureSchema(db);
  const rows = db
    .prepare('SELECT * FROM polls WHERE opens_at <= ? AND closes_at > ? ORDER BY closes_at ASC, created_at ASC')
    .all(nowSeconds, nowSeconds - CLOSED_LISTED_DAYS * 86_400) as Array<Record<string, unknown>>;
  const polls = rows.map(pollRow);
  const open = polls.filter((p) => pollStatus(p, nowSeconds) === 'open');
  const closed = polls.filter((p) => pollStatus(p, nowSeconds) === 'closed').reverse();
  return [...open, ...closed];
}

export function pollView(db: SproutDb, poll: PollRecord, nowSeconds: number): PollView {
  ensureSchema(db);
  const rows = db
    .prepare('SELECT option_id, SUM(weight) AS weight, COUNT(*) AS voters FROM poll_votes WHERE poll_id = ? GROUP BY option_id')
    .all(poll.id) as Array<{ option_id: string; weight: number; voters: number }>;
  const byOption = new Map(rows.map((r) => [r.option_id, r]));
  const options = poll.options.map((o) => ({
    id: o.id,
    label: o.label,
    weight: Number(byOption.get(o.id)?.weight ?? 0),
    voters: Number(byOption.get(o.id)?.voters ?? 0),
  }));
  return {
    id: poll.id,
    question: poll.question,
    opensAt: poll.opensAt,
    closesAt: poll.closesAt,
    status: pollStatus(poll, nowSeconds),
    options,
    totalWeight: options.reduce((sum, o) => sum + o.weight, 0),
    totalVoters: options.reduce((sum, o) => sum + o.voters, 0),
  };
}

/** Record (or replace) a wallet's vote at its current tier. The caller checks the poll is open. */
export function recordVote(
  db: SproutDb,
  input: { pollId: string; address: string; optionId: string; tier: TierId; votedAt: number },
): VoteView {
  ensureSchema(db);
  db.prepare(
    `INSERT INTO poll_votes (poll_id, address, option_id, tier, weight, voted_at) VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(poll_id, address) DO UPDATE SET
       option_id = excluded.option_id, tier = excluded.tier, weight = excluded.weight, voted_at = excluded.voted_at`,
  ).run(input.pollId, input.address.toLowerCase(), input.optionId, input.tier, VOTE_WEIGHTS[input.tier], input.votedAt);
  return getVote(db, input.pollId, input.address)!;
}

export function getVote(db: SproutDb, pollId: string, address: string): VoteView | null {
  ensureSchema(db);
  const row = db.prepare('SELECT * FROM poll_votes WHERE poll_id = ? AND address = ?').get(pollId, address.toLowerCase()) as Record<
    string,
    unknown
  > | null;
  if (!row) return null;
  return {
    pollId: String(row.poll_id),
    optionId: String(row.option_id),
    tier: String(row.tier) as TierId,
    weight: Number(row.weight),
    votedAt: Number(row.voted_at),
  };
}
