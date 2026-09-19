import { useCallback, useEffect, useRef, useState } from 'react';
import { Flame, Loader2, Wallet } from 'lucide-react';
import { dateLocale, t } from '../i18n';
import type { WalletState } from '../wallet';
import { burnAmount, fetchBurnQuote, loadBurnConfig, loadBurnSummary, sproutText, usdText, type BurnConfigInfo, type BurnQuoteInfo, type BurnSummaryInfo } from './burn';
import { RecurringBurn } from './RecurringBurn';
import { BurnCounter } from './BurnBits';
import { BurnNote, BurnQuoteLine, BurnStatus, useBurnRunner } from './BurnFlow';

/**
 * "Buy & burn 🔥" on /perks: anyone can spend a little USDG from their own
 * wallet to buy SPROUT on the open market and send it to the dead address,
 * plus the public counter and the latest burns. Rendered only when the server
 * has burns switched on.
 */

const QUOTE_REFRESH_MS = 30_000;

export function BurnPanel({ address, wallet, onConnect }: { address: string | null; wallet: WalletState | null; onConnect: () => void }) {
  const [config, setConfig] = useState<BurnConfigInfo | null>(null);
  const [summary, setSummary] = useState<BurnSummaryInfo | null>(null);
  const [choice, setChoice] = useState<string>('5');
  const [custom, setCustom] = useState('');
  const [quote, setQuote] = useState<BurnQuoteInfo | null>(null);
  const [quoteProblem, setQuoteProblem] = useState<string | null>(null);
  const [loadingQuote, setLoadingQuote] = useState(false);
  const request = useRef(0);

  const refreshSummary = useCallback(() => {
    void loadBurnSummary().then(setSummary);
  }, []);
  useEffect(() => {
    let live = true;
    void loadBurnConfig().then((c) => live && setConfig(c));
    void loadBurnSummary().then((s) => live && setSummary(s));
    return () => {
      live = false;
    };
  }, []);
  const { state, run, reset, busy } = useBurnRunner(config, refreshSummary);

  const usd = choice === 'custom' ? custom : choice;
  const amount = config ? burnAmount(usd, config) : null;

  useEffect(() => {
    if (!config || amount === null) {
      setQuote(null);
      return;
    }
    const id = ++request.current;
    const load = () => {
      setLoadingQuote(true);
      fetchBurnQuote(usdText(amount, config.route.usdgDecimals).replace(/,/g, ''))
        .then((q) => {
          if (id !== request.current) return;
          setQuote(q);
          setQuoteProblem(null);
        })
        .catch(() => {
          if (id !== request.current) return;
          setQuote(null);
          setQuoteProblem(t('Couldn’t get a price from the pool just now. Try again in a moment.'));
        })
        .finally(() => id === request.current && setLoadingQuote(false));
    };
    const timer = setTimeout(load, 300);
    // Keep the price fresh while the page is being looked at.
    const every = setInterval(() => !document.hidden && load(), QUOTE_REFRESH_MS);
    return () => {
      clearTimeout(timer);
      clearInterval(every);
    };
  }, [config, amount?.toString()]);

  if (!config) return null;
  const presets = config.presets.length ? config.presets : [1, 5, 20];
  const invalid = choice === 'custom' && custom.trim() !== '' && amount === null;
  const pick = (next: string) => {
    setChoice(next);
    if (state.phase === 'done' || state.phase === 'error') reset();
  };

  return (
    <section className="perks-card burn-card" id="burn" aria-labelledby="burn-title" data-testid="burn-panel">
      <h2 id="burn-title">🔥 {t('Buy & burn')}</h2>
      <RecurringBurn />
      <h3>{t('Optional one-time burn')}</h3>
      <p>{t('Anyone can spend a little USDG from their own wallet to buy SPROUT on the open market and burn it: it goes to the dead address, where nobody can ever move it again.')}</p>
      <BurnCounter summary={summary} variant="perks" />
      <BurnNote />
      <p className="perks-muted">{t('Nothing comes out of any sprout, and no Sprout tool costs anything. Burning doesn’t change your tier.')}</p>

      <form
        className="burn-form"
        data-testid="burn-form"
        onSubmit={(e) => {
          e.preventDefault();
          if (wallet && amount !== null && quote) void run(wallet, amount);
        }}
      >
        <fieldset className="burn-amounts" disabled={busy}>
          <legend>{t('How much USDG to spend')}</legend>
          {presets.map((p) => (
            <label key={p} className={'burn-chip' + (choice === String(p) ? ' is-on' : '')} data-testid={`burn-amount-${p}`}>
              <input type="radio" name="burn-amount" value={p} checked={choice === String(p)} onChange={() => pick(String(p))} />
              <b>${p}</b>
            </label>
          ))}
          <label className={'burn-chip' + (choice === 'custom' ? ' is-on' : '')} data-testid="burn-amount-custom">
            <input type="radio" name="burn-amount" value="custom" checked={choice === 'custom'} onChange={() => pick('custom')} />
            <b>{t('Other')}</b>
          </label>
        </fieldset>
        {choice === 'custom' ? (
          <label className="burn-custom">
            <span>{t('Amount in US dollars (USDG), ${min} to ${max}', { min: config.minUsd, max: config.maxUsd })}</span>
            <span className="burn-custom-input">
              <span aria-hidden>$</span>
              <input
                data-testid="burn-custom"
                inputMode="decimal"
                autoComplete="off"
                placeholder="10"
                value={custom}
                disabled={busy}
                aria-invalid={invalid}
                onChange={(e) => {
                  setCustom(e.target.value);
                  if (state.phase === 'done' || state.phase === 'error') reset();
                }}
              />
            </span>
            {invalid ? <small className="root-invalid">{t('Enter an amount from ${min} to ${max}, like 10 or 12.50.', { min: config.minUsd, max: config.maxUsd })}</small> : null}
          </label>
        ) : null}

        <div className="burn-quote" aria-live="polite">
          {quoteProblem && !quote ? <p className="perks-muted">{quoteProblem}</p> : <BurnQuoteLine quote={amount === null ? null : quote} config={config} loading={loadingQuote && amount !== null} />}
        </div>

        {!address || !wallet ? (
          <div className="burn-connect">
            <p>{t('Connect the wallet you’ll pay from. You approve and send the burn from your own wallet.')}</p>
            <button type="button" className="perks-button" data-testid="burn-connect" onClick={onConnect}>
              <Wallet size={16} aria-hidden /> {t('Connect wallet')}
            </button>
          </div>
        ) : (
          <>
            <p className="perks-muted">{t('Up to three wallet confirmations: two approvals for exactly this amount (skipped if your wallet already has them), then the buy & burn. Approvals made here are used up by the burn.')}</p>
            <button className="perks-button burn-button" type="submit" data-testid="burn-submit" disabled={busy || amount === null || !quote}>
              {busy ? <Loader2 size={16} className="root-spin" aria-hidden /> : <Flame size={16} aria-hidden />}
              {amount !== null ? t('Buy & burn ${amount}', { amount: usdText(amount, config.route.usdgDecimals) }) : t('Buy & burn')}
            </button>
          </>
        )}
        <BurnStatus state={state} config={config} />
      </form>

      {summary?.latest.length ? (
        <div className="burn-latest" data-testid="burn-latest">
          <h3>{t('Latest burns')}</h3>
          <ul>
            {summary.latest.slice(0, 5).map((b) => (
              <li key={b.tx}>
                <span>
                  🔥 <b>{t('{amount} SPROUT', { amount: sproutText(b.sprout, summary.decimals) })}</b>{' '}
                  <span className="perks-muted">{t('for ${usd}', { usd: usdText(b.usdg, summary.usdgDecimals) })}</span>
                </span>
                <span className="perks-muted">
                  <span translate="no">{b.wallet}</span> ·{' '}
                  {config.explorerUrl ? (
                    <a href={`${config.explorerUrl}/tx/${b.tx}`} target="_blank" rel="noreferrer">
                      {new Date(b.at * 1000).toLocaleString(dateLocale(), { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}
                    </a>
                  ) : (
                    new Date(b.at * 1000).toLocaleString(dateLocale(), { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
                  )}
                </span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </section>
  );
}
