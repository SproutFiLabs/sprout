import type { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { z } from 'zod';
import type { Address, Hex, PublicClient } from 'viem';
import { DEAD_ADDRESS, ROBINHOOD_BURN_ROUTE, quoteBurn } from '@sprout/shared';
import type { SproutDb } from './db';
import { familySession } from './privacy';
import { verifyToolBurn, type ToolBurnEvidence } from './toolBurnReceipt';
import {
  createToolPurchase,
  ensureToolTables,
  generateToolReport,
  ownedToolPurchase,
  purchaseView,
  redeemToolPurchase,
  TOOL_CATALOG,
  type ToolPurchase,
} from './toolPurchases';

const R = ROBINHOOD_BURN_ROUTE;
const requestSchema = z.object({ kind: z.enum(['goal', 'comparison', 'portfolio']), input: z.unknown() }).strict();
const receiptSchema = z.object({ txHash: z.string().regex(/^0x[0-9a-fA-F]{64}$/) }).strict();

export interface ToolRuntime {
  enabled: boolean;
  quote: () => Promise<{ amount: bigint; block: bigint }>;
  verify: (row: ToolPurchase, hash: Hex) => Promise<{ at: number }>;
}

/** Read-only chain access. Payments are signed solely by the visitor's wallet. */
export function createToolRuntime(client: PublicClient | null, enabled: boolean, now: () => number = Date.now): ToolRuntime {
  return {
    enabled: enabled && client !== null,
    async quote() {
      if (!client || !enabled) throw new Error('Tool payments are not enabled.');
      const [chainId, block] = await Promise.all([client.getChainId(), client.getBlock()]);
      const age = Math.floor(now() / 1000) - Number(block.timestamp);
      if (chainId !== R.chainId || age < -30 || age > 120) throw new Error('Current chain data is unavailable.');
      const quote = await quoteBurn(client as never, R, 500_000n, block.number);
      if (quote.sproutOut <= 0n) throw new Error('A SPROUT quote is unavailable.');
      return { amount: quote.sproutOut, block: block.number };
    },
    async verify(row, hash) {
      if (!client) throw new Error('The chain is unavailable.');
      const [transaction, receipt, headBlock, chainId] = await Promise.all([
        client.getTransaction({ hash }),
        client.getTransactionReceipt({ hash }),
        client.getBlockNumber({ cacheTime: 0 }),
        client.getChainId(),
      ]);
      if (chainId !== R.chainId) throw new Error('Wrong chain.');
      // Fetch by number, so a reorged receipt cannot provide its own canonical block.
      const block = await client.getBlock({ blockNumber: receipt.blockNumber });
      if (transaction.hash.toLowerCase() !== hash.toLowerCase()) throw new Error('Wrong transaction.');
      return verifyToolBurn({ transaction, receipt, block } as ToolBurnEvidence, {
        chainId: R.chainId,
        token: R.sprout,
        payer: row.wallet as Address,
        // ERC-20 transfer cannot enforce a quote deadline. Honor the stored
        // token price even if mining or receipt recovery is delayed; otherwise
        // a user could lose tokens without receiving their prepared report.
        amount: BigInt(row.amount),
        // The issued block is the canonical lower bound. Local wall-clock time
        // can be ahead of a chain timestamp when a receipt mines later.
        issuedAt: 0,
        expiresAt: Number.MAX_SAFE_INTEGER,
        issuedBlock: BigInt(row.issued_block),
        headBlock,
        confirmations: 3,
      });
    },
  };
}

export function registerToolRoutes(app: Hono, deps: { db: SproutDb; runtime: ToolRuntime; now?: () => number }) {
  const { db, runtime } = deps;
  const now = deps.now ?? Date.now;
  ensureToolTables(db);
  app.use('/api/family/tools/*', bodyLimit({ maxSize: 16_384 }));
  app.get('/api/tools', (c) =>
    c.json({
      enabled: runtime.enabled,
      tools: TOOL_CATALOG,
      chainId: R.chainId,
      token: R.sprout,
      decimals: R.sproutDecimals,
      deadAddress: DEAD_ADDRESS,
      referenceUsd: '0.50',
      pricing:
        'Each report is priced in SPROUT using a 0.50 USDG swap quote at preparation, including exchange fees. Its token price stays fixed for that saved report. You transfer only SPROUT; network gas is separate.',
    }),
  );
  app.get('/api/tools/burns', (c) => {
    const rows = db.query<{ tx_hash: string; amount: string; at: number }, []>(
      'SELECT tx_hash, amount, at FROM tool_burn_redemptions ORDER BY at DESC LIMIT 20',
    ).all();
    let total = 0n, count = 0;
    // The recent list is capped, but lifetime totals include every receipt.
    // Use BigInt, not SQLite SUM, so 18-decimal token amounts stay exact.
    for (const row of db.query<{ amount: string }, []>('SELECT amount FROM tool_burn_redemptions').iterate()) {
      total += BigInt(row.amount); count++;
    }
    return c.json({ count, totalAmount: String(total), latest: rows.map((row) => ({ txHash: row.tx_hash, amount: row.amount, at: row.at })) });
  });
  app.get('/api/family/tools/purchases', (c) => {
    const session = familySession(c, db, now());
    const rows = db
      .query<ToolPurchase, [string]>('SELECT * FROM tool_purchases WHERE wallet=? ORDER BY issued_at DESC LIMIT 100')
      .all(session.address);
    return c.json({ purchases: rows.map(purchaseView) });
  });
  app.get('/api/family/tools/purchases/:id', (c) => {
    const session = familySession(c, db, now());
    try {
      return c.json(purchaseView(ownedToolPurchase(db, c.req.param('id'), session.address)));
    } catch {
      return c.json({ error: 'This purchase is unavailable for this wallet.' }, 404);
    }
  });
  app.post('/api/family/tools/prepare', async (c) => {
    const session = familySession(c, db, now());
    if (!runtime.enabled) return c.json({ error: 'Tool payments are not enabled yet.' }, 503);
    let kind: 'goal' | 'comparison' | 'portfolio', result: unknown;
    try {
      const body = requestSchema.parse(await c.req.json());
      kind = body.kind;
      result = { input: body.input, report: generateToolReport(kind, body.input), preparedAt: Math.floor(now() / 1000) };
    } catch {
      return c.json({ error: 'Check the report inputs and supported ranges.' }, 400);
    }
    try {
      const quote = await runtime.quote();
      const row = createToolPurchase(db, {
        wallet: session.address,
        kind,
        result,
        amount: quote.amount,
        now: Math.floor(now() / 1000),
        issuedBlock: quote.block,
      });
      return c.json(purchaseView(row), 201);
    } catch {
      return c.json({ error: 'Could not prepare a current quote. Try again later; no payment was requested.' }, 503);
    }
  });
  app.post('/api/family/tools/purchases/:id/verify', async (c) => {
    const session = familySession(c, db, now());
    const parsed = receiptSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: 'Enter a valid transaction hash.' }, 400);
    let row: ToolPurchase;
    try {
      row = ownedToolPurchase(db, c.req.param('id'), session.address);
    } catch {
      return c.json({ error: 'This purchase is unavailable for this wallet.' }, 404);
    }
    if (row.paid_at !== null) return c.json(purchaseView(row));
    try {
      const verified = await runtime.verify(row, parsed.data.txHash as Hex);
      return c.json(redeemToolPurchase(db, row.id, session.address, parsed.data.txHash, verified.at));
    } catch {
      return c.json(
        {
          error:
            'The burn is not verified yet. It must match this quote and have three confirmations. Retry verification without sending another payment.',
        },
        409,
      );
    }
  });
}
