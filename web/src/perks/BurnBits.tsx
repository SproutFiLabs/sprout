import { useEffect, useState } from 'react';
import { t } from '../i18n';
import { burnCounter, loadBurnConfig, loadBurnSummary, onBurnOptIn, readBurnOptIn, writeBurnOptIn, type BurnSummaryInfo } from './burn';
import './burn-bits.css';

/**
 * The small pieces of "Buy & burn" that load outside /perks: the public
 * counter (perks page and landing) and the "Add a $1 burn to my buys" switch in
 * the wallet menu. The transaction flow lives in BurnFlow.tsx.
 */

/** "🔥 202,481 SPROUT burned via Sprout · 81.3M burned in total"; nothing while unknown. */
export function BurnCounter({ summary, variant }: { summary: BurnSummaryInfo | null | undefined; variant: 'perks' | 'landing' }) {
  const counter = burnCounter(summary);
  if (!counter) return null;
  if (variant === 'landing') {
    if (counter.count === 0) return null;
    return (
      <a className="burn-counter burn-counter--landing" href="/perks#burn" data-testid="burn-counter-landing">
        🔥 {t('{sprout} SPROUT burned via Sprout', { sprout: counter.viaSprout })}
      </a>
    );
  }
  return (
    <div className="burn-counter" data-testid="burn-counter" aria-live="polite">
      <span>
        🔥 <strong data-testid="burn-counter-sprout">{counter.viaSprout}</strong> {t('SPROUT burned via Sprout')}
      </span>
      {counter.total !== null ? (
        <span className="burn-counter-total" data-testid="burn-counter-total">
          {t('{total} burned in total', { total: counter.total })}
        </span>
      ) : null}
    </div>
  );
}

/** The landing page's line: shown only when burns are on and at least one went through Sprout. */
export function LandingBurnCounter() {
  const [summary, setSummary] = useState<BurnSummaryInfo | null>(null);
  useEffect(() => {
    let live = true;
    void loadBurnSummary().then((s) => live && setSummary(s));
    return () => {
      live = false;
    };
  }, []);
  return <BurnCounter summary={summary} variant="landing" />;
}

/** "Add a $1 burn to my buys": off by default, remembered on this device. Hidden when burns are off. */
export function BurnMenuToggle() {
  const [enabled, setEnabled] = useState(false);
  const [on, setOn] = useState(readBurnOptIn);
  useEffect(() => {
    let live = true;
    void loadBurnConfig().then((c) => live && setEnabled(!!c));
    const off = onBurnOptIn(setOn);
    return () => {
      live = false;
      off();
    };
  }, []);
  if (!enabled) return null;
  return (
    <label className="burn-menu-toggle" data-testid="burn-menu-toggle">
      <input type="checkbox" checked={on} data-testid="burn-opt-in" onChange={(e) => writeBurnOptIn(e.target.checked)} />
      <span>
        <b>🔥 {t('Add a $1 burn to my buys')}</b>
        <small>{t('After your own deposit or Invest now, we ask first. It’s paid from your wallet, never the sprout.')}</small>
      </span>
    </label>
  );
}
