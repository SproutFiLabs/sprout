import { describe, expect, test } from 'bun:test';
import { authenticate, AuthError, issueNonce } from '../src/auth';
import { memoryDb } from './helpers';
import { account, otherAccount } from './helpers';

describe('wallet nonce authentication', () => {
  test('accepts a valid signature once and rejects replay', async () => {
    const db = memoryDb();
    const challenge = issueNonce(db, { address: account.address, purpose: 'plant' });
    const signature = await account.signMessage({ message: challenge.message });

    const signer = await authenticate(db, {
      address: account.address,
      nonce: challenge.nonce,
      signature,
      purpose: 'plant',
    });
    expect(signer).toBe(account.address);

    await expect(
      authenticate(db, { address: account.address, nonce: challenge.nonce, signature, purpose: 'plant' }),
    ).rejects.toThrow('already used');
  });

  test('rejects expired nonces', async () => {
    const db = memoryDb();
    const challenge = issueNonce(db, { address: account.address, purpose: 'plant' });
    const signature = await account.signMessage({ message: challenge.message });
    await expect(
      authenticate(db, {
        address: account.address,
        nonce: challenge.nonce,
        signature,
        purpose: 'plant',
        now: challenge.expiresAt + 1,
      }),
    ).rejects.toThrow('expired');
  });

  test('rejects a nonce used for a different purpose', async () => {
    const db = memoryDb();
    const challenge = issueNonce(db, { address: account.address, purpose: 'plant' });
    const signature = await account.signMessage({ message: challenge.message });
    await expect(
      authenticate(db, { address: account.address, nonce: challenge.nonce, signature, purpose: 'schedule' }),
    ).rejects.toThrow('purpose mismatch');
  });

  test('rejects a signature from a different wallet', async () => {
    const db = memoryDb();
    const challenge = issueNonce(db, { address: account.address, purpose: 'plant' });
    const signature = await otherAccount.signMessage({ message: challenge.message });
    await expect(
      authenticate(db, { address: account.address, nonce: challenge.nonce, signature, purpose: 'plant' }),
    ).rejects.toThrow('invalid signature');
  });

  test('rejects an address that does not match the nonce', async () => {
    const db = memoryDb();
    const challenge = issueNonce(db, { address: account.address, purpose: 'plant' });
    const signature = await account.signMessage({ message: challenge.message });
    await expect(
      authenticate(db, { address: otherAccount.address, nonce: challenge.nonce, signature, purpose: 'plant' }),
    ).rejects.toBeInstanceOf(AuthError);
  });

  test('concurrent reuse of one signed nonce yields exactly one success', async () => {
    const db = memoryDb();
    const challenge = issueNonce(db, { address: account.address, purpose: 'plant' });
    const signature = await account.signMessage({ message: challenge.message });
    const attempt = () =>
      authenticate(db, { address: account.address, nonce: challenge.nonce, signature, purpose: 'plant' });
    const results = await Promise.allSettled([attempt(), attempt(), attempt(), attempt()]);
    const fulfilled = results.filter((r) => r.status === 'fulfilled');
    expect(fulfilled).toHaveLength(1);
  });
});
