import { useEffect, useState } from 'react';
import { loadAutomation } from '../automationStatus';
import { t } from '../i18n';

/**
 * Automatic weekly investing as a SPROUT holder perk. When /api/health reports
 * `automation.autoInvestTier`, the keeper only runs the plans of parents who
 * hold that tier; everyone else's plan stays saved and runs with Invest now.
 * The server decides; this only says so.
 */

export type TierId = 'seedling' | 'sapling' | 'bloom' | 'grove';
const TIER_ORDER: readonly TierId[] = ['seedling', 'sapling', 'bloom', 'grove'];
const TIER_NAMES: Record<TierId, string> = { seedling: 'Seedling', sapling: 'Sapling', bloom: 'Bloom', grove: 'Grove' };

type Automation = { enabled: boolean; autoInvestTier?: string | null } | null | undefined;

export function asTier(value: unknown): TierId | null {
  return typeof value === 'string' && (TIER_ORDER as readonly string[]).includes(value) ? (value as TierId) : null;
}

export function tierName(tier: TierId): string {
  return t(TIER_NAMES[tier]);
}

/** The tier automatic investing needs, or null when it is off or open to everyone. */
export function requiredTier(automation: Automation): TierId | null {
  return automation?.enabled ? asTier(automation.autoInvestTier) : null;
}

/**
 * The tier a parent still needs before the keeper runs their plan, or null when
 * nothing is locked. `parentTier` is undefined while unknown (loading, or the
 * check failed), and then nothing is claimed either way.
 */
export function autoInvestLock(automation: Automation, parentTier: TierId | null | undefined): TierId | null {
  const required = requiredTier(automation);
  if (!required || parentTier === undefined) return null;
  return parentTier !== null && TIER_ORDER.indexOf(parentTier) >= TIER_ORDER.indexOf(required) ? null : required;
}

export function autoInvestPerkText(required: TierId): string {
  return t('Automatic weekly investing is a perk for SPROUT holders ({tier} and up). Your plan is saved: run it any time with Invest now.', {
    tier: tierName(required),
  });
}

const tiers = new Map<string, Promise<TierId | null | undefined>>();

/** A wallet's holder tier from /api/holders/:address, once per page; undefined if the check fails. */
function loadHolderTier(address: string): Promise<TierId | null | undefined> {
  const key = address.toLowerCase();
  let pending = tiers.get(key);
  if (!pending) {
    pending = fetch(`/api/holders/${address}`)
      .then((r) => (r.ok ? (r.json() as Promise<{ tier?: unknown }>) : Promise.reject(new Error(String(r.status)))))
      .then((s) => asTier(s.tier))
      .catch(() => {
        tiers.delete(key);
        return undefined;
      });
    tiers.set(key, pending);
  }
  return pending;
}

/** For the connected parent: the tier they still need for automatic weekly investing, or null. */
export function useAutoInvestLock(automation: Automation, parent: string | null | undefined): TierId | null {
  const needed = Boolean(requiredTier(automation) && parent);
  const [known, setKnown] = useState<{ parent: string; tier: TierId | null | undefined } | null>(null);
  useEffect(() => {
    if (!needed || !parent) return;
    let live = true;
    void loadHolderTier(parent).then((tier) => {
      if (live) setKnown({ parent, tier });
    });
    return () => {
      live = false;
    };
  }, [needed, parent]);
  return autoInvestLock(automation, parent && known?.parent === parent ? known.tier : undefined);
}

/** The tier automatic investing needs, from /api/health, for pages without a dashboard. */
export function useAutoInvestTier(): TierId | null {
  const [tier, setTier] = useState<TierId | null>(null);
  useEffect(() => {
    let live = true;
    void loadAutomation().then((automation) => {
      if (live) setTier(requiredTier(automation));
    });
    return () => {
      live = false;
    };
  }, []);
  return tier;
}
