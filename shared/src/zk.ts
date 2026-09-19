import { z } from 'zod';

export const ZK_CIRCUIT = 'sprout-milestone-v1' as const;
export const ZK_TTL_MS = 30 * 60_000;
export const ZK_FIELD = 21888242871839275222246405745257275088548364400416034343698204186575808495617n;
export const ZK_BASE_FIELD = 21888242871839275222246405745257275088696311157297823662689037894645226208583n;
export const ZK_MAX_CENTS = (1n << 64n) - 1n;
export const ZK_THRESHOLDS = ['10000', '50000', '100000', '500000', '1000000'] as const;
const decimalPattern = /^(0|[1-9][0-9]{0,77})$/;
const decimal = z.string().regex(decimalPattern);
const bounded = (v: string, max: bigint, min = 0n) => decimalPattern.test(v) && BigInt(v) >= min && BigInt(v) < max;
export const zkFieldSchema = decimal.refine((v) => bounded(v, ZK_FIELD), 'Field value out of range');
export const zkThresholdSchema = decimal.refine((v) => bounded(v, ZK_MAX_CENTS + 1n, 1n), 'Invalid milestone amount');
const baseField = decimal.refine((v) => bounded(v, ZK_BASE_FIELD), 'Curve coordinate out of range');
const point = z.tuple([baseField, baseField, baseField]);
export const zkProofSchema = z
  .object({
    A: point,
    B: point,
    C: point,
    Z: point,
    T1: point,
    T2: point,
    T3: point,
    Wxi: point,
    Wxiw: point,
    eval_a: zkFieldSchema,
    eval_b: zkFieldSchema,
    eval_c: zkFieldSchema,
    eval_s1: zkFieldSchema,
    eval_s2: zkFieldSchema,
    eval_zw: zkFieldSchema,
    protocol: z.literal('plonk'),
    curve: z.literal('bn128'),
  })
  .strict();
export const zkCertificateSchema = z
  .object({
    id: z.string().regex(/^[a-f0-9]{32}$/),
    commitment: zkFieldSchema,
    thresholdCents: zkThresholdSchema,
    scope: decimal.refine((v) => bounded(v, 1n << 128n), 'Scope out of range'),
    issuedAt: z.number().int().nonnegative().safe(),
    expiresAt: z.number().int().positive().safe(),
  })
  .strict()
  .refine(
    (c) =>
      /^[a-f0-9]{32}$/.test(c.id) &&
      c.scope === BigInt(`0x${c.id}`).toString() &&
      c.expiresAt - c.issuedAt === ZK_TTL_MS,
    'Invalid certificate',
  );
export type ZkCertificate = z.infer<typeof zkCertificateSchema>;
export const zkEnvelopeSchema = z
  .object({
    version: z.literal(1),
    circuit: z.literal(ZK_CIRCUIT),
    certificate: zkCertificateSchema,
    publicSignals: z.tuple([zkFieldSchema, zkThresholdSchema, zkFieldSchema]),
    proof: zkProofSchema,
  })
  .strict()
  .refine(
    (p) =>
      p.publicSignals[0] === p.certificate.commitment &&
      p.publicSignals[1] === p.certificate.thresholdCents &&
      p.publicSignals[2] === p.certificate.scope,
    'Proof does not match certificate',
  );
export type ZkEnvelope = z.infer<typeof zkEnvelopeSchema>;
export interface ZkWitness {
  balance: string;
  salt: string;
  commitment: string;
  threshold: string;
  scope: string;
}
export interface ZkIssuance {
  certificate: ZkCertificate;
  witness: ZkWitness;
}
export interface ZkCertificateStatus extends ZkCertificate {
  revoked: boolean;
}
export function milestoneLabel(cents: string) {
  const whole = BigInt(cents) / 100n;
  const fraction = BigInt(cents) % 100n;
  return `$${whole.toLocaleString('en-US')}${fraction ? `.${fraction.toString().padStart(2, '0')}` : ''}`;
}
