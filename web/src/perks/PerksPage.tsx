import { useEffect, useState } from 'react';
import { ArrowRight, Check, Leaf, Wallet } from 'lucide-react';
import { t, tj, dateLocale } from '../i18n';
import { LanguageToggle } from '../i18n/LanguageToggle';
import { connectWallet, injectedProvider, type WalletState } from '../wallet';
import { api } from '../api';
import { useAutomationEnabled } from '../automationStatus';
import { PublicCa } from '../components/PublicCa';
import { holdPeriod, tierAtLeast, tierLabel, useHolder, wholeTokens, TIER_ORDER, type TierId } from './holder';
import { bouquetCount, bouquetsByTier } from './locks';
import { HolderVotes } from './Votes';
import { RootPanel } from './RootPanel';
import { RootedBadge } from './RootBits';
import './perks.css';

/** Vote weight per tier; the server uses the same table. */
const VOTE_WEIGHT: Record<TierId, number> = { seedling: 1, sapling: 2, bloom: 5, grove: 10 };

/** The visitor's address (read only), and a full wallet once they connect to vote. */
function useVisitorWallet(): { address: string | null; wallet: WalletState | null; connect: () => Promise<void>; error: string | null } {
  const [address, setAddress] = useState<string | null>(null);
  const [wallet, setWallet] = useState<WalletState | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    const provider = injectedProvider();
    if (!provider) return;
    void (provider.request({ method: 'eth_accounts' }) as Promise<string[]>).then((a) => setAddress(a[0] ?? null)).catch(() => undefined);
  }, []);
  const connect = async () => {
    setError(null);
    if (!injectedProvider()) {
      setError(t('No browser wallet found. Open this page in the browser that has your wallet.'));
      return;
    }
    try {
      const { chain } = await api.config();
      const w = await connectWallet({ chainId: chain.chainId, name: chain.name, rpcUrl: chain.walletRpcUrl });
      setWallet(w);
      setAddress(w.address);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };
  return { address, wallet, connect, error };
}

export function PerksPage() {
  const { address, wallet, connect, error: connectError } = useVisitorWallet();
  // The block this page's own lock or withdrawal confirmed in; a new one re-reads the tier.
  const [rootAfter, setRootAfter] = useState(0);
  const holder = useHolder(address, rootAfter);
  const automation = useAutomationEnabled();
  const { perks, status } = holder;
  const tiers = perks?.tiers ?? [];
  const tierIds = tiers.map((x) => x.id);
  const earlyTier = perks?.earlyAccess.tier ?? 'sapling';
  const autoTier = perks?.autoInvestTier ?? 'bloom';

  useEffect(() => {
    document.title = `${t('SPROUT holder perks')} · Sprout`;
  }, []);

  const perkRows: Array<{ label: string; has: (tier: TierId) => string | boolean }> = [
    { label: t('Holder baskets'), has: (tier) => t('{n} baskets', { n: bouquetCount(tier, tierIds) }) },
    { label: t('First dibs on new stocks'), has: (tier) => tierAtLeast(tier, earlyTier) },
    { label: t('Automatic weekly investing'), has: (tier) => tierAtLeast(tier, autoTier) },
    { label: t('Votes on the next stock'), has: (tier) => t('{n}× vote', { n: VOTE_WEIGHT[tier] }) },
  ];

  let statusBody: JSX.Element;
  if (!perks) statusBody = <p className="perks-muted">{t('Loading the perks…')}</p>;
  else if (!perks.enabled) statusBody = <p className="perks-muted">{t('Holder perks aren’t switched on here yet.')}</p>;
  else if (!address)
    statusBody = (
      <>
        <p>{t('Connect the wallet that holds your SPROUT to see your tier. Connecting only reads your address; nothing is signed.')}</p>
        <button className="perks-button" data-testid="perks-connect" onClick={() => void connect()}>
          <Wallet size={16} aria-hidden /> {t('Check my tier')}
        </button>
        {connectError ? <p className="perks-muted" role="alert">{connectError}</p> : null}
      </>
    );
  else if (!status) statusBody = <p className="perks-muted">{t('Checking your SPROUT…')}</p>;
  else
    statusBody = (
      <div data-testid="perks-status">
        <p className="perks-tier">
          {status.tier ? tierLabel(status.tier) : t('Not a holder tier yet')}
          {status.rooted ? <> <RootedBadge /></> : null}
        </p>
        <p className="perks-muted">
          {t('Held for the last {period}: {held} SPROUT · now: {now} SPROUT', {
            period: holdPeriod(status.holdSeconds),
            held: wholeTokens(status.heldBalance, status.decimals),
            now: wholeTokens(status.balance, status.decimals),
          })}
        </p>
        {status.locks?.length ? (
          <p className="perks-muted" data-testid="perks-rooted-line">
            {t('Rooted: {locked} SPROUT, counting as {credit} · your tier counts {total} SPROUT', {
              locked: wholeTokens(status.lockedBalance ?? '0', status.decimals),
              credit: wholeTokens(status.lockCredit ?? '0', status.decimals),
              total: wholeTokens(status.effectiveBalance ?? status.heldBalance, status.decimals),
            })}
          </p>
        ) : null}
        {status.currentTier && status.currentTier !== status.tier ? (
          <p className="perks-next">{t('Keep holding: {tier} unlocks once you’ve held it for {period}.', { tier: tierLabel(status.currentTier), period: holdPeriod(status.holdSeconds) })}</p>
        ) : null}
      </div>
    );

  return (
    <div className="knowledge knowledge-root perks-root">
      <header className="knowledge-topbar">
        <a className="knowledge-brand" href="/"><span className="knowledge-brand-mark"><img src="/brand/sprout-logo.png" alt="" /></span><span>SPROUT</span></a>
        <nav aria-label={t('Knowledge navigation')}>
          <a href="/dashboard">{t('Dashboard')}</a>
          <a href="/faq">{t('FAQ')}</a>
        </nav>
        <span className="knowledge-topbar-actions"><LanguageToggle /></span>
      </header>
      <main className="perks-main">
        <section className="perks-hero">
          <span className="knowledge-eyebrow">{t('SPROUT holders')}</span>
          <h1>{t('Hold SPROUT, and your sprout gets more.')}</h1>
          <p>
            {t('Perks unlock inside Sprout for wallets that have held SPROUT for {days} days (24 hours during SPROUT’s first week). Nothing here moves money: what’s in a sprout still only ever goes to your child.', { days: perks?.holdDays ?? 7 })}
          </p>
          <PublicCa variant="dashboard" />
        </section>

        <section className="perks-card perks-you" aria-labelledby="perks-you">
          <h2 id="perks-you"><Leaf size={18} aria-hidden /> {t('Your tier')}</h2>
          {statusBody}
        </section>

        {perks?.enabled && perks.root ? (
          <RootPanel perks={perks} status={status} address={address} wallet={wallet} onConnect={() => void connect()} after={rootAfter} onChanged={setRootAfter} />
        ) : null}

        <section className="perks-card" aria-labelledby="perks-tiers">
          <h2 id="perks-tiers">{t('The tiers')}</h2>
          <div className="perks-table-wrap">
            <table className="perks-table" data-testid="perks-tiers">
              <thead>
                <tr>
                  <th />
                  {tiers.map((tier) => (
                    <th key={tier.id} className={status?.tier === tier.id ? 'is-mine' : ''}>
                      <b>{tierLabel(tier.id)}</b>
                      <small>{t('{amount} SPROUT', { amount: BigInt(tier.min).toLocaleString('en-US') })}</small>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {perkRows.map((row) => (
                  <tr key={row.label}>
                    <th scope="row">{row.label}</th>
                    {TIER_ORDER.filter((id) => tiers.some((x) => x.id === id)).map((id) => {
                      const v = row.has(id);
                      return <td key={id}>{v === true ? <Check size={16} aria-label={t('Included')} /> : v === false ? <span aria-label={t('Not included')}>·</span> : v}</td>;
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <section className="perks-card" id="bouquets" aria-labelledby="perks-bouquets">
          <h2 id="perks-bouquets">💐 {t('Holder baskets')}</h2>
          <p>{t('One-tap baskets only holders can pick when planting or changing a sprout’s stocks. Each tier adds its own and keeps the ones below it.')}</p>
          <p className="perks-muted">{t('A Sprout basket is a ready-made mix of up to five stocks, like a small ETF you can see inside. Your sprout holds the stocks themselves, not a fund.')}</p>
          <div className="perks-bouquet-tiers" data-testid="perks-bouquets">
            {bouquetsByTier(tierIds).map(({ tier, bouquets }) => {
              const min = tiers.find((x) => x.id === tier)?.min;
              const open = tierAtLeast(status?.tier, tier);
              return (
                <div key={tier} className={'perks-bouquet-tier' + (open ? ' is-open' : '')} data-testid={`perks-bouquets-${tier}`}>
                  <h3>
                    <b>{tierLabel(tier)}</b>
                    {min ? <small>{t('{amount} SPROUT', { amount: BigInt(min).toLocaleString('en-US') })}</small> : null}
                    {open ? <span className="perks-bouquet-open"><Check size={14} aria-hidden /> {t('Unlocked for you')}</span> : null}
                  </h3>
                  <ul className="perks-bouquet-list">
                    {bouquets.map((b) => (
                      <li key={b.id} data-testid={`perks-bouquet-${b.id}`}>
                        <span className="perks-basket-name">
                          <b>{t(b.label)}</b>
                          {b.code ? <span className="perks-basket-code" translate="no">{b.code}</span> : null}
                        </span>
                        <span>{t(b.note)}</span>
                        <small className="perks-bouquet-mix">
                          {Object.entries(b.weights).map(([symbol, weight], i) => (
                            <span key={symbol}>{i > 0 ? ' · ' : ''}<span className="perks-bouquet-weight">{symbol} {weight}%</span></span>
                          ))}
                        </small>
                      </li>
                    ))}
                  </ul>
                </div>
              );
            })}
          </div>
          <p className="perks-muted">{t('Examples, not advice.')}</p>
        </section>

        <section className="perks-grid">
          <article className="perks-card">
            <h2>🚀 {t('First dibs on new stocks')}</h2>
            <p>{t('When Sprout adds new stocks, holders ({tier} and up) can put them in their kid’s sprout first, for the first week.', { tier: tierLabel(earlyTier) })}</p>
            {perks?.earlyAccess.symbols.length && perks.earlyAccess.until && perks.earlyAccess.until * 1000 > Date.now() ? (
              <p className="perks-next" data-testid="perks-early">
                {t('In early access now: {symbols}, until {date}.', {
                  symbols: perks.earlyAccess.symbols.join(', '),
                  date: new Date(perks.earlyAccess.until * 1000).toLocaleDateString(dateLocale(), { month: 'long', day: 'numeric' }),
                })}
              </p>
            ) : (
              <p className="perks-muted">{t('Nothing in early access right now. The next batch of stocks goes to holders first.')}</p>
            )}
          </article>
          <article className="perks-card">
            <h2>⚡ {t('Automatic weekly investing')}</h2>
            <p>{t('Holders ({tier} and up) get weekly plans that run by themselves, with the network fees on Sprout. Everyone else runs each week with Invest now.', { tier: tierLabel(autoTier) })}</p>
            {automation === false ? <p className="perks-muted">{t('Automatic investing isn’t switched on yet. When it is, holders get it first.')}</p> : null}
          </article>
        </section>

        <section className="perks-card" id="holder-votes" aria-labelledby="perks-votes">
          <h2 id="perks-votes">🗳️ {t('Votes on the next stock')}</h2>
          <HolderVotes wallet={wallet} onConnect={() => void connect()} />
        </section>

        <section className="perks-fine">
          <p>{t('Perks unlock features inside the Sprout app. They are not payments, rewards or financial advice, and they can change. The contracts stay open to everyone: holding SPROUT never changes who owns the money in a sprout.')}</p>
          <p>{tj('Questions? Read the {faq}.', { faq: <a href="/faq">{t('FAQ')}</a> })}</p>
          <a className="perks-button perks-button--light" href="/dashboard">{t('Open Sprout')} <ArrowRight size={15} /></a>
        </section>
      </main>
    </div>
  );
}
