/** WebCrypto only. Keys never leave this module except explicit recovery exports. */
const encoder = new TextEncoder();
const decoder = new TextDecoder();
export const b64 = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes));
export const un64 = (value: string) => Uint8Array.from(atob(value), (c) => c.charCodeAt(0));
const random = (n: number) => crypto.getRandomValues(new Uint8Array(n));
const aad = (context: string) => encoder.encode(`sprout-family-v1:${context}`);
export interface Box {
  iv: string;
  ciphertext: string;
}
export interface EncryptedVault {
  version: 1;
  owner: string;
  salt: string;
  wrappedKey: Box;
  data: Box;
}
export async function importKey(raw: Uint8Array) {
  return crypto.subtle.importKey('raw', new Uint8Array(raw), 'AES-GCM', false, ['encrypt', 'decrypt']);
}
export async function seal(key: CryptoKey, value: string, context: string): Promise<Box> {
  const iv = random(12);
  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv, additionalData: aad(context) },
    key,
    encoder.encode(value),
  );
  return { iv: b64(iv), ciphertext: b64(new Uint8Array(ciphertext)) };
}
export async function open(key: CryptoKey, box: Box, context: string) {
  return decoder.decode(
    await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: un64(box.iv), additionalData: aad(context) },
      key,
      un64(box.ciphertext),
    ),
  );
}
async function passwordKey(password: string, salt: Uint8Array) {
  const material = await crypto.subtle.importKey('raw', encoder.encode(password), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt: new Uint8Array(salt),
      iterations: 600_000,
      hash: 'SHA-256',
    },
    material,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}
export async function createVault(owner: string, password: string, data: Record<string, string>) {
  if (password.length < 12) throw new Error('Use a passphrase of at least 12 characters.');
  const raw = random(32);
  const key = await importKey(raw);
  const salt = random(16);
  const vault: EncryptedVault = {
    version: 1,
    owner,
    salt: b64(salt),
    wrappedKey: await seal(await passwordKey(password, salt), b64(raw), `${owner}:key`),
    data: await seal(key, JSON.stringify(data), `${owner}:data`),
  };
  return { key, vault, recovery: b64(raw) };
}
export async function unlockVault(vault: EncryptedVault, owner: string, password: string, recovery = false) {
  if (vault.version !== 1 || vault.owner !== owner)
    throw new Error('This backup belongs to a different family wallet.');
  const raw = recovery
    ? password.trim()
    : await open(await passwordKey(password, un64(vault.salt)), vault.wrappedKey, `${owner}:key`);
  const key = await importKey(un64(raw));
  const data: unknown = JSON.parse(await open(key, vault.data, `${owner}:data`));
  if (
    !data ||
    typeof data !== 'object' ||
    Array.isArray(data) ||
    Object.values(data).some((v) => typeof v !== 'string')
  )
    throw new Error('Invalid private vault.');
  return { key, data: data as Record<string, string> };
}

/** Hybrid gift envelopes: RSA-OAEP wraps a fresh AES key; AES-GCM binds the gift ID. */
export async function createGiftKeys() {
  const pair = await crypto.subtle.generateKey(
    {
      name: 'RSA-OAEP',
      modulusLength: 3072,
      publicExponent: new Uint8Array([1, 0, 1]),
      hash: 'SHA-256',
    },
    true,
    ['encrypt', 'decrypt'],
  );
  return {
    publicKey: b64(new Uint8Array(await crypto.subtle.exportKey('spki', pair.publicKey))),
    privateKey: b64(new Uint8Array(await crypto.subtle.exportKey('pkcs8', pair.privateKey))),
  };
}
export async function encryptGift(publicKey: string, giftId: string, message: { name?: string; note?: string }) {
  const rsa = await crypto.subtle.importKey('spki', un64(publicKey), { name: 'RSA-OAEP', hash: 'SHA-256' }, false, [
    'encrypt',
  ]);
  const raw = random(32);
  const wrapped = b64(new Uint8Array(await crypto.subtle.encrypt({ name: 'RSA-OAEP', label: aad(giftId) }, rsa, raw)));
  return (
    'encrypted:v1:' +
    JSON.stringify({
      wrapped,
      box: await seal(await importKey(raw), JSON.stringify(message), giftId),
    })
  );
}
export async function decryptGift(
  privateKey: string,
  giftId: string,
  envelope: string,
): Promise<{ name?: string; note?: string }> {
  const { wrapped, box } = JSON.parse(envelope.slice('encrypted:v1:'.length));
  const rsa = await crypto.subtle.importKey('pkcs8', un64(privateKey), { name: 'RSA-OAEP', hash: 'SHA-256' }, false, [
    'decrypt',
  ]);
  const raw = await crypto.subtle.decrypt({ name: 'RSA-OAEP', label: aad(giftId) }, rsa, un64(wrapped));
  const result = JSON.parse(await open(await importKey(new Uint8Array(raw)), box, giftId));
  if (
    (typeof result.name !== 'undefined' && typeof result.name !== 'string') ||
    (typeof result.note !== 'undefined' && typeof result.note !== 'string')
  )
    throw new Error('Invalid message');
  return result;
}
