import { useEffect, useReducer, useRef, useState, type ReactNode } from 'react';
import { ArrowRight, ArrowUpRight, Check, ChevronDown, Copy, Download, Info, RefreshCw, Wallet, X, LoaderCircle, CircleAlert } from 'lucide-react';
import { createPublicClient, erc20Abi, formatUnits, getAddress, http } from 'viem';
import { injectedProvider } from '../wallet';
import { ThemeToggle } from '../theme/ThemeSettings';
import { t, tj, dateLocale, useLocale } from '../i18n';
import { LanguageToggle } from '../i18n/LanguageToggle';
import { claimCsv, harvestReducer, initialHarvest, money, type Claim, type Scenario } from './model';
import './harvest.css';
import './harvest-language.css';

const TOKEN = '0x5ec27c931fb49911128dddf7d914c1754da9f49f';
const RPC = 'https://rpc.mainnet.chain.robinhood.com';
type Tab = 'Rewards' | 'History' | 'How it works';
type Modal = 'wallet' | 'review' | 'pending' | 'success' | 'receipt' | 'allocation' | null;
const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;
function download(claims: Claim[]) {
  const url = URL.createObjectURL(new Blob([claimCsv(claims)], { type: 'text/csv;charset=utf-8' }));
  const a = document.createElement('a'); a.href = url; a.download = 'SPROUT-Harvest-DEMO.csv'; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function Dialog({ children, close, title }: { children: ReactNode; close: () => void; title: string }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => { const el = ref.current; el?.showModal(); return () => el?.close(); }, []);
  return <dialog className="harvest-dialog" ref={ref} onCancel={e => { e.preventDefault(); close(); }} onClick={e => { if (e.target === e.currentTarget) close(); }} aria-labelledby="harvest-dialog-title">
    <div className="harvest-dialog-top"><span className="harvest-eyebrow">{t('SPROUT HARVEST / DEMO')}</span><button className="harvest-icon" aria-label={t('Close dialog')} onClick={close}><X size={20} /></button></div>
    <h2 id="harvest-dialog-title">{title}</h2>{children}
  </dialog>;
}
export function HarvestPage() {
  const [state, dispatch] = useReducer(harvestReducer, undefined, initialHarvest);
  const [tab, setTab] = useState<Tab>('Rewards');
  const [modal, setModal] = useState<Modal>(null);
  const [receipt, setReceipt] = useState<Claim | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const [copied, setCopied] = useState(false);
  const [address, setAddress] = useState('');
  const [holding, setHolding] = useState<string | null>(null);
  const [walletBusy, setWalletBusy] = useState(false);
  const [walletError, setWalletError] = useState('');
  const [search, setSearch] = useState('');
  const [claimError, setClaimError] = useState('');
  const [simulateFailure, setSimulateFailure] = useState(false);
  const claimTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const walletGeneration = useRef(0);
  const claimLocked = useRef(false);
  const locale = useLocale();
  useEffect(() => { document.title = t('Harvest preview · SPROUT'); }, [locale]);
  useEffect(() => { return () => { if (claimTimer.current) clearTimeout(claimTimer.current); walletGeneration.current++; }; }, []);
  useEffect(() => {
    const provider = injectedProvider();
    const clear = () => { walletGeneration.current++; setAddress(''); setHolding(null); setWalletBusy(false); setWalletError('Wallet changed. Connect again to refresh your balance.'); };
    provider?.on?.('accountsChanged', clear); provider?.on?.('chainChanged', clear);
    return () => { provider?.removeListener?.('accountsChanged', clear); provider?.removeListener?.('chainChanged', clear); };
  }, []);
  const switchTab = (next: Tab) => { setTab(next); setSearch(''); };
  const close = () => { if (claimTimer.current) clearTimeout(claimTimer.current); claimLocked.current = false; setModal(null); setConfirmed(false); setClaimError(''); };
  const reset = () => { close(); dispatch({ type: 'reset' }); setSimulateFailure(false); switchTab('Rewards'); };
  const connect = async () => {
    const generation = ++walletGeneration.current; setWalletBusy(true); setWalletError(''); setHolding(null);
    try {
      const provider = injectedProvider();
      if (!provider) throw new Error('No browser wallet found. Open SPROUT in a wallet-enabled browser, or continue with the example wallet.');
      const accounts = await provider.request({ method: 'eth_requestAccounts' }) as string[];
      if (!accounts[0]) throw new Error('No account selected. Try connecting again.');
      const account = getAddress(accounts[0]);
      const client = createPublicClient({ transport: http(RPC, { timeout: 12000, retryCount: 0 }) });
      if (await client.getChainId() !== 4663) throw new Error('The token network could not be verified. Please try again.');
      const block = await client.getBlock({ blockTag: 'latest' });
      if (block.number === null || Math.abs(Date.now() / 1000 - Number(block.timestamp)) > 300) throw new Error('A fresh token balance is unavailable. Please try again.');
      const [balance, decimals] = await Promise.all([
        client.readContract({ address: TOKEN, abi: erc20Abi, functionName: 'balanceOf', args: [account], blockNumber: block.number }),
        client.readContract({ address: TOKEN, abi: erc20Abi, functionName: 'decimals', blockNumber: block.number }),
      ]);
      if (generation !== walletGeneration.current) return;
      setAddress(account); setHolding(formatUnits(balance, decimals));
    } catch (error) { if (generation === walletGeneration.current) setWalletError(error instanceof Error && /wallet|account|fresh|network/i.test(error.message) ? error.message : 'Could not check your wallet. Please try again.'); }
    finally { if (generation === walletGeneration.current) setWalletBusy(false); }
  };
  const claim = () => {
    if (!confirmed || state.availableCents <= 0 || state.scenario !== 'funded' || claimLocked.current) return;
    claimLocked.current = true; setModal('pending'); setClaimError('');
    claimTimer.current = setTimeout(() => {
      claimLocked.current = false;
      if (simulateFailure) { setClaimError('The demo claim did not finish. Your example allocation is unchanged. Turn off the failure scenario or retry.'); setModal('review'); return; }
      const date = new Date().toISOString().slice(0, 10);
      const next = { id: 'DEMO-003', date, cents: state.availableCents };
      dispatch({ type: 'claim', date }); setReceipt(next); setModal('success');
    }, 1350);
  };
  const rows = state.claims.filter(c => `${c.id} ${c.date} ${money(c.cents)}`.toLowerCase().includes(search.toLowerCase()));
  const eligible = state.scenario === 'funded';
  const canClaim = eligible && state.availableCents > 0;
  const zero = state.scenario === 'empty' || state.availableCents === 0;
  const amount = state.scenario === 'unavailable' ? '—' : money(eligible ? state.availableCents : 0);
  const history = (full: boolean) => <section className="harvest-history">
    <div className="harvest-section-head"><h2>{full ? t('Your claim history') : t('Recent claims')}</h2><button className="harvest-link" onClick={() => full ? download(state.claims) : switchTab('History')}>{full ? <><Download size={16} /> {t('Export CSV')}</> : <>{t('View all')} <ArrowUpRight size={16} /></>}</button></div>
    {full && <label className="harvest-search">{t('Find a demo receipt')}<input value={search} onChange={e => setSearch(e.target.value)} placeholder={t('Search date, amount or receipt…')} /></label>}
    <div className="harvest-history-table" role="table" aria-label={t('Demo claim history')}>
      <div className="harvest-history-head" role="row"><span role="columnheader">{t('Date')}</span><span role="columnheader">{t('Amount')}</span><span role="columnheader">{t('Status')}</span><span role="columnheader">{t('Receipt')}</span></div>
      {(full ? rows : state.claims.slice(0, 2)).map(c => <div className="harvest-history-row" role="row" key={c.id}><span role="cell">{new Date(`${c.date}T12:00:00Z`).toLocaleDateString(dateLocale(), { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' })}</span><strong role="cell">{money(c.cents)} USDC</strong><span role="cell" className="harvest-muted">{t('Simulated')}</span><span role="cell"><button className="harvest-link" aria-label={t('View receipt {id}', { id: c.id })} onClick={() => { setReceipt(c); setModal('receipt'); }}>{c.id} <ArrowUpRight size={15} /></button></span></div>)}
      {rows.length === 0 && <p className="harvest-empty">{t('No receipts match.')} <button className="harvest-link" onClick={() => setSearch('')}>{t('Clear search')}</button></p>}
    </div>
  </section>;
  return <div className="harvest-root">
    <a className="harvest-skip" href="#harvest-content">{t('Skip to rewards')}</a>
    <header className="harvest-header">
      <a className="harvest-brand" href="/" aria-label={t('SPROUT home')}><span><img src="/brand/sprout-logo.png" alt="" /></span>SPROUT</a>
      <nav aria-label={t('Main navigation')}><details className="harvest-explore"><summary>{t('Explore')} <ChevronDown size={14} /></summary><div><a href="/intelligence">Intelligence</a><a href="/perks">{t('Holder perks')}</a><a href="/docs">{t('Documentation')}</a></div></details><ThemeToggle /><LanguageToggle /><a href="/dashboard" className="harvest-dashboard-link">{t('Dashboard')}</a><button className="harvest-button harvest-wallet" onClick={() => setModal('wallet')}><Wallet size={16} />{address ? short(address) : t('Example wallet')}</button></nav>
    </header>
    <main id="harvest-content" className="harvest-main">
      <div className="harvest-heading"><h1>{t('Your little harvest.')}</h1><span className="harvest-preview"><span />{t('Design preview · Sample data · Not live')}</span></div>
      <div className="harvest-top">
        <div className="harvest-primary">
          <div className="harvest-tabs" role="tablist" aria-label={t('Harvest sections')}>{(['Rewards', 'History', 'How it works'] as Tab[]).map((name, i) => <button id={`harvest-tab-${i}`} role="tab" aria-selected={tab === name} aria-controls="harvest-panel" tabIndex={tab === name ? 0 : -1} key={name} onClick={() => switchTab(name)} onKeyDown={e => { const tabs: Tab[] = ['Rewards', 'History', 'How it works']; if (['ArrowRight', 'ArrowLeft', 'Home', 'End'].includes(e.key)) { e.preventDefault(); const n = e.key === 'Home' ? 0 : e.key === 'End' ? 2 : (i + (e.key === 'ArrowRight' ? 1 : 2)) % 3; switchTab(tabs[n]!); document.getElementById(`harvest-tab-${n}`)?.focus(); } }}>{t(name)}</button>)}</div>
          <div id="harvest-panel" role="tabpanel" aria-labelledby={`harvest-tab-${['Rewards', 'History', 'How it works'].indexOf(tab)}`}>
          {tab === 'Rewards' ? <div className="harvest-balance" aria-live="polite">
            <p className="harvest-muted">{state.scenario === 'unavailable' ? t('Reward data is unavailable') : zero ? t('No rewards ready · Example') : state.scenario === 'ineligible' ? t('Not eligible · Example') : t('Available rewards · Example')}</p>
            <div className="harvest-amount">{amount} <span>USDC</span></div>
            <div className="harvest-actions"><button className="harvest-button" disabled={!canClaim} onClick={() => { setModal('review'); setConfirmed(false); setClaimError(''); }}>{t('Preview claim')} <ArrowRight size={19} /></button><button className="harvest-button secondary" onClick={() => switchTab('How it works')}>{t('How it works')}</button>{state.scenario === 'unavailable' && <button className="harvest-link" onClick={() => dispatch({ type: 'scenario', scenario: 'funded' })}><RefreshCw size={15} /> {t('Retry demo')}</button>}</div>
            <p className="harvest-status">{state.scenario === 'unavailable' ? t('Claims stay unavailable until a fresh check succeeds.') : state.scenario === 'ineligible' ? t('This example wallet does not meet the example allocation rules.') : zero ? t('You’re all caught up. No future reward is promised.') : t('Explore the claim flow. No wallet signature or payment.')}</p>
          </div> : tab === 'History' ? <div className="harvest-tab-intro"><span className="harvest-eyebrow">{t('A CLEAR RECORD')}</span><h2>{tj('Every little claim,{br}in one place.', { br: <br /> })}</h2><p>{t('Inspect a receipt or download your example history.')}</p><button className="harvest-button secondary" onClick={() => download(state.claims)}><Download size={17} /> {t('Download history')}</button></div> : <div className="harvest-tab-intro"><span className="harvest-eyebrow">{t('FROM POOL TO WALLET')}</span><h2>{tj('Know where{br}your share comes from.', { br: <br /> })}</h2><p>{t('A proposed way to distribute funded rewards to eligible holders. Funding and eligibility rules are still to be confirmed.')}</p><button className="harvest-button secondary" onClick={() => setModal('allocation')}>{t('Explore the example')} <ArrowRight size={17} /></button></div>}
          </div>
        </div>
        <div className="harvest-art"><img src="/art/harvest-bouquet.png" alt={t('Colorful cut-paper flowers in the SPROUT garden')} /></div>
      </div>
      {tab === 'Rewards' && <><section className="harvest-allocation"><div className="harvest-section-head"><h2>{t('Your allocation')}</h2><button className="harvest-link" onClick={() => setModal('allocation')}><Info size={16} /> {t('View breakdown')}</button></div><dl><div><dt>{t('Example funded pool')}</dt><dd>8,560 <small>USDC</small></dd></div><div><dt>{t('Example share')}</dt><dd>0.50<span>%</span></dd></div><div><dt>{t('Example holding')}</dt><dd>1,250,000 <small>SPROUT</small></dd></div></dl></section>{history(false)}</>}
      {tab === 'History' && history(true)}
      {tab === 'How it works' && <section className="harvest-how"><h2>{t('A simple path. A clear record.')}</h2>{[
        ['01', 'A funded pool', 'Rewards would come only from an explicitly funded pool. A revenue source has not been selected. Children’s savings remain separate.'],
        ['02', 'A published allocation', 'Before launch, the eligibility threshold, snapshot time, allocation formula and funding records need to be published. Holding SPROUT alone does not currently create a reward entitlement.'],
        ['03', 'Review, then claim', 'A live claim would need a deployed and reviewed distribution contract, a network check, a fee estimate and a wallet signature. This preview sends no transaction.'],
      ].map(([n, title, body]) => <article key={n}><span>{n}</span><div><h3>{t(title!)}</h3><p>{t(body!)}</p></div></article>)}</section>}
      <details className="harvest-demo-controls"><summary>{t('Preview different states')} <ChevronDown size={14} /></summary><div><label>{t('Reward state')}<select aria-label={t('Reward state')} value={state.scenario} onChange={e => dispatch({ type: 'scenario', scenario: e.target.value as Scenario })}><option value="funded">{t('Funded example')}</option><option value="empty">{t('No rewards')}</option><option value="ineligible">{t('Not eligible')}</option><option value="unavailable">{t('Network unavailable')}</option></select></label><label className="harvest-check"><input type="checkbox" checked={simulateFailure} onChange={e => setSimulateFailure(e.target.checked)} /> {t('Simulate a failed claim')}</label><button className="harvest-link" onClick={reset}><RefreshCw size={14} /> {t('Reset demo')}</button></div></details>
      <footer className="harvest-footer"><p>{t('Funding and eligibility rules to be confirmed.')}<br />{t('Illustrative amounts. No guaranteed returns. Family savings remain separate.')}</p><span>{t('SPROUT Harvest · Product preview')}</span></footer>
    </main>
    {modal && <Dialog close={close} title={modal === 'wallet' ? t('Your wallet, your choice.') : modal === 'review' ? t('A little check before you claim.') : modal === 'pending' ? t('Trying the claim flow.') : modal === 'success' ? t('That’s the whole journey.') : modal === 'receipt' ? t('Your example receipt.') : t('Where {amount} comes from.', { amount: '42.80' })}>
      {modal === 'wallet' && <><p className="harvest-muted">{t('The preview uses an example wallet. You can also read your real SPROUT balance; it does not unlock live rewards.')}</p><div className="harvest-detail-row"><span>{t('Example wallet')}</span><strong>0x8a…41c2 · 1,250,000 SPROUT</strong></div><button className="harvest-button secondary" onClick={() => { walletGeneration.current++; setAddress(''); setHolding(null); setWalletBusy(false); setWalletError(''); close(); }}>{t('Use example wallet')}</button><hr /><button className="harvest-button" disabled={walletBusy} onClick={() => void connect()}>{walletBusy ? <LoaderCircle className="harvest-spin" size={18} /> : <Wallet size={18} />}{walletBusy ? t('Checking Robinhood Chain…') : t('Connect & read my balance')}</button>{walletError && <p className="harvest-error" role="alert">{t(walletError)}</p>}{holding !== null && <div className="harvest-wallet-result"><span><Check size={16} /> {t('Balance checked')}</span><strong>{holding} SPROUT</strong><small>{address}</small><p>{t('Reward eligibility has not been established. All rewards shown on this page remain examples.')}</p></div>}<p className="harvest-footnote">{t('Read-only balance check. No signature, approval, token transfer or account switch.')}</p></>}
      {(modal === 'review' || modal === 'pending') && <><p className="harvest-muted">{t('Review this example claim. Nothing will be sent to a wallet.')}</p><div className="harvest-dialog-amount">{money(state.availableCents)} <small>USDC</small></div><div className="harvest-detail-row"><span>{t('Destination')}</span><strong>{t('Example wallet · {address}', { address: '0x8a…41c2' })}</strong></div><div className="harvest-detail-row"><span>{t('Network')}</span><strong>{t('Robinhood Chain · preview')}</strong></div><div className="harvest-detail-row"><span>{t('Network fee')}</span><strong>{t('None — simulated')}</strong></div><label className="harvest-check"><input type="checkbox" checked={confirmed} disabled={modal === 'pending'} onChange={e => setConfirmed(e.target.checked)} /> {t('I understand this is a demo. No funds move.')}</label>{claimError && <p role="alert" className="harvest-error"><CircleAlert size={16} />{t(claimError)}</p>}<button className="harvest-button wide" disabled={!confirmed || modal === 'pending'} onClick={claim}>{modal === 'pending' ? <><LoaderCircle className="harvest-spin" size={18} /> {t('Simulating claim…')}</> : <>{t('Complete demo claim')} <ArrowRight size={18} /></>}</button><button className="harvest-link harvest-cancel" onClick={close}>{modal === 'pending' ? t('Cancel simulation') : t('Back to rewards')}</button></>}
      {(modal === 'success' || modal === 'receipt') && receipt && <><div className="harvest-success"><Check size={24} /><span>{modal === 'success' ? t('Demo claim completed') : t('Simulated receipt')}</span></div><div className="harvest-dialog-amount">{money(receipt.cents)} <small>USDC</small></div><p className="harvest-muted">{t('No real funds were transferred. This is a preview of the claim experience.')}</p><div className="harvest-detail-row"><span>{t('Receipt')}</span><strong>{receipt.id}</strong></div><div className="harvest-detail-row"><span>{t('Date')}</span><strong>{receipt.date}</strong></div><div className="harvest-detail-row"><span>{t('Transaction hash')}</span><strong>{t('None · demo only')}</strong></div><div className="harvest-actions"><button className="harvest-button" onClick={() => { close(); switchTab('History'); }}>{t('View history')} <ArrowRight size={17} /></button><button className="harvest-button secondary" onClick={() => download([receipt])}><Download size={16} /> {t('Receipt')}</button></div></>}
      {modal === 'allocation' && <><p className="harvest-muted">{t('A transparent calculation using sample values. This is not a proposed return or a live allocation.')}</p><div className="harvest-equation"><span>8,560 <small>{t('USDC pool')}</small></span><span>×</span><span>0.50<small>{t('% example share')}</small></span><span>=</span><strong>42.80 <small>USDC</small></strong></div><p>{t('The example share is manually supplied for this preview. It is not calculated from your real wallet balance. Final eligibility and allocation rules need to be defined before launch.')}</p><div className="harvest-contract"><span>{t('SPROUT token')}</span><code>{TOKEN}</code><button className="harvest-link" onClick={async () => { try { await navigator.clipboard.writeText(TOKEN); setCopied(true); } catch { setCopied(false); } }}><Copy size={14} />{copied ? t('Copied') : t('Copy address')}</button></div><button className="harvest-button secondary" onClick={() => { close(); switchTab('How it works'); }}>{t('Read how it works')} <ArrowRight size={16} /></button></>}
    </Dialog>}
  </div>;
}
