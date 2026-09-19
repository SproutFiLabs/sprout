import { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowRight, ArrowUpRight, RefreshCw, Wallet, LogOut } from 'lucide-react';
import { formatUnits } from 'viem';
import { HARVEST_CHAIN_ID, HARVEST_RULES, type HarvestRound, type HarvestRegistration } from '@sprout/shared';
import { assertWalletReady, connectWallet, ensureChain, injectedProvider, sign, type WalletState } from '../wallet';
import { ThemeToggle } from '../theme/ThemeSettings';
import './harvest.css';
import './manual.css';

export async function harvestRequest<T>(path:string, init?:RequestInit):Promise<T> {
  const res=await fetch(path,{...init,cache:'no-store'});
  const data=await res.json();if(!res.ok) throw new Error(data.error||'Harvest is unavailable. Please retry.');return data as T;
}
export const displayAmount=(amount:string,decimals:number)=>formatUnits(BigInt(amount),decimals);
const date=(at:number)=>new Date(at).toLocaleString(undefined,{dateStyle:'medium',timeStyle:'short'});
const chain={chainId:HARVEST_CHAIN_ID,name:'Robinhood Chain',rpcUrl:'https://rpc.mainnet.chain.robinhood.com'};
export function HarvestHeader({children}:{children?:React.ReactNode}) {
  return <header className="harvest-header"><a className="harvest-brand" href="/" aria-label="SPROUT home"><span><img src="/brand/sprout-logo.png" alt=""/></span>SPROUT</a><nav aria-label="Main navigation"><a href="/intelligence" className="harvest-dashboard-link">Intelligence</a><ThemeToggle/>{children}</nav></header>;
}
export function ManualHarvestPage() {
  const [rounds,setRounds]=useState<HarvestRound[]>([]),[selected,setSelected]=useState(''),[wallet,setWallet]=useState<WalletState|null>(null),[rows,setRows]=useState<HarvestRegistration[]>([]);
  const [tab,setTab]=useState<'Rewards'|'History'|'How it works'>('Rewards'),[error,setError]=useState(''),[busy,setBusy]=useState(false),[loaded,setLoaded]=useState(false),[message,setMessage]=useState('');
  const generation=useRef(0),walletRef=useRef<WalletState|null>(null),action=useRef(false);
  const refresh=useCallback(async()=>{
    const epoch=generation.current,current=walletRef.current;
    const [data,account]=await Promise.all([harvestRequest<{rounds:HarvestRound[]}>('/api/harvest'),current?harvestRequest<{registrations:HarvestRegistration[]}>(`/api/harvest/account/${current.address}`):Promise.resolve({registrations:[]})]);
    if(epoch!==generation.current)return;
    setRounds(data.rounds);setRows(account.registrations);setLoaded(true);setSelected(prev=>data.rounds.some(r=>r.id===prev)?prev:data.rounds.find(r=>r.state==='open')?.id??data.rounds[0]?.id??'');
  },[]);
  useEffect(()=>{document.title='Harvest · SPROUT';void refresh().catch(e=>setError(e.message));const timer=setInterval(()=>{void refresh().catch(e=>setError(e.message));},30000);return()=>{clearInterval(timer);generation.current++;};},[refresh]);
  const disconnect=useCallback(()=>{generation.current++;walletRef.current=null;setWallet(null);setRows([]);setMessage('');setBusy(false);action.current=false;},[]);
  useEffect(()=>{const p=injectedProvider();const change=()=>{disconnect();setError('Wallet changed. Reconnect to continue.');};p?.on?.('accountsChanged',change);p?.on?.('chainChanged',change);return()=>{p?.removeListener?.('accountsChanged',change);p?.removeListener?.('chainChanged',change);};},[disconnect]);
  const connect=async()=>{
    if(action.current)return;action.current=true;setBusy(true);setError('');
    try { const next=await connectWallet(chain);await ensureChain(next,chain);await assertWalletReady(next);generation.current++;walletRef.current=next;setWallet(next);await refresh(); }
    catch(e){setError(e instanceof Error?e.message:'Could not connect.');}
    finally{action.current=false;setBusy(false);}
  };
  const round=rounds.find(r=>r.id===selected),registration=rows.find(r=>r.roundId===selected);
  const register=async()=>{
    if(!wallet||!round||action.current)return;action.current=true;setBusy(true);setError('');setMessage('');const epoch=generation.current;
    try{
      await assertWalletReady(wallet);
      const nonce=await harvestRequest<{nonce:string;message:string}>('/api/auth/nonce',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({address:wallet.address,purpose:`harvest:${round.id}`})});
      const signature=await sign(nonce.message,wallet);await assertWalletReady(wallet);
      if(epoch!==generation.current)return;
      await harvestRequest(`/api/harvest/rounds/${round.id}/register`,{method:'POST',headers:{'x-sprout-address':wallet.address,'x-sprout-nonce':nonce.nonce,'x-sprout-signature':signature}});
      if(epoch!==generation.current)return;setMessage('You’re registered. Your share is calculated after registration closes.');await refresh();
    }catch(e){if(epoch===generation.current)setError(e instanceof Error?e.message:'Registration failed.');}
    finally{if(epoch===generation.current){setBusy(false);action.current=false;}}
  };
  const open=round?.state==='open'&&Date.now()<round.closesAt;
  return <div className="harvest-root"><HarvestHeader>{wallet?<><button className="harvest-button harvest-wallet" onClick={disconnect} title="Disconnect wallet">{wallet.address.slice(0,6)}…{wallet.address.slice(-4)} <LogOut size={15}/></button></>:<button className="harvest-button harvest-wallet" disabled={busy} onClick={()=>void connect()}><Wallet size={16}/>{busy?'Connecting…':'Connect wallet'}</button>}</HarvestHeader>
    <main className="harvest-main"><div className="harvest-heading"><h1>Your little harvest.</h1><span className="harvest-preview"><span/>Manual rewards · Robinhood Chain</span></div>
      <div className="harvest-top"><div className="harvest-primary"><nav className="harvest-tabs" aria-label="Harvest sections">{(['Rewards','History','How it works'] as const).map(t=><button key={t} aria-current={tab===t?'page':undefined} onClick={()=>setTab(t)}>{t}</button>)}</nav>
      {tab==='Rewards'?<div className="harvest-balance">{round?<><label className="manual-select">Reward round<select value={selected} onChange={e=>{setSelected(e.target.value);setMessage('');}}>{rounds.map(r=><option key={r.id} value={r.id}>{r.title}</option>)}</select></label><p className="harvest-muted">{registration?.txHash?'Payment verified':round.state==='cancelled'?'Round cancelled':registration?.amount!==null&&registration?.amount!==undefined?'Your allocation · Manual payment':registration?'Registered · Allocation pending':'Announced round budget · Not escrowed'}</p><div className="harvest-amount manual-amount">{round.state==='cancelled'||(registration&&registration.amount===null)?'—':displayAmount(registration?.amount??round.budget,round.decimals)} <span>{round.symbol}</span></div>
      <div className="harvest-actions">{!wallet?<button className="harvest-button" onClick={()=>void connect()} disabled={busy}>Connect to register <ArrowRight size={17}/></button>:<button className="harvest-button" onClick={()=>void register()} disabled={busy||!open||!!registration}>{busy?'Check your wallet…':registration?.txHash?'Paid':registration?'Registered':open?'Sign & register':'Registration closed'} <ArrowRight size={17}/></button>}<button className="harvest-button secondary" onClick={()=>setTab('How it works')}>How it works</button></div><p className="harvest-status">{registration?.txHash?'This payment was verified against a finalized token transfer.':round.state==='locked'?'The team sends payments manually. An allocation is not a completed payment.':`Registration closes ${date(round.closesAt)}. A signature proves wallet ownership; it does not send tokens.`}</p></>:<><p className="harvest-muted">{loaded?'No reward round announced yet':'Loading rewards…'}</p><h2 className="manual-empty-title">A little patience.<br/>A clear beginning.</h2><p>Each round will show its budget, registration deadline and snapshot before holders register. There are no claimable rewards yet.</p><button className="harvest-button secondary" onClick={()=>setTab('How it works')}>See the rules <ArrowRight size={17}/></button></>}</div>:<div className="harvest-tab-intro"><span className="harvest-eyebrow">{tab==='History'?'A CLEAR RECORD':'FROM SNAPSHOT TO PAYMENT'}</span><h2>{tab==='History'?<>Every payment,<br/>in one place.</>:<>Your share,<br/>explained simply.</>}</h2><p>{tab==='History'?'Track registrations, allocations and verified transfers for your connected wallet.':'A published budget. A fixed snapshot. A payment you can verify.'}</p></div>}
      </div><div className="harvest-art"><img src="/art/harvest-bouquet.png" alt="Colorful cut-paper flowers in the SPROUT garden"/></div></div>
      {error&&<p className="harvest-error" role="alert">{error}<button className="harvest-link" onClick={()=>{setError('');void refresh().catch(e=>setError(e.message));}}><RefreshCw size={14}/>Retry</button></p>}{message&&<p className="harvest-success" role="status">{message}</p>}
      {tab==='Rewards'&&round&&<section className="harvest-allocation"><h2>The round, in full.</h2><dl><div><dt>Minimum at snapshot</dt><dd>1,000,000 <small>SPROUT</small></dd></div><div><dt>Snapshot block</dt><dd>{round.snapshotBlock}</dd></div><div><dt>Payment method</dt><dd>Manual <small>by the team</small></dd></div></dl><div className="manual-contracts"><p>Payout token <a href={`https://robinhoodchain.blockscout.com/address/${round.token}`} target="_blank" rel="noreferrer">{round.token} ↗</a></p><p>Treasury <a href={`https://robinhoodchain.blockscout.com/address/${round.funder}`} target="_blank" rel="noreferrer">{round.funder} ↗</a></p></div></section>}
      {tab==='History'&&<section className="harvest-history"><h2>Your payment history</h2>{!wallet?<p>Connect your wallet to see its registrations and payments.</p>:rows.length===0?<p>No registrations for this wallet yet.</p>:rows.map(r=>{const owner=rounds.find(x=>x.id===r.roundId);return <article className="manual-history" key={r.roundId}><div><strong>{owner?.title??r.roundId}</strong><p>{owner?.state==='cancelled'?'Cancelled':r.txHash?'Paid · Verified on-chain':r.pendingTxHash?'Payment submitted · Verification pending':r.amount===null?'Registered · Awaiting allocation':BigInt(r.amount)===0n?'Below the smallest payout unit':'Allocated · Awaiting manual payment'}</p></div><strong>{r.amount&&owner?`${displayAmount(r.amount,owner.decimals)} ${owner.symbol}`:'—'}</strong>{r.txHash?<a className="harvest-link" href={`https://robinhoodchain.blockscout.com/tx/${r.txHash}`} target="_blank" rel="noreferrer">View transaction <ArrowUpRight size={16}/></a>:<span className="harvest-muted">No payment recorded</span>}</article>;})}</section>}
      {tab==='How it works'&&<section className="harvest-how"><h2>A simple path. A clear record.</h2>{[
        ['01','Meet the snapshot','Hold at least 1,000,000 SPROUT at the published block. Buying after that snapshot does not qualify a wallet for that round.'],
        ['02','Register before the deadline','Connect that wallet and sign a one-time ownership message. You keep your tokens. No token approval, transfer, staking or subscription is required.'],
        ['03','Share the announced budget','After registration closes, the budget is divided proportionally by the SPROUT balance of eligible registered wallets at the snapshot. Fractions of the smallest payout unit round down.'],
        ['04','Follow the manual payment','The team sends the announced payout asset to your registered wallet. Harvest marks it paid only after verifying the sender, recipient, amount and finalized transaction.'],
      ].map(([n,title,body])=><article key={n}><span>{n}</span><div><h3>{title}</h3><p>{body}</p></div></article>)}<p>{HARVEST_RULES}</p></section>}
      <footer className="harvest-footer"><p>Budgets remain in the treasury until manually paid. Family savings remain separate.<br/>No guaranteed returns or recurring rewards. Token ownership alone creates no payment entitlement.</p><a href="/harvest?demo=1">Explore the design demo</a></footer>
    </main></div>;
}
