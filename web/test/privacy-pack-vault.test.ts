import { afterEach, expect, test } from 'bun:test';
import { getFavorites, getMilestoneTitle, getNickname, initializeLabels, lockLabels, setFamilyOwner } from '../src/localStore';
import { moveLabelsIntoVault } from '../src/privacyPack/data';

const values = new Map<string, string>();
const storage = {
  getItem: (k: string) => values.get(k) ?? null,
  setItem: (k: string, v: string) => void values.set(k, v),
  removeItem: (k: string) => void values.delete(k),
  key: (i: number) => [...values.keys()][i] ?? null,
  get length() {
    return values.size;
  },
};
const previousWindow = globalThis.window;
const previousStorage = globalThis.localStorage;
const OWNER = '0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266';
const MINE = '0x00000000000000000000000000000000000000A1';
const THEIRS = '0x00000000000000000000000000000000000000b1';

function browser() {
  Object.defineProperty(globalThis, 'window', { value: { dispatchEvent: () => true }, configurable: true, writable: true });
  Object.defineProperty(globalThis, 'localStorage', { value: storage, configurable: true, writable: true });
  values.clear();
  setFamilyOwner(OWNER);
}
afterEach(() => {
  lockLabels();
  Object.defineProperty(globalThis, 'window', { value: previousWindow, configurable: true, writable: true });
  Object.defineProperty(globalThis, 'localStorage', { value: previousStorage, configurable: true, writable: true });
});

test('older plaintext labels move into the unlocked vault; only this family’s plain copies are removed, after the vault saved them', async () => {
  browser();
  await initializeLabels('a family passphrase for tests', []);
  storage.setItem(`sprout.nickname.${MINE}`, 'Maya');
  storage.setItem(`sprout.milestone.31337.${MINE}.0xAbC`, 'Feed the cat');
  storage.setItem('sprout.favorite.', JSON.stringify([MINE, THEIRS]));
  storage.setItem(`sprout.nickname.${THEIRS}`, 'Not ours');

  expect(await moveLabelsIntoVault(OWNER, [MINE], storage)).toBe(3);
  expect(getNickname(MINE)).toBe('Maya');
  expect(getMilestoneTitle(31337, MINE, '0xabc')).toBe('Feed the cat');
  expect(getFavorites()).toEqual([MINE.toLowerCase()]);
  expect(storage.getItem(`sprout.nickname.${MINE}`)).toBeNull();
  expect(storage.getItem(`sprout.milestone.31337.${MINE}.0xAbC`)).toBeNull();
  expect(storage.getItem('sprout.favorite.')).toBe(JSON.stringify([THEIRS]));
  expect(storage.getItem(`sprout.nickname.${THEIRS}`)).toBe('Not ours');
  const vault = storage.getItem(`sprout.private.v1.${OWNER}`) ?? '';
  expect(vault).not.toContain('Maya');
  expect(vault).not.toContain('Feed the cat');
});

test('a label the vault already holds is kept as the vault has it', async () => {
  browser();
  storage.setItem(`sprout.nickname.${MINE.toLowerCase()}`, 'From the vault');
  await initializeLabels('a family passphrase for tests', [MINE]);
  storage.setItem(`sprout.nickname.${MINE}`, 'An older copy');
  await moveLabelsIntoVault(OWNER, [MINE], storage);
  expect(getNickname(MINE)).toBe('From the vault');
  expect(storage.getItem(`sprout.nickname.${MINE}`)).toBeNull();
});

test('nothing moves, and nothing is removed, while the vault is locked', async () => {
  browser();
  await initializeLabels('a family passphrase for tests', []);
  lockLabels();
  storage.setItem(`sprout.nickname.${MINE}`, 'Maya');
  await expect(moveLabelsIntoVault(OWNER, [MINE], storage)).rejects.toThrow('unlock');
  expect(storage.getItem(`sprout.nickname.${MINE}`)).toBe('Maya');
});
