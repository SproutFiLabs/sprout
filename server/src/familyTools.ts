import { bodyLimit } from "hono/body-limit";
import { randomUUID } from "node:crypto";
import {
  createPublicClient,
  decodeEventLog,
  erc20Abi,
  http,
  type Address,
  type Hex,
} from "viem";
import { base } from "viem/chains";
import { z } from "zod";
import type { Context, Hono } from "hono";
import {
  assetPassport,
  FAMILY_SOURCES,
  ledgerCsv,
  SPEND_USDC,
  rewardCents,
  type LedgerEntry,
  type FamilyPlan,
  type InvestmentProvider,
  type RewardOffer,
  type RewardClaim,
  type RewardQuote,
} from "@sprout/shared";
import type { SproutDb } from "./db";
import type { HolderChecker } from "./holders";
import { familySession } from "./privacy";
import { AuthError } from "./auth";

const cents = z.number().int().min(0).max(99_999_999_999);
const address = z.string().regex(/^0x[\da-fA-F]{40}$/);
const hash = z.string().regex(/^0x[\da-fA-F]{64}$/);
export const ledgerSchema = z
  .object({
    id: z
      .string()
      .min(1)
      .max(100)
      .regex(/^[\w:.-]+$/),
    date: z.string().datetime(),
    kind: z.enum(["purchase", "sale", "spend", "transfer", "gift", "reward"]),
    asset: z
      .string()
      .trim()
      .min(1)
      .max(20)
      .regex(/^[a-zA-Z0-9._-]+$/),
    quantity: z.string().regex(/^\d{1,30}(\.\d{1,18})?$/),
    chainId: z.number().int().positive().max(2147483647),
    wallet: address,
    usdCents: cents.nullable(),
    basisCents: cents.nullable(),
    feeCents: cents,
    txHash: hash.optional(),
    note: z.string().max(300),
    source: z.enum(["manual", "import", "spend", "harvest", "rewards"]),
  })
  .strict();
const planSchema = z
  .object({
    goal: z.string().trim().min(2).max(80),
    targetCents: cents.min(100),
    horizon: z.number().int().min(1).max(30),
    account: z.enum(["parent", "custodial"]),
    state: z.string().regex(/^[A-Z]{2}$/),
    adult: z.literal(true),
  })
  .strict();
export const US_STATES =
  "AL AK AZ AR CA CO CT DE FL GA HI ID IL IN IA KS KY LA ME MD MA MI MN MS MO MT NE NV NH NJ NM NY NC ND OH OK OR PA RI SC SD TN TX UT VT VA WA WV WI WY DC".split(
    " ",
  );
export interface RewardsRail {
  treasury: string;
  balance(): Promise<bigint>;
  verify(
    tx: string,
    index: number,
    recipient: string,
    amount: bigint,
    after: number,
  ): Promise<void>;
}
/** Read-only chain adapter. No signing key or transfer capability. */
export function rewardsRail(
  env: Record<string, string | undefined>,
): RewardsRail | undefined {
  if (env.SPROUT_REWARDS_ENABLED !== "true") return;
  const treasury = address.parse(env.SPROUT_REWARDS_TREASURY).toLowerCase();
  const client = createPublicClient({
    chain: base,
    transport: http(env.SPROUT_REWARDS_RPC_URL || "https://mainnet.base.org", {
      timeout: 12000,
      retryCount: 0,
    }),
  });
  return {
    treasury,
    async balance() {
      if ((await client.getChainId()) !== 8453)
        throw new Error("Wrong reward network.");
      return client.readContract({
        address: SPEND_USDC,
        abi: erc20Abi,
        functionName: "balanceOf",
        args: [treasury as Address],
        blockTag: "finalized",
      });
    },
    async verify(tx, index, recipient, amount, after) {
      if ((await client.getChainId()) !== 8453)
        throw new Error("Wrong reward network.");
      const receipt = await client.getTransactionReceipt({ hash: tx as Hex });
      const [finalized, block] = await Promise.all([
        client.getBlock({ blockTag: "finalized" }),
        client.getBlock({ blockNumber: receipt.blockNumber }),
      ]);
      if (
        receipt.status !== "success" ||
        receipt.blockNumber > finalized.number ||
        receipt.blockHash !== block.hash ||
        Number(block.timestamp) * 1000 < after
      )
        throw new Error(
          "Payment is not a finalized successful transfer after confirmation.",
        );
      const log = receipt.logs.find(
        (l) =>
          l.logIndex === index &&
          l.address.toLowerCase() === SPEND_USDC.toLowerCase(),
      );
      if (!log) throw new Error("USDC transfer not found.");
      const decoded = decodeEventLog({
        abi: erc20Abi,
        data: log.data,
        topics: log.topics,
      });
      if (
        decoded.eventName !== "Transfer" ||
        decoded.args.from.toLowerCase() !== treasury ||
        decoded.args.to.toLowerCase() !== recipient.toLowerCase() ||
        decoded.args.value !== amount
      )
        throw new Error("Transfer sender, recipient or amount does not match.");
    },
  };
}
export function loadInvestmentProvider(
  env: Record<string, string | undefined>,
  now: number,
): InvestmentProvider | null {
  if (!env.SPROUT_US_PROVIDER_JSON) return null;
  try {
    const p = z
      .object({
        name: z.string().min(2).max(80),
        url: z.string().url(),
        disclosureUrl: z.string().url(),
        states: z.array(z.enum(US_STATES as [string, ...string[]])).min(1),
        reviewedAt: z.string().datetime(),
        validUntil: z.string().datetime(),
        approved: z.literal(true),
      })
      .strict()
      .parse(JSON.parse(env.SPROUT_US_PROVIDER_JSON));
    if (
      ![p.url, p.disclosureUrl].every(
        (u) =>
          new URL(u).protocol === "https:" &&
          !new URL(u).username &&
          !new URL(u).password,
      ) ||
      Date.parse(p.validUntil) <= now ||
      Date.parse(p.reviewedAt) > now
    )
      return null;
    return {
      name: p.name,
      url: p.url,
      disclosureUrl: p.disclosureUrl,
      states: p.states,
      reviewedAt: p.reviewedAt,
      validUntil: p.validUntil,
    };
  } catch {
    return null;
  }
}
type DataRow = { id: string; owner: string; data: string };
export function ensureToolsTables(db: SproutDb) {
  db.run(`CREATE TABLE IF NOT EXISTS family_ledger(id TEXT NOT NULL,owner TEXT NOT NULL,data TEXT NOT NULL,PRIMARY KEY(owner,id));
  CREATE TABLE IF NOT EXISTS family_plans(owner TEXT PRIMARY KEY,data TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS reward_offers(id TEXT PRIMARY KEY,data TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS reward_claims(id TEXT PRIMARY KEY,order_id TEXT UNIQUE NOT NULL,owner TEXT NOT NULL,data TEXT NOT NULL,tx_hash TEXT,log_index INTEGER,UNIQUE(tx_hash,log_index));
  CREATE TABLE IF NOT EXISTS tools_audit(id INTEGER PRIMARY KEY AUTOINCREMENT,action TEXT NOT NULL,detail TEXT NOT NULL,created_at INTEGER NOT NULL);`);
}
export function ledgerEntries(db: SproutDb, owner: string): LedgerEntry[] {
  return db
    .query<DataRow, [string]>("SELECT * FROM family_ledger WHERE owner=?")
    .all(owner.toLowerCase())
    .map((r) => JSON.parse(r.data))
    .sort((a, b) => b.date.localeCompare(a.date));
}
function offers(db: SproutDb): RewardOffer[] {
  return db
    .query<{ data: string }, []>("SELECT data FROM reward_offers")
    .all()
    .map((r) => JSON.parse(r.data));
}
function claims(db: SproutDb, owner?: string): RewardClaim[] {
  return (
    owner
      ? db
          .query<{ data: string }, [string]>(
            "SELECT data FROM reward_claims WHERE owner=?",
          )
          .all(owner)
      : db.query<{ data: string }, []>("SELECT data FROM reward_claims").all()
  ).map((r) => JSON.parse(r.data));
}
export async function premiumAccess(holders: HolderChecker, owner: string) {
  const s = await holders.status(owner);
  return (
    s.enabled && BigInt(s.heldBalance) >= 1_000_000n * 10n ** BigInt(s.decimals)
  );
}
function putEntry(db: SproutDb, owner: string, e: LedgerEntry) {
  db.run("INSERT OR IGNORE INTO family_ledger(id,owner,data) VALUES(?,?,?)", [
    e.id,
    owner,
    JSON.stringify(e),
  ]);
}
export function explainContext(
  db: SproutDb,
  owner: string,
  kind: string,
  id: string,
  assets: { symbol: string; address: string }[],
  chainId: number,
) {
  if (kind === "asset") {
    const asset = assets.find((a) => a.symbol === id);
    if (!asset) throw new AuthError("Asset unavailable.", 404);
    return {
      title: `${id} Asset Passport`,
      facts: assetPassport(asset, chainId),
      sources: [FAMILY_SOURCES[0], FAMILY_SOURCES[2]],
    };
  }
  if (kind === "ledger") {
    const entry = ledgerEntries(db, owner).find((e) => e.id === id);
    if (!entry) throw new AuthError("Record unavailable.", 404);
    const { wallet, txHash, ...facts } = entry;
    return {
      title: `${entry.asset} ${entry.kind} record`,
      facts,
      sources: [FAMILY_SOURCES[1]],
    };
  }
  if (kind === "reward") {
    const claim = claims(db, owner).find((c) => c.id === id);
    if (!claim) throw new AuthError("Reward unavailable.", 404);
    return {
      title: "Purchase reward",
      facts: {
        cents: claim.cents,
        status: claim.status,
        createdAt: claim.createdAt,
      },
      sources: [FAMILY_SOURCES[1]],
    };
  }
  throw new AuthError("Unknown context.", 400);
}
export function createRewards(
  db: SproutDb,
  holders: HolderChecker,
  rail: RewardsRail | undefined,
  now: () => number,
) {
  ensureToolsTables(db);
  const quote = async (
    owner: string,
    product: string,
    value: number,
    offerId?: string,
  ): Promise<RewardQuote | null> => {
    if (!offerId) return null;
    if (!rail || !(await premiumAccess(holders, owner)))
      throw new AuthError(
        "This offer requires verified eligible holder access.",
        403,
      );
    const offer = offers(db).find(
      (o) =>
        o.id === offerId &&
        o.product === product &&
        o.endsAt > now() &&
        o.treasury.toLowerCase() === rail.treasury.toLowerCase(),
    );
    if (!offer)
      throw new AuthError("This offer has ended or is unavailable.", 409);
    const amount = rewardCents(value, offer.rateBps);
    if (amount < 1 || amount > offer.budgetCents - offer.reservedCents)
      throw new AuthError("This offer’s remaining budget is too small.", 409);
    const unpaid = claims(db)
      .filter((c) => c.status === "pending" || c.status === "confirmed")
      .reduce((n, c) => n + c.cents, 0);
    if ((await rail.balance()) < BigInt(unpaid + amount) * 10000n)
      throw new AuthError("Reward funding cannot cover this checkout.", 409);
    return {
      offerId: offer.id,
      title: offer.title,
      cents: amount,
      rateBps: offer.rateBps,
      terms: offer.terms,
    };
  };
  const reserve = (owner: string, orderId: string, q: RewardQuote | null) => {
    if (!q) return;
    const offer = offers(db).find(
      (o) => o.id === q.offerId && o.endsAt > now(),
    );
    if (!offer || q.cents > offer.budgetCents - offer.reservedCents)
      throw new AuthError(
        "This offer’s budget has been reserved. Please try again.",
        409,
      );
    offer.reservedCents += q.cents;
    db.run("UPDATE reward_offers SET data=? WHERE id=?", [
      JSON.stringify(offer),
      offer.id,
    ]);
    const claim: RewardClaim = {
      id: randomUUID(),
      orderId,
      offerId: offer.id,
      owner,
      cents: q.cents,
      status: "pending",
      createdAt: now(),
    };
    db.run(
      "INSERT INTO reward_claims(id,order_id,owner,data) VALUES(?,?,?,?)",
      [claim.id, orderId, owner, JSON.stringify(claim)],
    );
  };
  return { quote, reserve };
}
export function registerFamilyTools(
  app: Hono,
  deps: {
    db: SproutDb;
    holders: HolderChecker;
    now?: () => number;
    rail?: RewardsRail;
    assets: { symbol: string; address: string }[];
    chainId: number;
    provider?: InvestmentProvider | null;
    requireAdmin: (c: Context) => void;
  },
) {
  const { db } = deps,
    now = () => deps.now?.() ?? Date.now();
  ensureToolsTables(db);
  app.use(
    "/api/family-tools/*",
    bodyLimit({
      maxSize: 1_000_000,
      onError: (c) => c.json({ error: "Request too large." }, 413),
    }),
  );
  const owner = (c: Context) => familySession(c, db, now()).address;
  const audit = (action: string, detail: unknown) =>
    db.run("INSERT INTO tools_audit(action,detail,created_at) VALUES(?,?,?)", [
      action,
      JSON.stringify(detail),
      now(),
    ]);
  app.get("/api/family-tools/public", (c) =>
    c.json({
      passports: deps.assets.map((a) => assetPassport(a, deps.chainId)),
      offers: offers(db).filter(
        (o) => o.endsAt > now() && o.budgetCents > o.reservedCents,
      ),
      rewardReady: !!deps.rail,
      provider:
        deps.provider && Date.parse(deps.provider.validUntil) > now()
          ? deps.provider
          : null,
      sources: FAMILY_SOURCES,
    }),
  );
  app.get("/api/family-tools", (c) => {
    const who = owner(c);
    return (async () =>
      c.json({
        entries: ledgerEntries(db, who),
        claims: claims(db, who),
        offers: offers(db).filter((o) => o.endsAt > now()),
        plan: JSON.parse(
          db
            .query<{ data: string }, [string]>(
              "SELECT data FROM family_plans WHERE owner=?",
            )
            .get(who)?.data ?? "null",
        ),
        premium: await premiumAccess(deps.holders, who).catch(() => false),
        rewardReady: !!deps.rail,
      }))();
  });
  app.post("/api/family-tools/ledger", async (c) => {
    const who = owner(c);
    const parsed = z
      .object({ entries: z.array(ledgerSchema).min(1).max(500) })
      .strict()
      .safeParse(await c.req.json().catch(() => null));
    if (!parsed.success)
      return c.json(
        {
          error: "Use the ledger template: up to 500 valid records per import.",
        },
        400,
      );
    const existing = ledgerEntries(db, who);
    if (existing.length + parsed.data.entries.length > 5000)
      return c.json(
        { error: "The 5,000-record family limit has been reached." },
        409,
      );
    let added = 0;
    db.transaction(() => {
      for (const e of parsed.data.entries) {
        const r = db
          .query(
            "INSERT OR IGNORE INTO family_ledger(id,owner,data) VALUES(?,?,?)",
          )
          .run(
            e.id,
            who,
            JSON.stringify({
              ...e,
              source: e.source === "manual" ? "manual" : "import",
            }),
          );
        added += r.changes;
      }
    })();
    return c.json({ added, duplicates: parsed.data.entries.length - added });
  });
  app.patch("/api/family-tools/ledger/:id", async (c) => {
    const who = owner(c),
      id = c.req.param("id");
    const p = z
      .object({
        basisCents: cents.nullable(),
        usdCents: cents.nullable(),
        feeCents: cents,
        date: z.string().datetime().optional(),
        note: z.string().max(300).optional(),
        txHash: hash.optional(),
      })
      .strict()
      .safeParse(await c.req.json().catch(() => null));
    if (!p.success) return c.json({ error: "Check the dollar amounts." }, 400);
    const row = db
      .query<DataRow, [string, string]>(
        "SELECT * FROM family_ledger WHERE owner=? AND id=?",
      )
      .get(who, id);
    if (!row) return c.json({ error: "Record unavailable." }, 404);
    const e: LedgerEntry = { ...JSON.parse(row.data), ...p.data };
    db.run("UPDATE family_ledger SET data=? WHERE owner=? AND id=?", [
      JSON.stringify(e),
      who,
      id,
    ]);
    return c.json({ entry: e });
  });
  app.delete("/api/family-tools/ledger/:id", (c) => {
    const who = owner(c);
    db.run("DELETE FROM family_ledger WHERE owner=? AND id=?", [
      who,
      c.req.param("id"),
    ]);
    return c.json({ ok: true });
  });
  app.get("/api/family-tools/ledger.csv", async (c) => {
    const who = owner(c),
      advanced = c.req.query("advanced") === "1";
    if (advanced && !(await premiumAccess(deps.holders, who)))
      return c.json(
        { error: "Advanced reconciliation requires holder access." },
        403,
      );
    c.header("Content-Type", "text/csv; charset=utf-8");
    c.header(
      "Content-Disposition",
      'attachment; filename="sprout-family-ledger.csv"',
    );
    return c.body(ledgerCsv(ledgerEntries(db, who), advanced));
  });
  app.post("/api/family-tools/sync", (c) => {
    const who = owner(c);
    let added = 0;
    const before = ledgerEntries(db, who).length;
    for (const row of db
      .query<{ id: string; data: string }, [string]>(
        "SELECT id,data FROM spend_orders WHERE owner=?",
      )
      .all(who)) {
      const o = JSON.parse(row.data);
      if (o.status === "delivered")
        putEntry(db, who, {
          id: `spend:${row.id}`,
          date: new Date(o.createdAt).toISOString(),
          kind: "spend",
          asset: "USDC",
          quantity: String(o.payment?.amount ?? o.value),
          chainId: 8453,
          wallet: who,
          usdCents: null,
          basisCents: null,
          feeCents: 0,
          note: `${o.product.name}: nominal order $${o.value}. Add actual transaction time, USD value, basis and fees from your wallet receipt.`,
          source: "spend",
        });
    }
    for (const c of claims(db, who).filter((c) => c.status === "paid"))
      putEntry(db, who, {
        id: `reward:${c.id}`,
        date: new Date(c.createdAt).toISOString(),
        kind: "reward",
        asset: "USDC",
        quantity: (c.cents / 100).toFixed(2),
        chainId: 8453,
        wallet: who,
        usdCents: null,
        basisCents: null,
        feeCents: 0,
        txHash: c.txHash,
        note: "Purchase rebate receipt. Review payment date, fair market value and tax treatment with your accountant.",
        source: "rewards",
      });
    for (const r of db
      .query<
        {
          round_id: string;
          amount: string;
          tx_hash: string;
          paid_at: number;
          data: string;
        },
        [string]
      >(
        "SELECT r.round_id,r.amount,r.tx_hash,r.paid_at,h.data FROM harvest_registrations r JOIN harvest_rounds h ON h.id=r.round_id WHERE r.address=? AND r.paid_at IS NOT NULL",
      )
      .all(who)) {
      const round = JSON.parse(r.data);
      const decimals = round.payoutDecimals ?? round.decimals;
      if (!Number.isInteger(decimals) || decimals < 0 || decimals > 18)
        continue;
      const raw = BigInt(r.amount),
        unit = 10n ** BigInt(decimals);
      putEntry(db, who, {
        id: `harvest:${r.round_id}`,
        date: new Date(r.paid_at).toISOString(),
        kind: "reward",
        asset: round.symbol ?? "TOKEN",
        quantity: `${raw / unit}.${(raw % unit).toString().padStart(decimals, "0")}`,
        chainId: round.chainId ?? deps.chainId,
        wallet: who,
        usdCents: null,
        basisCents: null,
        feeCents: 0,
        txHash: r.tx_hash,
        note: "Verified Harvest payment. Add historical USD value and review tax treatment.",
        source: "harvest",
      });
    }
    added = ledgerEntries(db, who).length - before;
    return c.json({ added });
  });
  app.put("/api/family-tools/plan", async (c) => {
    const who = owner(c),
      p = planSchema.safeParse(await c.req.json().catch(() => null));
    if (!p.success || !US_STATES.includes(p.data.state))
      return c.json(
        {
          error:
            "Complete the adult-owned planning form with a valid US state.",
        },
        400,
      );
    const plan: FamilyPlan = { ...p.data, savedAt: now() };
    db.run(
      "INSERT INTO family_plans VALUES(?,?) ON CONFLICT(owner) DO UPDATE SET data=excluded.data",
      [who, JSON.stringify(plan)],
    );
    return c.json({ plan });
  });
  app.delete("/api/family-tools/plan", (c) => {
    db.run("DELETE FROM family_plans WHERE owner=?", [owner(c)]);
    return c.json({ ok: true });
  });
  app.post("/api/family-tools/provider-handoff", (c) => {
    const who = owner(c),
      r = db
        .query<{ data: string }, [string]>(
          "SELECT data FROM family_plans WHERE owner=?",
        )
        .get(who);
    const p = r ? (JSON.parse(r.data) as FamilyPlan) : null;
    if (
      !p ||
      !deps.provider ||
      Date.parse(deps.provider.validUntil) <= now() ||
      !deps.provider.states.includes(p.state)
    )
      return c.json(
        {
          error:
            "An approved provider is not available for this plan. No investment account has been opened.",
        },
        409,
      );
    return c.json({
      url: deps.provider.url,
      name: deps.provider.name,
      disclosureUrl: deps.provider.disclosureUrl,
    });
  });
  app.get("/api/family-tools/context", (c) =>
    c.json(
      explainContext(
        db,
        owner(c),
        c.req.query("kind") ?? "",
        c.req.query("id") ?? "",
        deps.assets,
        deps.chainId,
      ),
    ),
  );
  app.post("/api/family-tools/rewards/:id/confirm", (c) => {
    const who = owner(c),
      claim = claims(db, who).find((r) => r.id === c.req.param("id"));
    if (!claim) return c.json({ error: "Reward unavailable." }, 404);
    if (claim.status !== "pending") return c.json({ claim });
    const order = db
      .query<{ data: string }, [string, string]>(
        "SELECT data FROM spend_orders WHERE id=? AND owner=?",
      )
      .get(claim.orderId, who);
    if (!order || JSON.parse(order.data).status !== "delivered")
      return c.json(
        {
          error:
            "The shop must confirm delivery before this reward can be confirmed.",
        },
        409,
      );
    claim.status = "confirmed";
    claim.createdAt = now();
    db.run("UPDATE reward_claims SET data=? WHERE id=?", [
      JSON.stringify(claim),
      claim.id,
    ]);
    return c.json({ claim });
  });
  app.get("/api/family-tools/operator", (c) => {
    deps.requireAdmin(c);
    return c.json({ offers: offers(db), claims: claims(db) });
  });
  app.post("/api/family-tools/operator/offers", async (c) => {
    deps.requireAdmin(c);
    if (!deps.rail)
      return c.json({ error: "Configure a reward treasury first." }, 503);
    const p = z
      .object({
        title: z.string().trim().min(3).max(80),
        product: z.string().min(1).max(150),
        rateBps: z.number().int().min(1).max(2000),
        budgetCents: cents.min(1),
        endsAt: z.number().int(),
        terms: z.string().trim().min(20).max(1000),
      })
      .strict()
      .safeParse(await c.req.json().catch(() => null));
    if (
      !p.success ||
      p.data.endsAt <= now() ||
      p.data.endsAt > now() + 90 * 86400000
    )
      return c.json(
        { error: "Check offer terms, budget and expiry (within 90 days)." },
        400,
      );
    const balance = await deps.rail.balance();
    const offer: RewardOffer = {
      ...p.data,
      id: randomUUID(),
      reservedCents: 0,
      treasury: deps.rail.treasury,
      createdAt: now(),
    };
    db.transaction(() => {
      const liabilities =
        claims(db)
          .filter((c) => c.status === "pending" || c.status === "confirmed")
          .reduce((n, c) => n + c.cents, 0) +
        offers(db)
          .filter((o) => o.endsAt > now())
          .reduce((n, o) => n + o.budgetCents - o.reservedCents, 0);
      if (BigInt(liabilities + offer.budgetCents) * 10000n > balance)
        throw new AuthError(
          "Treasury balance cannot cover existing commitments and this offer.",
          409,
        );
      db.run("INSERT INTO reward_offers VALUES(?,?)", [
        offer.id,
        JSON.stringify(offer),
      ]);
      audit("offer-created", { id: offer.id });
    })();
    return c.json({ offer }, 201);
  });
  app.post("/api/family-tools/operator/payments", async (c) => {
    deps.requireAdmin(c);
    const p = z
      .object({
        claimId: z.string(),
        txHash: hash,
        logIndex: z.number().int().min(0),
      })
      .strict()
      .safeParse(await c.req.json().catch(() => null));
    if (!p.success || !deps.rail)
      return c.json(
        { error: "Check the receipt and reward configuration." },
        400,
      );
    const claim = claims(db).find((r) => r.id === p.data.claimId);
    if (!claim || claim.status !== "confirmed")
      return c.json(
        { error: "Only a confirmed unpaid reward can be reconciled." },
        409,
      );
    try {
      await deps.rail.verify(
        p.data.txHash,
        p.data.logIndex,
        claim.owner,
        BigInt(claim.cents) * 10000n,
        claim.createdAt,
      );
    } catch {
      return c.json(
        {
          error:
            "Receipt could not be verified. Check the network, finalized transfer, sender, recipient and exact amount.",
        },
        409,
      );
    }
    try {
      db.transaction(() => {
        const current = claims(db).find((r) => r.id === claim.id);
        if (current?.status !== "confirmed") throw new Error();
        Object.assign(claim, {
          status: "paid",
          txHash: p.data.txHash.toLowerCase(),
          logIndex: p.data.logIndex,
        });
        db.run(
          "UPDATE reward_claims SET data=?,tx_hash=?,log_index=? WHERE id=?",
          [JSON.stringify(claim), claim.txHash!, claim.logIndex!, claim.id],
        );
        audit("reward-paid", { id: claim.id, tx: claim.txHash });
      })();
    } catch {
      return c.json(
        { error: "This reward or transfer has already been reconciled." },
        409,
      );
    }
    return c.json({ claim });
  });
}
