import { useEffect, useState } from 'react';
import { ShieldCheck, EyeOff, Leaf, LockKeyhole } from 'lucide-react';
import { formatUnits } from '@sprout/shared';
import { kidRequest, type KidSummary } from './api';
import { BloomGarden } from './garden/BloomGarden';
import { LanguageToggle } from './i18n/LanguageToggle';
import { t, tc } from './i18n';
import { KidLearn } from './kid/KidLearn';
import { findLesson } from './kid/lessons';
import { isKnownStock, stockInfo } from './stocks';

/** What "a little piece of …" names for a ticker (English source text), or null for an unknown one. */
export function kidCompany(symbol: string): string | null {
  if (!isKnownStock(symbol)) return null;
  const info = stockInfo(symbol);
  return info.kidName ?? info.name;
}

/** "8 years and 3 months", "5 months", "12 days", or null once it has arrived. */
export function timeUntil(targetSeconds: number, nowMs: number): string | null {
  const now = new Date(nowMs);
  const target = new Date(targetSeconds * 1000);
  if (target.getTime() <= now.getTime()) return null;
  let months = (target.getUTCFullYear() - now.getUTCFullYear()) * 12 + (target.getUTCMonth() - now.getUTCMonth());
  if (target.getUTCDate() < now.getUTCDate()) months -= 1;
  const count = (n: number, one: string, many: string) => t(n === 1 ? one : many, { n });
  if (months <= 0) {
    const days = Math.max(1, Math.ceil((target.getTime() - now.getTime()) / 86_400_000));
    return count(days, '{n} day', '{n} days');
  }
  const years = Math.floor(months / 12);
  const rest = months % 12;
  if (years === 0) return count(rest, '{n} month', '{n} months');
  if (rest === 0) return count(years, '{n} year', '{n} years');
  return t('{years} and {months}', { years: count(years, '{n} year', '{n} years'), months: count(rest, '{n} month', '{n} months') });
}

/** Names and wallet addresses never belong in an invitation URL. */
export function kidViewPath(id: string, _name?: string | null): string {
  return /^[a-f0-9]{32}$/.test(id) ? `/kid/${id}` : '/kid/expired';
}
export function kidLessonPath(id: string, lesson: string | null, _search = '') {
  return `${kidViewPath(id)}${lesson ? `/learn/${encodeURIComponent(lesson)}` : ''}`;
}
export function parseKidPath(path: string): { vault: string; lessonId: string | null } | null {
  const match = path.replace(/\/+$/, '').match(/^\/kid\/([^/]+)(?:\/learn\/([^/]+))?$/);
  if (!match) return null;
  let lessonId: string | null = null;
  try {
    lessonId = match[2] ? decodeURIComponent(match[2]) : null;
  } catch {
    /* invalid lesson */
  }
  return {
    vault: /^[a-f0-9]{32}$/.test(match[1]!) ? match[1]! : 'expired',
    lessonId,
  };
}
// The fragment is never sent in an HTTP URL. Remove it before loading anything else.
let bootstrap: string | null =
  typeof window !== 'undefined' && window.location.pathname.startsWith('/kid/') ? window.location.hash.slice(1) : null;
if (typeof window !== 'undefined' && window.location.pathname.startsWith('/kid/')) {
  const parsed = parseKidPath(window.location.pathname);
  // An address for a lesson that doesn't exist falls back to the plain kid view.
  window.history.replaceState(null, '', parsed ? kidLessonPath(parsed.vault, findLesson(parsed.lessonId)?.id ?? null) : '/kid/expired');
}
const pending = new Map<string, Promise<string>>();
function getKidToken(id: string): Promise<string> {
  if (pending.has(id)) return pending.get(id)!;
  const request = (async () => {
    let stored: string | null = null;
    try {
      stored = sessionStorage.getItem(`sprout.kid.session.${id}`);
    } catch {
      /* session can remain in memory */
    }
    if (bootstrap) {
      const secret = bootstrap;
      bootstrap = null;
      const result = await kidRequest<{ token: string }>('/api/kid/redeem', '', { id, token: secret });
      try {
        sessionStorage.setItem(`sprout.kid.session.${id}`, result.token);
      } catch {
        /* no persistent token */
      }
      return result.token;
    }
    if (!stored) throw new Error('Ask a grown-up for a new invitation.');
    return stored;
  })();
  pending.set(id, request);
  return request;
}
export function KidView({ vault, lessonId = null }: { vault: string; lessonId?: string | null }) {
  const [data, setData] = useState<KidSummary | null>(null);
  const [error, setError] = useState('');
  const [lesson, setLesson] = useState<string | null>(findLesson(lessonId)?.id ?? null);
  // Set at render time so the tab title follows the language switch.
  const pageTitle = t('Your private sprout');
  useEffect(() => {
    document.title = `${pageTitle} · Sprout`;
  }, [pageTitle]);
  useEffect(() => {
    let live = true;
    const load = async () => {
      try {
        if (vault === 'expired') throw new Error('This old link is retired. Ask a grown-up for a private invitation.');
        const token = await getKidToken(vault);
        const result = await kidRequest<KidSummary>('/api/kid/view', token);
        if (live) {
          setData(result);
          setError('');
        }
      } catch (e) {
        if (live) {
          setData(null);
          setError(e instanceof Error ? e.message : 'This view is unavailable.');
        }
      }
    };
    void load();
    const interval = setInterval(() => void load(), 15_000);
    const focus = () => {
      if (!document.hidden) void load();
    };
    document.addEventListener('visibilitychange', focus);
    const pop = () => setLesson(findLesson(parseKidPath(location.pathname)?.lessonId)?.id ?? null);
    window.addEventListener('popstate', pop);
    return () => {
      live = false;
      clearInterval(interval);
      document.removeEventListener('visibilitychange', focus);
      window.removeEventListener('popstate', pop);
    };
  }, [vault]);
  const navigate = (id: string | null) => {
    history.pushState(null, '', kidLessonPath(vault, id));
    setLesson(id);
  };
  return (
    <main className="garden-root kid-root" data-testid="kid-view">
      <header className="kid-top">
        <a className="garden-brand" href="/">
          <span className="garden-brand-mark">
            <img src="/brand/sprout-logo.png" alt="" />
          </span>
          <span>SPROUT</span>
        </a>
        <span className="kid-badge">
          <ShieldCheck size={14} /> {t('Your own little window')}
        </span>
        <LanguageToggle />
      </header>
      <section className="kid-hero">
        <div className="kid-hero-copy">
          <h1 data-testid="kid-heading">
            {t('Your little world.')}
            <br />
            {t('Growing every day.')}
          </h1>
          {error ? (
            <p className="kid-lead" role="alert">
              {t(error)}
            </p>
          ) : !data ? (
            <p className="kid-lead">{t('Opening your invitation…')}</p>
          ) : (
            <>
              <p className="kid-value" data-testid="kid-value">
                {data.balance?.valueUsd
                  ? `$${formatUnits(BigInt(data.balance.valueUsd), data.balance.feedDecimals, 2)}`
                  : t('A future in bloom')}
              </p>
              <p className="kid-lead">
                {data.balance
                  ? t('Your grown-up chose to share this balance with you.')
                  : t('Your money is tucked away. Your curiosity can grow.')}
              </p>
              <span className="kid-badge">
                <EyeOff size={15} />
                {data.balance ? t('Only on your invited device') : t('Amounts stay with your grown-up')}
              </span>
            </>
          )}
        </div>
        <div className="kid-garden" aria-hidden="true">
          <BloomGarden theme="overview" scrollMarker={false} />
        </div>
      </section>
      {data ? (
        <>
          <div className="kid-grid">
            <section className="kid-card">
              <h2>
                <Leaf size={20} /> {t('A little piece of the world')}
              </h2>
              <p className="kid-muted">{t('Explore the companies your sprout follows.')}</p>
              <ul className="kid-list">
                {data.symbols.map((symbol) => {
                  const company = kidCompany(symbol);
                  return (
                    <li key={symbol}>
                      <b>{symbol}</b>
                      {company ? <span>{t('a little piece of {company}', { company: tc('holding', company) })}</span> : null}
                      <span>{t('Learn what makes this company grow')}</span>
                    </li>
                  );
                })}
              </ul>
            </section>
            <section className="kid-card">
              <h2>
                <LockKeyhole size={20} /> {t('Yours to explore')}
              </h2>
              <p className="kid-muted">{t('Discover what makes your sprout grow. Your grown-up takes care of the money.')}</p>
              <p className="kid-highlight">
                {data.chores === 1
                  ? t('{n} chore waiting for a grown-up’s approval.', { n: data.chores })
                  : t('{n} chores waiting for a grown-up’s approval.', { n: data.chores })}
              </p>
            </section>
          </div>
          <KidLearn vault={vault} heldSymbols={data.symbols} openId={lesson} onNavigate={navigate} />
        </>
      ) : null}
      <footer className="kid-foot">
        <ShieldCheck size={16} /> {t('A grown-up can close this window at any time.')}
      </footer>
    </main>
  );
}
