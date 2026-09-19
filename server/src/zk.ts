import { randomBytes } from 'node:crypto';
import type { Hono, Context } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { z } from 'zod';
import type { Address } from 'viem';
import { milestoneCommitment } from '@sprout/shared/zk-commitment';
import { ZK_MAX_CENTS, ZK_TTL_MS, zkCertificateSchema, zkThresholdSchema, type ZkCertificate } from '@sprout/shared/zk';
import type { AppDeps } from './app';
import { AuthError } from './auth';
import { authorizeVault, familySession } from './privacy';
import { cachedHoldings, type HoldingsSnapshot } from './chain';

interface Row {
  id: string;
  vault_id: string;
  commitment: string;
  threshold_cents: string;
  scope: string;
  issued_at: number;
  expires_at: number;
  revoked: number;
}
function certificate(row: Row): ZkCertificate {
  return {
    id: row.id,
    commitment: row.commitment,
    thresholdCents: row.threshold_cents,
    scope: row.scope,
    issuedAt: row.issued_at,
    expiresAt: row.expires_at,
  };
}
/** Fail closed on unavailable pricing; round DOWN so a proof never overstates the value. */
export function snapshotCents(snapshot: HoldingsSnapshot): string {
  if (
    !snapshot.available ||
    !snapshot.totalValueUsd ||
    !/^[0-9]+$/.test(snapshot.totalValueUsd) ||
    snapshot.holdings.some((h) => h.status !== 'ok') ||
    !Number.isInteger(snapshot.feedDecimals) ||
    snapshot.feedDecimals < 0 ||
    snapshot.feedDecimals > 36 ||
    snapshot.blockNumber === null
  ) {
    throw new AuthError('A fresh, fully priced balance is needed to create this proof.', 503);
  }
  const value = BigInt(snapshot.totalValueUsd);
  const cents =
    snapshot.feedDecimals >= 2
      ? value / 10n ** BigInt(snapshot.feedDecimals - 2)
      : value * 10n ** BigInt(2 - snapshot.feedDecimals);
  if (cents > ZK_MAX_CENTS) throw new AuthError('This balance exceeds the proof range.', 422);
  return cents.toString();
}
export function registerZkRoutes(app: Hono, deps: AppDeps, signed: (c: Context, purpose: string) => Promise<string>) {
  const now = () => deps.now?.() ?? Date.now();
  app.use('/api/zk/*', bodyLimit({ maxSize: 4096, onError: (c) => c.json({ error: 'Request too large.' }, 413) }));
  const idSchema = z.string().regex(/^[a-f0-9]{32}$/);
  async function json<S extends z.ZodTypeAny>(c: Context, schema: S): Promise<z.infer<S>> {
    let data: unknown;
    try {
      data = await c.req.json();
    } catch {
      throw new AuthError('Invalid request.', 400);
    }
    const result = schema.safeParse(data);
    if (!result.success) throw new AuthError('Invalid proof request.', 400);
    return result.data;
  }
  function rateLimit(vault: string, at: number) {
    const count =
      deps.db
        .query<
          { count: number },
          [string, number]
        >('SELECT count(*) AS count FROM zk_milestone_certificates WHERE vault_id=? AND issued_at>?')
        .get(vault, at - ZK_TTL_MS)?.count ?? 0;
    if (count >= 10) throw new AuthError('You can create ten proofs every 30 minutes. Try again later.', 429);
  }
  app.get('/api/zk/certificates/:vault', (c) => {
    const session = familySession(c, deps.db, now());
    const vault = authorizeVault(deps.db, c.req.param('vault'), session.address, true);
    const rows = deps.db
      .query<
        Row,
        [string, number]
      >('SELECT * FROM zk_milestone_certificates WHERE vault_id=? AND expires_at>? ORDER BY issued_at DESC LIMIT 10')
      .all(vault.id.toLowerCase(), now());
    return c.json({ certificates: rows.map((row) => ({ ...certificate(row), revoked: Boolean(row.revoked) })) });
  });
  app.post('/api/zk/issue/:vault', async (c) => {
    const vaultId = c.req.param('vault');
    const signer = await signed(c, `zk-issue:${vaultId.toLowerCase()}`);
    const vault = authorizeVault(deps.db, vaultId, signer, true);
    const { thresholdCents } = await json(c, z.object({ thresholdCents: zkThresholdSchema }).strict());
    rateLimit(vault.id.toLowerCase(), now());
    const balance = snapshotCents(await cachedHoldings(deps.chain, vault.id as Address));
    if (BigInt(balance) < BigInt(thresholdCents))
      throw new AuthError('This sprout has not reached that milestone yet.', 422);
    const id = randomBytes(16).toString('hex');
    const salt = BigInt(`0x${randomBytes(31).toString('hex')}`).toString();
    const scope = BigInt(`0x${id}`).toString();
    const commitment = await milestoneCommitment(balance, salt, scope);
    const issuedAt = now();
    const value: ZkCertificate = { id, commitment, thresholdCents, scope, issuedAt, expiresAt: issuedAt + ZK_TTL_MS };
    deps.db.transaction(() => {
      // Recheck after async RPC/hash work to make the issuance cap race-safe.
      rateLimit(vault.id.toLowerCase(), issuedAt);
      deps.db.run('DELETE FROM zk_milestone_certificates WHERE expires_at<=?', [issuedAt]);
      deps.db.run(
        'INSERT INTO zk_milestone_certificates (id,vault_id,commitment,threshold_cents,scope,issued_at,expires_at) VALUES (?,?,?,?,?,?,?)',
        [id, vault.id.toLowerCase(), commitment, thresholdCents, scope, issuedAt, value.expiresAt],
      );
    })();
    // This authenticated response is the ONLY location that includes the private witness.
    // No salt or exact balance is stored in the certificate table.
    return c.json(
      { certificate: value, witness: { balance, salt, scope, commitment, threshold: thresholdCents } },
      201,
    );
  });
  app.post('/api/zk/revoke/:id', async (c) => {
    const id = idSchema.safeParse(c.req.param('id'));
    if (!id.success) throw new AuthError('Proof unavailable.', 404);
    const signer = await signed(c, `zk-revoke:${id.data}`);
    const row = deps.db.query<Row, [string]>('SELECT * FROM zk_milestone_certificates WHERE id=?').get(id.data);
    if (!row) throw new AuthError('Proof unavailable.', 404);
    authorizeVault(deps.db, row.vault_id, signer, true);
    deps.db.run('UPDATE zk_milestone_certificates SET revoked=1 WHERE id=?', [row.id]);
    return c.json({ revoked: true });
  });
  // Anyone holding a certificate can check its provenance/liveness. No identity lookup API.
  // The browser independently checks the ZK proof with the pinned verification key.
  app.post('/api/zk/status', async (c) => {
    const value = await json(c, zkCertificateSchema);
    const row = deps.db
      .query<Row, [string, number]>('SELECT * FROM zk_milestone_certificates WHERE id=? AND revoked=0 AND expires_at>?')
      .get(value.id, now());
    const active = Boolean(
      row && Object.entries(certificate(row)).every(([key, data]) => value[key as keyof ZkCertificate] === data),
    );
    return c.json({ active, checkedAt: now() });
  });
}
