import { afterEach, expect, test } from 'bun:test';
import { createVault, createGiftKeys, encryptGift } from '../src/privacy/crypto';
import {
  getNickname,
  initializeLabels,
  labelsUnlocked,
  lockLabels,
  setFamilyOwner,
  setPrivateLabel,
  unlockLabels,
  flushPrivateLabels,
} from '../src/localStore';
import { decodeGiftNotes } from '../src/api';
const values = new Map<string, string>();
const storage = {
  getItem: (k: string) => values.get(k) ?? null,
  setItem: (k: string, v: string) => {
    values.set(k, v);
  },
  removeItem: (k: string) => {
    values.delete(k);
  },
  key: (i: number) => [...values.keys()][i] ?? null,
  get length() {
    return values.size;
  },
};
const previousWindow = globalThis.window;
const previousStorage = globalThis.localStorage;
function browser() {
  Object.defineProperty(globalThis, 'window', {
    value: { dispatchEvent: () => true },
    configurable: true,
    writable: true,
  });
  Object.defineProperty(globalThis, 'localStorage', {
    value: storage,
    configurable: true,
    writable: true,
  });
  values.clear();
  setFamilyOwner('family-a');
}
afterEach(() => {
  lockLabels();
  Object.defineProperty(globalThis, 'window', {
    value: previousWindow,
    configurable: true,
    writable: true,
  });
  Object.defineProperty(globalThis, 'localStorage', {
    value: previousStorage,
    configurable: true,
    writable: true,
  });
});

test('an unlock in flight cannot publish keys after account changes or locking', async () => {
  browser();
  const original = await createVault('family-a', 'private passphrase for testing', {
    'sprout.nickname.vault': 'Secret child A',
  });
  storage.setItem('sprout.private.v1.family-a', JSON.stringify(original.vault));
  for (const action of [() => setFamilyOwner('family-b'), () => lockLabels()]) {
    setFamilyOwner('family-a');
    const pending = unlockLabels('private passphrase for testing');
    action();
    await expect(pending).rejects.toThrow('Family changed');
    expect(labelsUnlocked()).toBe(false);
    expect(getNickname('vault')).toBeNull();
  }
});
test('initialization interrupted by an account switch preserves legacy data and never writes the other owner', async () => {
  browser();
  storage.setItem('sprout.nickname.vault', 'Keep this label');
  const pending = initializeLabels('private passphrase for testing');
  setFamilyOwner('family-b');
  await expect(pending).rejects.toThrow('Family changed');
  expect(storage.getItem('sprout.nickname.vault')).toBe('Keep this label');
  expect(storage.getItem('sprout.private.v1.family-b')).toBeNull();
});
test('a decrypt in flight returns no private message after a lock', async () => {
  browser();
  await initializeLabels('private passphrase for testing');
  const keys = await createGiftKeys();
  setPrivateLabel('gift.privateKey', keys.privateKey);
  await flushPrivateLabels();
  const note = await encryptGift(keys.publicKey, 'gift', {
    name: 'Secret name',
    note: 'Secret message',
  });
  const pending = decodeGiftNotes('gift', [
    {
      name: null,
      note,
      token: null,
      amount: null,
      blockNumber: null,
      txHash: '0x',
      logIndex: 0,
    },
  ]);
  lockLabels();
  const result = await pending;
  expect(JSON.stringify(result)).not.toContain('Secret');
});

test('legacy migration only takes labels for the authenticated family sprouts', async () => {
  browser();
  storage.setItem('sprout.nickname.vault-a', 'Family A child');
  storage.setItem('sprout.nickname.vault-b', 'Family B child');
  await initializeLabels('private passphrase for testing', ['vault-a']);
  expect(getNickname('vault-a')).toBe('Family A child');
  expect(getNickname('vault-b')).toBeNull();
  expect(storage.getItem('sprout.nickname.vault-a')).toBeNull();
  expect(storage.getItem('sprout.nickname.vault-b')).toBe('Family B child');
});
