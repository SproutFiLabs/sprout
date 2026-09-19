/**
 * Data for the privacy checkup and "Delete my family's data": the server's
 * family report, the public on-chain picture of each sprout, and this
 * browser's own Sprout storage. Mirrors server/src/privacyPack.ts.
 */
import type { Address } from 'viem';
import { familyHeaders, getJson, signedPostJson, type ChainEvent, type Holdings, type Sprout } from '../api';
import type { WalletState } from '../wallet';
import { flushPrivateLabels, getPrivateLabel, labelsUnlocked, setPrivateLabel } from '../localStore';
import { t } from '../i18n';

export const ERASE_CONFIRM = 'DELETE';

export interface SproutFootprint {
  id: Address;
  beneficiary: Address;
  factory: Address | null;
  graduationTimestamp: number;
  gifts: { links: number; plainLabels: number; campaigns: number; plainCampaignTitles: number; payments: number };
  notes: { total: number; encrypted: number; plain: number; hidden: number };
  invites: { total: number; waiting: number; openNow: number; balanceVisible: number; ended: number };
  proofs: { total: number; active: number };
  chores: { total: number; open: number; described: number };
  kept: { events: number; snapshots: number; jobs: number; keeperTxs: number };
}

export interface EraseCounts {
  familyLedger?: number;
  familyPlans?: number;
  giftLinks: number;
  campaigns: number;
  giftNotes: number;
  giftPayments: number;
  kidInvites: number;
  kidSessions: number;
  proofs: number;
  choreDescriptions: number;
  giftKey: number;
  sessions: number;
  signIns: number;
}

export interface FamilyFootprint {
  address: string;
  sprouts: SproutFootprint[];
  beneficiaryOf: number;
  giftKeyRegistered: boolean;
  activeSessions: number;
  legacyText: Array<{ giftId: string; label: string | null; title: string | null }>;
  erase: EraseCounts;
  kept: { sprouts: number; events: number; snapshots: number; chores: number; jobs: number; keeperTxs: number };
}

export interface PlainNote {
  giftId: string;
  txHash: string;
  logIndex: number;
  name: string | null;
  note: string | null;
  hidden: boolean;
}

export interface EraseResult {
  erased: EraseCounts;
  kept: FamilyFootprint['kept'];
  inviteIds: string[];
}

export const packApi = {
  report: () => getJson<FamilyFootprint>('/api/family/privacy-report'),
  /** Signed, like the dashboard's full note list: it includes hidden notes. */
  plainNotes: (wallet: WalletState) => signedPostJson<{ notes: PlainNote[] }>(wallet, '/api/family/plain-notes', 'gift-notes-plain', {}),
  encryptNotes: (wallet: WalletState, notes: Array<{ giftId: string; txHash: string; logIndex: number; encryptedNote: string }>) =>
    signedPostJson<{ encrypted: number; skipped: number }>(wallet, '/api/family/plain-notes/encrypt', 'encrypt-gift-notes', { notes }),
  clearServerLabels: (wallet: WalletState, giftIds: string[]) =>
    signedPostJson<{ labels: number; titles: number }>(wallet, '/api/family/server-labels/clear', 'clear-server-labels', { giftIds }),
  revokeAllKidLinks: (wallet: WalletState) =>
    signedPostJson<{ revoked: number }>(wallet, '/api/family/kid-links/revoke-all', 'kid-revoke-all', {}),
  /** Needs the family session and a fresh signature from the same wallet. */
  erase: (wallet: WalletState, vaults: string[]) =>
    signedPostJson<EraseResult>(wallet, '/api/family/erase', 'erase-family-data', { confirm: ERASE_CONFIRM, vaults }, familyHeaders()),
};

/** The server's own message from a failed request ("429 {"error":"…"}"), else the error text; shown translated. */
export function errorMessage(error: unknown): string {
  const text = error instanceof Error ? error.message : String(error);
  const json = text.match(/^\d{3} (\{.*\})$/s)?.[1];
  if (json) {
    try {
      const parsed = JSON.parse(json) as { error?: unknown };
      if (typeof parsed.error === 'string') return t(parsed.error);
    } catch {
      /* fall through */
    }
  }
  return t(text);
}

// ---- what anyone can see ------------------------------------------------------

export interface WalletActivity {
  address: string;
  count: number;
  /** Raw amounts per token address (lowercase). */
  amounts: Record<string, bigint>;
}

export interface PublicPicture {
  gifts: { count: number; wallets: WalletActivity[] };
  deposits: { fromParent: number; fromOthers: WalletActivity[] };
  purchases: number;
  choreRewards: number;
  claims: number;
  withdrawals: { count: number; to: string[] };
}

function addActivity(list: WalletActivity[], address: string, token: string, amount: unknown): void {
  const key = address.toLowerCase();
  let entry = list.find((w) => w.address.toLowerCase() === key);
  if (!entry) {
    entry = { address, count: 0, amounts: {} };
    list.push(entry);
  }
  entry.count += 1;
  try {
    const t = token.toLowerCase();
    entry.amounts[t] = (entry.amounts[t] ?? 0n) + BigInt(String(amount ?? 0));
  } catch {
    /* an unreadable amount still counts as a transfer */
  }
}

/** What the sprout's public events say about who put money in and took it out. */
export function publicPicture(events: ChainEvent[], parent: string): PublicPicture {
  const gifts: WalletActivity[] = [];
  const others: WalletActivity[] = [];
  const withdrawnTo = new Set<string>();
  let fromParent = 0;
  let purchases = 0;
  let choreRewards = 0;
  let claims = 0;
  let giftCount = 0;
  let withdrawals = 0;
  for (const e of events) {
    const p = (e.payload ?? {}) as Record<string, unknown>;
    const token = String(p.token ?? '');
    switch (e.eventName) {
      case 'GiftReceived':
        giftCount += 1;
        addActivity(gifts, String(p.gifter ?? ''), token, p.amount);
        break;
      case 'Funded':
        if (String(p.from ?? '').toLowerCase() === parent.toLowerCase()) fromParent += 1;
        else addActivity(others, String(p.from ?? ''), token, p.amount);
        break;
      case 'InvestmentExecuted':
        purchases += 1;
        break;
      case 'MilestoneCreated':
        choreRewards += 1;
        break;
      case 'AllowanceClaimed':
        claims += 1;
        break;
      case 'Withdrawn':
        withdrawals += 1;
        withdrawnTo.add(String(p.to ?? ''));
        break;
      default:
        break;
    }
  }
  const byCount = (a: WalletActivity, b: WalletActivity) => b.count - a.count;
  return {
    gifts: { count: giftCount, wallets: gifts.sort(byCount) },
    deposits: { fromParent, fromOthers: others.sort(byCount) },
    purchases,
    choreRewards,
    claims,
    withdrawals: { count: withdrawals, to: [...withdrawnTo] },
  };
}

/** Holdings a stranger would see: every token with a nonzero balance. */
export function publicHoldings(holdings: Holdings | null): Holdings['holdings'] {
  if (!holdings?.available) return [];
  return holdings.holdings.filter((h) => h.rawBalance !== '0');
}

export interface SproutPublicView {
  sprout: Sprout;
  holdings: Holdings | null;
  events: ChainEvent[];
  picture: PublicPicture;
}

// ---- this browser -------------------------------------------------------------

export type KeyStore = Pick<Storage, 'getItem' | 'setItem' | 'removeItem' | 'key' | 'length'>;

const VAULT_PREFIX = 'sprout.private.v1.';

function storage(kind: 'local' | 'session'): KeyStore | null {
  try {
    return kind === 'local' ? window.localStorage : window.sessionStorage;
  } catch {
    return null;
  }
}

function keysOf(store: KeyStore): string[] {
  const keys: string[] = [];
  try {
    for (let i = 0; i < store.length; i++) {
      const k = store.key(i);
      if (k !== null) keys.push(k);
    }
  } catch {
    /* unreadable storage has nothing we can list */
  }
  return keys;
}

/** The sprout a Sprout storage key belongs to, if any. */
function vaultOfKey(key: string): string | null {
  const parts = key.split('.');
  if (parts[0] !== 'sprout') return null;
  if (parts[1] === 'nickname') return parts[2] ?? null;
  if (parts[1] === 'milestone') return parts[3] ?? null;
  if (parts[1] === 'investNow') return parts[3] ?? null;
  if (parts[1] === 'learn') return parts[2] ?? null;
  return null;
}

function favoritesOf(store: KeyStore): string[] | null {
  try {
    const raw = store.getItem('sprout.favorite.');
    if (raw === null) return null;
    const items: unknown = JSON.parse(raw);
    return Array.isArray(items) ? items.filter((v): v is string => typeof v === 'string') : null;
  } catch {
    return null;
  }
}

export interface LocalFamilyData {
  /** This wallet's encrypted Family privacy vault is on this device. */
  vault: boolean;
  /** Older plaintext labels for these sprouts (names, chore titles, favourites). */
  plainLabels: string[];
  /** Other per-sprout helpers (Invest now markers, lesson progress). */
  helpers: string[];
}

/** What this browser keeps for this wallet's sprouts. */
export function localFamilyData(owner: string, vaults: string[], store: KeyStore | null = storage('local')): LocalFamilyData {
  const result: LocalFamilyData = { vault: false, plainLabels: [], helpers: [] };
  if (!store) return result;
  const mine = new Set(vaults.map((v) => v.toLowerCase()));
  for (const key of keysOf(store)) {
    if (key === VAULT_PREFIX + owner.toLowerCase()) result.vault = true;
    const vault = vaultOfKey(key)?.toLowerCase();
    if (!vault || !mine.has(vault)) continue;
    if (key.startsWith('sprout.nickname.') || key.startsWith('sprout.milestone.')) result.plainLabels.push(key);
    else result.helpers.push(key);
  }
  const favorites = favoritesOf(store);
  if (favorites?.some((v) => mine.has(v.toLowerCase()))) result.plainLabels.push('sprout.favorite.');
  return result;
}

/** The vault's key for an older label (the vault reads addresses and ids in lower case). */
export function normalizeLabelKey(key: string): string {
  const parts = key.split('.');
  if (parts[1] === 'nickname' && parts[2]) parts[2] = parts[2].toLowerCase();
  if (parts[1] === 'milestone') {
    if (parts[3]) parts[3] = parts[3].toLowerCase();
    if (parts[4]) parts[4] = parts[4].toLowerCase();
  }
  return parts.join('.');
}

/**
 * Move older plaintext labels for these sprouts into the unlocked vault, then
 * remove the plaintext copies (only after the vault has saved them). A label
 * the vault already holds is kept as the vault has it.
 */
export async function moveLabelsIntoVault(owner: string, vaults: string[], store: KeyStore | null = storage('local')): Promise<number> {
  if (!labelsUnlocked()) throw new Error('Open Family privacy and unlock your encrypted labels first.');
  if (!store) return 0;
  const { plainLabels } = localFamilyData(owner, vaults, store);
  const mine = new Set(vaults.map((v) => v.toLowerCase()));
  let moved = 0;
  for (const key of plainLabels) {
    const value = store.getItem(key);
    if (value === null) continue;
    if (key === 'sprout.favorite.') {
      const mineOnly = (favoritesOf(store) ?? []).filter((v) => mine.has(v.toLowerCase()));
      const existing = (() => {
        try {
          return JSON.parse(getPrivateLabel(key) ?? '[]') as string[];
        } catch {
          return [];
        }
      })();
      setPrivateLabel(key, JSON.stringify([...new Set([...existing, ...mineOnly.map((v) => v.toLowerCase())])]));
    } else if (getPrivateLabel(normalizeLabelKey(key)) === null) {
      setPrivateLabel(normalizeLabelKey(key), value);
    }
    moved += 1;
  }
  await flushPrivateLabels();
  for (const key of plainLabels) {
    if (key !== 'sprout.favorite.') store.removeItem(key);
    else {
      const rest = (favoritesOf(store) ?? []).filter((v) => !mine.has(v.toLowerCase()));
      if (rest.length) store.setItem(key, JSON.stringify(rest));
      else store.removeItem(key);
    }
  }
  return moved;
}

/**
 * Remove this wallet's family data from this browser: its encrypted vault,
 * older plaintext labels and helpers for these sprouts, and kid sessions for
 * erased invitations. Appearance, language and discreet mode stay.
 */
export function clearLocalFamilyData(
  owner: string,
  vaults: string[],
  inviteIds: string[],
  stores: { local: KeyStore | null; session: KeyStore | null } = { local: storage('local'), session: storage('session') },
): number {
  let removed = 0;
  const remove = (store: KeyStore | null, key: string) => {
    try {
      if (store && store.getItem(key) !== null) {
        store.removeItem(key);
        removed += 1;
      }
    } catch {
      /* storage may be blocked */
    }
  };
  const local = stores.local;
  if (local) {
    const found = localFamilyData(owner, vaults, local);
    remove(local, VAULT_PREFIX + owner.toLowerCase());
    for (const key of [...found.plainLabels, ...found.helpers]) {
      if (key !== 'sprout.favorite.') remove(local, key);
    }
    if (found.plainLabels.includes('sprout.favorite.')) {
      const mine = new Set(vaults.map((v) => v.toLowerCase()));
      const rest = (favoritesOf(local) ?? []).filter((v) => !mine.has(v.toLowerCase()));
      try {
        if (rest.length) local.setItem('sprout.favorite.', JSON.stringify(rest));
        else local.removeItem('sprout.favorite.');
        removed += 1;
      } catch {
        /* storage may be blocked */
      }
    }
  }
  for (const id of inviteIds) {
    remove(stores.session, `sprout.kid.session.${id}`);
    // A kid view opened in this browser keeps lesson progress under its invitation.
    remove(local, `sprout.learn.${id}`);
  }
  remove(stores.session, 'sprout-pending-nickname');
  return removed;
}
