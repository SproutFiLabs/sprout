import { z } from 'zod';

export const addressSchema = z.string().regex(/^0x[0-9a-fA-F]{40}$/, 'invalid address');
export const hexSchema = z.string().regex(/^0x[0-9a-fA-F]*$/, 'invalid hex');
export const hashSchema = z.string().regex(/^0x[0-9a-fA-F]{64}$/, 'invalid hash');
export const decimalStringSchema = z.string().regex(/^\d+$/, 'expected unsigned integer string');

export const allocationSchema = z.object({
  asset: addressSchema,
  weightBps: z.number().int().min(0).max(10_000),
});

export const createSproutSchema = z.object({
  beneficiary: addressSchema,
  graduationTimestamp: z.number().int().positive(),
  settlementToken: addressSchema,
  allocations: z.array(allocationSchema).min(1).max(5),
  venues: z.array(addressSchema).max(5).default([]),
  nickname: z.string().min(1).max(40).optional(),
});

export const plantRequestSchema = createSproutSchema.extend({
  txHash: hashSchema.optional(),
});

export const scheduleInvestmentSchema = z.object({
  amount: decimalStringSchema,
  periodSeconds: z.number().int().min(3600),
  firstExecution: z.number().int().nonnegative().optional(),
  txHash: hashSchema.optional(),
});

export const createGiftSchema = z.object({
  vaultId: z.string().min(1).max(128),
  label: z.string().min(1).max(60).optional(),
  acceptedAssets: z.array(addressSchema).min(1).max(5),
  txHash: hashSchema.optional(),
});

export const recordGiftPaymentSchema = z.object({
  giftId: z.string().min(1).max(128),
  gifter: addressSchema,
  token: addressSchema,
  amount: decimalStringSchema,
  txHash: hashSchema,
  logIndex: z.number().int().nonnegative().default(0),
});

export const createMilestoneSchema = z.object({
  vaultId: z.string().min(1).max(128),
  milestoneId: hashSchema,
  token: addressSchema,
  amount: decimalStringSchema,
  unlockTime: z.number().int().nonnegative().default(0),
  txHash: hashSchema.optional(),
});

export const nonceRequestSchema = z.object({
  address: addressSchema,
  purpose: z.string().min(1).max(40),
});

export const verifyRequestSchema = z.object({
  address: addressSchema,
  nonce: z.string().min(1).max(128),
  signature: hexSchema,
});

export const indexRangeSchema = z.object({
  fromBlock: z.coerce.bigint().nonnegative().optional(),
  toBlock: z.coerce.bigint().nonnegative().optional(),
});

export type CreateSproutInput = z.infer<typeof createSproutSchema>;
export type PlantRequestInput = z.infer<typeof plantRequestSchema>;
export type ScheduleInvestmentInput = z.infer<typeof scheduleInvestmentSchema>;
export type CreateGiftInput = z.infer<typeof createGiftSchema>;
export type RecordGiftPaymentInput = z.infer<typeof recordGiftPaymentSchema>;
export type CreateMilestoneInput = z.infer<typeof createMilestoneSchema>;
