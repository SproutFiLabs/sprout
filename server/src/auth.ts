import { randomBytes } from 'node:crypto';
import { getAddress, verifyMessage } from 'viem';
import type { SproutDb } from './db';
import { consumeNonce, createNonce, getNonce, type NonceRecord } from './repo';

export class AuthError extends Error {
  status: number;
  constructor(message: string, status = 401) {
    super(message);
    this.name = 'AuthError';
    this.status = status;
  }
}

export interface NonceChallenge {
  nonce: string;
  address: string;
  purpose: string;
  message: string;
  expiresAt: number;
}

function buildMessage(address: string, purpose: string, nonce: string, expiresAt: number): string {
  return [
    'Sprout authentication',
    `Address: ${getAddress(address)}`,
    `Purpose: ${purpose}`,
    `Nonce: ${nonce}`,
    `Expires: ${new Date(expiresAt).toISOString()}`,
  ].join('\n');
}

export function issueNonce(
  db: SproutDb,
  input: { address: string; purpose: string; ttlMs?: number; now?: number },
): NonceChallenge {
  const address = getAddress(input.address);
  const purpose = input.purpose;
  const issuedAt = input.now ?? Date.now();
  const expiresAt = issuedAt + (input.ttlMs ?? 5 * 60 * 1000);
  const nonce = randomBytes(16).toString('hex');
  const record: NonceRecord = {
    nonce,
    address,
    purpose,
    message: buildMessage(address, purpose, nonce, expiresAt),
    expiresAt,
    usedAt: null,
    createdAt: issuedAt,
  };
  createNonce(db, record);
  return { nonce, address, purpose, message: record.message, expiresAt };
}

/**
 * Verify a signed nonce challenge and consume it. Returns the recovered,
 * checksummed signer address that was bound to the nonce. An address supplied
 * by the client is never trusted without a matching signature.
 */
export async function authenticate(
  db: SproutDb,
  input: { address: string; nonce: string; signature: string; purpose: string; now?: number },
): Promise<string> {
  const at = input.now ?? Date.now();
  const record = getNonce(db, input.nonce);
  if (!record) throw new AuthError('unknown nonce');
  if (record.usedAt !== null) throw new AuthError('nonce already used');
  if (record.expiresAt < at) throw new AuthError('nonce expired');
  if (record.purpose !== input.purpose) throw new AuthError('nonce purpose mismatch');

  let claimed: string;
  try {
    claimed = getAddress(input.address);
  } catch {
    throw new AuthError('invalid address');
  }
  if (claimed !== record.address) throw new AuthError('address does not match nonce');

  let valid = false;
  try {
    valid = await verifyMessage({
      address: record.address as `0x${string}`,
      message: record.message,
      signature: input.signature as `0x${string}`,
    });
  } catch {
    valid = false;
  }
  if (!valid) throw new AuthError('invalid signature');

  // Atomic single-use: only one concurrent caller can flip used_at from NULL.
  if (!consumeNonce(db, record.nonce, at)) throw new AuthError('nonce already used');
  return record.address;
}
