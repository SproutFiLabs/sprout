/**
 * The privacy pack: a family's privacy report, one-signature fixes, and
 * "Delete my family's data".
 *
 * Erased: what Sprout made that is not on the blockchain (gift links and their
 * labels, campaigns, gift messages, Sprout's attribution of gifts to links, kid
 * invitations and sessions, milestone proof certificates, chore description
 * hashes, the registered gift key, sessions and sign-in challenges). Kept: the
 * copies of public chain data Sprout needs to keep the sprout working (the
 * sprout's index row, chain events, chore records, value history, keeper jobs)
 * and data that is not the family's (holder votes, Intelligence counters).
 *
 * Scope is always derived from the authenticated wallet: the sprouts it planted
 * (`sprouts.parent`). A request body can narrow what the client expects to
 * change, never widen it. Nothing here touches the chain or the public index
 * copies of it (sprouts, chain events, milestones, value history, keeper jobs).
 */
import type { Context, Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { z } from 'zod';
import { addressSchema, hashSchema } from '@sprout/shared';
import type { AppDeps } from './app';
import { AuthError } from './auth';
import { digest, familySession } from './privacy';

/** What the family types to confirm an erase. The server checks it too. */
export const ERASE_CONFIRM = 'DELETE';
/** The generic text new gift links and campaigns already store (see POST /api/gifts). */
export const GENERIC_GIFT_LABEL = 'A gift for the future';
export const GENERIC_CAMPAIGN_TITLE = 'Family gift';
const ENVELOPE = 'encrypted:v1:';
const DAY = 86_400_000;

/** Fixed-window limits per wallet, like intelligence_usage. */
export const PRIVACY_LIMITS = {
  read: { max: 60, windowMs: 10 * 60_000 },
  write: { max: 20, windowMs: 60 * 60_000 },
  erase: { max: 5, windowMs: 60 * 60_000 },
} as const;

const USAGE_TABLE = `CREATE TABLE IF NOT EXISTS privacy_request_usage (
  key TEXT NOT NULL, bucket TEXT NOT NULL, used INTEGER NOT NULL, updated_at INTEGER NOT NULL,
  PRIMARY KEY (key, bucket)
);`;

type Db = AppDeps['db'];

interface SproutRow {
  id: string;
  beneficiary: string;
  factory: string | null;
  graduation_timestamp: number;
}

export interface SproutFootprint {
  id: string;
  beneficiary: string;
  factory: string | null;
  graduationTimestamp: number;
  gifts: { links: number; plainLabels: number; campaigns: number; plainCampaignTitles: number; payments: number };
  notes: { total: number; encrypted: number; plain: number; hidden: number };
  invites: { total: number; waiting: number; openNow: number; balanceVisible: number; ended: number };
  proofs: { total: number; active: number };
  chores: { total: number; open: number; described: number };
  kept: { events: number; snapshots: number; jobs: number; keeperTxs: number };
}

export interface EraseCounts {
  familyLedger?: number;
  familyPlans?: number;
  giftLinks: number;
  campaigns: number;
  giftNotes: number;
  giftPayments: number;
  kidInvites: number;
  kidSessions: number;
  proofs: number;
  choreDescriptions: number;
  giftKey: number;
  sessions: number;
  signIns: number;
}

export interface FamilyFootprint {
  address: string;
  sprouts: SproutFootprint[];
  beneficiaryOf: number;
  giftKeyRegistered: boolean;
  activeSessions: number;
  /** Older gift links whose label or campaign title is stored as the family wrote it. */
  legacyText: Array<{ giftId: string; label: string | null; title: string | null }>;
  /** Exactly what POST /api/family/erase would remove right now. */
  erase: EraseCounts;
  kept: { sprouts: number; events: number; snapshots: number; chores: number; jobs: number; keeperTxs: number };
}

const lower = (s: string) => s.toLowerCase();
const count = (db: Db, sql: string, ...params: Array<string | number>) =>
  (db.query<{ n: number }, Array<string | number>>(sql).get(...params)?.n ?? 0);
const isEncrypted = (row: { name: string | null; note: string | null }) =>
  row.name === null && typeof row.note === 'string' && row.note.startsWith(ENVELOPE);

function parentVaults(db: Db, address: string): SproutRow[] {
  return db
    .query<SproutRow, [string]>(
      'SELECT id, beneficiary, factory, graduation_timestamp FROM sprouts WHERE lower(parent) = lower(?) ORDER BY created_at ASC, id ASC',
    )
    .all(address);
}

function giftIdsOf(db: Db, vault: string): string[] {
  return db.query<{ id: string }, [string]>('SELECT id FROM gifts WHERE lower(vault_id) = ?').all(lower(vault)).map((g) => g.id);
}

function sproutFootprint(db: Db, s: SproutRow, now: number): SproutFootprint {
  const v = lower(s.id);
  const gifts = db
    .query<{ id: string; label: string | null }, [string]>('SELECT id, label FROM gifts WHERE lower(vault_id) = ?')
    .all(v);
  const campaigns = db
    .query<{ title: string }, [string]>(
      'SELECT c.title FROM gift_campaigns c JOIN gifts g ON lower(g.id) = lower(c.gift_id) WHERE lower(g.vault_id) = ?',
    )
    .all(v);
  const notes = db
    .query<{ name: string | null; note: string | null; hidden: number }, [string]>(
      'SELECT n.name, n.note, n.hidden FROM gift_notes n JOIN gifts g ON lower(g.id) = lower(n.gift_id) WHERE lower(g.vault_id) = ?',
    )
    .all(v);
  const invites = db
    .query<{ redeemed: number; revoked: number; expires_at: number; show_balance: number; session_until: number | null }, [string]>(
      `SELECT i.redeemed, i.revoked, i.expires_at, i.show_balance,
              (SELECT max(s.expires_at) FROM kid_sessions s WHERE s.invite_id = i.id) AS session_until
         FROM kid_invites i WHERE lower(i.vault_id) = ?`,
    )
    .all(v);
  // Mirrors the redeem and childSession checks: a link works while it is unrevoked and unexpired,
  // either waiting to be opened or open on a device whose session has not ended.
  const waiting = invites.filter((i) => !i.revoked && !i.redeemed && i.expires_at > now);
  const openNow = invites.filter((i) => !i.revoked && i.redeemed && i.expires_at > now && (i.session_until ?? 0) > now);
  const encrypted = notes.filter(isEncrypted).length;
  return {
    id: s.id,
    beneficiary: s.beneficiary,
    factory: s.factory,
    graduationTimestamp: s.graduation_timestamp,
    gifts: {
      links: gifts.length,
      plainLabels: gifts.filter((g) => g.label !== null && g.label !== GENERIC_GIFT_LABEL).length,
      campaigns: campaigns.length,
      plainCampaignTitles: campaigns.filter((c) => c.title !== GENERIC_CAMPAIGN_TITLE).length,
      payments: count(db, 'SELECT count(*) AS n FROM gift_payments WHERE lower(vault_id) = ?', v),
    },
    notes: { total: notes.length, encrypted, plain: notes.length - encrypted, hidden: notes.filter((n) => n.hidden === 1).length },
    invites: {
      total: invites.length,
      waiting: waiting.length,
      openNow: openNow.length,
      balanceVisible: [...waiting, ...openNow].filter((i) => i.show_balance).length,
      ended: invites.length - waiting.length - openNow.length,
    },
    proofs: {
      total: count(db, 'SELECT count(*) AS n FROM zk_milestone_certificates WHERE lower(vault_id) = ?', v),
      active: count(db, 'SELECT count(*) AS n FROM zk_milestone_certificates WHERE lower(vault_id) = ? AND revoked = 0 AND expires_at > ?', v, now),
    },
    chores: {
      total: count(db, 'SELECT count(*) AS n FROM milestones WHERE lower(vault_id) = ?', v),
      open: count(db, "SELECT count(*) AS n FROM milestones WHERE lower(vault_id) = ? AND status = 'created'", v),
      described: count(db, 'SELECT count(*) AS n FROM milestones WHERE lower(vault_id) = ? AND description_hash IS NOT NULL', v),
    },
    kept: {
      events: count(db, 'SELECT count(*) AS n FROM chain_events WHERE lower(vault_id) = ?', v),
      snapshots: count(db, 'SELECT count(*) AS n FROM growth_snapshots WHERE lower(vault_id) = ?', v),
      jobs: count(db, 'SELECT count(*) AS n FROM investment_jobs WHERE lower(vault_id) = ?', v),
      keeperTxs: count(db, 'SELECT count(*) AS n FROM keeper_txs WHERE lower(vault_id) = ?', v),
    },
  };
}

/** Everything Sprout holds off-chain for the sprouts this wallet planted, as counts. */
export function familyFootprint(db: Db, address: string, now: number): FamilyFootprint {
  const vaults = parentVaults(db, address);
  const sprouts = vaults.map((s) => sproutFootprint(db, s, now));
  const legacyText: FamilyFootprint['legacyText'] = [];
  for (const s of vaults) {
    const rows = db
      .query<{ id: string; label: string | null; title: string | null }, [string]>(
        `SELECT g.id, g.label, c.title FROM gifts g LEFT JOIN gift_campaigns c ON lower(c.gift_id) = lower(g.id)
          WHERE lower(g.vault_id) = ? ORDER BY g.created_at ASC`,
      )
      .all(lower(s.id));
    for (const r of rows) {
      const label = r.label !== null && r.label !== GENERIC_GIFT_LABEL ? r.label : null;
      const title = r.title !== null && r.title !== GENERIC_CAMPAIGN_TITLE ? r.title : null;
      if (label !== null || title !== null) legacyText.push({ giftId: r.id, label, title });
    }
  }
  const sum = (pick: (s: SproutFootprint) => number) => sprouts.reduce((n, s) => n + pick(s), 0);
  const a = lower(address);
  const kidSessions = vaults.reduce(
    (n, s) =>
      n +
      count(
        db,
        'SELECT count(*) AS n FROM kid_sessions WHERE invite_id IN (SELECT id FROM kid_invites WHERE lower(vault_id) = ?)',
        lower(s.id),
      ),
    0,
  );
  return {
    address: a,
    sprouts,
    beneficiaryOf: count(db, 'SELECT count(*) AS n FROM sprouts WHERE lower(beneficiary) = ? AND lower(parent) != ?', a, a),
    giftKeyRegistered: count(db, 'SELECT count(*) AS n FROM family_gift_keys WHERE address = ?', a) > 0,
    activeSessions: count(db, 'SELECT count(*) AS n FROM family_sessions WHERE address = ? AND expires_at > ?', a, now),
    legacyText,
    erase: {
      familyLedger: db.query("SELECT 1 FROM sqlite_master WHERE type='table' AND name='family_ledger'").get() ? count(db, 'SELECT count(*) AS n FROM family_ledger WHERE owner=?', a) : 0,
      familyPlans: db.query("SELECT 1 FROM sqlite_master WHERE type='table' AND name='family_plans'").get() ? count(db, 'SELECT count(*) AS n FROM family_plans WHERE owner=?', a) : 0,
      giftLinks: sum((s) => s.gifts.links),
      campaigns: sum((s) => s.gifts.campaigns),
      giftNotes: sum((s) => s.notes.total),
      giftPayments: sum((s) => s.gifts.payments),
      kidInvites: sum((s) => s.invites.total),
      kidSessions,
      proofs: sum((s) => s.proofs.total),
      choreDescriptions: sum((s) => s.chores.described),
      giftKey: count(db, 'SELECT count(*) AS n FROM family_gift_keys WHERE address = ?', a),
      sessions: count(db, 'SELECT count(*) AS n FROM family_sessions WHERE address = ?', a),
      signIns: count(db, 'SELECT count(*) AS n FROM nonces WHERE lower(address) = ?', a),
    },
    kept: {
      sprouts: vaults.length,
      events: sum((s) => s.kept.events),
      snapshots: sum((s) => s.kept.snapshots),
      chores: sum((s) => s.chores.total),
      jobs: sum((s) => s.kept.jobs),
      keeperTxs: sum((s) => s.kept.keeperTxs),
    },
  };
}

/**
 * Erase everything Sprout stores off-chain for this wallet's family, in one
 * transaction. `expectedVaults` must be exactly the sprouts the wallet planted
 * (what the family reviewed); otherwise nothing is deleted.
 */
export function eraseFamily(db: Db, address: string, expectedVaults: string[], now: number) {
  // Overwrite the erased rows on disk rather than only unlinking them, then fold
  // the write-ahead log back in so old page images do not linger there either.
  const previous = db.query<{ secure_delete: number }, []>('PRAGMA secure_delete').get()?.secure_delete ?? 0;
  db.exec('PRAGMA secure_delete = ON');
  try {
    return eraseInTransaction(db, address, expectedVaults, now);
  } finally {
    db.exec(`PRAGMA secure_delete = ${Number(previous) === 2 ? 'FAST' : Number(previous) ? 'ON' : 'OFF'}`);
    try {
      db.exec('PRAGMA wal_checkpoint(TRUNCATE)');
    } catch {
      /* a busy checkpoint finishes on a later write */
    }
  }
}

function eraseInTransaction(db: Db, address: string, expectedVaults: string[], now: number) {
  return db.transaction(() => {
    const vaults = parentVaults(db, address).map((s) => lower(s.id));
    const expected = new Set(expectedVaults.map(lower));
    if (expected.size !== vaults.length || vaults.some((v) => !expected.has(v))) {
      throw new AuthError('Your sprouts changed since you reviewed this. Review the list again.', 409);
    }
    const before = familyFootprint(db, address, now);
    const inviteIds: string[] = [];
    for (const v of vaults) {
      for (const gift of giftIdsOf(db, v)) {
        db.run('DELETE FROM gift_notes WHERE lower(gift_id) = lower(?)', [gift]);
        db.run('DELETE FROM gift_campaigns WHERE lower(gift_id) = lower(?)', [gift]);
        db.run('DELETE FROM gift_payments WHERE lower(gift_id) = lower(?)', [gift]);
      }
      db.run('DELETE FROM gift_payments WHERE lower(vault_id) = ?', [v]);
      db.run('DELETE FROM gifts WHERE lower(vault_id) = ?', [v]);
      inviteIds.push(
        ...db.query<{ id: string }, [string]>('SELECT id FROM kid_invites WHERE lower(vault_id) = ?').all(v).map((i) => i.id),
      );
      db.run('DELETE FROM kid_sessions WHERE invite_id IN (SELECT id FROM kid_invites WHERE lower(vault_id) = ?)', [v]);
      db.run('DELETE FROM kid_invites WHERE lower(vault_id) = ?', [v]);
      db.run('DELETE FROM zk_milestone_certificates WHERE lower(vault_id) = ?', [v]);
      db.run('UPDATE milestones SET description_hash = NULL WHERE lower(vault_id) = ? AND description_hash IS NOT NULL', [v]);
    }
    const a = lower(address);
    for (const table of ['family_ledger','family_plans']) {
      if(db.query("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(table)) db.run(`DELETE FROM ${table} WHERE owner = ?`, [a]);
    }
    db.run('DELETE FROM family_gift_keys WHERE address = ?', [a]);
    db.run('DELETE FROM family_sessions WHERE address = ?', [a]);
    db.run('DELETE FROM nonces WHERE lower(address) = ?', [a]);
    return { erased: before.erase, kept: before.kept, inviteIds };
  })();
}

const giftIdSchema = z.string().regex(/^0x[0-9a-fA-F]{64}$/);
const envelopeSchema = z
  .string()
  .max(6000)
  .startsWith(ENVELOPE)
  .refine((value) => {
    try {
      const parsed = JSON.parse(value.slice(ENVELOPE.length)) as { wrapped?: unknown; box?: { iv?: unknown; ciphertext?: unknown } };
      const b64 = (x: unknown) => typeof x === 'string' && x.length > 0 && /^[A-Za-z0-9+/]+={0,2}$/.test(x);
      return b64(parsed.wrapped) && b64(parsed.box?.iv) && b64(parsed.box?.ciphertext);
    } catch {
      return false;
    }
  });

export function registerPrivacyPackRoutes(app: Hono, deps: AppDeps, signed: (c: Context, purpose: string) => Promise<string>) {
  const db = deps.db;
  const now = () => deps.now?.() ?? Date.now();
  db.exec(USAGE_TABLE);

  /** A wallet's request count per action and fixed window; rows older than two days are pruned. */
  function limit(address: string, action: keyof typeof PRIVACY_LIMITS) {
    const at = now();
    const { max, windowMs } = PRIVACY_LIMITS[action];
    const key = digest(`${action}:${lower(address)}`);
    db.transaction(() => {
      db.run('DELETE FROM privacy_request_usage WHERE updated_at < ?', [at - 2 * DAY]);
      const row = db
        .query<{ used: number }, [string, string, number, number]>(
          `INSERT INTO privacy_request_usage (key, bucket, used, updated_at) VALUES (?, ?, 1, ?)
           ON CONFLICT(key, bucket) DO UPDATE SET used = used + 1, updated_at = excluded.updated_at WHERE used < ?
           RETURNING used`,
        )
        .get(key, String(Math.floor(at / windowMs)), at, max);
      if (!row) throw new AuthError('Too many privacy requests from this wallet. Please try again later.', 429);
    })();
  }

  async function json<S extends z.ZodTypeAny>(c: Context, schema: S): Promise<z.infer<S>> {
    let data: unknown;
    try {
      data = await c.req.json();
    } catch {
      throw new AuthError('Invalid request.', 400);
    }
    const result = schema.safeParse(data);
    if (!result.success) throw new AuthError('Invalid request.', 400);
    return result.data;
  }

  const tooLarge = (c: Context) => c.json({ error: 'Request too large.' }, 413);
  app.use('/api/family/erase', bodyLimit({ maxSize: 8 * 1024, onError: tooLarge }));
  app.use('/api/family/kid-links/*', bodyLimit({ maxSize: 1024, onError: tooLarge }));
  app.use('/api/family/server-labels/*', bodyLimit({ maxSize: 64 * 1024, onError: tooLarge }));
  app.use('/api/family/plain-notes', bodyLimit({ maxSize: 1024, onError: tooLarge }));
  app.use('/api/family/plain-notes/*', bodyLimit({ maxSize: 700 * 1024, onError: tooLarge }));
  // The page is the app shell; still keep it out of caches and search results like /family and /kid.
  app.use('/privacy-checkup', async (c, next) => {
    await next();
    c.res.headers.set('Cache-Control', 'no-store');
    c.res.headers.set('X-Robots-Tag', 'noindex, nofollow, noarchive');
  });

  app.get('/api/family/privacy-report', (c) => {
    const session = familySession(c, db, now());
    limit(session.address, 'read');
    return c.json(familyFootprint(db, session.address, now()));
  });

  // Older gift messages the server can still read, for the family's browser to
  // encrypt. Signed like the existing full note list (hidden notes included).
  app.post('/api/family/plain-notes', async (c) => {
    const signer = lower(await signed(c, 'gift-notes-plain'));
    limit(signer, 'read');
    await json(c, z.object({}).strict());
    const rows = db
      .query<{ gift_id: string; tx_hash: string; log_index: number; name: string | null; note: string | null; hidden: number }, [string]>(
        `SELECT n.gift_id, n.tx_hash, n.log_index, n.name, n.note, n.hidden
           FROM gift_notes n
           JOIN gifts g ON lower(g.id) = lower(n.gift_id)
           JOIN sprouts s ON lower(s.id) = lower(g.vault_id)
          WHERE lower(s.parent) = ?
          ORDER BY n.created_at ASC LIMIT 500`,
      )
      .all(signer);
    return c.json({
      notes: rows
        .filter((r) => !isEncrypted(r))
        .map((r) => ({ giftId: r.gift_id, txHash: r.tx_hash, logIndex: r.log_index, name: r.name, note: r.note, hidden: r.hidden === 1 })),
    });
  });

  app.post('/api/family/plain-notes/encrypt', async (c) => {
    const signer = await signed(c, 'encrypt-gift-notes');
    limit(signer, 'write');
    const body = await json(
      c,
      z
        .object({
          notes: z
            .array(z.object({ giftId: giftIdSchema, txHash: hashSchema, logIndex: z.number().int().min(0), encryptedNote: envelopeSchema }).strict())
            .min(1)
            .max(100),
        })
        .strict(),
    );
    const result = db.transaction(() => {
      let encrypted = 0;
      let skipped = 0;
      for (const n of body.notes) {
        const row = db
          .query<{ name: string | null; note: string | null; parent: string }, [string, string, number]>(
            `SELECT n.name, n.note, s.parent FROM gift_notes n
               JOIN gifts g ON lower(g.id) = lower(n.gift_id)
               JOIN sprouts s ON lower(s.id) = lower(g.vault_id)
              WHERE lower(n.gift_id) = lower(?) AND n.tx_hash = ? AND n.log_index = ?`,
          )
          .get(n.giftId, lower(n.txHash), n.logIndex);
        // Same answer for "missing" and "someone else's": nothing about other families is disclosed.
        if (!row || lower(row.parent) !== lower(signer)) throw new AuthError('This family view is unavailable.', 403);
        if (isEncrypted(row)) {
          skipped += 1;
          continue;
        }
        db.run('UPDATE gift_notes SET name = NULL, note = ? WHERE lower(gift_id) = lower(?) AND tx_hash = ? AND log_index = ?', [
          n.encryptedNote,
          n.giftId,
          lower(n.txHash),
          n.logIndex,
        ]);
        encrypted += 1;
      }
      return { encrypted, skipped };
    })();
    return c.json(result);
  });

  // Older links stored the family's own label/title; the browser keeps them in its vault first.
  app.post('/api/family/server-labels/clear', async (c) => {
    const signer = await signed(c, 'clear-server-labels');
    limit(signer, 'write');
    const body = await json(c, z.object({ giftIds: z.array(giftIdSchema).min(1).max(500) }).strict());
    const result = db.transaction(() => {
      let labels = 0;
      let titles = 0;
      for (const id of body.giftIds) {
        const owner = db
          .query<{ parent: string }, [string]>(
            'SELECT s.parent FROM gifts g JOIN sprouts s ON lower(s.id) = lower(g.vault_id) WHERE lower(g.id) = lower(?)',
          )
          .get(id);
        if (!owner || lower(owner.parent) !== lower(signer)) throw new AuthError('This family view is unavailable.', 403);
        labels += db.run('UPDATE gifts SET label = ? WHERE lower(id) = lower(?) AND label IS NOT NULL AND label != ?', [
          GENERIC_GIFT_LABEL,
          id,
          GENERIC_GIFT_LABEL,
        ]).changes;
        titles += db.run('UPDATE gift_campaigns SET title = ? WHERE lower(gift_id) = lower(?) AND title != ?', [
          GENERIC_CAMPAIGN_TITLE,
          id,
          GENERIC_CAMPAIGN_TITLE,
        ]).changes;
      }
      return { labels, titles };
    })();
    return c.json(result);
  });

  app.post('/api/family/kid-links/revoke-all', async (c) => {
    const signer = await signed(c, 'kid-revoke-all');
    limit(signer, 'write');
    await json(c, z.object({}).strict());
    const vaults = parentVaults(db, signer).map((s) => lower(s.id));
    const at = now();
    let revoked = 0;
    db.transaction(() => {
      for (const v of vaults) {
        revoked += db.run('UPDATE kid_invites SET revoked = 1 WHERE lower(vault_id) = ? AND revoked = 0 AND expires_at > ?', [v, at]).changes;
      }
    })();
    return c.json({ revoked });
  });

  // Needs both the family session and a fresh signature from the same wallet.
  app.post('/api/family/erase', async (c) => {
    const session = familySession(c, db, now());
    const signer = await signed(c, 'erase-family-data');
    if (lower(signer) !== session.address) throw new AuthError('Sign with the wallet you are signed in with.', 403);
    limit(signer, 'erase');
    const body = await json(
      c,
      z.object({ confirm: z.literal(ERASE_CONFIRM), vaults: z.array(addressSchema).max(200) }).strict(),
    );
    return c.json(eraseFamily(db, signer, body.vaults, now()));
  });
}
