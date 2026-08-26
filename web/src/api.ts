import type { Address } from 'viem';
import { sign, type WalletState } from './wallet';

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
    venue?: Address;
    settlementDecimals: number;
    stockTokens: StockTokenPublic[];
  };
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
  automation: AutomationCapability;
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
}

export interface GiftSummary {
  id: string;
  vaultId: Address;
  label: string | null;
  acceptedAssets: Address[];
  status: string;
  paymentCount: number;
  totals: Record<string, string>;
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

async function getJson<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`${res.status} ${text}`);
  }
  return (await res.json()) as T;
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

async function signedPostJson<T>(wallet: WalletState, url: string, purpose: string, body: unknown): Promise<T> {
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
    },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${res.status} ${text}`);
  return JSON.parse(text) as T;
}

export const api = {
  health: () => getJson<Health>('/api/health'),
  config: () => getJson<{ chain: ChainPublic }>('/api/config'),
  sproutsByParent: (parent: string) => getJson<{ sprouts: Sprout[] }>(`/api/sprouts?parent=${parent}`),
  sproutsByBeneficiary: (beneficiary: string) =>
    getJson<{ sprouts: Sprout[] }>(`/api/sprouts?beneficiary=${beneficiary}`),
  sprout: (id: string) =>
    getJson<{
      sprout: Sprout;
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
    }>(`/api/sprouts/${id}`),
  holdings: (id: string) => getJson<Holdings>(`/api/sprouts/${id}/holdings`),
  growth: (id: string) => getJson<Growth>(`/api/sprouts/${id}/growth`),
  events: (id: string) => getJson<{ events: ChainEvent[] }>(`/api/sprouts/${id}/events`),
  beneficiaryState: (id: string) => getJson<BeneficiaryState>(`/api/sprouts/${id}/beneficiary`),
  gift: (id: string) => getJson<GiftSummary>(`/api/gifts/${id}`),
  registerSprout: (wallet: WalletState, txHash: string) =>
    signedPostJson<{ sprout: Sprout }>(wallet, '/api/sprouts', 'plant', { txHash }),
  createGift: (wallet: WalletState, vaultId: string, label: string, acceptedAssets: string[]) =>
    signedPostJson<{ gift: { id: string; vaultId: Address; label: string | null; acceptedAssets: Address[] } }>(
      wallet,
      '/api/gifts',
      'gift-create',
      { vaultId, label, acceptedAssets },
    ),
  recordGiftPayment: (wallet: WalletState, giftId: string, txHash: string) =>
    signedPostJson<{ accepted: boolean; duplicate: boolean }>(wallet, `/api/gifts/${giftId}/payments`, 'gift-pay', {
      txHash,
    }),
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
