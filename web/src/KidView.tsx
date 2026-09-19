import { useCallback, useEffect, useState, type MouseEvent } from 'react';
import { CalendarHeart, Gift, Leaf, Sprout as SproutIcon, Star } from 'lucide-react';
import { formatUnits } from '@sprout/shared';
import { api, type BeneficiaryState, type ChainPublic, type Holdings, type Milestone } from './api';
import { BloomGarden } from './garden/BloomGarden';
import { holdingSharesText } from './garden/format';
import { getMilestoneTitle, getNickname } from './localStore';
import { ThemeToggle } from './theme/ThemeSettings';
import { LanguageToggle } from './i18n/LanguageToggle';
import { KidLearn } from './kid/KidLearn';
import { findLesson, lessonForSymbol } from './kid/lessons';

/**
 * A read-only page a parent can open on their child's tablet: how big the
 * sprout has grown, what it holds in plain words, chores and rewards, and how
 * long until it is theirs. No wallet, no buttons that move money; everything
 * shown is already public on the chain for anyone who knows the vault.
 */

const COMPANY: Record<string, string> = {
  AAPL: 'Apple',
  NVDA: 'NVIDIA',
  MSFT: 'Microsoft',
  SPY: '500 big US companies',
};

interface KidData {
  chain: ChainPublic;
  graduationTimestamp: number;
  chainId: number;
  milestones: Milestone[];
  holdings: Holdings | null;
  gifts: number;
  rewards: BeneficiaryState | null;
}

function dollars(valueUsd: string | null, feedDecimals: number): string | null {
  if (!valueUsd) return null;
  try {
    const n = Number(formatUnits(BigInt(valueUsd), feedDecimals, 2));
    return `$${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  } catch {
    return null;
  }
}

/** "8 years and 3 months", "5 months", "12 days", or null once it has arrived. */
export function timeUntil(targetSeconds: number, nowMs: number): string | null {
  const now = new Date(nowMs);
  const target = new Date(targetSeconds * 1000);
  if (target.getTime() <= now.getTime()) return null;
  let months = (target.getUTCFullYear() - now.getUTCFullYear()) * 12 + (target.getUTCMonth() - now.getUTCMonth());
  if (target.getUTCDate() < now.getUTCDate()) months -= 1;
  const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;
  if (months <= 0) {
    const days = Math.max(1, Math.ceil((target.getTime() - now.getTime()) / 86_400_000));
    return plural(days, 'day');
  }
  const years = Math.floor(months / 12);
  const rest = months % 12;
  if (years === 0) return plural(rest, 'month');
  return rest === 0 ? plural(years, 'year') : `${plural(years, 'year')} and ${plural(rest, 'month')}`;
}

export function kidViewPath(vault: string, name?: string | null): string {
  const clean = name?.trim();
  return `/kid/${vault}${clean ? `?name=${encodeURIComponent(clean)}` : ''}`;
}

/** `/kid/<vault>` or `/kid/<vault>/learn/<lessonId>`, keeping the query (the name). */
export function kidLessonPath(vault: string, lessonId: string | null, search = ''): string {
  return `/kid/${vault}${lessonId ? `/learn/${encodeURIComponent(lessonId)}` : ''}${search}`;
}

export function parseKidPath(pathname: string): { vault: string; lessonId: string | null } | null {
  const match = pathname.replace(/\/+$/, '').match(/^\/kid\/(0x[0-9a-fA-F]{40})(?:\/learn\/([^/]+))?$/);
  if (!match) return null;
  let lessonId: string | null = null;
  try {
    lessonId = match[2] ? decodeURIComponent(match[2]) : null;
  } catch {
    lessonId = null;
  }
  return { vault: match[1]!, lessonId };
}

export function KidView({ vault, lessonId = null }: { vault: string; lessonId?: string | null }) {
  const [data, setData] = useState<KidData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [openLesson, setOpenLesson] = useState<string | null>(() => findLesson(lessonId)?.id ?? null);
  const params = new URLSearchParams(window.location.search);
  const name = (params.get('name') ?? getNickname(vault) ?? '').trim().slice(0, 24);
  const heading = name ? `${name}’s sprout` : 'Your sprout';
  const lessonTitle = findLesson(openLesson)?.title;

  useEffect(() => {
    document.title = lessonTitle ? `${lessonTitle} · ${heading} · Sprout` : `${heading} · Sprout`;
  }, [heading, lessonTitle]);

  // Lessons have their own address so a reload or the back button keeps the
  // child where they were. An address for a lesson that doesn't exist falls
  // back to the plain kid view.
  useEffect(() => {
    if (lessonId && !findLesson(lessonId)) {
      window.history.replaceState(null, '', kidLessonPath(vault, null, window.location.search));
    }
    const onPop = () => {
      const parsed = parseKidPath(window.location.pathname);
      setOpenLesson(findLesson(parsed?.lessonId)?.id ?? null);
    };
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, [vault, lessonId]);

  const openLessonAt = useCallback(
    (id: string | null) => {
      const target = kidLessonPath(vault, id, window.location.search);
      if (`${window.location.pathname}${window.location.search}` !== target) window.history.pushState(null, '', target);
      setOpenLesson(id);
    },
    [vault],
  );

  const followLessonLink = (event: MouseEvent<HTMLAnchorElement>, id: string) => {
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    openLessonAt(id);
  };

  useEffect(() => {
    let live = true;
    (async () => {
      try {
        const [{ chain }, detail] = await Promise.all([api.config(), api.sprout(vault)]);
        const [holdings, events, rewards] = await Promise.all([
          api.holdings(vault).catch(() => null),
          api.events(vault).catch(() => ({ events: [] })),
          chain.configured ? api.beneficiaryState(vault).catch(() => null) : Promise.resolve(null),
        ]);
        if (!live) return;
        setData({
          chain,
          graduationTimestamp: detail.sprout.graduationTimestamp,
          chainId: detail.sprout.chainId,
          milestones: detail.milestones,
          holdings,
          gifts: events.events.filter((e) => e.eventName === 'GiftReceived').length,
          rewards,
        });
      } catch (e) {
        if (live) setError(e instanceof Error && e.message.startsWith('404') ? 'We couldn’t find this sprout.' : 'This sprout couldn’t be loaded just now.');
      }
    })();
    return () => {
      live = false;
    };
  }, [vault]);

  const tokenInfo = (address: string) => {
    const c = data?.chain.contracts;
    if (!c) return { symbol: '', decimals: 18 };
    if (address.toLowerCase() === c.settlementToken?.toLowerCase()) return { symbol: c.settlementSymbol ?? 'USD', decimals: c.settlementDecimals };
    const t = c.stockTokens.find((s) => s.address.toLowerCase() === address.toLowerCase());
    return { symbol: t?.symbol ?? '', decimals: t?.decimals ?? 18 };
  };
  const reward = (token: string, amount: string) => {
    const t = tokenInfo(token);
    const qty = formatUnits(BigInt(amount), t.decimals, 2);
    return t.symbol === data?.chain.contracts.settlementSymbol || t.symbol === 'USD' ? `$${qty}` : `${qty} ${t.symbol}`;
  };

  const h = data?.holdings;
  const value = h?.available ? dollars(h.totalValueUsd, h.feedDecimals) : null;
  const stocks = h?.holdings.filter((x) => x.kind === 'stock' && x.rawBalance !== '0') ?? [];
  const cash = h?.holdings.find((x) => x.kind === 'settlement' && x.rawBalance !== '0');
  const openChores = data?.milestones.filter((m) => m.status === 'created') ?? [];
  const claimable = data?.rewards?.allowances.filter((a) => a.bucket !== '0') ?? [];
  const until = data ? timeUntil(data.graduationTimestamp, Date.now()) : null;

  return (
    <main className="garden-root kid-root" data-testid="kid-view">
      <header className="kid-top">
        <a className="garden-brand" href="/"><span className="garden-brand-mark"><img src="/brand/sprout-logo.png" alt="" /></span><span>SPROUT</span></a>
        <span className="kid-badge">Just looking · nothing here moves money</span>
        <ThemeToggle />
        <LanguageToggle />
      </header>

      <section className="kid-hero">
        <div className="kid-hero-copy">
          <h1 data-testid="kid-heading">{heading}</h1>
          {error ? (
            <p className="kid-lead" role="alert">{error}</p>
          ) : !data ? (
            <p className="kid-lead">Taking a look…</p>
          ) : (
            <>
              <p className="kid-value" data-testid="kid-value">{value ?? (h ? 'Still growing' : '—')}</p>
              <p className="kid-lead">
                {value
                  ? 'is growing in your sprout.'
                  : 'Prices are resting right now, so we can’t add it up. Check back soon.'}
              </p>
            </>
          )}
        </div>
        <div className="kid-garden" aria-hidden><BloomGarden theme="overview" scrollMarker={false} /></div>
      </section>

      {data ? (
        <div className="kid-grid">
          <section className="kid-card" aria-labelledby="kid-own">
            <h2 id="kid-own"><Leaf size={20} aria-hidden /> What you own</h2>
            {stocks.length === 0 && !cash ? <p className="kid-muted">Nothing yet. When money is added and invested, it shows up here.</p> : null}
            <ul className="kid-list" data-testid="kid-holdings">
              {stocks.map((s) => {
                const lesson = lessonForSymbol(s.symbol);
                return (
                  <li key={s.address}>
                    <b>{holdingSharesText({ shareEquivalent: s.shareEquivalent, rawBalance: s.rawBalance, decimals: s.decimals })} {s.symbol}</b>
                    <span>a little piece of {COMPANY[s.symbol] ?? s.symbol}</span>
                    {lesson ? (
                      <a className="kid-learn-link" href={kidLessonPath(vault, lesson.id, window.location.search)} onClick={(e) => followLessonLink(e, lesson.id)}>
                        Learn about {lesson.name ?? lesson.title}
                      </a>
                    ) : null}
                  </li>
                );
              })}
              {cash ? (
                <li>
                  <b>{dollars(cash.valueUsd, cash.feedDecimals) ?? '—'}</b>
                  <span>waiting to be planted in stocks</span>
                </li>
              ) : null}
            </ul>
          </section>

          <section className="kid-card" aria-labelledby="kid-chores">
            <h2 id="kid-chores"><Star size={20} aria-hidden /> Chores and rewards</h2>
            {openChores.length === 0 ? <p className="kid-muted">No chores waiting right now.</p> : null}
            <ul className="kid-list" data-testid="kid-chores">
              {openChores.map((m) => (
                <li key={m.id}>
                  <b>{getMilestoneTitle(data.chainId, vault, m.id) ?? 'A chore'}</b>
                  <span>earns {reward(m.token, m.amount)} when a grown-up says it’s done</span>
                </li>
              ))}
            </ul>
            {claimable.length > 0 ? (
              <p className="kid-highlight" data-testid="kid-rewards">
                You have {claimable.map((a) => reward(a.token, a.bucket)).join(' and ')} of rewards ready to claim.
              </p>
            ) : null}
          </section>

          <section className="kid-card" aria-labelledby="kid-gifts">
            <h2 id="kid-gifts"><Gift size={20} aria-hidden /> Gifts</h2>
            <p className="kid-big" data-testid="kid-gifts">{data.gifts}</p>
            <p className="kid-muted">{data.gifts === 1 ? 'gift from family so far' : 'gifts from family so far'}</p>
          </section>

          <section className="kid-card" aria-labelledby="kid-when">
            <h2 id="kid-when"><CalendarHeart size={20} aria-hidden /> When it’s yours</h2>
            <p className="kid-big" data-testid="kid-countdown">{until ?? 'It’s yours now'}</p>
            <p className="kid-muted">
              {until ? 'to go, until ' : 'since '}
              {new Date(data.graduationTimestamp * 1000).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric', timeZone: 'UTC' })}
            </p>
          </section>
        </div>
      ) : null}

      {data ? (
        <KidLearn vault={vault} heldSymbols={stocks.map((s) => s.symbol)} openId={openLesson} onNavigate={openLessonAt} />
      ) : null}

      <footer className="kid-foot">
        <SproutIcon size={16} aria-hidden />
        <span>A grown-up looks after this sprout until the big day. Values go up and down.</span>
      </footer>
    </main>
  );
}
