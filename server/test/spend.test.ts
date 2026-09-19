import { afterEach, describe, expect, test } from "bun:test";
import {
  spendPurpose,
  SPEND_USDC,
  type SpendProduct,
  type SpendRequest,
  type SpendOrder,
} from "@sprout/shared";
import { createApp } from "../src/app";
import { issueNonce } from "../src/auth";
import { createFamilySession } from "../src/privacy";
import { upsertSprout } from "../src/repo";
import { bitrefillProvider, type SpendProvider } from "../src/spendProvider";
import { account, otherAccount, memoryDb, testimonialChain } from "./helpers";
const closes: Array<() => void> = [];
afterEach(() => closes.splice(0).forEach((f) => f()));
const product: SpendProduct = {
  id: "gift-us",
  name: "Gift card",
  country: "US",
  currency: "USD",
  values: [25, 50, 100],
  category: "Gift cards",
};
function fixture(enabled = true) {
  const db = memoryDb();
  closes.push(() => db.close());
  let time = Date.now(),
    creates = 0,
    fail = false,
    status: SpendOrder["status"] = "unpaid";
  const vault = "0x1111111111111111111111111111111111111111";
  upsertSprout(db, {
    id: vault,
    chainId: 4663,
    parent: account.address,
    beneficiary: otherAccount.address,
    settlementToken: SPEND_USDC,
    graduationTimestamp: 9999999999,
    assets: [],
    weights: [],
    createdTxHash: null,
    createdBlock: null,
  });
  const provider: SpendProvider = {
    catalog: async () => [product],
    create: async () => {
      creates++;
      if (fail) throw new Error("timeout");
      return {
        invoiceId: `invoice-${creates}`,
        order: {
          status: "unpaid",
          payment: {
            address: otherAccount.address,
            amount: "25",
            chainId: 8453,
            token: SPEND_USDC,
            expiresAt: time + 180000,
          },
        },
      };
    },
    status: async () => ({
      status,
      ...(status === "delivered"
        ? { redemption: { code: "TEST-ONLY-NOT-REDEEMABLE" } }
        : {}),
    }),
  };
  const app = createApp({
    db,
    chain: testimonialChain(),
    localDemo: false,
    spend: enabled ? provider : undefined,
    now: () => time,
  });
  const input = (value = 25): SpendRequest => ({
    key: crypto.randomUUID(),
    vault,
    product: product.id,
    value,
    country: "US",
  });
  const headers = (signer = account) => ({
    authorization: `Bearer ${createFamilySession(db, signer.address, time).token}`,
  });
  const credentials = async (body: SpendRequest, signer = account) => {
    const nonce = issueNonce(db, {
      address: signer.address,
      purpose: spendPurpose(body),
      now: time,
    });
    return {
      "content-type": "application/json",
      "x-sprout-address": signer.address,
      "x-sprout-nonce": nonce.nonce,
      "x-sprout-signature": await signer.signMessage({
        message: nonce.message,
      }),
    };
  };
  const create = async (body = input(), signer = account) =>
    app.request("/api/spend/orders", {
      method: "POST",
      headers: await credentials(body, signer),
      body: JSON.stringify(body),
    });
  return {
    db,
    app,
    provider,
    input,
    headers,
    credentials,
    create,
    creates: () => creates,
    fail: () => {
      fail = true;
    },
    status: (s: SpendOrder["status"]) => {
      status = s;
      time += 11000;
    },
    advance: () => {
      time += 181000;
    },
  };
}
describe("Sprout Spend", () => {
  test("unconfigured catalog is empty and checkout is unavailable", async () => {
    const f = fixture(false);
    const c = await (await f.app.request("/api/spend/catalog")).json();
    expect(c.enabled).toBe(false);
    expect(c.products).toEqual([]);
    expect((await f.create()).status).toBe(503);
  });
  test("orders require authenticated parent ownership", async () => {
    const f = fixture();
    expect((await f.app.request("/api/spend/orders")).status).toBe(401);
    expect((await f.create(f.input(), otherAccount)).status).toBe(403);
    expect(f.creates()).toBe(0);
  });
  test("signature binds product, value, vault, region and request key", async () => {
    const f = fixture(),
      body = f.input();
    const headers = await f.credentials(body);
    expect(
      (
        await f.app.request("/api/spend/orders", {
          method: "POST",
          headers,
          body: JSON.stringify({ ...body, value: 100 }),
        })
      ).status,
    ).toBe(401);
    expect(f.creates()).toBe(0);
  });
  test("replay fails, retry with same request key returns the original invoice", async () => {
    const f = fixture(),
      body = f.input();
    const headers = await f.credentials(body);
    const send = () =>
      f.app.request("/api/spend/orders", {
        method: "POST",
        headers,
        body: JSON.stringify(body),
      });
    const first = await (await send()).json();
    expect((await send()).status).toBe(401);
    const retry = await (await f.create(body)).json();
    expect(retry.order.id).toBe(first.order.id);
    expect(f.creates()).toBe(1);
  });
  test("concurrent retries cannot create two invoices", async () => {
    const f = fixture(),
      body = f.input();
    await Promise.all([f.create(body), f.create(body)]);
    expect(f.creates()).toBe(1);
  });
  test("rejects tampered product, region, amount and unknown body fields", async () => {
    const f = fixture();
    for (const v of [
      { value: 101 },
      { value: 0 },
      { value: 25.5 },
      { product: "unknown" },
      { country: "CA" },
      { payment_method: "balance" },
    ])
      expect(
        (await f.create({ ...f.input(), ...v } as SpendRequest)).status,
      ).toBe(400);
    expect(f.creates()).toBe(0);
  });
  test("enforces a rolling daily limit before creating a provider invoice", async () => {
    const f = fixture();
    expect((await f.create(f.input(100))).status).toBe(201);
    expect((await f.create(f.input(100))).status).toBe(201);
    expect((await f.create()).status).toBe(409);
    expect(f.creates()).toBe(2);
  });
  test("uncertain provider outcome persists and blocks another checkout", async () => {
    const f = fixture();
    f.fail();
    const response = await f.create();
    expect(response.status).toBe(503);
    expect((await response.json()).order.status).toBe("attention");
    expect((await f.create()).status).toBe(409);
    expect(f.creates()).toBe(1);
  });
  test("order IDs do not grant another family access", async () => {
    const f = fixture();
    const { order } = await (await f.create()).json();
    expect(
      (
        await f.app.request(`/api/spend/orders/${order.id}`, {
          headers: f.headers(otherAccount),
        })
      ).status,
    ).toBe(404);
    const list = await (
      await f.app.request("/api/spend/orders", {
        headers: f.headers(otherAccount),
      })
    ).json();
    expect(list.orders).toEqual([]);
  });
  test("only provider-confirmed delivery reveals codes; codes are not stored", async () => {
    const f = fixture();
    const { order } = await (await f.create()).json();
    const read = () =>
      f.app.request(`/api/spend/orders/${order.id}`, { headers: f.headers() });
    expect((await (await read()).json()).order.redemption).toBeUndefined();
    f.status("delivered");
    expect((await (await read()).json()).order.redemption.code).toBe(
      "TEST-ONLY-NOT-REDEEMABLE",
    );
    expect((await (await read()).json()).order.redemption.code).toBe(
      "TEST-ONLY-NOT-REDEEMABLE",
    );
    expect(
      JSON.stringify(f.db.query("SELECT * FROM spend_orders").all()),
    ).not.toContain("TEST-ONLY-NOT-REDEEMABLE");
  });
  test("expired payment window cannot be reused, later delivery still reconciles", async () => {
    const f = fixture();
    const { order } = await (await f.create()).json();
    f.advance();
    expect(
      (
        await (
          await f.app.request(`/api/spend/orders/${order.id}?payment=1`, {
            headers: f.headers(),
          })
        ).json()
      ).order.status,
    ).toBe("expired");
    f.status("delivered");
    expect(
      (
        await (
          await f.app.request(`/api/spend/orders/${order.id}`, {
            headers: f.headers(),
          })
        ).json()
      ).order.status,
    ).toBe("delivered");
  });
  test("provider requires credentials plus curated products", () => {
    expect(bitrefillProvider({})).toBeUndefined();
    expect(
      bitrefillProvider({
        SPROUT_SPEND_ENABLED: "true",
        BITREFILL_API_KEY: "personal",
      }),
    ).toBeUndefined();
  });
  test("personal API keys use server-side Bearer authentication", async () => {
    const authorizations: Array<string | null> = [];
    const provider = bitrefillProvider(
      {
        SPROUT_SPEND_ENABLED: "true",
        BITREFILL_API_KEY: " test-personal-key ",
        SPROUT_SPEND_PRODUCT_IDS: product.id,
      },
      (async (_url: string, init: RequestInit) => {
        authorizations.push(new Headers(init.headers).get("authorization"));
        return Response.json({
          data: {
            id: product.id,
            name: product.name,
            country_code: "US",
            currency: "USD",
            in_stock: true,
            recipient_type: "none",
            packages: [{ id: "p25", value: "25" }],
          },
        });
      }) as typeof fetch,
    )!;
    const catalog = await provider.catalog("US");
    expect(authorizations[0]).toBe("Bearer test-personal-key");
    expect(catalog[0]?.values).toEqual([25]);
    expect(JSON.stringify(catalog)).not.toContain("test-personal-key");
  });
  test("provider never uses balance payments and verifies invoice currency", async () => {
    const calls: Array<{ url: string; body: any }> = [];
    const request = (async (url: string, init: RequestInit) => {
      const body = init.body ? JSON.parse(String(init.body)) : null;
      calls.push({ url, body });
      return Response.json({
        data: body
          ? {
              id: "i",
              status: "unpaid",
              payment: {
                method: "usdc_base",
                status: "unpaid",
                currency: "BTC",
                address: account.address,
                price: 25,
              },
              orders: [],
            }
          : {
              id: product.id,
              name: product.name,
              country_code: "US",
              currency: "USD",
              in_stock: true,
              recipient_type: "none",
              packages: [{ id: "p25", value: 25 }],
            },
      });
    }) as typeof fetch;
    const provider = bitrefillProvider(
      {
        SPROUT_SPEND_ENABLED: "true",
        BITREFILL_API_ID: "test",
        BITREFILL_API_SECRET: "test",
        SPROUT_SPEND_PRODUCT_IDS: product.id,
      },
      request,
    )!;
    await expect(
      provider.create(product, 25, account.address),
    ).rejects.toThrow();
    expect(calls[1]!.body.payment_method).toBe("usdc_base");
    expect(calls[1]!.body.auto_pay).toBe(false);
    expect(calls[1]!.body.send_email).toBe(false);
  });
});

describe("Spend payment attempt reservation", () => {
  test("only the order owner can reserve payment; repeat attempts stay blocked", async () => {
    const f = fixture();
    const { order } = await (await f.create()).json();
    const path = `/api/spend/orders/${order.id}/payment`;
    expect(
      (
        await f.app.request(path, {
          method: "POST",
          headers: f.headers(otherAccount),
        })
      ).status,
    ).toBe(404);
    expect(
      (await f.app.request(path, { method: "POST", headers: f.headers() }))
        .status,
    ).toBe(200);
    expect(
      (await f.app.request(path, { method: "POST", headers: f.headers() }))
        .status,
    ).toBe(409);
    const saved = await (
      await f.app.request(`/api/spend/orders/${order.id}`, {
        headers: f.headers(),
      })
    ).json();
    expect(saved.order.paymentStarted).toBe(true);
    expect(
      (await f.app.request(path, { method: "DELETE", headers: f.headers() }))
        .status,
    ).toBe(200);
    expect(
      (await f.app.request(path, { method: "POST", headers: f.headers() }))
        .status,
    ).toBe(200);
  });
  test("a late status refresh preserves another tab's payment reservation", async () => {
    const f = fixture();
    const { order } = await (await f.create()).json();
    let release!: () => void;
    let entered!: () => void;
    const started = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const blocked = new Promise<void>((resolve) => {
      release = resolve;
    });
    let calls = 0;
    f.provider.status = async () => {
      if (++calls === 1) {
        entered();
        await blocked;
      }
      return { status: "unpaid" };
    };
    const path = `/api/spend/orders/${order.id}`;
    const refreshing = f.app.request(path, { headers: f.headers() });
    await started;
    expect(
      (
        await f.app.request(`${path}/payment`, {
          method: "POST",
          headers: f.headers(),
        })
      ).status,
    ).toBe(200);
    release();
    expect((await (await refreshing).json()).order.paymentStarted).toBe(true);
    expect(
      (
        await f.app.request(`${path}/payment`, {
          method: "POST",
          headers: f.headers(),
        })
      ).status,
    ).toBe(409);
  });
  test("expired and already paid invoices reject a payment reservation", async () => {
    const f = fixture();
    const { order } = await (await f.create()).json();
    f.status("confirming");
    expect(
      (
        await f.app.request(`/api/spend/orders/${order.id}/payment`, {
          method: "POST",
          headers: f.headers(),
        })
      ).status,
    ).toBe(409);
    f.status("unpaid");
    f.advance();
    expect(
      (
        await f.app.request(`/api/spend/orders/${order.id}/payment`, {
          method: "POST",
          headers: f.headers(),
        })
      ).status,
    ).toBe(409);
  });
});
