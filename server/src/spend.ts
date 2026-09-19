import type { RewardQuote } from '@sprout/shared';
import { randomUUID } from "node:crypto";
import type { Hono, Context } from "hono";
import { z } from "zod";
import {
  spendPurpose,
  type SpendRequest,
  type SpendOrder,
} from "@sprout/shared";
import type { SproutDb } from "./db";
import { authorizeVault, familySession } from "./privacy";
import { SpendProviderError, type SpendProvider } from "./spendProvider";
const requestSchema = z
  .object({
    key: z.string().uuid(),
    rewardOfferId: z.string().uuid().optional(),
    vault: z.string().regex(/^0x[0-9a-fA-F]{40}$/),
    product: z.string().min(1).max(150),
    value: z.number().int().min(1).max(100),
    country: z.literal("US"),
  })
  .strict();
type Row = {
  id: string;
  owner: string;
  request_key: string;
  fingerprint: string;
  invoice: string | null;
  data: string;
  created_at: number;
  value: number;
  checked_at: number;
};
export function registerSpendRoutes(
  app: Hono,
  deps: {
    db: SproutDb;
    provider?: SpendProvider;
    rewards?: { quote(owner:string,product:string,value:number,offerId?:string):Promise<RewardQuote|null>; reserve(owner:string,orderId:string,quote:RewardQuote|null):void };
    now?: () => number;
    requireAuth: (c: Context, purpose: string) => Promise<string>;
  },
) {
  const { db, provider } = deps;
  const now = () => deps.now?.() ?? Date.now();
  db.run(
    `CREATE TABLE IF NOT EXISTS spend_orders (id TEXT PRIMARY KEY,owner TEXT NOT NULL,request_key TEXT NOT NULL,fingerprint TEXT NOT NULL,invoice TEXT UNIQUE,data TEXT NOT NULL,created_at INTEGER NOT NULL,value INTEGER NOT NULL,checked_at INTEGER NOT NULL DEFAULT 0,UNIQUE(owner,request_key))`,
  );
  app.get("/api/spend/catalog", async (c) => {
    if (c.req.query("country") && c.req.query("country") !== "US")
      return c.json({ error: "Choose United States for this release." }, 400);
    try {
      return c.json({
        enabled: !!provider,
        products: provider ? await provider.catalog("US") : [],
        perOrderLimit: 100,
        dailyLimit: 200,
        country: "US",
      });
    } catch {
      return c.json(
        { error: "The shop could not load. Please try again." },
        503,
      );
    }
  });
  app.get("/api/spend/orders", (c) => {
    const { address } = familySession(c, db, now());
    const rows = db
      .query<Row, [string]>(
        "SELECT * FROM spend_orders WHERE owner=? ORDER BY created_at DESC LIMIT 50",
      )
      .all(address);
    return c.json({
      orders: rows.map((r) => JSON.parse(r.data) as SpendOrder),
    });
  });
  app.post("/api/spend/orders", async (c) => {
    if (!provider)
      return c.json({ error: "Checkout is not available yet." }, 503);
    const parsed = requestSchema.safeParse(
      await c.req.json().catch(() => null),
    );
    if (!parsed.success)
      return c.json({ error: "Check the product, amount and country." }, 400);
    const input: SpendRequest = parsed.data;
    const fingerprint = spendPurpose(input);
    const owner = (await deps.requireAuth(c, fingerprint)).toLowerCase();
    authorizeVault(db, input.vault, owner, true);
    const existing = db
      .query<Row, [string, string]>(
        "SELECT * FROM spend_orders WHERE owner=? AND request_key=?",
      )
      .get(owner, input.key);
    if (existing)
      return existing.fingerprint === fingerprint
        ? c.json({ order: JSON.parse(existing.data) })
        : c.json(
            { error: "This checkout reference belongs to another order." },
            409,
          );
    let product;
    try {
      product = (await provider.catalog(input.country)).find(
        (p) =>
          p.id === input.product &&
          p.currency === "USD" &&
          p.country === input.country &&
          p.values.includes(input.value),
      );
    } catch {
      return c.json(
        { error: "Products could not be checked. Please try again." },
        503,
      );
    }
    if (!product)
      return c.json({ error: "This product or amount is unavailable." }, 400);
    const reward = await deps.rewards?.quote(owner,input.product,input.value,input.rewardOfferId) ?? null;
    const order: SpendOrder = {
      ...(reward ? {reward} : {}),
      id: randomUUID(),
      product,
      value: input.value,
      status: "creating",
      createdAt: now(),
    };
    // Reserve before the external request. A timeout must never automatically create another invoice.
    const reserve = db.transaction(() => {
      if (
        db
          .query("SELECT 1 FROM spend_orders WHERE owner=? AND request_key=?")
          .get(owner, input.key)
      )
        return "duplicate";
      if (
        db
          .query(
            "SELECT 1 FROM spend_orders WHERE owner=? AND json_extract(data,'$.status') IN ('creating','attention')",
          )
          .get(owner)
      )
        return "pending";
      const used = db
        .query<{ total: number }, [string, number]>(
          "SELECT COALESCE(SUM(value),0) AS total FROM spend_orders WHERE owner=? AND created_at>=?",
        )
        .get(owner, now() - 86400000)!.total;
      if (used + input.value > 200) return "limit";
      deps.rewards?.reserve(owner,order.id,reward);
      db.run(
        "INSERT INTO spend_orders(id,owner,request_key,fingerprint,data,created_at,value) VALUES(?,?,?,?,?,?,?)",
        [
          order.id,
          owner,
          input.key,
          fingerprint,
          JSON.stringify(order),
          now(),
          input.value,
        ],
      );
      return "ok";
    })();
    if (reserve !== "ok")
      return c.json(
        {
          error:
            reserve === "limit"
              ? "Your $200 daily checkout limit has been reached."
              : "A checkout is already being checked. Open your orders before trying again.",
        },
        409,
      );
    try {
      const created = await provider.create(product, input.value, owner);
      Object.assign(order, created.order);
      db.run("UPDATE spend_orders SET invoice=?,data=? WHERE id=?", [
        created.invoiceId,
        JSON.stringify(order),
        order.id,
      ]);
      return c.json({ order }, 201);
    } catch (error) {
      order.status = "attention";
      db.run("UPDATE spend_orders SET data=? WHERE id=?", [
        JSON.stringify(order),
        order.id,
      ]);
      return c.json(
        {
          order,
          error:
            error instanceof SpendProviderError
              ? error.message
              : "We could not confirm this checkout. Check your orders before starting another.",
        },
        503,
      );
    }
  });
  app.post("/api/spend/orders/:id/payment", async (c) => {
    const { address } = familySession(c, db, now());
    const row = db
      .query<Row, [string, string]>(
        "SELECT * FROM spend_orders WHERE id=? AND owner=?",
      )
      .get(c.req.param("id"), address);
    if (!provider || !row?.invoice)
      return c.json({ error: "Order unavailable." }, 404);
    const order = JSON.parse(row.data) as SpendOrder;
    if (order.paymentStarted)
      return c.json(
        {
          error:
            "A payment has already been started. Check your order; do not pay again.",
        },
        409,
      );
    try {
      const status = await provider.status(row.invoice);
      if (
        status.status !== "unpaid" ||
        !order.payment ||
        order.payment.expiresAt <= now()
      )
        return c.json({ error: "This order is not accepting payment." }, 409);
      order.paymentStarted = true;
      const changed = db
        .query(
          "UPDATE spend_orders SET data=json_set(data,'$.paymentStarted',json('true')) WHERE id=? AND COALESCE(json_extract(data,'$.paymentStarted'),0)=0",
        )
        .run(order.id);
      if (changed.changes !== 1)
        return c.json({ error: "A payment has already been started." }, 409);
      return c.json({ order });
    } catch {
      return c.json(
        { error: "Payment availability could not be verified." },
        503,
      );
    }
  });
  app.delete("/api/spend/orders/:id/payment", async (c) => {
    // Only used when the wallet explicitly returns user-rejected (4001), never after an RPC timeout.
    const { address } = familySession(c, db, now());
    db.run(
      "UPDATE spend_orders SET data=json_set(data,'$.paymentStarted',json('false')) WHERE id=? AND owner=? AND json_extract(data,'$.status')='unpaid'",
      [c.req.param("id"), address],
    );
    return c.json({ ok: true });
  });
  app.get("/api/spend/orders/:id", async (c) => {
    const { address } = familySession(c, db, now());
    const row = db
      .query<Row, [string, string]>(
        "SELECT * FROM spend_orders WHERE id=? AND owner=?",
      )
      .get(c.req.param("id"), address);
    if (!row) return c.json({ error: "Order unavailable." }, 404);
    const order = JSON.parse(row.data) as SpendOrder;
    if (
      !provider ||
      !row.invoice ||
      (order.status !== "delivered" &&
        row.checked_at > now() - 10000 &&
        c.req.query("payment") !== "1")
    )
      return c.json({ order });
    // A fresh provider status is required for the explicit payment preflight.
    try {
      const status = await provider.status(row.invoice);
      Object.assign(order, status);
      if (
        order.status === "unpaid" &&
        order.payment &&
        order.payment.expiresAt <= now()
      )
        order.status = "expired";
      const persisted = { ...order };
      delete persisted.redemption; // Codes are never stored in the database.
      // A status fetch can finish after another tab reserves a payment. Preserve
      // the current database flag instead of writing the snapshot read above.
      db.run(
        "UPDATE spend_orders SET data=json_set(?,'$.paymentStarted',json(CASE WHEN json_extract(data,'$.paymentStarted') THEN 'true' ELSE 'false' END)),checked_at=? WHERE id=?",
        [JSON.stringify(persisted), now(), order.id],
      );
      const saved = db
        .query<{ data: string }, [string]>(
          "SELECT data FROM spend_orders WHERE id=?",
        )
        .get(order.id)!;
      order.paymentStarted = (
        JSON.parse(saved.data) as SpendOrder
      ).paymentStarted;
      return c.json({ order });
    } catch {
      return c.json(
        { error: "Order status could not be verified. Please try again." },
        503,
      );
    }
  });
}
