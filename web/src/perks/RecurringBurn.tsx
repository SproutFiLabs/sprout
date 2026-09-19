import { useEffect, useState } from 'react';
import { dateLocale, t } from '../i18n';
interface View {
  enabled: boolean;
  wallet: string | null;
  status: string;
  nextRunAt: number | null;
  lastTx: string | null;
  count: number;
}
export function RecurringBurn() {
  const [view, setView] = useState<View | null>(null);
  useEffect(() => {
    let active = true;
    const controller = new AbortController();
    const load = () =>
      fetch('/api/burns/recurring', { signal: controller.signal })
        .then((r) => {
          if (!r.ok) throw new Error();
          return r.json();
        })
        .then((v) => {
          if (active) setView(v);
        })
        .catch(() => {
          if (active) setView(null);
        });
    void load();
    const timer = setInterval(load, 30000);
    return () => {
      active = false;
      controller.abort();
      clearInterval(timer);
    };
  }, []);
  if (!view?.enabled) return null;
  const waiting = view.status === 'awaiting-usdg' || view.status === 'awaiting-gas' || view.status === 'waiting';
  const status = waiting
    ? t('Waiting for project funding')
    : view.status === 'scheduled'
      ? t('Scheduled')
      : view.status === 'running'
        ? t('Processing')
        : t('Paused or checking the transaction');
  return (
    <div className="recurring-burn" data-testid="recurring-burn">
      <h3>{t('Daily project buy & burn')}</h3>
      <p>
        {t(
          'The project schedules $5 USDG every 24 hours to buy SPROUT and send it directly to the dead address. It uses a dedicated project wallet, never family sprouts or visitor wallets.',
        )}
      </p>
      <p>
        <b>{status}</b> · {t('{count} completed daily burns', { count: view.count })}
      </p>
      {view.nextRunAt && <p>{t('Next eligible run: {date}', { date: new Date(view.nextRunAt * 1000).toLocaleString(dateLocale()) })}</p>}
      <p className="perks-muted">
        {t(
          'Runs pause if funding, gas or quotes are unavailable. Missed days are skipped. The amount of SPROUT burned varies with the price; no price increase is promised.',
        )}
      </p>
      {view.wallet && (
        <p>
          <a href={`https://robinhoodchain.blockscout.com/address/${view.wallet}`} target="_blank" rel="noopener noreferrer">
            {t('Project burn wallet')}
          </a>
          {view.lastTx && (
            <>
              {' '}
              ·{' '}
              <a href={`https://robinhoodchain.blockscout.com/tx/${view.lastTx}`} target="_blank" rel="noopener noreferrer">
                {t('Latest daily burn')}
              </a>
            </>
          )}
        </p>
      )}
    </div>
  );
}
