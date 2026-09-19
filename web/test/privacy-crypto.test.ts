import { expect, test } from 'bun:test';
import { createVault, unlockVault, seal, createGiftKeys, encryptGift, decryptGift } from '../src/privacy/crypto';

test('encrypted backup supports passphrase and recovery, rejects wrong wallet/key and tampering', async () => {
  const owner = 'test-family';
  const result = await createVault(owner, 'a long unique test passphrase', {
    name: 'Private child',
  });
  expect(JSON.stringify(result.vault)).not.toContain('Private child');
  expect((await unlockVault(result.vault, owner, 'a long unique test passphrase')).data.name).toBe('Private child');
  expect((await unlockVault(result.vault, owner, result.recovery, true)).data.name).toBe('Private child');
  expect(unlockVault(result.vault, owner, 'wrong passphrase')).rejects.toThrow();
  expect(unlockVault(result.vault, 'other-family', result.recovery, true)).rejects.toThrow();
  const tampered = structuredClone(result.vault);
  tampered.data.ciphertext = 'AAAA' + tampered.data.ciphertext.slice(4);
  expect(unlockVault(tampered, owner, result.recovery, true)).rejects.toThrow();
  const same = await seal(result.key, JSON.stringify({ name: 'Private child' }), `${owner}:data`);
  expect(same.iv).not.toBe(result.vault.data.iv);
  expect(same.ciphertext).not.toBe(result.vault.data.ciphertext);
});
test('gift message can only be opened with recipient key and matching gift context', async () => {
  const family = await createGiftKeys();
  const other = await createGiftKeys();
  const note = { name: 'Grandma', note: 'Private birthday wishes' };
  const encrypted = await encryptGift(family.publicKey, 'gift-one', note);
  expect(encrypted).not.toContain('Grandma');
  expect(encrypted).not.toContain(note.note);
  expect(await decryptGift(family.privateKey, 'gift-one', encrypted)).toEqual(note);
  expect(decryptGift(other.privateKey, 'gift-one', encrypted)).rejects.toThrow();
  expect(decryptGift(family.privateKey, 'gift-two', encrypted)).rejects.toThrow();
}, 15000);
