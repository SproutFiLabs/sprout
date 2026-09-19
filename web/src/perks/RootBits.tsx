import { useEffect, useState } from 'react';
import { t } from '../i18n';
import { loadPerks, type RootInfo } from './holder';
import { rootedCounter } from './root';
import './root-bits.css';

/**
 * The small, shared pieces of "Root your SPROUT": the Rooted badge (perks page
 * and the wallet menu's tier row) and the public rooted counter (perks page and
 * landing). Kept apart from RootPanel so the dashboard and landing don't load
 * the lock flow.
 */

export function RootedBadge() {
  return (
    <span className="root-badge" data-testid="rooted-badge">
      {t('Rooted 🌳')}
    </span>
  );
}

/** "812,500 SPROUT rooted, 0.08% of all SPROUT"; nothing while unknown (or, on the landing page, zero). */
export function RootedCounter({ root, variant }: { root: RootInfo | undefined | null; variant: 'perks' | 'landing' }) {
  const counter = rootedCounter(root);
  if (!counter) return null;
  if (variant === 'landing') {
    if (!root?.rootedTotal || BigInt(root.rootedTotal) === 0n) return null;
    return (
      <a className="root-counter root-counter--landing" href="/perks#root" data-testid="root-counter-landing">
        🌳 {t('{total} SPROUT rooted · {share} of supply', counter)}
      </a>
    );
  }
  return (
    <div className="root-counter" data-testid="root-counter" aria-live="polite">
      <strong data-testid="root-counter-total">{counter.total}</strong>{' '}
      <span>{t('SPROUT rooted, {share} of all SPROUT', { share: counter.share })}</span>
    </div>
  );
}

/** The landing page's counter: shown only when rooting is on and something is rooted. */
export function LandingRootedCounter() {
  const [root, setRoot] = useState<RootInfo | null>(null);
  useEffect(() => {
    let live = true;
    void loadPerks().then((p) => live && p?.enabled && p.root && setRoot(p.root));
    return () => {
      live = false;
    };
  }, []);
  return <RootedCounter root={root} variant="landing" />;
}
