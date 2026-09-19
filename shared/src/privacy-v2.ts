/** Privacy v2 preparation protocol. No function in this module moves funds. */
import { z } from "zod";
import {
  encodeAbiParameters,
  getAddress,
  keccak256,
  toHex,
  type Address,
  type Hex,
} from "viem";

const address = z
  .string()
  .regex(/^0x[0-9a-fA-F]{40}$/)
  .transform((v) => getAddress(v));
const hash = z.string().regex(/^0x[0-9a-fA-F]{64}$/);
const units = z
  .string()
  .regex(/^(0|[1-9][0-9]{0,76})$/)
  .refine((v) => BigInt(v) < 2n ** 256n);
export const featureIds = [
  "swaps",
  "tags",
  "gifts",
  "adult",
  "policy",
  "attestations",
] as const;
export type PrivacyFeature = (typeof featureIds)[number];
export const allocationSchema = z
  .array(
    z
      .object({ asset: address, bps: z.number().int().min(1).max(10000) })
      .strict(),
  )
  .min(1)
  .max(21)
  .superRefine((rows, ctx) => {
    if (rows.reduce((n, r) => n + r.bps, 0) !== 10000)
      ctx.addIssue({ code: "custom", message: "The mix must total 100%." });
    if (new Set(rows.map((r) => r.asset.toLowerCase())).size !== rows.length)
      ctx.addIssue({
        code: "custom",
        message: "Each asset may appear only once.",
      });
  });
export const policySchema = z
  .object({
    version: z.literal(1),
    chainId: z.number().int().positive(),
    account: hash,
    epoch: z.number().int().nonnegative(),
    expiresAt: z.number().int().positive(),
    maxOrderValue: units.refine((v) => BigInt(v) > 0n),
    assets: z
      .array(
        z
          .object({
            asset: address,
            maxWeightBps: z.number().int().min(1).max(10000),
          })
          .strict(),
      )
      .min(1)
      .max(21),
  })
  .strict()
  .superRefine((v, ctx) => {
    if (
      new Set(v.assets.map((a) => a.asset.toLowerCase())).size !==
      v.assets.length
    )
      ctx.addIssue({ code: "custom", message: "Duplicate policy assets." });
  });
export type PrivatePolicy = z.infer<typeof policySchema>;
export function policyHash(input: PrivatePolicy): Hex {
  const p = policySchema.parse(input);
  const sorted = [...p.assets].sort((a, b) =>
    a.asset.toLowerCase().localeCompare(b.asset.toLowerCase()),
  );
  return keccak256(
    encodeAbiParameters(
      [
        { type: "string" },
        { type: "uint256" },
        { type: "bytes32" },
        { type: "uint256" },
        { type: "uint256" },
        { type: "uint256" },
        { type: "address[]" },
        { type: "uint256[]" },
      ],
      [
        "sprout-policy-v2",
        BigInt(p.chainId),
        p.account as Hex,
        BigInt(p.epoch),
        BigInt(p.expiresAt),
        BigInt(p.maxOrderValue),
        sorted.map((a) => a.asset as Address),
        sorted.map((a) => BigInt(a.maxWeightBps)),
      ],
    ),
  );
}
export const orderSchema = z
  .object({
    // Preparation denomination: token base units and USD price with six decimals.
    // These are NOT Darkpool calldata. Settlement requires a verified price/conversion adapter.
    account: hash,
    asset: address,
    side: z.enum(["buy", "sell"]),
    quantity: units.refine((v) => BigInt(v) > 0n),
    limitPrice: units.refine((v) => BigInt(v) > 0n),
    window: z.number().int().positive(),
    policyHash: hash,
    nonce: hash,
    minimumFill: units,
    displayQuantity: units,
    pegOffsetBps: z.number().int().min(-100).max(100),
    backstop: z.boolean(),
    maxSpreadBps: z.number().int().min(0).max(200),
  })
  .strict()
  .superRefine((o, c) => {
    if (
      BigInt(o.minimumFill) > BigInt(o.quantity) ||
      BigInt(o.displayQuantity) > BigInt(o.quantity)
    )
      c.addIssue({
        code: "custom",
        message: "Fill and display sizes cannot exceed the order.",
      });
  });
export type PrivateOrder = z.infer<typeof orderSchema>;

/** Advisory preflight only: a settlement verifier must independently prove every rule. */
export function checkOrderPolicy(
  input: PrivateOrder,
  inputPolicy: PrivatePolicy,
  state: {
    now: number;
    chainId: number;
    epoch: number;
    eligible: string[];
    paused: string[];
    orderValue: bigint;
    assetValueAfter: bigint;
    portfolioValueAfter: bigint;
  },
): void {
  const o = orderSchema.parse(input),
    p = policySchema.parse(inputPolicy);
  if (
    state.chainId !== p.chainId ||
    state.epoch !== p.epoch ||
    state.now >= p.expiresAt
  )
    throw new Error("Policy expired or superseded.");
  if (o.account !== p.account || o.policyHash !== policyHash(p))
    throw new Error("Order is not bound to this policy.");
  const asset = o.asset.toLowerCase(),
    rule = p.assets.find((a) => a.asset.toLowerCase() === asset);
  if (!rule || !state.eligible.some((a) => a.toLowerCase() === asset))
    throw new Error("Asset is outside the approved list.");
  if (state.paused.some((a) => a.toLowerCase() === asset))
    throw new Error("Asset paused for a corporate action.");
  if (state.orderValue <= 0n || state.orderValue > BigInt(p.maxOrderValue))
    throw new Error("Order exceeds the parent limit.");
  if (
    state.assetValueAfter < 0n ||
    state.portfolioValueAfter <= 0n ||
    state.assetValueAfter > state.portfolioValueAfter
  )
    throw new Error("Invalid post-trade values.");
  if (
    state.assetValueAfter * 10000n >
    state.portfolioValueAfter * BigInt(rule.maxWeightBps)
  )
    throw new Error("Order exceeds the allocation cap.");
  if (
    o.pegOffsetBps !== 0 ||
    BigInt(o.displayQuantity) !== BigInt(o.quantity) ||
    BigInt(o.minimumFill) !== 0n
  )
    throw new Error("Advanced orders are reserved for adult accounts.");
}

/** Integer allocation: largest remainder, deterministic input-order tie breaking. */
export function allocateGift(
  amount: bigint,
  input: z.input<typeof allocationSchema>,
) {
  if (amount <= 0n || amount >= 2n ** 256n)
    throw new Error("Invalid gift amount.");
  const mix = allocationSchema.parse(input);
  const rows = mix.map((r, i) => ({
    ...r,
    i,
    amount: (amount * BigInt(r.bps)) / 10000n,
    remainder: (amount * BigInt(r.bps)) % 10000n,
  }));
  let dust = amount - rows.reduce((n, r) => n + r.amount, 0n);
  for (const row of [...rows].sort((a, b) =>
    a.remainder === b.remainder
      ? a.i - b.i
      : a.remainder > b.remainder
        ? -1
        : 1,
  )) {
    if (dust === 0n) break;
    row.amount++;
    dust--;
  }
  return rows.map(({ asset, amount }) => ({
    asset,
    amount: amount.toString(),
  }));
}
export const savingsSchema = z
  .object({
    version: z.literal(1),
    kind: z.literal("adult"),
    amount: units.refine((v) => BigInt(v) > 0n),
    cadenceDays: z.union([z.literal(1), z.literal(7), z.literal(30)]),
    startAt: z.number().int().positive(),
    mix: allocationSchema,
    backstop: z.boolean(),
    maxSpreadBps: z.number().int().min(0).max(200),
  })
  .strict();
export const claimSchema = z
  .object({
    version: z.literal(1),
    kind: z.enum(["holdings", "membership", "solvency"]),
    chainId: z.number().int().positive(),
    verifier: address,
    root: hash,
    epoch: z.number().int().nonnegative(),
    audience: z.string().url().max(256),
    challenge: hash,
    expiresAt: z.number().int().positive(),
    threshold: units.refine((v) => BigInt(v) > 0n),
  })
  .strict();
export function claimDigest(
  input: z.input<typeof claimSchema>,
  now: number,
): Hex {
  const c = claimSchema.parse(input);
  if (c.expiresAt <= now || c.expiresAt > now + 600)
    throw new Error("Proof challenges expire within ten minutes.");
  return keccak256(toHex(JSON.stringify(c)));
}

export interface PrivacyReadiness {
  enabled: boolean;
  graduationVerified: boolean;
  backupRestoreVerified: boolean;
  poolVerified: boolean;
  policyVerifierVerified: boolean;
  settlementVerified: boolean;
  tagRegistryVerified: boolean;
  attestationVerifierVerified: boolean;
  solvencyVerifierVerified: boolean;
}
export const CLOSED_PRIVACY: PrivacyReadiness = Object.freeze({
  enabled: false,
  graduationVerified: false,
  backupRestoreVerified: false,
  poolVerified: false,
  policyVerifierVerified: false,
  settlementVerified: false,
  tagRegistryVerified: false,
  attestationVerifierVerified: false,
  solvencyVerifierVerified: false,
});
export function featureReady(f: PrivacyFeature, r: PrivacyReadiness): boolean {
  if (
    !r.enabled ||
    !r.graduationVerified ||
    !r.backupRestoreVerified ||
    !r.poolVerified
  )
    return false;
  switch (f) {
    case "tags":
      return r.tagRegistryVerified;
    case "policy":
      return r.policyVerifierVerified;
    case "attestations":
      return r.attestationVerifierVerified && r.solvencyVerifierVerified;
    case "gifts":
      return (
        r.tagRegistryVerified &&
        r.policyVerifierVerified &&
        r.settlementVerified
      );
    case "swaps":
      return r.policyVerifierVerified && r.settlementVerified;
    case "adult":
      return r.settlementVerified;
  }
}
