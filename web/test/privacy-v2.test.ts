import { describe, expect, test } from "bun:test";
import { privateKeyToAddress } from "viem/accounts";
import {
  allocateGift,
  checkOrderPolicy,
  claimDigest,
  CLOSED_PRIVACY,
  featureIds,
  featureReady,
  policyHash,
  type PrivateOrder,
  type PrivatePolicy,
} from "@sprout/shared/privacy-v2";
import {
  createStealthIdentity,
  deriveStealthDestination,
  recoverStealthKey,
} from "@sprout/shared/stealth";
import { createVault, unlockVault } from "../src/privacy/crypto";
import { exactUnits } from "../src/privacy-v2/amounts";

const A = "0x0000000000000000000000000000000000000001",
  B = "0x0000000000000000000000000000000000000002";
const h = `0x${"11".repeat(32)}` as const;
const policy: PrivatePolicy = {
  version: 1,
  chainId: 4663,
  account: h,
  epoch: 1,
  expiresAt: 2000,
  maxOrderValue: "100",
  assets: [
    { asset: A, maxWeightBps: 6000 },
    { asset: B, maxWeightBps: 5000 },
  ],
};
const order: PrivateOrder = {
  account: h,
  asset: A,
  side: "buy",
  quantity: "20",
  limitPrice: "2",
  window: 5,
  policyHash: policyHash(policy),
  nonce: h,
  minimumFill: "0",
  displayQuantity: "20",
  pegOffsetBps: 0,
  backstop: false,
  maxSpreadBps: 0,
};
const state = {
  now: 1000,
  chainId: 4663,
  epoch: 1,
  eligible: [A, B],
  paused: [] as string[],
  orderValue: 40n,
  assetValueAfter: 60n,
  portfolioValueAfter: 100n,
};

describe("private preparation boundaries", () => {
  test("human amounts convert exactly and never round excess precision", () => {
    expect(exactUnits("100.01", 2)).toBe("10001");
    expect(exactUnits("0.000000000000000001", 18)).toBe("1");
    expect(exactUnits("1", 0)).toBe("1");
    for (const value of [
      "1.001",
      "1e2",
      "-1",
      "0",
      "Infinity",
      "NaN",
      "01",
      "1.",
    ])
      expect(() => exactUnits(value, 2)).toThrow();
    expect(() => exactUnits("1.1", 0)).toThrow();
    expect(() => exactUnits("1", 37)).toThrow();
  });
  test("policy commits domain, chain, epoch, cap and account; asset order is canonical", () => {
    expect(
      policyHash({ ...policy, assets: [...policy.assets].reverse() }),
    ).toBe(policyHash(policy));
    for (const changed of [
      { chainId: 1 },
      { epoch: 2 },
      { maxOrderValue: "101" },
      { account: `0x${"22".repeat(32)}` },
    ])
      expect(policyHash({ ...policy, ...changed })).not.toBe(
        policyHash(policy),
      );
  });
  test("rejects stale, unapproved, paused, oversize, overweight and adult-only orders", () => {
    expect(() => checkOrderPolicy(order, policy, state)).not.toThrow();
    for (const change of [
      { now: 2000 },
      { epoch: 2 },
      { chainId: 1 },
      { eligible: [B] },
      { paused: [A] },
      { orderValue: 101n },
      { assetValueAfter: 61n },
    ])
      expect(() =>
        checkOrderPolicy(order, policy, { ...state, ...change }),
      ).toThrow();
    for (const change of [
      { policyHash: `0x${"33".repeat(32)}` },
      { displayQuantity: "1" },
      { minimumFill: "1" },
      { pegOffsetBps: 1 },
    ])
      expect(() =>
        checkOrderPolicy({ ...order, ...change }, policy, state),
      ).toThrow();
  });
  test("gift allocations conserve every unit, including dust and large integers", () => {
    for (const amount of [1n, 2n, 3n, 101n, 10n ** 70n]) {
      const rows = allocateGift(amount, [
        { asset: A, bps: 6000 },
        { asset: B, bps: 4000 },
      ]);
      expect(rows.reduce((n, r) => n + BigInt(r.amount), 0n)).toBe(amount);
    }
    expect(
      allocateGift(1n, [
        { asset: A, bps: 5000 },
        { asset: B, bps: 5000 },
      ])[0]?.amount,
    ).toBe("1");
    expect(() =>
      allocateGift(10n, [
        { asset: A, bps: 6000 },
        { asset: A, bps: 4000 },
      ]),
    ).toThrow();
    expect(() => allocateGift(10n, [{ asset: A, bps: 9900 }])).toThrow();
  });
  test("challenge binds audience, root, verifier, chain and expires quickly", () => {
    const c = {
      version: 1 as const,
      kind: "holdings" as const,
      chainId: 4663,
      verifier: A,
      root: h,
      epoch: 1,
      audience: "https://sproutfy.tech",
      challenge: h,
      expiresAt: 1200,
      threshold: "100",
    };
    const digest = claimDigest(c, 1000);
    for (const changed of [
      { audience: "https://other.example" },
      { root: `0x${"22".repeat(32)}` },
      { verifier: B },
      { chainId: 1 },
      { challenge: `0x${"33".repeat(32)}` },
    ])
      expect(claimDigest({ ...c, ...changed }, 1000)).not.toBe(digest);
    expect(() => claimDigest(c, 1200)).toThrow();
    expect(() => claimDigest({ ...c, expiresAt: 1601 }, 1000)).toThrow();
  });
  test("all settlement paths are closed by default; base release checks cannot be skipped", () => {
    for (const f of featureIds)
      expect(featureReady(f, CLOSED_PRIVACY)).toBe(false);
    const ready = Object.fromEntries(
      Object.keys(CLOSED_PRIVACY).map((k) => [k, true]),
    ) as unknown as typeof CLOSED_PRIVACY;
    for (const f of featureIds) {
      expect(featureReady(f, ready)).toBe(true);
      for (const k of [
        "enabled",
        "graduationVerified",
        "backupRestoreVerified",
        "poolVerified",
      ])
        expect(featureReady(f, { ...ready, [k]: false })).toBe(false);
    }
  });
});

describe("local stealth destinations", () => {
  test("fresh destinations are recoverable only by the recipient keys", () => {
    const recipient = createStealthIdentity(),
      stranger = createStealthIdentity();
    const destinations = Array.from({ length: 12 }, () =>
      deriveStealthDestination(
        recipient.spendingPublicKey,
        recipient.viewingPublicKey,
      ),
    );
    expect(new Set(destinations.map((d) => d.address)).size).toBe(12);
    for (const d of destinations) {
      const secret = recoverStealthKey(
        recipient.spendingKey,
        recipient.viewingKey,
        d.ephemeralPublicKey,
        d.address,
      );
      expect(privateKeyToAddress(secret)).toBe(d.address);
      expect(() =>
        recoverStealthKey(
          stranger.spendingKey,
          stranger.viewingKey,
          d.ephemeralPublicKey,
          d.address,
        ),
      ).toThrow();
    }
  });
  test("invalid curve points cannot enter destination generation", () => {
    const recipient = createStealthIdentity();
    expect(() =>
      deriveStealthDestination(
        `0x02${"ff".repeat(32)}`,
        recipient.viewingPublicKey,
      ),
    ).toThrow();
  });
  test("encrypted backup round-trips keys and plans; wrong password and tampering fail", async () => {
    const identity = createStealthIdentity();
    const data = {
      workspace: JSON.stringify({ identity, amount: "918273645" }),
    };
    const { vault } = await createVault(
      "privacy-v2-test",
      "a sufficiently long passphrase",
      data,
    );
    expect(JSON.stringify(vault)).not.toContain(identity.spendingKey);
    expect(JSON.stringify(vault)).not.toContain("918273645");
    expect(
      (
        await unlockVault(
          vault,
          "privacy-v2-test",
          "a sufficiently long passphrase",
        )
      ).data,
    ).toEqual(data);
    await expect(
      unlockVault(vault, "privacy-v2-test", "incorrect passphrase"),
    ).rejects.toThrow();
    await expect(
      unlockVault(
        { ...vault, data: { ...vault.data, ciphertext: "AAAA" } },
        "privacy-v2-test",
        "a sufficiently long passphrase",
      ),
    ).rejects.toThrow();
  });
});
