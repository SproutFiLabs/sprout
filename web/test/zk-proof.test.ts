import type { ZkEnvelope } from '@sprout/shared/zk';
import { describe, expect, test } from 'bun:test';
import {
  ZK_BASE_FIELD,
  ZK_FIELD,
  ZK_TTL_MS,
  zkCertificateSchema,
  zkEnvelopeSchema,
  zkThresholdSchema,
} from '@sprout/shared/zk';
import { parseProof, proofFromHash } from '../src/privacy/zk-client';

const certificate = {
  id: '00000000000000000000000000000001',
  commitment: '123',
  thresholdCents: '50000',
  scope: '1',
  issuedAt: 1_000,
  expiresAt: 1_000 + ZK_TTL_MS,
};
// Parser fixture only. Mathematical validity is covered by test:zk and Solidity tests.
const point: [string, string, string] = ['1', '2', '1'];
const envelope: ZkEnvelope = {
  version: 1,
  circuit: 'sprout-milestone-v1',
  certificate,
  publicSignals: ['123', '50000', '1'],
  proof: {
    A: point,
    B: point,
    C: point,
    Z: point,
    T1: point,
    T2: point,
    T3: point,
    Wxi: point,
    Wxiw: point,
    eval_a: '1',
    eval_b: '1',
    eval_c: '1',
    eval_s1: '1',
    eval_s2: '1',
    eval_zw: '1',
    protocol: 'plonk',
    curve: 'bn128',
  },
};
describe('strict private proof transport', () => {
  test('round trips the disclosed proof and no extra private fields', () => {
    expect(parseProof(JSON.stringify(envelope))).toEqual(envelope);
    const hash =
      '#proof=' + btoa(JSON.stringify(envelope)).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
    expect(proofFromHash(hash)).toEqual(envelope);
    for (const extra of [{ balance: '125000' }, { wallet: '0x123' }, { salt: 'secret' }, { name: 'child' }]) {
      expect(zkEnvelopeSchema.safeParse({ ...envelope, ...extra }).success).toBe(false);
      expect(zkEnvelopeSchema.safeParse({ ...envelope, certificate: { ...certificate, ...extra } }).success).toBe(
        false,
      );
      expect(zkEnvelopeSchema.safeParse({ ...envelope, proof: { ...envelope.proof, ...extra } }).success).toBe(false);
    }
  });
  test('rejects malformed or out of range values without throwing from safeParse', () => {
    for (const value of ['NaN', '-1', '01', '1e3', '0', (1n << 64n).toString(), '9'.repeat(300)]) {
      expect(zkThresholdSchema.safeParse(value).success).toBe(false);
    }
    expect(zkThresholdSchema.safeParse(((1n << 64n) - 1n).toString()).success).toBe(true);
    expect(
      zkEnvelopeSchema.safeParse({ ...envelope, proof: { ...envelope.proof, eval_a: ZK_FIELD.toString() } }).success,
    ).toBe(false);
    expect(
      zkEnvelopeSchema.safeParse({ ...envelope, proof: { ...envelope.proof, A: [ZK_BASE_FIELD.toString(), '1', '1'] } })
        .success,
    ).toBe(false);
    expect(zkCertificateSchema.safeParse({ ...certificate, id: 'not-hex' }).success).toBe(false);
  });
  test('binds all public signals, certificate scope and lifetime', () => {
    for (let i = 0; i < 3; i++) {
      const publicSignals = [...envelope.publicSignals];
      publicSignals[i] = '999';
      expect(zkEnvelopeSchema.safeParse({ ...envelope, publicSignals }).success).toBe(false);
    }
    expect(zkCertificateSchema.safeParse({ ...certificate, scope: '2' }).success).toBe(false);
    expect(zkCertificateSchema.safeParse({ ...certificate, expiresAt: certificate.expiresAt + 1 }).success).toBe(false);
  });
  test('rejects oversized and malformed imports', () => {
    for (const value of ['x'.repeat(16385), '{bad json}', '{}']) expect(() => parseProof(value)).toThrow();
    for (const hash of ['#proof=invalid!', '#proof=' + 'x'.repeat(24_000), '#proof=e30'])
      expect(() => proofFromHash(hash)).toThrow();
  });
});
