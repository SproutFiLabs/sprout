import { useEffect, useState, type ReactNode } from 'react';
import { ArrowLeft, ArrowRight, Building2, Compass, Layers, RefreshCw, Sprout } from 'lucide-react';
import { t, tj } from '../i18n';
import { LanguageToggle } from '../i18n/LanguageToggle';
import { KNOWN_SYMBOLS, displayDescription, displayName } from '../stocks';
import { tierLabel, tierName, type TierId } from '../perks/holder';
import { KIND_HEADING, KIND_INTRO, KIND_LABEL, KIND_ORDER, THEMES, profileOf, themeOf } from './profiles';
import { parseGuidePath } from './routes';
import { GUIDE } from './content';
import { allBaskets, basketTheme, basketsWith, findBasket, type Basket } from './baskets';
import { fetchHistory, type HistoryResult, type StockHistory } from './historyApi';
import { BUMPINESS_LABEL, CALM_BELOW, VERY_BUMPY_FROM, bumpiness, type BumpinessLevel, type ClosePoint } from './bumpiness';
import { basketIndex, INDEX_START } from './basketIndex';
import { spreadReading, spreadText } from './diversification';
import { DiversificationMeter } from './DiversificationMeter';
import { PriceChart } from './PriceChart';
import { day, dayOf, indexLevel, money, percent } from './format';
import '../perks/perks.css';
import './stock-guide.css';

/**
 * The stock guide: /stocks lists every asset a sprout can hold and every Sprout
 * basket; /stocks/<SYMBOL> explains one asset; /stocks/basket/<id> is a
 * basket's factsheet. Prices are the real daily closes of each stock's
 * on-chain price feed (server/src/stockPrices.ts); nothing here is estimated.
 */

const BASKET_PATH = (b: Basket) => `/stocks/basket/${encodeURIComponent(b.id)}`;
const intelligenceLink = (question: string) => `/intelligence?q=${encodeURIComponent(question)}`;

export function StockGuidePage({ path }: { path: string }) {
  const route = parseGuidePath(path);
  let body: ReactNode;
  let title: string;
  if (route.page === 'stock') {
    body = <StockPage symbol={route.symbol} />;
    title = `${displayName(route.symbol) ?? route.symbol} (${route.symbol})`;
  } else if (route.page === 'basket') {
    const basket = findBasket(route.id)!;
    body = <BasketPage basket={basket} />;
    title = basket.code ?? t(basket.label);
  } else if (route.page === 'index') {
    body = <GuideIndex />;
    title = t('Stock guide');
  } else {
    body = <Missing />;
    title = t('Stock guide');
  }
  useEffect(() => {
    document.title = `${title} · Sprout`;
  }, [title]);
  return (
    <div className="knowledge knowledge-root sg-root" data-testid="stock-guide">
      <header className="knowledge-topbar">
        <a className="knowledge-brand" href="/"><span className="knowledge-brand-mark"><img src="/brand/sprout-logo.png" alt="" /></span><span>SPROUT</span></a>
        <nav aria-label={t('Knowledge navigation')}>
          <a href="/dashboard">{t('Dashboard')}</a>
          <a href="/stocks" className={route.page === 'index' ? 'is-current' : ''}>{t('Stock guide')}</a>
          <a href="/faq">{t('FAQ')}</a>
        </nav>
        <span className="knowledge-topbar-actions"><LanguageToggle /></span>
      </header>
      <main className="sg-main">{body}</main>
    </div>
  );
}

// ---- index ------------------------------------------------------------------

function GuideIndex() {
  const baskets = allBaskets();
  return (
    <>
      <section className="sg-hero">
        <div className="sg-hero-text">
          <span className="knowledge-eyebrow">{t('Stock guide')}</span>
          <h1>{t('Know what you’re planting.')}</h1>
          <p>{t('Every stock and fund a sprout can hold, in plain words: what it is, what tends to move its price, and how bumpy the ride has been so far.')}</p>
          <nav className="sg-jump" aria-label={t('On this page')}>
            {KIND_ORDER.map((kind) => <a key={kind} href={`#${kind}`}>{t(KIND_HEADING[kind])}</a>)}
            <a href="#baskets">{t('Sprout baskets')}</a>
            <a href="#etf-or-stock">{t('ETF or single stock?')}</a>
          </nav>
        </div>
        <img className="sg-hero-art" src="/art/dashboard/hero-bouquet.png" alt="" aria-hidden="true" decoding="async" />
      </section>

      {KIND_ORDER.map((kind) => {
        const symbols = KNOWN_SYMBOLS.filter((s) => profileOf(s)?.kind === kind);
        return (
          <section className="sg-section" id={kind} key={kind} aria-labelledby={`${kind}-title`}>
            <h2 id={`${kind}-title`}>{t(KIND_HEADING[kind])}</h2>
            <p className="sg-section-intro">{t(KIND_INTRO[kind])}</p>
            <div className="sg-grid">
              {symbols.map((symbol) => <StockCard key={symbol} symbol={symbol} />)}
            </div>
          </section>
        );
      })}

      <section className="sg-section" id="baskets" aria-labelledby="baskets-title">
        <h2 id="baskets-title">{t('Sprout baskets')}</h2>
        <p className="sg-section-intro">{t('Every starter mix and holder bouquet, shown like a fund factsheet. A basket is a mix of separate stock tokens held in your sprout, not a fund of its own.')}</p>
        <div className="sg-grid sg-grid--baskets">
          {baskets.map((b) => <BasketCard key={b.id} basket={b} />)}
        </div>
        <p className="sg-fine">{t('Examples, not advice.')}</p>
      </section>

      <EtfExplainer />

      <footer className="sg-fine sg-footer">
        <p>{t('Prices come from the price feeds on Robinhood Chain that Sprout also uses to value sprouts.')}</p>
        <p>{t('Nothing here is financial advice.')}</p>
        <a className="perks-button perks-button--light" href="/dashboard">{t('Open Sprout')} <ArrowRight size={15} aria-hidden /></a>
      </footer>
    </>
  );
}

/** A theme tag; `text` is already translated. */
function ThemeChip({ text }: { text: string }) {
  return <span className="sg-chip">{text}</span>;
}

function StockCard({ symbol }: { symbol: string }) {
  const name = displayName(symbol);
  const theme = themeOf(symbol);
  return (
    <a className="sg-card" href={`/stocks/${symbol}`} data-testid={`guide-card-${symbol}`}>
      <span className="sg-card-top">
        <b className="sg-ticker">{symbol}</b>
        {theme ? <ThemeChip text={t(theme.label)} /> : null}
      </span>
      {name ? <span className="sg-card-name">{name}</span> : null}
      <small>{displayDescription(symbol)}</small>
    </a>
  );
}

function BasketCard({ basket }: { basket: Basket }) {
  const reading = spreadReading(basket.weights);
  return (
    <a className="sg-card sg-card--basket" href={BASKET_PATH(basket)} data-testid={`guide-basket-${basket.id}`}>
      <span className="sg-card-top">
        <b className="sg-ticker">{basket.code ?? `${basket.source === 'holder' ? '💐 ' : ''}${t(basket.label)}`}</b>
        {basket.source === 'holder' ? <span className="sg-chip sg-chip--holder">{t('Holder bouquet')}</span> : <span className="sg-chip">{t('Starter mix')}</span>}
      </span>
      {basket.code ? <span className="sg-card-name">{t(basket.label)}</span> : null}
      <small className="sg-card-weights">{basket.weights.map((w) => `${w.symbol} ${w.weight}%`).join(' · ')}</small>
      {reading ? <small className="sg-card-spread">{t('How spread out')}: <b>{spreadText(reading).label}</b></small> : null}
    </a>
  );
}

function EtfExplainer() {
  return (
    <section className="sg-section sg-explainer" id="etf-or-stock" aria-labelledby="etf-title">
      <h2 id="etf-title">{t('ETF or single stock?')}</h2>
      <p className="sg-section-intro">{t('Everything a sprout can hold is one of two kinds.')}</p>
      <div className="sg-two">
        <article className="sg-panel">
          <h3><Building2 size={18} aria-hidden /> {t('A single stock')}</h3>
          <p>{t('A piece of one company, like Apple or Tesla. If that company has a great year, you feel all of it. If it has a hard one, you feel that too.')}</p>
        </article>
        <article className="sg-panel">
          <h3><Layers size={18} aria-hidden /> {t('A fund (ETF)')}</h3>
          <p>{t('An exchange-traded fund is one thing you can buy that holds many things at once. SPY holds about 500 large US companies, so one company’s bad news is a small part of the whole. When most companies fall together, the fund falls too.')}</p>
        </article>
      </div>
      <KidsLine text={t('A single stock is one apple tree. A fund is a whole orchard: one sick tree matters less, but a big storm still reaches every tree.')} />
      <p>{t('Commodity funds like SLV (silver) and USO (oil) are ETFs too, but they hold one raw material instead of many companies, so they aren’t spread out the same way.')}</p>
      <p className="sg-fine">{t('This explains how they work. It isn’t advice.')}</p>
    </section>
  );
}

/** `text` is already translated. */
function KidsLine({ text }: { text: string }) {
  return (
    <p className="sg-kids" data-testid="guide-kids">
      <img src="/art/dashboard/motion/leaf-green.png" alt="" aria-hidden="true" />
      <span>
        <b>{t('For kids')}</b> {text}
      </span>
    </p>
  );
}

function Missing() {
  return (
    <section className="sg-hero sg-missing">
      <div className="sg-hero-text">
        <span className="knowledge-eyebrow">{t('Stock guide')}</span>
        <h1>{t('That isn’t in the guide.')}</h1>
        <p>{t('The guide covers the stocks and funds a sprout can hold, and Sprout’s baskets.')}</p>
        <a className="perks-button" href="/stocks"><ArrowLeft size={15} aria-hidden /> {t('All stocks')}</a>
      </div>
    </section>
  );
}

// ---- one stock ----------------------------------------------------------------

function useHistory(symbol: string): [HistoryResult | null, () => void] {
  const [result, setResult] = useState<HistoryResult | null>(null);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let live = true;
    setResult(null);
    void fetchHistory(symbol).then((r) => live && setResult(r));
    return () => {
      live = false;
    };
  }, [symbol, attempt]);
  return [result, () => setAttempt((n) => n + 1)];
}

function useExplorer(): string | null {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    fetch('/api/config', { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null))
      .then((c: { chain?: { explorerUrl?: string } } | null) => live && setUrl(c?.chain?.explorerUrl ?? null))
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, []);
  return url;
}

function StockPage({ symbol }: { symbol: string }) {
  const name = displayName(symbol) ?? symbol;
  const profile = profileOf(symbol)!;
  const theme = THEMES[profile.theme];
  const entry = GUIDE[symbol];
  const inMixes = basketsWith(symbol);
  const [history, retry] = useHistory(symbol);
  const question = t('Help me explain {name} ({symbol}) to my child: what it is, and why its price goes up and down.', { name, symbol });
  return (
    <article className="sg-page" data-testid={`guide-stock-${symbol}`}>
      <a className="sg-back" href="/stocks"><ArrowLeft size={15} aria-hidden /> {t('All stocks')}</a>
      <header className="sg-head">
        <span className="sg-ticker sg-ticker--big">{symbol}</span>
        <h1>{name}</h1>
        <div className="sg-badges">
          <span className={`sg-chip sg-chip--kind sg-chip--${profile.kind}`} data-testid="guide-kind">{t(KIND_LABEL[profile.kind])}</span>
          <ThemeChip text={t(theme.label)} />
        </div>
        {displayDescription(symbol) ? <p className="sg-lead">{displayDescription(symbol)}</p> : null}
      </header>

      <div className="sg-columns">
        <div className="sg-col">
          <section className="sg-block" aria-labelledby="what-title">
            <h2 id="what-title">{t('What it is')}</h2>
            {entry ? <p>{t(entry.what)}</p> : null}
            {entry?.note ? (
              <p className="sg-note" data-testid="guide-token-note">
                {tj(entry.note, { registry: <q className="sg-registry" lang="en" data-sweep-skip>{entry.registry}</q> })}
              </p>
            ) : null}
            {entry ? <KidsLine text={t(entry.kids)} /> : null}
          </section>

          {profile.kind !== 'company' ? (
            <section className="sg-block" aria-labelledby="inside-title">
              <h2 id="inside-title">{t('What’s inside')}</h2>
              {entry?.inside ? <p>{t(entry.inside)}</p> : null}
              <p>
                {profile.kind === 'index-fund'
                  ? t('Because one token holds many companies, one company’s bad news is a small part of the whole. When most companies fall together, the fund falls too.')
                  : t('A commodity fund holds one raw material, not companies, so it isn’t spread out the way an index fund is. Its price can move quite differently from company stocks.')}
              </p>
            </section>
          ) : null}

          <section className="sg-block" aria-labelledby="moves-title">
            <h2 id="moves-title">{t('What moves it')}</h2>
            <ul className="sg-list">{entry?.drivers.map((d) => <li key={d}>{t(d)}</li>)}</ul>
            <p className="sg-fine">{t('Some of the things that tend to move the price. Not a prediction.')}</p>
          </section>
        </div>

        <div className="sg-col">
          <section className="sg-block" aria-labelledby="price-title">
            <h2 id="price-title">{t('Price history')}</h2>
            <StockPrices symbol={symbol} result={history} retry={retry} />
          </section>
        </div>
      </div>

      <section className="sg-block" aria-labelledby="mixes-title">
        <h2 id="mixes-title">{t('In these baskets')}</h2>
        {inMixes.length ? (
          <ul className="sg-mixes">
            {inMixes.map(({ basket, weight }) => (
              <li key={basket.id}>
                <a href={BASKET_PATH(basket)}>
                  <span>{basket.source === 'holder' ? '💐 ' : ''}{basket.code ?? t(basket.label)}</span>
                  <b>{t('{weight}% of the mix', { weight })}</b>
                </a>
              </li>
            ))}
          </ul>
        ) : (
          <p>{t('Not in any starter mix or holder bouquet yet.')}</p>
        )}
      </section>

      <section className="sg-block sg-actions" aria-labelledby="plant-title">
        <h2 id="plant-title">{t('Plant it')}</h2>
        <p>{t('Plant a sprout and pick {symbol} in step 2, or search for it by name.', { symbol })}</p>
        <p className="sg-fine">{t('Already have a sprout? Open Portfolio and choose Edit allocation. Sprouts planted before the list grew can only hold Apple, NVIDIA, Microsoft and the S&P 500.')}</p>
        <div className="sg-buttons">
          <a className="perks-button" href="/dashboard?new=1" data-testid="guide-plant"><Sprout size={16} aria-hidden /> {t('Plant a sprout')}</a>
          <a className="perks-button perks-button--light" href="/dashboard" data-testid="guide-add">{t('Add to a sprout')} <ArrowRight size={15} aria-hidden /></a>
          <a className="perks-button perks-button--light" href={intelligenceLink(question)} data-testid="guide-ask">
            <Compass size={16} aria-hidden /> {t('Ask SPROUT Intelligence about {name}', { name })}
          </a>
        </div>
      </section>

      <footer className="sg-fine sg-footer">
        <p>
          {profile.kind === 'company'
            ? t('In a sprout, {symbol} is a stock token made by Robinhood that follows the price of the company’s shares. It isn’t the same as owning the shares yourself: for example, it gives no vote at company meetings.', { symbol })
            : t('In a sprout, {symbol} is a stock token made by Robinhood that follows the price of the fund’s shares. It isn’t the same as owning the fund’s shares yourself.', { symbol })}
        </p>
        <p>{t('Nothing here is financial advice.')}</p>
      </footer>
    </article>
  );
}

function StockPrices({ symbol, result, retry }: { symbol: string; result: HistoryResult | null; retry: () => void }) {
  const explorer = useExplorer();
  if (!result) return <p className="sg-muted" role="status">{t('Loading prices…')}</p>;
  if (result.status === 'none') return <p className="sg-muted" data-testid="guide-no-history">{t('Price history isn’t available on this server.')}</p>;
  if (result.status === 'error') {
    return (
      <div className="sg-muted" role="alert">
        <p>{t('Prices couldn’t be loaded right now.')}</p>
        <button type="button" className="perks-button perks-button--light" onClick={retry}><RefreshCw size={14} aria-hidden /> {t('Try again')}</button>
      </div>
    );
  }
  const h = result.history;
  const points: ClosePoint[] = h.days.map((d) => ({ date: d.date, value: d.price }));
  if (points.length < 2) {
    return <p className="sg-muted">{t('Only {count} day of prices so far. The chart starts once there are two.', { count: points.length })}</p>;
  }
  const b = bumpiness(points)!;
  return (
    <div className="sg-prices" data-testid="guide-history">
      <div className="sg-price-now">
        <b>{money(h.latest?.price ?? points[points.length - 1]!.value)}</b>
        <span>{h.latest ? t('Last price, {date}', { date: dayOf(h.latest.updatedAt) }) : null}</span>
        <span className="sg-change">{t('{change} since {date}', { change: percent(b.change, true), date: day(b.from, true) })}</span>
      </div>
      <PriceChart points={points} format={money} label={t('Daily closing prices of {symbol} from {from} to {to}.', { symbol, from: day(b.from, true), to: day(b.to, true) })} />
      <p className="sg-fine">
        {t('Daily closing prices (UTC) from the {symbol} price feed on Robinhood Chain: {days} days, {from} to {to}.', { symbol, days: b.days, from: day(b.from, true), to: day(b.to, true) })}{' '}
        {explorer ? <a href={`${explorer.replace(/\/$/, '')}/address/${h.feed}`} target="_blank" rel="noopener noreferrer">{t('See the feed')}</a> : null}
      </p>
      {!h.complete ? <p className="sg-fine">{t('Older prices are still being read, so the chart may start later than the feed does.')}</p> : null}
      <ShortWindow days={b.days} />
      <BumpinessCard points={points} />
    </div>
  );
}

/** Roughly six months of trading days. */
const SHORT_WINDOW_DAYS = 126;

function ShortWindow({ days }: { days: number }) {
  if (days >= SHORT_WINDOW_DAYS) return null;
  return <p className="sg-fine">{t('That is a short window: a few months say little about the years a sprout grows for.')}</p>;
}

// ---- bumpiness -------------------------------------------------------------------

const LEVELS: BumpinessLevel[] = ['calm', 'bumpy', 'very-bumpy'];

function BumpinessCard({ points }: { points: readonly ClosePoint[] }) {
  const b = bumpiness(points);
  if (!b) return null;
  return (
    <div className="sg-bumps" data-testid="guide-bumpiness" data-level={b.level ?? 'unknown'}>
      <h3>{t('How bumpy has it been?')}</h3>
      <div className="sg-bumps-scale" aria-hidden="true">
        {LEVELS.map((level) => <span key={level} className={b.level === level ? 'is-on' : undefined}>{t(BUMPINESS_LABEL[level])}</span>)}
      </div>
      {b.level ? (
        <p className="sg-bumps-label"><b>{t(BUMPINESS_LABEL[b.level])}</b></p>
      ) : (
        <p className="sg-bumps-label"><b>{t('Not enough history yet to say')}</b></p>
      )}
      <dl className="sg-facts">
        <div>
          <dt>{t('Typical day')}</dt>
          <dd>{t('{pct} up or down', { pct: percent(b.typicalMove) })}</dd>
        </div>
        <div>
          <dt>{t('Biggest fall from a high')}</dt>
          <dd>
            {b.biggestFall
              ? t('{pct}, from {from} to {to}', { pct: percent(b.biggestFall.fraction), from: day(b.biggestFall.from), to: day(b.biggestFall.to) })
              : t('None in this window')}
          </dd>
        </div>
      </dl>
      <p className="sg-fine">
        {t('The typical day is the middle of {moves} daily moves: half were bigger, half smaller. Measured from daily closes, {from} to {to}. Past swings, not a prediction.', {
          moves: b.moves,
          from: day(b.from, true),
          to: day(b.to, true),
        })}
      </p>
      <p className="sg-fine">
        {t('Calm: a typical day moves less than {calm}. Bumpy: {calm} to {very}. Very bumpy: {very} or more.', { calm: percent(CALM_BELOW), very: percent(VERY_BUMPY_FROM) })}
      </p>
    </div>
  );
}

// ---- one basket ----------------------------------------------------------------

function useHistories(symbols: readonly string[]): [Record<string, HistoryResult> | null, () => void] {
  const [results, setResults] = useState<Record<string, HistoryResult> | null>(null);
  const [attempt, setAttempt] = useState(0);
  const key = symbols.join(',');
  useEffect(() => {
    let live = true;
    setResults(null);
    void Promise.all(symbols.map((s) => fetchHistory(s))).then((r) => {
      if (live) setResults(Object.fromEntries(symbols.map((s, i) => [s, r[i]!])));
    });
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, attempt]);
  return [results, () => setAttempt((n) => n + 1)];
}

function BasketPage({ basket }: { basket: Basket }) {
  const label = t(basket.label);
  const theme = basketTheme(basket);
  const symbols = basket.weights.map((w) => w.symbol);
  const [histories, retry] = useHistories(symbols);
  const question = t('Help me explain the “{name}” mix ({symbols}) to my child: what is in it, and why its value goes up and down.', { name: label, symbols: symbols.join(', ') });
  const tier = basket.tier && ['seedling', 'sapling', 'bloom', 'grove'].includes(basket.tier) ? (basket.tier as TierId) : null;
  return (
    <article className="sg-page" data-testid={`guide-basket-page-${basket.id}`}>
      <a className="sg-back" href="/stocks#baskets"><ArrowLeft size={15} aria-hidden /> {t('Stock guide')}</a>
      <header className="sg-head">
        <span className="knowledge-eyebrow">{basket.source === 'holder' ? t('Holder bouquet') : t('Sprout basket')}</span>
        <h1>{basket.source === 'holder' ? '💐 ' : ''}{basket.code ?? label}</h1>
        {basket.code ? <p className="sg-subtitle">{label}</p> : null}
        <div className="sg-badges">
          <span className="sg-chip sg-chip--kind">{t('Basket of {count} stock tokens', { count: basket.weights.length })}</span>
          <ThemeChip text={theme ? t(theme.text) : t('Mixed themes')} />
          {basket.source === 'holder' && tier ? <span className="sg-chip sg-chip--holder" data-testid="guide-basket-tier">{t('💐 {tier} and up', { tier: tierName(tier) })}</span> : null}
        </div>
        <p className="sg-lead">{t(basket.note)}</p>
      </header>

      <p className="sg-note" data-testid="guide-basket-note">
        {t('A basket is a mix of separate stock tokens held directly in your sprout, not a fund of its own. Each holding keeps its own price, and you can change the mix later.')}{' '}
        <b>{t('Examples, not advice.')}</b>
      </p>

      <div className="sg-columns">
        <div className="sg-col">
          <section className="sg-block" aria-labelledby="holdings-title">
            <h2 id="holdings-title">{t('Holdings')}</h2>
            <table className="sg-table" data-testid="guide-basket-holdings">
              <thead>
                <tr>
                  <th scope="col">{t('Holding')}</th>
                  <th scope="col">{t('Theme')}</th>
                  <th scope="col" className="sg-num">{t('Weight')}</th>
                </tr>
              </thead>
              <tbody>
                {basket.weights.map((w) => {
                  const profile = profileOf(w.symbol);
                  return (
                    <tr key={w.symbol}>
                      <td>
                        <a href={`/stocks/${w.symbol}`}><b>{w.symbol}</b></a>
                        <small>{[displayName(w.symbol), profile ? t(KIND_LABEL[profile.kind]) : null].filter(Boolean).join(' · ')}</small>
                      </td>
                      <td>{profile ? t(THEMES[profile.theme].label) : '—'}</td>
                      <td className="sg-num">{w.weight}%</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </section>
          <section className="sg-block" aria-labelledby="spread-title">
            <h2 id="spread-title">{t('Diversification')}</h2>
            <DiversificationMeter picks={basket.weights} testId="guide-basket-spread" />
          </section>
        </div>
        <div className="sg-col">
          <section className="sg-block" aria-labelledby="index-title">
            <h2 id="index-title">{t('Combined price history')}</h2>
            <BasketPrices basket={basket} histories={histories} retry={retry} />
          </section>
        </div>
      </div>

      <section className="sg-block sg-actions" aria-labelledby="plant-title">
        <h2 id="plant-title">{t('Plant this basket')}</h2>
        <p>
          {basket.source === 'holder'
            ? t('Plant a sprout and tap “{label}” in step 2.', { label: `💐 ${label}` })
            : t('Plant a sprout and tap “{label}” in step 2.', { label })}
        </p>
        {basket.source === 'holder' && tier ? <p className="sg-fine">{t('For SPROUT holders ({tier} and up).', { tier: tierLabel(tier) })}</p> : null}
        <div className="sg-buttons">
          <a className="perks-button" href="/dashboard?new=1" data-testid="guide-plant"><Sprout size={16} aria-hidden /> {t('Plant this basket')}</a>
          <a className="perks-button perks-button--light" href={intelligenceLink(question)} data-testid="guide-ask">
            <Compass size={16} aria-hidden /> {t('Ask SPROUT Intelligence about {name}', { name: basket.code ?? label })}
          </a>
        </div>
      </section>

      <footer className="sg-fine sg-footer">
        <p>{t('Nothing here is financial advice.')}</p>
      </footer>
    </article>
  );
}

function BasketPrices({ basket, histories, retry }: { basket: Basket; histories: Record<string, HistoryResult> | null; retry: () => void }) {
  if (!histories) return <p className="sg-muted" role="status">{t('Loading prices…')}</p>;
  const results = basket.weights.map((w) => histories[w.symbol]);
  if (results.some((r) => r?.status === 'error')) {
    return (
      <div className="sg-muted" role="alert">
        <p>{t('Prices couldn’t be loaded right now.')}</p>
        <button type="button" className="perks-button perks-button--light" onClick={retry}><RefreshCw size={14} aria-hidden /> {t('Try again')}</button>
      </div>
    );
  }
  const missing = basket.weights.filter((w) => histories[w.symbol]?.status !== 'ok').map((w) => w.symbol);
  if (missing.length) {
    return <p className="sg-muted" data-testid="guide-no-history">{t('Price history isn’t available on this server for {symbols}, so there is no combined chart here.', { symbols: missing.join(', ') })}</p>;
  }
  const index = basketIndex(
    basket.weights.map((w) => {
      const h = (histories[w.symbol] as { status: 'ok'; history: StockHistory }).history;
      return { symbol: w.symbol, weight: w.weight, closes: h.days.map((d) => ({ date: d.date, value: d.price })) };
    }),
  );
  if (!index) return <p className="sg-muted">{t('Its holdings don’t have two days of prices in common yet, so there is no combined chart.')}</p>;
  const b = bumpiness(index.points)!;
  return (
    <div className="sg-prices" data-testid="guide-history">
      <div className="sg-price-now">
        <b>{indexLevel(index.points[index.points.length - 1]!.value)}</b>
        <span>{t('Index level, {date}', { date: day(index.to, true) })}</span>
        <span className="sg-change">{t('{change} since {date}', { change: percent(b.change, true), date: day(index.from, true) })}</span>
      </div>
      <PriceChart
        points={index.points}
        format={indexLevel}
        baseline={INDEX_START}
        label={t('Combined index of {name} from {from} to {to}, starting at 100.', { name: basket.code ?? t(basket.label), from: day(index.from, true), to: day(index.to, true) })}
      />
      <p className="sg-fine" data-testid="guide-index-method">
        {t('Buy and hold: {start} split by the basket’s weights on {from}, never rebalanced. Each part then moves with its own stock’s daily close (UTC), from each stock’s price feed on Robinhood Chain.', { start: money(INDEX_START), from: day(index.from, true) })}
      </p>
      {index.shorter.length ? (
        <p className="sg-fine">{t('Charted from {from}, the first day every holding has a price ({symbols} starts later).', { from: day(index.from, true), symbols: index.shorter.join(', ') })}</p>
      ) : null}
      {index.skippedDays ? <p className="sg-fine">{t('Days left out because a holding had no price that day: {count}.', { count: index.skippedDays })}</p> : null}
      <ShortWindow days={b.days} />
      <BumpinessCard points={index.points} />
    </div>
  );
}

