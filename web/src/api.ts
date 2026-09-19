import type { ZkIssuance, ZkCertificateStatus } from '@sprout/shared/zk';
import type { Address } from 'viem';
import { sign, type WalletState } from './wallet';
import { encryptGift, decryptGift } from './privacy/crypto';
import { lockLabels, privateEpoch, setFamilyOwner, getPrivateLabel, setPrivateLabel, requirePrivateLabels, flushPrivateLabels } from './localStore';

export interface StockTokenPublic {
  symbol: string;
  address: Address;
  decimals: number;
  multiplier: string;
  feedAddress?: Address;
  heartbeatSeconds?: number;
}

export interface ChainPublic {
  chainId: number;
  name: string;
  explorerUrl?: string;
  isLocal: boolean;
  localDemo: boolean;
  configured: boolean;
  missing: string[];
  walletRpcUrl?: string;
  contracts: {
    factory?: Address;
    settlementToken?: Address;
    /** Ticker for the settlement token, e.g. USDG; absent on chains that do not set one. */
    settlementSymbol?: string;
    venue?: Address;
    settlementDecimals: number;
    stockTokens: StockTokenPublic[];
  };
}

/** Mirrors server/src/invest.ts. */
export interface InvestQuote {
  vault: Address;
  venue: Address | null;
  amount: string;
  available: string;
  chainTime: number;
  blockNumber: number;
  schedule: { active: boolean; amount: string; periodSeconds: number; nextExecution: number; maxSlippageBps: number };
  due: boolean;
  legs: Array<{
    asset: Address;
    symbol: string;
    weightBps: number;
    amountIn: string;
    expectedOut: string;
    floorOut: string;
    simulatedOut: string | null;
    minOut: string | null;
  }>;
  minOuts: string[] | null;
  blocker: { code: string; message: string; asset?: Address } | null;
}

export interface AutomationCapability {
  keeperConfigured: boolean;
  gasBudgetConfigured: boolean;
  enabled: boolean;
}

export interface Health {
  ok: boolean;
  chainId: number;
  chainName: string;
  configured: boolean;
  missing: string[];
  localDemo: boolean;
  /** `autoInvestTier`: the SPROUT holder tier a parent needs for automatic weekly investing; null means everyone. */
  automation: AutomationCapability & { autoInvestTier?: string | null };
}

export interface Sprout {
  id: Address;
  chainId: number;
  parent: Address;
  beneficiary: Address;
  settlementToken: Address;
  graduationTimestamp: number;
  assets: Address[];
  weights: number[];
  createdTxHash: string | null;
  createdBlock: number | null;
  createdAt: number;
  graduated?: boolean;
  role?: 'parent' | 'beneficiary';
  /** The factory that created this sprout (sent by newer servers; null when unknown). */
  factory?: Address | null;
  /**
   * Stock tokens that factory admitted: the only ones this sprout's mix can
   * ever use. Absent on older servers and null when unknown; callers then fall
   * back to the configured stock tokens.
   */
  admittedAssets?: Address[] | null;
}

export interface Milestone {
  id: string;
  vaultId: Address;
  token: Address;
  amount: string;
  unlockTime: number;
  status: 'created' | 'released' | 'cancelled';
  descriptionHash: string | null;
  createdTxHash: string | null;
  releasedTxHash: string | null;
}

export interface Job {
  id: string;
  vaultId: Address;
  amount: string;
  periodSeconds: number;
  nextRunAt: number;
  status: 'active' | 'cancelled' | 'paused' | 'unavailable';
  lastError: string | null;
  /** The schedule transaction (or, after a keeper run, the purchase). */
  lastTxHash?: string | null;
}

export interface GiftSummary {
  id: string;
  vaultId: Address;
  label: string | null;
  acceptedAssets: Address[];
  status: string;
  paymentCount: number;
  totals: Record<string, string>;
  /** Present when the link is a birthday campaign. */
  campaign?: GiftCampaign | null;
  /** Visible notes, newest first (the dashboard summary carries the latest few). */
  notes?: GiftNote[];
  hiddenNotes?: number;
}

/** Mirrors server/src/campaigns.ts. */
export interface GiftCampaign {
  title: string;
  goalCents: number;
  endsAt: number;
  raisedCents: number;
  otherGifts: Record<string, string>;
  ended: boolean;
}

export interface GiftNote {
  name: string | null;
  note: string | null;
  token: string | null;
  amount: string | null;
  blockNumber: number | null;
  txHash: string;
  logIndex: number;
  hidden?: boolean;
}

export interface Holdings {
  available: boolean;
  reason?: string;
  blockNumber: number | null;
  feedDecimals: number;
  totalValueUsd: string | null;
  settlementAssumption: string;
  holdings: Array<{
    symbol: string;
    address: Address;
    kind: 'stock' | 'settlement';
    rawBalance: string;
    decimals: number;
    multiplier: string;
    price: string | null;
    feedDecimals: number;
    valueUsd: string | null;
    shareEquivalent: string | null;
    status: 'ok' | 'stale' | 'paused' | 'missing-feed';
    note?: string;
  }>;
}

export interface Growth {
  available: boolean;
  reason?: string;
  snapshots: Array<{
    takenAt: number;
    valueUsd: string;
    feedDecimals: number;
    source: string;
    note?: string | null;
  }>;
  /**
   * Net money put in over time (deposits and gifts, less claims and
   * withdrawals) as a cumulative step series: block time in unix seconds, and
   * 8-decimal USD. Optional because older servers do not send it.
   */
  contributions?: Array<{ at: number; netUsd: string }>;
  /** Lifetime money in, out and net, 8-decimal USD; null when unknown. */
  totals?: { inUsd: string; outUsd: string; netUsd: string } | null;
  /** Set when some of the money in or out could not be valued or read. */
  note?: string;
}

export interface BeneficiaryState {
  graduated: boolean;
  settlementToken: Address;
  allowances: Array<{ token: Address; bucket: string }>;
}

export interface ChainEvent {
  eventName: string;
  blockNumber: number;
  logIndex: number;
  payload: unknown;
}

export interface LocalWalletInfo {
  enabled: boolean;
  reason?: string;
  chainId: number;
  actualChainId?: number;
  accounts: Array<{ address: Address; label: string; role: string }>;
}

export interface PublicStats {
  sproutsPlanted: number;
  sproutsFunded: number;
  giftsSent: number;
  purchases: number;
  source: 'chain' | 'index';
  asOf: number;
}

let readSession: { token: string; expiresAt: number; address: string } | null = null;
let sessionVersion = 0;
let sessionTimer: ReturnType<typeof setTimeout> | undefined;
export function clearFamilySession() { readSession = null; sessionVersion++; clearTimeout(sessionTimer); lockLabels(); }
export async function authorizeFamily(wallet: WalletState) {
  if (readSession?.address === wallet.address && readSession.expiresAt > Date.now()) return;
  clearFamilySession();
  const version = sessionVersion;
  const result = await signedPostJson<{ token: string; expiresAt: number }>(wallet, '/api/family/session', 'family-session', {});
  if (version !== sessionVersion) throw new Error('Account changed during sign-in.');
  readSession = { ...result, address: wallet.address };
  setFamilyOwner(wallet.address);
  sessionTimer = setTimeout(() => { clearFamilySession(); window.dispatchEvent(new Event('sprout-family-session-ended')); }, Math.max(0, result.expiresAt - Date.now()));
}
export async function lockFamilySession() {
  try { await fetch('/api/family/lock', { method: 'POST', headers: familyHeaders() }); } finally { clearFamilySession(); }
}
export function familyHeaders(): Record<string, string> { return readSession ? { authorization: `Bearer ${readSession.token}` } : {}; }
export async function decodeGiftNotes(id: string, notes: GiftNote[]) {
  const epoch = privateEpoch();
  const version = sessionVersion;
  const hidden = (n: GiftNote) => ({ ...n, name: null, note: 'Encrypted message · unlock Family privacy to read' });
  const decoded = await Promise.all(notes.map(async n => {
    if (!n.note?.startsWith('encrypted:v1:')) return n;
    const key = getPrivateLabel('gift.privateKey');
    if (!key) return hidden(n);
    try { const message = await decryptGift(key, id, n.note); return { ...n, name: message.name ?? null, note: message.note ?? null }; }
    catch { return { ...n, name: null, note: 'This encrypted message could not be opened.' }; }
  }));
  if (version !== sessionVersion) throw new Error('Family session changed.');
  return epoch === privateEpoch() ? decoded : notes.map(hidden);
}
export interface KidInvitation { id: string; expiresAt: number; redeemed: number; revoked: number; showBalance: number }
export interface KidSummary { symbols: string[]; balance: { valueUsd: string | null; feedDecimals: number } | null; chores: number; expiresAt: number }
export async function kidRequest<T>(path: string, token: string, body?: unknown): Promise<T> {
  const res = await fetch(path, { method: body ? 'POST' : 'GET', headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` }, ...(body ? { body: JSON.stringify(body) } : {}) });
  if (!res.ok) throw new Error('This invitation has ended. Ask a grown-up for a new one.');
  return await res.json() as T;
}
export async function getJson<T>(url: string): Promise<T> {
  const version = sessionVersion;
  const res = await fetch(url, { headers: familyHeaders(), cache: 'no-store' });
  if (!res.ok) {
    if (res.status === 401 && /^\/api\/(sprouts|family|jobs|zk)/.test(url)) { clearFamilySession(); window.dispatchEvent(new Event('sprout-family-session-ended')); }
    const text = await res.text();
    throw new Error(`${res.status} ${text}`);
  }
  const result = await res.json() as T;
  if (/^\/api\/(sprouts|family|jobs|zk)/.test(url) && version !== sessionVersion) throw new Error('Family session changed.');
  return result;
}

async function postJson<T>(url: string, body: unknown): Promise<T> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${res.status} ${text}`);
  return JSON.parse(text) as T;
}

export async function signedPostJson<T>(wallet: WalletState, url: string, purpose: string, body: unknown, extraHeaders: Record<string, string> = {}): Promise<T> {
  const version = sessionVersion;
  const challenge = await postJson<{ nonce: string; message: string }>('/api/auth/nonce', {
    address: wallet.address,
    purpose,
  });
  const signature = await sign(challenge.message, wallet);
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-sprout-address': wallet.address,
      'x-sprout-nonce': challenge.nonce,
      'x-sprout-signature': signature,
      ...extraHeaders,
    },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${res.status} ${text}`);
  if (version !== sessionVersion) throw new Error('Family session changed.');
  return JSON.parse(text) as T;
}

export const api = {
  downloadHistory: async (vault: string) => {
    const version = sessionVersion;
    const res = await fetch(`/api/sprouts/${vault}/history.csv`, { headers: familyHeaders(), cache: 'no-store' });
    if (!res.ok) throw new Error('History could not be downloaded. Reconnect your family session and try again.');
    const blob = await res.blob();
    if (version !== sessionVersion) throw new Error('Family session changed.');
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `sprout-${vault.slice(2, 8).toLowerCase()}-history.csv`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  },
  zkCertificates: (vault: string) => getJson<{ certificates: ZkCertificateStatus[] }>(`/api/zk/certificates/${vault}`),
  issueZk: (wallet: WalletState, vault: string, thresholdCents: string) => signedPostJson<ZkIssuance>(wallet, `/api/zk/issue/${vault}`, `zk-issue:${vault.toLowerCase()}`, { thresholdCents }),
  revokeZk: (wallet: WalletState, id: string) => signedPostJson(wallet, `/api/zk/revoke/${id}`, `zk-revoke:${id}`, {}),

  kidInvites: (vault: string) => getJson<{ invites: KidInvitation[] }>(`/api/family/invites/${vault}`),
  createKidInvite: (wallet: WalletState, vault: string, showBalance: boolean) => signedPostJson<{ id: string; token: string; expiresAt: number }>(wallet, `/api/family/invites/${vault}`, `kid-invite:${vault.toLowerCase()}`, { showBalance }),
  revokeKidInvite: (wallet: WalletState, id: string) => signedPostJson(wallet, `/api/family/invites/${id}/revoke`, `kid-revoke:${id}`, {}),
  giftCheckout: (wallet: WalletState, id: string) => signedPostJson<{ vaultId: Address }>(wallet, `/api/gifts/${id}/checkout`, 'gift-checkout', {}),
  registerGiftKey: (wallet: WalletState, publicKey: string) => signedPostJson(wallet, '/api/family/gift-key', 'family-gift-key', { publicKey }),
  health: () => getJson<Health>('/api/health'),
  stats: () => getJson<PublicStats>('/api/stats'),
  config: () => getJson<{ chain: ChainPublic }>('/api/config'),
  sproutsByParent: (parent: string) => getJson<{ sprouts: Sprout[] }>(`/api/sprouts?parent=${parent}`),
  sproutsByBeneficiary: (beneficiary: string) =>
    getJson<{ sprouts: Sprout[] }>(`/api/sprouts?beneficiary=${beneficiary}`),
  sprout: (id: string) =>
    getJson<{
      sprout: Sprout;
      /** See Sprout.factory and Sprout.admittedAssets; a server may send them here instead. */
      factory?: Address | null;
      admittedAssets?: Address[] | null;
      automation: AutomationCapability;
      milestones: Milestone[];
      jobs: Job[];
      gifts: Array<{
        id: string;
        vaultId: Address;
        label: string | null;
        status: string;
        acceptedAssets: Address[];
        paymentCount: number;
        totals: Record<string, string>;
      }>;
    }>(`/api/sprouts/${id}`).then(async detail => ({ ...detail, gifts: await Promise.all(detail.gifts.map(async g => ({ ...g, notes: await decodeGiftNotes(g.id, (g as GiftSummary).notes ?? []), label: getPrivateLabel(`gift.label.${g.id}`) ?? 'A gift for the future', ...((g as GiftSummary).campaign ? { campaign: { ...(g as GiftSummary).campaign!, title: getPrivateLabel(`gift.title.${g.id}`) ?? 'Family gift' } } : {}) }))) })),
  holdings: (id: string, afterBlock = 0) =>
    getJson<Holdings>(`/api/sprouts/${id}/holdings${afterBlock > 0 ? `?after=${afterBlock}` : ''}`),
  investQuote: (id: string, amount: bigint, afterBlock = 0) =>
    getJson<InvestQuote>(`/api/sprouts/${id}/invest-quote?amount=${amount}${afterBlock > 0 ? `&after=${afterBlock}` : ''}`),
  growth: (id: string) => getJson<Growth>(`/api/sprouts/${id}/growth`),
  events: (id: string) => getJson<{ events: ChainEvent[] }>(`/api/sprouts/${id}/events`),
  beneficiaryState: (id: string) => getJson<BeneficiaryState>(`/api/sprouts/${id}/beneficiary`),
  gift: (id: string) => getJson<Pick<GiftSummary, 'id' | 'label' | 'acceptedAssets' | 'status'> & { publicKey: string | null }>(`/api/gifts/${id}`),
  registerSprout: (wallet: WalletState, txHash: string) =>
    signedPostJson<{ sprout: Sprout }>(wallet, '/api/sprouts', 'plant', { txHash }),
  createGift: (
    wallet: WalletState,
    vaultId: string,
    label: string,
    acceptedAssets: string[],
    campaign?: { title: string; goalDollars: number; endsAt: number },
  ) => {
    requirePrivateLabels(label || campaign?.title || '');
    return signedPostJson<{ gift: GiftSummary }>(wallet, '/api/gifts', 'gift-create', { vaultId, label: 'A gift for the future', acceptedAssets, ...(campaign ? { campaign: { ...campaign, title: 'Family gift' } } : {}) }).then(async result => {
      setPrivateLabel(`gift.label.${result.gift.id}`, label);
      if (campaign) setPrivateLabel(`gift.title.${result.gift.id}`, campaign.title);
      await flushPrivateLabels();
      return { gift: { ...result.gift, label, campaign: result.gift.campaign ? { ...result.gift.campaign, title: campaign?.title ?? 'Family gift' } : null } };
    });
  },
  recordGiftPayment: async (wallet: WalletState, giftId: string, txHash: string, message?: { name?: string; note?: string }) => {
    let encryptedNote: string | undefined;
    if (message?.name || message?.note) {
      const gift = await api.gift(giftId);
      if (!gift.publicKey) throw new Error('This family has not enabled encrypted messages.');
      encryptedNote = await encryptGift(gift.publicKey, giftId, message);
    }
    return signedPostJson<{ accepted: boolean; duplicate: boolean }>(wallet, `/api/gifts/${giftId}/payments`, 'gift-pay', { txHash, ...(encryptedNote ? { encryptedNote } : {}) });
  },
  giftNotes: (wallet: WalletState, giftId: string) =>
    signedPostJson<{ notes: GiftNote[] }>(wallet, `/api/gifts/${giftId}/notes`, 'gift-notes', {}).then(async r => ({ notes: await decodeGiftNotes(giftId, r.notes) })),
  setGiftNoteHidden: (wallet: WalletState, giftId: string, note: { txHash: string; logIndex: number }, hidden: boolean) =>
    signedPostJson<{ notes: GiftNote[] }>(wallet, `/api/gifts/${giftId}/notes/visibility`, 'gift-note-visibility', {
      txHash: note.txHash,
      logIndex: note.logIndex,
      hidden,
    }).then(async r => ({ notes: await decodeGiftNotes(giftId, r.notes) })),
  createMilestone: (wallet: WalletState, vaultId: string, body: { milestoneId: string; txHash: string; descriptionHash?: string }) =>
    signedPostJson<{ milestone: Milestone }>(wallet, `/api/sprouts/${vaultId}/milestones`, 'milestone-create', body),
  releaseMilestone: (wallet: WalletState, vaultId: string, milestoneId: string, txHash: string) =>
    signedPostJson<{ milestone: Milestone }>(
      wallet,
      `/api/sprouts/${vaultId}/milestones/${milestoneId}/release`,
      'milestone-release',
      { txHash },
    ),
  cancelMilestone: (wallet: WalletState, vaultId: string, milestoneId: string, txHash: string) =>
    signedPostJson<{ milestone: Milestone }>(
      wallet,
      `/api/sprouts/${vaultId}/milestones/${milestoneId}/cancel`,
      'milestone-cancel',
      { txHash },
    ),
  schedule: (wallet: WalletState, vaultId: string, txHash: string) =>
    signedPostJson<{ jobs: Job[] }>(wallet, `/api/sprouts/${vaultId}/schedule`, 'schedule', { txHash }),
  cancelSchedule: (wallet: WalletState, vaultId: string, txHash: string) =>
    signedPostJson<{ jobs: Job[] }>(wallet, `/api/sprouts/${vaultId}/schedule/cancel`, 'cancel-schedule', { txHash }),
  runJobs: () => postJson<{ results: unknown[] }>('/api/jobs/run', {}),
  localWallet: () => getJson<LocalWalletInfo>('/api/local/wallet'),
  localFund: (account: string, amount: string, token?: string) =>
    postJson<{ txHash: string; token: string; amount: string }>('/api/local/fund', { account, amount, token }),
  advanceTime: (seconds: number) =>
    postJson<{
      advancedSeconds: number;
      timestamp: number;
      refreshedFeeds: string[];
      failedFeeds: Array<{ feed: string; error: string }>;
      label: string;
    }>('/api/local/advance-time', { seconds }),
};
