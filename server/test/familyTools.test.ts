import { afterEach, describe, expect, test } from "bun:test";
import { Hono } from "hono";
import { createFamilySession } from "../src/privacy";
import { AuthError } from "../src/auth";
import { eraseFamily, familyFootprint } from "../src/privacyPack";
import {
  createRewards,
  ensureToolsTables,
  explainContext,
  ledgerSchema,
  loadInvestmentProvider,
  registerFamilyTools,
  type RewardsRail,
} from "../src/familyTools";
import {
  dollarsToCents,
  ledgerCsv,
  ledgerSummary,
  assetPassport,
  spendPurpose,
  type LedgerEntry,
} from "@sprout/shared";
import { memoryDb, account, otherAccount } from "./helpers";
import type { HolderChecker } from "../src/holders";
const closes: (() => void)[] = [];
afterEach(() => closes.splice(0).forEach((f) => f()));
const now = Date.parse("2026-09-19T14:00:00Z");
const entry: LedgerEntry = {
  id: "record-1",
  date: "2026-09-19T12:00:00.000Z",
  kind: "sale",
  asset: "TEST",
  quantity: "2",
  chainId: 8453,
  wallet: account.address,
  usdCents: 5000,
  basisCents: null,
  feeCents: 20,
  note: "Manual record",
  source: "manual",
};
function fixture() {
  const db = memoryDb();
  closes.push(() => db.close());
  const app = new Hono();
  let eligible = true,
    balance = 1000000000n,
    verified = true,
    checks = 0;
  const holders = {
    status: async () => ({
      enabled: true,
      heldBalance: eligible ? "1000000000000000000000000" : "0",
      decimals: 18,
    }),
  } as unknown as HolderChecker;
  const rail: RewardsRail = {
    treasury: otherAccount.address.toLowerCase(),
    balance: async () => balance,
    verify: async () => {
      checks++;
      if (!verified) throw new Error("Receipt mismatch.");
    },
  };
  app.onError((e, c) =>
    c.json(
      { error: e.message },
      e instanceof AuthError ? (e.status as 400) : 500,
    ),
  );
  ensureToolsTables(db);
  db.run("CREATE TABLE spend_orders(id TEXT PRIMARY KEY,owner TEXT,data TEXT)");
  registerFamilyTools(app, {
    db,
    holders,
    rail,
    now: () => now,
    assets: [{ symbol: "AAPL", address: otherAccount.address }],
    chainId: 4663,
    requireAdmin: (c) => {
      if (c.req.header("x-sprout-admin-token") !== "test-admin")
        throw new AuthError("Unauthorized.", 401);
    },
  });
  const headers = {
    authorization: `Bearer ${createFamilySession(db, account.address, now).token}`,
    "content-type": "application/json",
  };
  const other = {
    authorization: `Bearer ${createFamilySession(db, otherAccount.address, now).token}`,
    "content-type": "application/json",
  };
  const admin = {
    "x-sprout-admin-token": "test-admin",
    "content-type": "application/json",
  };
  const req = (
    path: string,
    method = "GET",
    body?: unknown,
    h: Record<string, string> = headers,
  ) =>
    app.request("/api/family-tools" + path, {
      method,
      headers: h,
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
  const addOffer = () =>
    req(
      "/operator/offers",
      "POST",
      {
        title: "School supplies",
        product: "school-us",
        rateBps: 300,
        budgetCents: 5000,
        endsAt: now + 86400000,
        terms:
          "Treasury-funded promotional offer. Manual payout after confirmed delivery.",
      },
      admin,
    );
  return {
    db,
    req,
    headers,
    other,
    admin,
    addOffer,
    rewards: createRewards(db, holders, rail, () => now),
    setEligible: (v: boolean) => (eligible = v),
    setBalance: (v: bigint) => (balance = v),
    setVerified: (v: boolean) => (verified = v),
    checks: () => checks,
  };
}
describe("Family ledger and planning", () => {
  test("family erasure counts and removes only the owner's toolkit records", async () => {
    const f = fixture();
    await f.req("/ledger", "POST", { entries: [entry] });
    await f.req("/ledger", "POST", { entries: [entry] }, f.other);
    const plan = { goal: "College", targetCents: 500000, horizon: 10, account: "parent", state: "NY", adult: true };
    expect((await f.req("/plan", "PUT", plan)).status).toBe(200);
    expect((await f.req("/plan", "PUT", plan, f.other)).status).toBe(200);
    const before = familyFootprint(f.db, account.address, now);
    expect(before.erase.familyLedger).toBe(1);
    expect(before.erase.familyPlans).toBe(1);
    eraseFamily(f.db, account.address, [], now);
    const after = familyFootprint(f.db, account.address, now);
    expect(after.erase.familyLedger).toBe(0);
    expect(after.erase.familyPlans).toBe(0);
    const untouched = familyFootprint(f.db, otherAccount.address, now);
    expect(untouched.erase.familyLedger).toBe(1);
    expect(untouched.erase.familyPlans).toBe(1);
  });
  test("rejects anonymous access and isolates wallets", async () => {
    const f = fixture();
    expect((await f.req("", "GET", undefined, {} as any)).status).toBe(401);
    await f.req("/ledger", "POST", { entries: [entry] });
    expect((await (await f.req("")).json()).entries).toHaveLength(1);
    expect(
      (await (await f.req("", "GET", undefined, f.other)).json()).entries,
    ).toHaveLength(0);
    expect(
      (
        await f.req(
          "/ledger/record-1",
          "PATCH",
          { basisCents: 10, usdCents: 10, feeCents: 0 },
          f.other,
        )
      ).status,
    ).toBe(404);
    expect(
      (
        await f.req(
          "/context?kind=ledger&id=record-1",
          "GET",
          undefined,
          f.other,
        )
      ).status,
    ).toBe(404);
  });
  test("imports idempotently and cannot forge a verified source", async () => {
    const f = fixture();
    expect(
      (
        await (
          await f.req("/ledger", "POST", {
            entries: [{ ...entry, source: "harvest" }],
          })
        ).json()
      ).added,
    ).toBe(1);
    expect(
      (await (await f.req("/ledger", "POST", { entries: [entry] })).json())
        .duplicates,
    ).toBe(1);
    expect((await (await f.req("")).json()).entries[0].source).toBe("import");
  });
  test("missing basis stays missing and explicit zero is retained", () => {
    expect(ledgerSummary([entry]).missing).toBe(1);
    expect(ledgerSummary([{ ...entry, basisCents: 0 }]).knownGainCents).toBe(
      4980,
    );
    expect(dollarsToCents("")).toBeNull();
    expect(dollarsToCents("0")).toBe(0);
    expect(dollarsToCents("12.34")).toBe(1234);
    expect(() => dollarsToCents("1.001")).toThrow();
    expect(() => dollarsToCents("1e4")).toThrow();
  });
  test("CSV quotes cells and neutralizes formulas", () => {
    const csv = ledgerCsv([{ ...entry, note: '=HYPERLINK("evil")' }], true);
    expect(csv).toContain("'=HYPERLINK");
    expect(csv).toContain("Missing basis or value");
    expect(csv).not.toContain("undefined");
    const loss = ledgerCsv([{ ...entry, basisCents: 6000 }], true);
    expect(loss).toContain('"-10.20"');
    expect(loss).not.toContain("'-10.20");
  });
  test("advanced export needs independently checked holder access", async () => {
    const f = fixture();
    await f.req("/ledger", "POST", { entries: [entry] });
    f.setEligible(false);
    expect((await f.req("/ledger.csv?advanced=1")).status).toBe(403);
    expect((await f.req("/ledger.csv")).status).toBe(200);
    f.setEligible(true);
    expect((await f.req("/ledger.csv?advanced=1")).status).toBe(200);
  });
  test("rejects malformed and oversized imports", async () => {
    const f = fixture();
    expect(
      (
        await f.req("/ledger", "POST", {
          entries: [{ ...entry, quantity: "1e8" }],
        })
      ).status,
    ).toBe(400);
    expect(
      (await f.req("/ledger", "POST", { entries: Array(501).fill(entry) }))
        .status,
    ).toBe(400);
  });
  test("plans require an adult and valid state; provider defaults closed", async () => {
    const f = fixture();
    const plan = {
      goal: "A first apartment",
      targetCents: 2500000,
      horizon: 18,
      account: "parent",
      state: "NY",
      adult: true,
    };
    expect(
      (await f.req("/plan", "PUT", { ...plan, adult: false })).status,
    ).toBe(400);
    expect((await f.req("/plan", "PUT", { ...plan, state: "XX" })).status).toBe(
      400,
    );
    expect((await f.req("/plan", "PUT", plan)).status).toBe(200);
    expect((await f.req("/provider-handoff", "POST", {})).status).toBe(409);
    expect(
      (await (await f.req("", "GET", undefined, f.other)).json()).plan,
    ).toBeNull();
  });
  test("provider config requires review, HTTPS, and unexpired approval", () => {
    const p = {
      name: "Test provider",
      url: "https://example.org/open",
      disclosureUrl: "https://example.org/terms",
      states: ["NY"],
      approved: true,
      reviewedAt: "2026-09-18T00:00:00Z",
      validUntil: "2026-10-01T00:00:00Z",
    };
    expect(
      loadInvestmentProvider(
        { SPROUT_US_PROVIDER_JSON: JSON.stringify(p) },
        now,
      )?.name,
    ).toBe("Test provider");
    expect(
      loadInvestmentProvider(
        { SPROUT_US_PROVIDER_JSON: JSON.stringify({ ...p, approved: false }) },
        now,
      ),
    ).toBeNull();
    expect(
      loadInvestmentProvider(
        {
          SPROUT_US_PROVIDER_JSON: JSON.stringify({
            ...p,
            url: "javascript:alert(1)",
          }),
        },
        now,
      ),
    ).toBeNull();
  });
  test("context strips wallet and hash; absent records do not leak", async () => {
    const f = fixture();
    await f.req("/ledger", "POST", {
      entries: [{ ...entry, txHash: `0x${"a".repeat(64)}` }],
    });
    const ctx = explainContext(
      f.db,
      account.address.toLowerCase(),
      "ledger",
      entry.id,
      [],
      4663,
    );
    expect(ctx.facts).not.toHaveProperty("wallet");
    expect(ctx.facts).not.toHaveProperty("txHash");
    expect(ctx.sources[0]?.id).toBe("irs");
  });
  test("passports never imply US access or share ownership", () => {
    const p = assetPassport({ symbol: "AAPL", address: account.address }, 4663);
    expect(() =>
      JSON.stringify(
        assetPassport(
          { ...{ symbol: "AAPL", address: account.address, multiplier: 1n } },
          4663,
        ),
      ),
    ).not.toThrow();
    expect(p.usAvailable).toBe(false);
    expect(p.ownership).toContain("No legal or beneficial rights");
    expect(
      assetPassport({ symbol: "AAPL", address: account.address }, 1)
        .verifiedIssuer,
    ).toBe(false);
  });
});
describe("Purchase rewards", () => {
  test("requires admin and sufficient funding for all offers", async () => {
    const f = fixture();
    expect((await f.req("/operator")).status).toBe(401);
    f.setBalance(49_000_000n);
    expect((await f.addOffer()).status).toBe(409);
    f.setBalance(75_000_000n);
    expect((await f.addOffer()).status).toBe(201);
    expect((await f.addOffer()).status).toBe(409);
  });
  test("reserves quoted cents once and rejects over-budget reservations", async () => {
    const f = fixture();
    const { offer } = await (await f.addOffer()).json();
    const q = await f.rewards.quote(account.address, "school-us", 25, offer.id);
    expect(q?.cents).toBe(75);
    f.db.transaction(() =>
      f.rewards.reserve(account.address.toLowerCase(), "order-1", q),
    )();
    expect(() =>
      f.db.transaction(() =>
        f.rewards.reserve(account.address.toLowerCase(), "order-1", q),
      )(),
    ).toThrow();
    const state = await (
      await f.req("/operator", "GET", undefined, f.admin)
    ).json();
    expect(state.offers[0].reservedCents).toBe(75);
    expect(() =>
      f.rewards.reserve(account.address, "order-2", { ...q!, cents: 10000 }),
    ).toThrow();
  });
  test("checks holder access, product and available treasury at checkout", async () => {
    const f = fixture();
    const { offer } = await (await f.addOffer()).json();
    f.setEligible(false);
    await expect(
      f.rewards.quote(account.address, "school-us", 25, offer.id),
    ).rejects.toThrow();
    f.setEligible(true);
    await expect(
      f.rewards.quote(account.address, "other-product", 25, offer.id),
    ).rejects.toThrow();
    f.setBalance(0n);
    await expect(
      f.rewards.quote(account.address, "school-us", 25, offer.id),
    ).rejects.toThrow();
  });
  test("only delivered owner orders confirm; bad or reused receipts never pay", async () => {
    const f = fixture();
    const { offer } = await (await f.addOffer()).json();
    const who = account.address.toLowerCase();
    for (const id of ["order-1", "order-2"]) {
      const q = await f.rewards.quote(who, "school-us", 25, offer.id);
      f.rewards.reserve(who, id, q);
      f.db.run("INSERT INTO spend_orders VALUES(?,?,?)", [
        id,
        who,
        JSON.stringify({ status: "unpaid" }),
      ]);
    }
    let d = await (await f.req("")).json();
    const id = d.claims[0].id;
    expect((await f.req(`/rewards/${id}/confirm`, "POST", {})).status).toBe(
      409,
    );
    expect(
      (await f.req(`/rewards/${id}/confirm`, "POST", {}, f.other)).status,
    ).toBe(404);
    f.db.run("UPDATE spend_orders SET data=?", [
      JSON.stringify({ status: "delivered" }),
    ]);
    for (const c of d.claims)
      expect((await f.req(`/rewards/${c.id}/confirm`, "POST", {})).status).toBe(
        200,
      );
    const txHash = `0x${"a".repeat(64)}`;
    f.setVerified(false);
    expect(
      (
        await f.req(
          "/operator/payments",
          "POST",
          { claimId: id, txHash, logIndex: 1 },
          f.admin,
        )
      ).status,
    ).toBe(409);
    d = await (await f.req("")).json();
    expect(d.claims[0].status).toBe("confirmed");
    f.setVerified(true);
    expect(
      (
        await f.req(
          "/operator/payments",
          "POST",
          { claimId: id, txHash, logIndex: 1 },
          f.admin,
        )
      ).status,
    ).toBe(200);
    expect(
      (
        await f.req(
          "/operator/payments",
          "POST",
          { claimId: d.claims[1].id, txHash, logIndex: 1 },
          f.admin,
        )
      ).status,
    ).toBe(409);
    expect(f.checks()).toBe(3);
  });
  test("wallet checkout signature binds the offer reference", () => {
    const r = {
      key: "x",
      vault: account.address,
      product: "school-us",
      value: 25,
      country: "US",
    };
    expect(spendPurpose(r)).not.toBe(
      spendPurpose({ ...r, rewardOfferId: "a" }),
    );
    expect(spendPurpose({ ...r, rewardOfferId: "a" })).not.toBe(
      spendPurpose({ ...r, rewardOfferId: "b" }),
    );
  });
});
