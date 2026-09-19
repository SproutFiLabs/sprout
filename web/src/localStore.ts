import { createVault, unlockVault, seal, createGiftKeys, type EncryptedVault } from './privacy/crypto';
const PREFIX = 'sprout.private.v1.';
let owner = '';
let generation = 0;
const unchanged = (version: number, address: string) => {
  if (version !== generation || address !== owner)
    throw new Error('Family changed or was locked. Please unlock again.');
};
let key: CryptoKey | null = null;
let data: Record<string, string> = {};
let queue = Promise.resolve();
let persistenceError = '';
const notify = () => window.dispatchEvent(new Event('sprout-privacy-change'));
export const privateEpoch = () => generation;
export const labelsUnlocked = () => key !== null;
export const privateStoreError = () => persistenceError;
export function setFamilyOwner(address: string) {
  if (owner !== address.toLowerCase()) {
    lockLabels();
    owner = address.toLowerCase();
  }
}
export function lockLabels() {
  generation++;
  key = null;
  data = {};
  notify();
}
export function requirePrivateLabels(text: string) {
  if (text.trim() && !key) throw new Error('Open Family privacy and unlock your encrypted labels first.');
}
export function hasPrivateVault() {
  return !!owner && !!localStorage.getItem(PREFIX + owner);
}
function legacyLabels(vaults: string[]): Record<string, string> {
  const allowed = new Set(vaults.map((v) => v.toLowerCase()));
  const result: Record<string, string> = {};
  for (let i = 0; i < localStorage.length; i++) {
    const name = localStorage.key(i)!;
    const parts = name.split('.');
    const vault = parts[1] === 'nickname' ? parts[2] : parts[1] === 'milestone' ? parts[3] : undefined;
    if (parts[0] === 'sprout' && vault && allowed.has(vault.toLowerCase())) result[name] = localStorage.getItem(name)!;
    // Migrate a legacy favorite list only when every entry belongs to this family.
    if (name === 'sprout.favorite.') {
      try {
        const items = JSON.parse(localStorage.getItem(name) ?? '[]');
        if (Array.isArray(items) && items.every((v) => typeof v === 'string' && allowed.has(v.toLowerCase())))
          result[name] = JSON.stringify(items);
      } catch {
        /* preserve malformed legacy data rather than destroy it */
      }
    }
  }
  return result;
}
export async function initializeLabels(password: string, vaults: string[] = []) {
  if (!owner) throw new Error('Connect your family wallet first.');
  if (hasPrivateVault()) throw new Error('Unlock your existing vault to preserve its labels.');
  const activeOwner = owner;
  const version = generation;
  const legacy = legacyLabels(vaults);
  const giftKeys = await createGiftKeys();
  legacy['gift.publicKey'] = giftKeys.publicKey;
  legacy['gift.privateKey'] = giftKeys.privateKey;
  const result = await createVault(activeOwner, password, legacy);
  unchanged(version, activeOwner);
  localStorage.setItem(PREFIX + activeOwner, JSON.stringify(result.vault));
  // Delete old plaintext only after a successful encrypted write + decrypt check.
  await unlockVault(JSON.parse(localStorage.getItem(PREFIX + activeOwner)!), activeOwner, password);
  unchanged(version, activeOwner);
  for (const name of Object.keys(legacy)) if (name.startsWith('sprout.')) localStorage.removeItem(name);
  key = result.key;
  data = legacy;
  notify();
  return result.recovery;
}
export async function unlockLabels(password: string, recovery = false, backup?: string) {
  const activeOwner = owner;
  const version = generation;
  const raw = backup ?? localStorage.getItem(PREFIX + activeOwner);
  if (!raw) throw new Error('No encrypted labels saved on this device.');
  const vault = JSON.parse(raw) as EncryptedVault;
  const result = await unlockVault(vault, activeOwner, password, recovery);
  unchanged(version, activeOwner);
  // Never replace a newer existing store through an accidental import.
  if (backup && hasPrivateVault())
    throw new Error('This device already has a vault. Restore on a fresh browser profile.');
  if (backup) localStorage.setItem(PREFIX + owner, raw);
  key = result.key;
  data = result.data;
  persistenceError = '';
  notify();
}
export async function encryptedBackup() {
  await queue;
  if (persistenceError) throw new Error(persistenceError);
  return localStorage.getItem(PREFIX + owner) ?? '';
}
export async function flushPrivateLabels() {
  await queue;
  if (persistenceError) throw new Error(persistenceError);
}
export function getPrivateLabel(name: string): string | null {
  return key ? (data[name] ?? null) : null;
}
export function setPrivateLabel(name: string, value: string) {
  if (!key) {
    if (value.trim()) requirePrivateLabels(value);
    return;
  }
  if (value.trim()) data[name] = value.trim();
  else delete data[name];
  const activeKey = key;
  const activeOwner = owner;
  const snapshot = JSON.stringify(data);
  queue = queue
    .then(async () => {
      const vault = JSON.parse(localStorage.getItem(PREFIX + activeOwner)!) as EncryptedVault;
      vault.data = await seal(activeKey, snapshot, `${activeOwner}:data`);
      localStorage.setItem(PREFIX + activeOwner, JSON.stringify(vault));
      persistenceError = '';
    })
    .catch(() => {
      persistenceError = 'Private labels could not be saved. Keep this tab open and export after storage is available.';
    })
    .finally(notify);
  notify();
}
export const getNickname = (vault: string) => getPrivateLabel(`sprout.nickname.${vault.toLowerCase()}`);
export const setNickname = (vault: string, name: string) =>
  setPrivateLabel(`sprout.nickname.${vault.toLowerCase()}`, name);
const milestoneKey = (chain: number, vault: string, id: string) =>
  `sprout.milestone.${chain}.${vault.toLowerCase()}.${id.toLowerCase()}`;
export const getMilestoneTitle = (chain: number, vault: string, id: string) =>
  getPrivateLabel(milestoneKey(chain, vault, id));
export const setMilestoneTitle = (chain: number, vault: string, id: string, title: string) =>
  setPrivateLabel(milestoneKey(chain, vault, id), title);
export function getFavorites(): string[] {
  try {
    return JSON.parse(getPrivateLabel('sprout.favorite.') ?? '[]');
  } catch {
    return [];
  }
}
export function toggleFavorite(vault: string) {
  const current = getFavorites();
  const v = vault.toLowerCase();
  const next = current.includes(v) ? current.filter((x) => x !== v) : [...current, v];
  if (key) setPrivateLabel('sprout.favorite.', JSON.stringify(next));
  return next;
}

const ONE_OFF_SCHEDULE_PREFIX = 'sprout.investNow.scheduleTx.';

/**
 * Invest now sets the vault's schedule for a moment to run a one-off purchase,
 * then clears it. The indexer records that as a plan that was cancelled, which
 * the dashboard would otherwise offer to "resume". Remember which schedule
 * transactions were one-off purchases so they are not presented as plans.
 */
export function rememberOneOffSchedule(vaultId: string, txHash: string): void {
  try {
    const key = ONE_OFF_SCHEDULE_PREFIX + vaultId.toLowerCase();
    const current = JSON.parse(window.localStorage.getItem(key) ?? '[]') as string[];
    const next = [...current.filter((h) => h !== txHash.toLowerCase()), txHash.toLowerCase()].slice(-20);
    window.localStorage.setItem(key, JSON.stringify(next));
  } catch {
    // storage may be unavailable in private mode
  }
}

export function isOneOffSchedule(vaultId: string, txHash: string | null | undefined): boolean {
  if (!txHash) return false;
  try {
    const list = JSON.parse(window.localStorage.getItem(ONE_OFF_SCHEDULE_PREFIX + vaultId.toLowerCase()) ?? '[]') as string[];
    return list.includes(txHash.toLowerCase());
  } catch {
    return false;
  }
}

