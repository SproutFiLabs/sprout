import { describe, test, expect } from "bun:test";
import {
  memoryDb,
  testimonialChain,
  readHeaders,
  account,
  otherAccount,
} from "./helpers";
import { ExpansionStore } from "../src/v3/store";
import { fillOrder, mirrorAccount, replay } from "../src/v3/arena";
import { preciseRoundup } from "../src/v3/worker";
import { equityOpen } from "../src/v3/chain";
import { expansionConfig, registerExpansion } from "../src/v3/routes";
import { Hono } from "hono";
import { arenaReadiness, type ArenaAsset } from "@sprout/shared";
const market: ArenaAsset[] = [
  {
    address: "0x" + "1".repeat(40),
    symbol: "AAA",
    name: "Practice asset",
    priceCents: 10000,
    quantityMicros: 2000000,
    status: "open",
  },
];
describe("expansion privacy and records", () => {
  test("authenticated encryption hides wallet, title and amounts from stored payload", () => {
    const db = memoryDb(),
      store = new ExpansionStore(db, Buffer.alloc(32, 7));
    store.put(account.address, "event", "celebration", {
      title: "Private birthday",
      cents: 12345,
    });
    const row = db
      .query<{ owner: string; body: string }, []>(
        "SELECT owner,body FROM v3_documents",
      )
      .get()!;
    expect(row.owner).not.toContain(account.address.slice(2));
    expect(row.body).not.toContain("Private birthday");
    expect(
      store.get<{ title: string; cents: number }>(
        account.address,
        "event",
        "celebration",
      ),
    ).toEqual({
      title: "Private birthday",
      cents: 12345,
    });
    expect(store.get(otherAccount.address, "event", "celebration")).toBeNull();
    db.close();
  });
  test("ciphertext cannot be copied between owners or IDs", () => {
    const db = memoryDb(),
      store = new ExpansionStore(db, Buffer.alloc(32, 7));
    store.put(account.address, "event", "a", { secret: true });
    db.run("UPDATE v3_documents SET id='b'");
    expect(() => store.get(account.address, "event", "b")).toThrow();
    db.close();
  });
  test("receipt references cannot be claimed twice and transactions roll back", () => {
    const db = memoryDb(),
      store = new ExpansionStore(db, Buffer.alloc(32, 7));
    store.claim("tx:1", account.address);
    expect(() =>
      store.transaction(() => {
        store.put(account.address, "event", "a", { n: 2 });
        store.claim("tx:1", otherAccount.address);
      }),
    ).toThrow();
    expect(store.get(account.address, "event", "a")).toBeNull();
    db.close();
  });
  test("incomplete deployments fail closed", () => {
    expect(
      expansionConfig({ SPROUT_V3_ENABLED: "true" }, 31337, true).enabled,
    ).toBe(false);
    expect(expansionConfig({}, 4663, true).local).toBe(false);
  });
  test("disabled config stays public and private state requires a session", async () => {
    const db = memoryDb(),
      app = new Hono();
    app.onError((e, c) => c.json({ error: "unauthorized" }, 401));
    registerExpansion(
      app,
      { db, chain: testimonialChain(), localDemo: false },
      {},
    );
    expect((await app.request("/api/v3/config")).status).toBe(200);
    expect((await app.request("/api/v3/state")).status).toBe(401);
    const res = await app.request("/api/v3/state", {
      headers: readHeaders(db),
    });
    expect(res.status).toBe(200);
    expect((await res.json()).chain).toBeNull();
    db.close();
  });
});
describe("round-up arithmetic", () => {
  test("rounds exactly without a floating-point or sub-cent overcharge", () => {
    expect(preciseRoundup(4350000n, 6, 1, 1)).toBe(65);
    expect(preciseRoundup(5000000n, 6, 5, 3)).toBe(0);
    expect(preciseRoundup(4999999n, 6, 1, 3)).toBe(0);
    expect(preciseRoundup(8100000n, 6, 10, 2)).toBe(380);
  });
});
describe("practice execution and replay", () => {
  test("a trade changes only the virtual account, conserves recorded cash and replays exactly", () => {
    const a = mirrorAccount("vault", market, 50000, "1", 0);
    const b = fillOrder(a, market[0]!, "buy", 1000000, "trade-1", 1, "2");
    const c = fillOrder(b, market[0]!, "sell", 500000, "trade-2", 2, "3");
    expect(a.cashCents).toBe(50000);
    expect(b.cashCents).toBe(39990);
    expect(c.cashCents).toBe(44985);
    expect(replay(c, 0)).toEqual({
      cashCents: 50000,
      holdings: { AAA: 2000000 },
      fills: [],
    });
    expect(replay(c, 1).cashCents).toBe(b.cashCents);
    expect(replay(c, 2).holdings).toEqual(c.holdings);
  });
  test("idempotency, no overspend, no short selling, closed-market refusal", () => {
    const a = mirrorAccount("vault", market, 50000, "1", 0),
      b = fillOrder(a, market[0]!, "buy", 1000000, "trade-1", 1, "2");
    expect(fillOrder(b, market[0]!, "buy", 1000000, "trade-1", 1, "2")).toBe(b);
    expect(() =>
      fillOrder(a, market[0]!, "buy", 10000000, "trade-2", 1, "2"),
    ).toThrow("cash");
    expect(() =>
      fillOrder(a, market[0]!, "sell", 3000000, "trade-2", 1, "2"),
    ).toThrow("sell");
    expect(() =>
      fillOrder(
        a,
        { ...market[0]!, status: "closed" },
        "buy",
        1e6,
        "trade-2",
        1,
        "2",
      ),
    ).toThrow("not available");
  });
  test("practice days are unique and readiness cannot exceed 100", () => {
    const a = mirrorAccount("vault", market, 50000, "1", 0),
      b = fillOrder(a, market[0]!, "buy", 1e6, "one", 100, "2"),
      c = fillOrder(b, market[0]!, "sell", 1e6, "two", 200, "3");
    expect(c.practiceDays).toEqual([0]);
    expect(
      arenaReadiness({
        ...c,
        lessons: ["needs", "diversify", "patience", "risk"],
        practiceDays: Array.from({ length: 100 }, (_, i) => i),
      }),
    ).toBe(100);
  });
  test("equity calendar respects holidays, early closure, weekends and future-year fail-closed", () => {
    expect(equityOpen(Date.parse("2026-09-21T14:00Z"))).toBe(true);
    expect(equityOpen(Date.parse("2026-07-03T14:00Z"))).toBe(false);
    expect(equityOpen(Date.parse("2026-12-24T18:00Z"))).toBe(false);
    expect(equityOpen(Date.parse("2026-09-19T14:00Z"))).toBe(false);
    expect(equityOpen(Date.parse("2027-09-20T14:00Z"))).toBe(false);
  });
});

test("family erasure removes expansion records and public link lookup", async () => {
  const { eraseFamily, familyFootprint } = await import("../src/privacyPack");
  const old = process.env.SPROUT_V3_DATA_KEY;
  process.env.SPROUT_V3_DATA_KEY = "08".repeat(32);
  const db = memoryDb(),
    store = new ExpansionStore(db, Buffer.alloc(32, 8));
  try {
    store.put(account.address, "event", "birthday", {
      id: "birthday",
      vault: "v",
      title: "private",
    });
    store.put("event-links", "index", "birthday", { owner: account.address });
    expect(
      familyFootprint(db, account.address, Date.now()).erase.expansionRecords,
    ).toBe(1);
    eraseFamily(db, account.address, [], Date.now());
    expect(store.get(account.address, "event", "birthday")).toBeNull();
    expect(store.get("event-links", "index", "birthday")).toBeNull();
  } finally {
    if (old === undefined) delete process.env.SPROUT_V3_DATA_KEY;
    else process.env.SPROUT_V3_DATA_KEY = old;
    db.close();
  }
});
