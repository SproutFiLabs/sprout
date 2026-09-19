/** Family read authorization. Bearer secrets are random, hashed at rest and never put in URLs. */
import { createHash, randomBytes } from 'node:crypto';
import type { Context } from 'hono';
import type { SproutDb } from './db';
import { AuthError } from './auth';
import { getSprout } from './repo';

export const FAMILY_TTL = 30 * 60_000;
export const CHILD_TTL = 24 * 60 * 60_000;
export const secret = () => randomBytes(32).toString('base64url');
export const digest = (value: string) => createHash('sha256').update(value).digest('hex');
export interface FamilySession {
  token_hash: string;
  address: string;
  expires_at: number;
}
export interface KidInvite {
  id: string;
  vault_id: string;
  secret_hash: string;
  expires_at: number;
  redeemed: number;
  revoked: number;
  show_balance: number;
}
export function createFamilySession(db: SproutDb, address: string, now: number) {
  const token = secret();
  db.run('DELETE FROM family_sessions WHERE expires_at <= ?', [now]);
  db.run('INSERT INTO family_sessions VALUES (?, ?, ?)', [digest(token), address.toLowerCase(), now + FAMILY_TTL]);
  return { token, expiresAt: now + FAMILY_TTL };
}
export function familySession(c: Context, db: SproutDb, now: number): FamilySession {
  const token = c.req.header('authorization')?.replace(/^Bearer /, '') ?? '';
  if (!/^[\w-]{43}$/.test(token)) throw new AuthError('Sign in to view your family.');
  const row = db
    .query<FamilySession, [string, number]>('SELECT * FROM family_sessions WHERE token_hash = ? AND expires_at > ?')
    .get(digest(token), now);
  if (!row) throw new AuthError('Your family session expired. Please reconnect.');
  return row;
}
export function authorizeVault(db: SproutDb, id: string, address: string, parentOnly = false) {
  const sprout = getSprout(db, id);
  // Deliberately do not disclose whether another family's vault exists.
  if (
    !sprout ||
    (sprout.parent.toLowerCase() !== address.toLowerCase() &&
      (parentOnly || sprout.beneficiary.toLowerCase() !== address.toLowerCase()))
  ) {
    throw new AuthError('This family view is unavailable.', 403);
  }
  return sprout;
}
export function childSession(c: Context, db: SproutDb, now: number): KidInvite {
  const token = c.req.header('authorization')?.replace(/^Bearer /, '') ?? '';
  if (!/^[\w-]{43}$/.test(token)) throw new AuthError('Ask a grown-up for a new invitation.');
  const row = db
    .query<KidInvite, [string, number, number]>(
      `SELECT i.* FROM kid_invites i JOIN kid_sessions s ON s.invite_id=i.id
    WHERE s.token_hash=? AND s.expires_at>? AND i.expires_at>? AND i.revoked=0`,
    )
    .get(digest(token), now, now);
  if (!row) throw new AuthError('This invitation has ended. Ask a grown-up for a new one.');
  return row;
}
