import { useEffect, useState } from 'react';
import { t } from '../i18n';

/**
 * SPROUT holder tiers, as the server reports them (/api/perks and
 * /api/holders/:address). The server decides tiers from chain history; the
 * browser only shows them and hides what a tier doesn't unlock.
 */

export type TierId = 'seedling' | 'sapling' | 'bloom' | 'grove';
export const TIER_ORDER: readonly TierId[] = ['seedling', 'sapling', 'bloom', 'grove'];

export interface PerksInfo {
  enabled: boolean;
  token: string | null;
  tiers: Array<{ id: TierId; min: string }>;
  holdDays: number;
  earlyAccess: { symbols: string[]; until: number | null; tier: TierId };
  autoInvestTier: TierId | null;
}

export interface HolderStatus {
  address: string;
  enabled: boolean;
  decimals: number;
  balance: string;
  heldBalance: string;
  tier: TierId | null;
  currentTier: TierId | null;
  holdDays: number;
  /** The hold that applied, in seconds: 24 hours while SPROUT is new, then the full period. */
  holdSeconds: number;
  windowStart: number;
  checkedAt: number;
}

export interface Holder {
  perks: PerksInfo | null;
  status: HolderStatus | null;
}

const EMOJI: Record<TierId, string> = { seedling: '🌱', sapling: '🌿', bloom: '🌸', grove: '🌳' };
const NAME: Record<TierId, string> = { seedling: 'Seedling', sapling: 'Sapling', bloom: 'Bloom', grove: 'Grove' };

export function tierName(id: TierId): string {
  return t(NAME[id]);
}

export function tierLabel(id: TierId): string {
  return `${EMOJI[id]} ${tierName(id)}`;
}

export function tierAtLeast(tier: TierId | null | undefined, required: TierId): boolean {
  return !!tier && TIER_ORDER.indexOf(tier) >= TIER_ORDER.indexOf(required);
}

/** "7 days" or "24 hours". */
export function holdPeriod(seconds: number): string {
  return seconds >= 2 * 86_400 ? t('{n} days', { n: Math.round(seconds / 86_400) }) : t('{n} hours', { n: Math.round(seconds / 3_600) });
}

/** Whole tokens, grouped ("1,000,000"). */
export function wholeTokens(raw: string, decimals: number): string {
  const whole = BigInt(raw || '0') / 10n ** BigInt(decimals);
  return whole.toLocaleString('en-US');
}

let perksPromise: Promise<PerksInfo | null> | null = null;

export function loadPerks(): Promise<PerksInfo | null> {
  perksPromise ??= fetch('/api/perks')
    .then((r) => (r.ok ? (r.json() as Promise<PerksInfo>) : null))
    .catch(() => {
      perksPromise = null;
      return null;
    });
  return perksPromise;
}

export async function loadHolderStatus(address: string): Promise<HolderStatus | null> {
  try {
    const r = await fetch(`/api/holders/${address}`);
    return r.ok ? ((await r.json()) as HolderStatus) : null;
  } catch {
    return null;
  }
}

/** The perks ladder, plus this wallet's tier once it is known. */
export function useHolder(address: string | null | undefined): Holder {
  const [perks, setPerks] = useState<PerksInfo | null>(null);
  const [status, setStatus] = useState<HolderStatus | null>(null);
  useEffect(() => {
    let live = true;
    void loadPerks().then((p) => live && setPerks(p));
    return () => {
      live = false;
    };
  }, []);
  useEffect(() => {
    let live = true;
    setStatus(null);
    if (address && perks?.enabled) void loadHolderStatus(address).then((s) => live && setStatus(s));
    return () => {
      live = false;
    };
  }, [address, perks?.enabled]);
  return { perks, status };
}
