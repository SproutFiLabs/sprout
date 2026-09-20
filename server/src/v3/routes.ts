import { matchingAbi } from "./chain";
import { expansionConfig } from "./config";
export { expansionConfig } from "./config";
import type { Hono, Context } from "hono";
import { bodyLimit } from "hono/body-limit";
import { z } from "zod";
import { randomBytes, createHash } from "node:crypto";
import {
  parseAbi,
  BaseError,
  decodeEventLog,
  zeroAddress,
  type Hex,
  type Address,
} from "viem";
import {
  EXPANSION_PAGES,
  arenaReadiness,
  roundupDelta,
  type GrowthEvent,
  type RoundupSettings,
  type RoundupEntry,
  type ArenaAccount,
  type ArenaLeague,
  type V3PublicConfig,
  type ExpansionPage,
} from "@sprout/shared";
import { familySession } from "../privacy";
import { AuthError } from "../auth";
import type { SproutDb } from "../db";
import type { ChainContext } from "../chain";
import { ExpansionStore } from "./store";
import { ExpansionChain, giftLog, cents, transferLog } from "./chain";
import { observe } from "./worker";
import { LESSONS, mirrorAccount, fillOrder, replay } from "./arena";

export interface ExpansionDeps {
  db: SproutDb;
  chain: ChainContext;
  localDemo: boolean;
  now?: () => number;
}
const addr = z
  .string()
  .regex(/^0x[0-9a-fA-F]{40}$/)
  .transform((x) => x.toLowerCase());
const hash = z.string().regex(/^0x[0-9a-fA-F]{64}$/);
const amount = z.number().int().min(1).max(100_000_000);
const id = z.string().regex(/^[a-zA-Z0-9-]{8,80}$/);
const text = (max: number) =>
  z
    .string()
    .trim()
    .min(1)
    .max(max)
    .refine(
      (s) => !/[\u0000-\u001f\u202a-\u202e]|https?:|www\./i.test(s),
      "Use plain text without links.",
    );
const actionInputs: Record<string, z.ZodTypeAny> = {
  match: z
    .object({
      budgetCents: amount,
      capCents: amount,
      periods: z.number().int().min(1).max(24),
    })
    .strict()
    .refine(
      (v) => v.capCents <= v.budgetCents,
      "The cap cannot exceed the funded budget.",
    ),
  "cancel-match": z.object({ id: z.string().regex(/^\d{1,30}$/) }).strict(),
  fund: z.object({ amountCents: amount }).strict(),
  gift: z.object({ amountCents: amount, giftRef: hash, eventId: id }).strict(),
  "roundup-link": z
    .object({
      capCents: amount,
      allowanceCents: amount,
      expiresAt: z.number().int().positive(),
    })
    .strict()
    .refine(
      (v) => v.allowanceCents >= v.capCents,
      "Allowance must cover one weekly cap.",
    ),
  "roundup-unlink": z.object({}).strict(),
  "cash-toggle": z.object({ enabled: z.boolean() }).strict(),
  park: z.object({ amountCents: amount }).strict(),
  unpark: z.object({ amountCents: amount }).strict(),
  plan: z
    .object({
      successor: addr,
      coGuardian: addr,
      cadenceDays: z.number().int().min(7).max(366),
      graceDays: z.number().int().min(2).max(90),
      earlyGraduation: z.number().int().nonnegative(),
      hash,
      installmentCents: amount,
      periodDays: z.number().int().min(7).max(366),
    })
    .strict(),
  "check-in": z.object({}).strict(),
  revoke: z.object({}).strict(),
  "cancel-claim": z.object({}).strict(),
  arm: z.object({}).strict(),
  activate: z.object({}).strict(),
  reserve: z.object({ amountCents: amount }).strict(),
  "refund-reserve": z.object({ amountCents: amount }).strict(),
  invest: z.object({ amountCents: amount }).strict(),
};
export function registerExpansion(
  app: Hono,
  deps: ExpansionDeps,
  env: Record<string, string | undefined> = process.env,
) {
  const config = expansionConfig(
    env,
    deps.chain.config.chain.chainId,
    deps.localDemo,
  );
  const chain = new ExpansionChain(deps.chain, config);
  let store: ExpansionStore | null = null;
  if (config.enabled) {
    const key = env.SPROUT_V3_DATA_KEY;
    if (key && /^[0-9a-fA-F]{64}$/.test(key))
      store = new ExpansionStore(deps.db, Buffer.from(key, "hex"));
    else config.enabled = false;
  }
  const db = () => {
    if (!store)
      throw new AuthError(
        "The expansion is waiting for its private-data configuration.",
        503,
      );
    return store;
  };
  const now = () => deps.now?.() ?? Date.now();
  const actor = (c: Context) => familySession(c, deps.db, now()).address;
  const enabled = (page: ExpansionPage) => {
    if (!config.enabled || !config.flags[page])
      throw new AuthError(
        "This feature is not enabled for this deployment.",
        503,
      );
  };
  const body = async <T>(c: Context, schema: z.ZodType<T>) => {
    if (Number(c.req.header("content-length") ?? 0) > 32_768)
      throw new AuthError("This request is too large.", 413);
    let value;
    try {
      const raw = await c.req.text();
      if (raw.length > 32_768) throw Error();
      value = JSON.parse(raw);
    } catch {
      throw new AuthError("Send a valid, bounded JSON request.", 400);
    }
    const parsed = schema.safeParse(value);
    if (!parsed.success)
      throw new AuthError(
        parsed.error.issues.map((i) => i.message).join(" "),
        400,
      );
    return parsed.data;
  };
  const getFamily = async (c: Context, vault: string, parentOnly = false) => {
    const wallet = actor(c);
    const s = await chain.state(addr.parse(vault), wallet);
    if (
      wallet !== s.parent.toLowerCase() &&
      (parentOnly || wallet !== s.beneficiary.toLowerCase())
    )
      throw new AuthError("This family workspace is unavailable.", 403);
    return { wallet, s, owner: s.parent.toLowerCase() };
  };
  const getEvent = (eventId: string) => {
    const lookup = db().get<{ owner: string }>("event-links", "index", eventId);
    if (!lookup) return null;
    const event = db().get<GrowthEvent>(lookup.owner, "event", eventId);
    return event ? { owner: lookup.owner, event } : null;
  };
  const leagueScore = (member: string, league: string) => {
    const saved = db().get<{ score: number; owner?: string; vault?: string }>(
      member,
      "league-score",
      league,
    );
    if (saved?.owner && saved.vault) {
      const a = db().get<ArenaAccount>(saved.owner, "arena", saved.vault);
      return a ? arenaReadiness(a) : 0;
    }
    return saved?.score ?? 0;
  };
  const publicEvent = (e: GrowthEvent) => ({
    ...e,
    guests: e.publicWall ? e.guests : [],
  });
  const handle =
    (fn: (c: Context) => Promise<Response> | Response) =>
    async (c: Context) => {
      try {
        return await fn(c);
      } catch (e) {
        if (e instanceof AuthError) throw e;
        return c.json(
          {
            error:
              e instanceof BaseError
                ? "The chain request could not finish. Check the wallet network and try again."
                : e instanceof z.ZodError
                  ? "Check the submitted fields."
                  : e instanceof Error
                    ? e.message
                    : "This action could not finish.",
          },
          400,
        );
      }
    };
  app.use(
    "/api/v3/*",
    bodyLimit({
      maxSize: 32768,
      onError: (c) => c.json({ error: "This request is too large." }, 413),
    }),
  );
  app.get("/api/v3/config", (c) => c.json(config));
  app.use("/api/v3/*", async (c, next) => {
    c.header("Cache-Control", "no-store");
    c.header("X-Robots-Tag", "noindex, nofollow");
    await next();
  });
  app.get(
    "/api/v3/state",
    handle(async (c) => {
      const wallet = actor(c);
      if (!config.enabled)
        return c.json({
          config,
          vaults: [],
          chain: null,
          events: [],
          roundup: null,
          ledger: [],
          arena: null,
          leagues: [],
        });
      const owned = await chain.vaults(wallet);
      const selected = c.req.query("vault") ?? owned[0];
      const base = {
        config,
        vaults: owned.map((v, i) => ({
          id: v,
          label: `Family sprout ${i + 1}`,
        })),
        chain: null,
        events: [],
        roundup: null,
        ledger: [],
        arena: null,
        leagues: [],
      };
      if (!selected) return c.json(base);
      const s = await chain.state(addr.parse(selected), wallet);
      const isFamily = [s.parent, s.beneficiary].some(
        (a) => a.toLowerCase() === wallet,
      );
      const isSuccessor = [
        s.continuity.successor,
        s.continuity.coGuardian,
      ].some((a) => a.toLowerCase() === wallet);
      if (!isFamily && !isSuccessor)
        throw new AuthError("This workspace is unavailable.", 403);
      const owner = s.parent.toLowerCase();
      const events = isFamily
        ? db()
            .list<GrowthEvent>(owner, "event")
            .filter((e) => e.vault === selected.toLowerCase())
        : [];
      const leagues = db()
        .list<ArenaLeague>("leagues", "league")
        .filter((l) => l.members.some((m) => m.owner === wallet))
        .map((l) => ({
          id: l.id,
          title: l.title,
          ...(l.owner === wallet ? { invite: l.invite } : {}),
          members: l.members.map((m) => ({
            alias: m.alias,
            score: leagueScore(m.owner, l.id),
          })),
        }));
      return c.json({
        ...base,
        vaults: base.vaults.length
          ? base.vaults
          : [
              {
                id: selected,
                label: isFamily ? "Family sprout" : "Successor workspace",
              },
            ],
        chain: s,
        events,
        roundup:
          wallet === owner
            ? db().get<RoundupSettings>(
                owner,
                "roundups",
                selected.toLowerCase(),
              )
            : null,
        ledger:
          wallet === owner
            ? db()
                .list<RoundupEntry>(owner, "roundup-entry")
                .filter((x) => x.vault === selected.toLowerCase())
                .slice(0, 200)
            : [],
        arena: isFamily
          ? db().get<ArenaAccount>(owner, "arena", selected.toLowerCase())
          : null,
        leagues,
      });
    }),
  );
  app.post(
    "/api/v3/transaction",
    handle(async (c) => {
      const wallet = actor(c);
      const p = await body(
        c,
        z
          .object({
            vault: addr,
            action: z.string().max(30),
            input: z.record(z.unknown()),
          })
          .strict(),
      );
      const page: ExpansionPage = p.action.includes("roundup")
        ? "roundups"
        : ["park", "unpark", "cash-toggle"].includes(p.action)
          ? "cash"
          : ["match", "cancel-match", "fund", "gift", "invest"].includes(
                p.action,
              )
            ? "events"
            : "continuity";
      enabled(page);
      const schema = actionInputs[p.action];
      if (!schema) throw Error("Unknown action.");
      const input = schema.parse(p.input) as Record<string, unknown>;
      if (p.action === "gift") {
        const record = getEvent(String(input.eventId));
        if (
          !record ||
          record.event.closed ||
          record.event.endsAt <= now() ||
          record.event.vault !== p.vault ||
          record.event.giftRef !== input.giftRef
        )
          throw Error("This event is no longer accepting gifts.");
      }
      if (
        p.action === "roundup-link" &&
        (Number(input.expiresAt) <= now() + 7 * 86400000 ||
          Number(input.expiresAt) > now() + 366 * 86400000)
      )
        throw Error("Choose an expiry between 8 and 366 days from now.");
      return c.json(await chain.prepare(wallet, p.vault, p.action, input));
    }),
  );
  app.post(
    "/api/v3/events",
    handle(async (c) => {
      enabled("events");
      const p = await body(
        c,
        z
          .object({
            vault: addr,
            kind: z.enum([
              "birthday",
              "baby-shower",
              "graduation",
              "milestone",
            ]),
            title: text(70),
            goalCents: amount,
            endsAt: z.number().int(),
            publicWall: z.boolean(),
          })
          .strict(),
      );
      const { owner } = await getFamily(c, p.vault, true);
      if (p.endsAt <= now() || p.endsAt > now() + 366 * 86400000)
        throw Error("Choose a future date within the next year.");
      if (db().list(owner, "event").length >= 100)
        throw Error("Your family has reached the 100-event limit.");
      const event: GrowthEvent = {
        ...p,
        id: randomBytes(18).toString("hex"),
        giftRef: `0x${randomBytes(32).toString("hex")}`,
        createdAt: now(),
        closed: false,
        raisedCents: 0,
        guests: [],
      };
      db().transaction(() => {
        db().put(owner, "event", event.id, event);
        db().put("event-links", "index", event.id, { owner });
      });
      return c.json(event, 201);
    }),
  );
  app.post(
    "/api/v3/events/:id/close",
    handle(async (c) => {
      enabled("events");
      const record = getEvent(id.parse(c.req.param("id")));
      if (!record) throw Error("This event is unavailable.");
      await getFamily(c, record.event.vault, true);
      record.event.closed = true;
      db().put(record.owner, "event", record.event.id, record.event);
      return c.json({ ok: true });
    }),
  );
  app.get(
    "/api/v3/events/:id",
    handle(async (c) => {
      enabled("events");
      const record = getEvent(id.parse(c.req.param("id")));
      if (!record) return c.json({ error: "This event is unavailable." }, 404);
      return c.json(publicEvent(record.event));
    }),
  );
  app.post(
    "/api/v3/events/:id/receipt",
    handle(async (c) => {
      enabled("events");
      const wallet = actor(c);
      const p = await body(
        c,
        z
          .object({
            txHash: hash,
            alias: text(24).optional(),
            message: text(140).optional(),
            share: z.boolean(),
          })
          .strict(),
      );
      const r = getEvent(id.parse(c.req.param("id")));
      if (!r) throw Error("This event is unavailable.");
      const client = deps.chain.publicClient!;
      const receipt = await client.getTransactionReceipt({
        hash: p.txHash as Hex,
      });
      const latest = await client.getBlockNumber();
      if (
        receipt.status !== "success" ||
        receipt.from.toLowerCase() !== wallet ||
        latest < receipt.blockNumber + BigInt(config.local ? 0 : 5)
      )
        throw Error("Wait for the gift transaction to confirm.");
      const canonical = await client.getBlock({
        blockNumber: receipt.blockNumber,
      });
      if (canonical.hash !== receipt.blockHash)
        throw Error("This receipt is no longer on the canonical chain.");
      const state = await chain.state(r.event.vault, wallet);
      let contribution = 0n;
      let logIndex = -1;
      for (const l of receipt.logs) {
        if (l.address.toLowerCase() !== r.event.vault) continue;
        try {
          const decoded = decodeEventLog({
            abi: giftLog,
            data: l.data,
            topics: l.topics,
          });
          if (
            decoded.args.giftRef === r.event.giftRef &&
            decoded.args.gifter.toLowerCase() === wallet &&
            decoded.args.token.toLowerCase() === state.settlement.toLowerCase()
          ) {
            contribution += decoded.args.amount;
            logIndex = l.logIndex;
          }
        } catch {}
      }
      if (logIndex < 0)
        throw Error("No matching gift was found in this receipt.");
      db().transaction(() => {
        db().claim(`gift:${config.chainId}:${p.txHash.toLowerCase()}`, wallet);
        const fresh = db().get<GrowthEvent>(r.owner, "event", r.event.id)!;
        fresh.raisedCents += cents(contribution, state.settlementDecimals);
        if (p.share && fresh.publicWall && p.alias)
          fresh.guests.push({
            alias: p.alias,
            message: p.message ?? "",
            at: now(),
          });
        db().put(r.owner, "event", fresh.id, fresh);
      });
      return c.json({ ok: true });
    }),
  );
  app.post(
    "/api/v3/roundups/settings",
    handle(async (c) => {
      enabled("roundups");
      const p = await body(
        c,
        z
          .object({
            vault: addr,
            step: z.union([z.literal(1), z.literal(5), z.literal(10)]),
            multiplier: z.union([z.literal(1), z.literal(2), z.literal(3)]),
            capCents: amount,
            enabled: z.boolean(),
          })
          .strict(),
      );
      const { s, owner } = await getFamily(c, p.vault, true);
      if (p.enabled && (!s.roundup.active || s.roundup.capCents !== p.capCents))
        throw Error("Confirm the matching onchain weekly limit first.");
      if (!p.enabled && s.roundup.active)
        throw Error("Unlink the onchain rule before stopping round-ups.");
      const old = db().get<RoundupSettings>(owner, "roundups", p.vault);
      const settings: RoundupSettings = {
        ...p,
        id: s.roundup.id,
        wallet: owner,
        linkedAt: old?.linkedAt ?? now(),
        observedThrough: old?.observedThrough ?? s.block,
      };
      db().put(owner, "roundups", p.vault, settings);
      return c.json(settings);
    }),
  );
  app.post(
    "/api/v3/roundups/sync",
    handle(async (c) => {
      enabled("roundups");
      const p = await body(c, z.object({ vault: addr }).strict());
      const { s, owner } = await getFamily(c, p.vault, true);
      const settings = db().get<RoundupSettings>(owner, "roundups", p.vault);
      if (!settings?.enabled || !s.roundup.active)
        throw Error("Link and enable round-ups first.");
      return c.json({ added: await observe(chain, db(), settings) });
    }),
  );
  app.get("/api/v3/arena/lessons", (c) =>
    c.json(LESSONS.map(({ answer, ...lesson }) => lesson)),
  );
  app.post(
    "/api/v3/matches/receipt",
    handle(async (c) => {
      enabled("events");
      const wallet = actor(c),
        p = await body(c, z.object({ vault: addr, txHash: hash }).strict());
      await chain.validate(p.vault);
      const client = deps.chain.publicClient!,
        receipt = await client.getTransactionReceipt({ hash: p.txHash as Hex }),
        latest = await client.getBlockNumber();
      if (
        receipt.status !== "success" ||
        receipt.from.toLowerCase() !== wallet ||
        latest < receipt.blockNumber + BigInt(config.local ? 0 : 5)
      )
        throw Error("Wait for the matching transaction to confirm.");
      if (
        (await client.getBlock({ blockNumber: receipt.blockNumber })).hash !==
        receipt.blockHash
      )
        throw Error("This receipt is no longer canonical.");
      const abi = parseAbi([
        "event MatchCommitted(uint256 indexed id,address indexed vault,address indexed sponsor,uint256 budget,uint256 cap,uint64 expires)",
      ]);
      let found = false;
      for (const log of receipt.logs) {
        if (log.address.toLowerCase() !== config.matching.toLowerCase())
          continue;
        try {
          const x = decodeEventLog({ abi, data: log.data, topics: log.topics });
          if (
            x.args.sponsor.toLowerCase() === wallet &&
            x.args.vault.toLowerCase() === p.vault
          ) {
            db().put(wallet, "matching-history", x.args.id.toString(), {
              id: x.args.id.toString(),
              vault: p.vault,
              txHash: p.txHash,
            });
            found = true;
          }
        } catch {}
      }
      if (!found)
        throw Error("No matching commitment was found in that receipt.");
      return c.json({ ok: true });
    }),
  );
  app.get(
    "/api/v3/matches",
    handle(async (c) => {
      enabled("events");
      const wallet = actor(c),
        vault = addr.parse(c.req.query("vault")),
        state = await chain.state(vault, wallet);
      const ids = [
        ...new Set([
          ...state.matches.map((m) => m.id),
          ...db()
            .list<{ id: string; vault: string }>(wallet, "matching-history")
            .filter((m) => m.vault === vault)
            .map((m) => m.id),
        ]),
      ].slice(-100);
      const rows = await Promise.all(
        ids.map(async (id) => {
          const m = await chain.read<
            readonly [
              string,
              string,
              string,
              bigint,
              bigint,
              bigint,
              bigint,
              bigint,
              bigint,
              bigint,
              boolean,
            ]
          >(config.matching, matchingAbi, "commitments", [BigInt(id)]);
          if (m[0].toLowerCase() !== wallet || m[1].toLowerCase() !== vault)
            return null;
          return {
            id,
            sponsor: m[0],
            capCents: cents(m[3], state.settlementDecimals),
            remainingCents: cents(m[4], state.settlementDecimals),
            matchedCents: cents(m[5], state.settlementDecimals),
            expires: Number(m[7]) * 1000,
            cancelled: m[10],
          };
        }),
      );
      return c.json(rows.filter(Boolean));
    }),
  );
  app.post(
    "/api/v3/arena/start",
    handle(async (c) => {
      enabled("arena");
      const p = await body(c, z.object({ vault: addr }).strict());
      const { s, owner } = await getFamily(c, p.vault);
      const old = db().get<ArenaAccount>(owner, "arena", p.vault);
      if (old) return c.json(old);
      if (
        !s.market.length ||
        s.market.some((a) => a.priceCents <= 0 || a.status === "unavailable")
      )
        throw Error("Wait for available portfolio prices before mirroring.");
      const a = mirrorAccount(
        p.vault,
        s.market,
        s.balanceCents + s.cash.valueCents,
        s.block,
        now(),
      );
      db().put(owner, "arena", p.vault, a);
      return c.json(a, 201);
    }),
  );
  app.post(
    "/api/v3/arena/order",
    handle(async (c) => {
      enabled("arena");
      const p = await body(
        c,
        z
          .object({
            vault: addr,
            id,
            side: z.enum(["buy", "sell"]),
            symbol: text(12),
            quantityMicros: z.number().int().min(1).max(1e12),
          })
          .strict(),
      );
      const { s, owner } = await getFamily(c, p.vault);
      const asset = s.market.find((a) => a.symbol === p.symbol);
      if (!asset) throw Error("Choose an asset in this practice portfolio.");
      return c.json(
        db().transaction(() => {
          const a = db().get<ArenaAccount>(owner, "arena", p.vault);
          if (!a) throw Error("Mirror the portfolio first.");
          const next = fillOrder(
            a,
            asset,
            p.side,
            p.quantityMicros,
            p.id,
            now(),
            s.block,
          );
          db().put(owner, "arena", p.vault, next);
          return next;
        }),
      );
    }),
  );
  app.post(
    "/api/v3/arena/lesson",
    handle(async (c) => {
      enabled("arena");
      const p = await body(
        c,
        z
          .object({
            vault: addr,
            lesson: z.string().max(30),
            answer: z.number().int().min(0).max(2),
          })
          .strict(),
      );
      const { owner } = await getFamily(c, p.vault);
      const lesson = LESSONS.find((l) => l.id === p.lesson);
      if (!lesson) throw Error("Lesson not found.");
      const correct = lesson.answer === p.answer;
      if (correct)
        db().transaction(() => {
          const a = db().get<ArenaAccount>(owner, "arena", p.vault);
          if (!a) throw Error("Start your practice portfolio first.");
          a.lessons = [...new Set([...a.lessons, lesson.id])];
          db().put(owner, "arena", p.vault, a);
        });
      return c.json({ correct, explanation: lesson.explanation });
    }),
  );
  app.get(
    "/api/v3/arena/replay",
    handle(async (c) => {
      enabled("arena");
      const { owner } = await getFamily(c, addr.parse(c.req.query("vault")));
      const a = db().get<ArenaAccount>(
        owner,
        "arena",
        c.req.query("vault")!.toLowerCase(),
      );
      if (!a) throw Error("Start a practice portfolio first.");
      const steps = z.coerce
        .number()
        .int()
        .min(0)
        .max(a.fills.length)
        .parse(c.req.query("steps"));
      return c.json(replay(a, steps));
    }),
  );
  app.post(
    "/api/v3/arena/permissions",
    handle(async (c) => {
      enabled("arena");
      const p = await body(
        c,
        z
          .object({ vault: addr, days: z.number().int().min(7).max(180) })
          .strict(),
      );
      const { owner } = await getFamily(c, p.vault, true);
      const a = db().get<ArenaAccount>(owner, "arena", p.vault);
      if (!a) throw Error("Start a practice portfolio first.");
      a.unlockDays = p.days;
      db().put(owner, "arena", p.vault, a);
      return c.json({ ok: true });
    }),
  );
  app.get(
    "/api/v3/arena/export",
    handle(async (c) => {
      enabled("arena");
      const vault = addr.parse(c.req.query("vault"));
      const { owner } = await getFamily(c, vault);
      const a = db().get<ArenaAccount>(owner, "arena", vault);
      if (!a) throw Error("Start a practice portfolio first.");
      c.header(
        "Content-Disposition",
        'attachment; filename="sprout-practice-ledger.json"',
      );
      return c.json({ practice: true, ...a });
    }),
  );
  app.post(
    "/api/v3/leagues",
    handle(async (c) => {
      enabled("arena");
      const p = await body(
        c,
        z.object({ title: text(50), alias: text(24), vault: addr }).strict(),
      );
      const { wallet, owner } = await getFamily(c, p.vault);
      const all = db().list<ArenaLeague>("leagues", "league");
      if (all.filter((l) => l.owner === wallet).length >= 10)
        throw Error("You can host up to ten private leagues.");
      const l: ArenaLeague = {
        id: randomBytes(16).toString("hex"),
        title: p.title,
        owner: wallet,
        invite: randomBytes(24).toString("hex"),
        members: [{ owner: wallet, alias: p.alias, joinedAt: now() }],
        createdAt: now(),
      };
      db().put("leagues", "league", l.id, l);
      db().put(wallet, "league-score", l.id, {
        owner,
        vault: p.vault,
        score: arenaReadiness(
          db().get<ArenaAccount>(owner, "arena", p.vault) ??
            mirrorAccount(p.vault, [], 0, "0", now()),
        ),
      });
      return c.json({ id: l.id, invite: l.invite }, 201);
    }),
  );
  app.post(
    "/api/v3/leagues/join",
    handle(async (c) => {
      enabled("arena");
      const p = await body(
        c,
        z
          .object({
            invite: z.string().regex(/^[0-9a-f]{48}$/),
            alias: text(24),
            vault: addr,
          })
          .strict(),
      );
      const { wallet, owner } = await getFamily(c, p.vault);
      return c.json(
        db().transaction(() => {
          const l = db()
            .list<ArenaLeague>("leagues", "league")
            .find((l) => l.invite === p.invite);
          if (!l) throw Error("This invitation is unavailable.");
          if (l.members.length >= 20) throw Error("This league is full.");
          if (!l.members.some((m) => m.owner === wallet))
            l.members.push({ owner: wallet, alias: p.alias, joinedAt: now() });
          db().put("leagues", "league", l.id, l);
          const a = db().get<ArenaAccount>(owner, "arena", p.vault);
          db().put(wallet, "league-score", l.id, {
            owner,
            vault: p.vault,
            score: a ? arenaReadiness(a) : 0,
          });
          return { ok: true };
        }),
      );
    }),
  );
  return { config, store, chain };
}
