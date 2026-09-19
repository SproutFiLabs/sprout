import { useEffect, useRef, useState } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { erc20Abi, formatUnits, type Address, type Hex } from 'viem';
import { api, authorizeFamily, clearFamilySession, familyHeaders } from '../api';
import { connectWallet, contractWriter, ensureChain, type WalletState } from '../wallet';
import { ToolComposer, ToolReportView, type ToolKind } from './ToolComposer';
import reportCss from './tools.css?inline';
import './tools-page.css';

interface ToolConfig {
  enabled: boolean;
  token: Address;
  deadAddress: Address;
  decimals: number;
  chainId: number;
  pricing: string;
}
interface Purchase {
  id: string;
  kind: ToolKind;
  amount: string;
  expiresAt: number;
  txHash: string | null;
  paidAt: number | null;
  result: { input: unknown; report: unknown; preparedAt: number } | null;
}
export type PaymentAttemptState = 'idle' | 'signing' | 'submitted' | 'ambiguous';
type PersistedPaymentState = {
  state: PaymentAttemptState;
  hash?: string;
  updatedAt: number;
};
const paymentKey = (id: string) => `sprout-tool-payment:${id}`;
export function paymentAttemptError(error: unknown, phase: 'simulation' | 'signing' | 'receipt'): 'retry' | 'ambiguous' {
  if (phase === 'simulation') return 'retry';
  if (phase === 'signing' && typeof error === 'object' && error !== null) {
    const candidate = error as { code?: unknown; cause?: { code?: unknown } };
    if (candidate.code === 4001 || candidate.cause?.code === 4001) return 'retry';
  }
  return 'ambiguous';
}
type PaymentStorage = Pick<Storage, 'getItem' | 'setItem'>;
type PaymentLocks = {
  request: <T>(name: string, options: { ifAvailable: true }, callback: (lock: object | null) => Promise<T>) => Promise<T>;
};
export async function claimPaymentAttempt(
  id: string,
  locks: PaymentLocks | undefined,
  storage: PaymentStorage,
  write: () => Promise<string>,
): Promise<Hex> {
  if (!locks) throw new Error('This browser cannot safely coordinate payment tabs. Use a modern browser to pay.');
  return locks.request(`sprout-tool-payment:${id}`, { ifAvailable: true }, async (lock) => {
    if (!lock) throw new Error('Another tab is paying this order. Check its payment status before retrying.');
    let existing: PersistedPaymentState;
    try {
      const raw = storage.getItem(paymentKey(id));
      existing = raw ? (JSON.parse(raw) as PersistedPaymentState) : { state: 'idle', updatedAt: Date.now() };
      if (!['idle', 'signing', 'submitted', 'ambiguous'].includes(existing.state)) throw new Error('Invalid payment state.');
    } catch {
      throw new Error('Payment recovery storage is unavailable. Please enable site storage before paying.');
    }
    if (existing.state !== 'idle')
      throw new Error('This order already has a payment attempt. Verify its transaction hash before retrying.');
    const signing = { state: 'signing' as const, updatedAt: Date.now() };
    try {
      storage.setItem(paymentKey(id), JSON.stringify(signing));
      const hash = await write();
      storage.setItem(paymentKey(id), JSON.stringify({ state: 'submitted', hash, updatedAt: Date.now() }));
      return hash as Hex;
    } catch (error) {
      if (paymentAttemptError(error, 'signing') === 'retry') {
        try {
          storage.setItem(paymentKey(id), JSON.stringify({ state: 'idle', updatedAt: Date.now() }));
        } catch {
          /* preserve fail closed */
        }
      } else {
        try {
          storage.setItem(paymentKey(id), JSON.stringify({ state: 'ambiguous', updatedAt: Date.now() }));
        } catch {
          /* preserve fail closed */
        }
      }
      throw error;
    }
  });
}
export function readPaymentState(id: string): PersistedPaymentState {
  const raw = localStorage.getItem(paymentKey(id));
  if (!raw) return { state: 'idle', updatedAt: Date.now() };
  const parsed = JSON.parse(raw) as PersistedPaymentState;
  if (!['idle', 'signing', 'submitted', 'ambiguous'].includes(parsed.state)) throw new Error('Invalid payment state.');
  return parsed;
}
const title = (kind: ToolKind) =>
  ({
    goal: 'Savings goal planner',
    comparison: 'Contribution comparison',
    portfolio: 'Portfolio allocation report',
  })[kind];
async function request<T>(path: string, body?: unknown): Promise<T> {
  const response = await fetch(path, {
    method: body === undefined ? 'GET' : 'POST',
    cache: 'no-store',
    headers: { ...familyHeaders(), 'content-type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || 'This request could not be completed.');
  return result;
}

function Report({ purchase }: { purchase: Purchase }) {
  if (!purchase.result) return null;
  return (
    <article>
      <ToolReportView kind={purchase.kind} result={purchase.result.report} />
      <section className="tools-input-record">
        <h3>Your inputs</h3>
        <pre>{JSON.stringify(purchase.result.input, null, 2)}</pre>
        <p>
          Prepared {new Date(purchase.result.preparedAt * 1000).toLocaleString()}. This saved result is a snapshot, not live market data.
        </p>
      </section>
    </article>
  );
}

function download(purchase: Purchase) {
  const content = renderToStaticMarkup(<Report purchase={purchase} />);
  const document = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Sprout report</title><style>body{font-family:system-ui;margin:24px auto;max-width:1000px;background:#f5f2e9;padding:16px}pre{white-space:pre-wrap}${reportCss}</style></head><body>${content}</body></html>`;
  const url = URL.createObjectURL(new Blob([document], { type: 'text/html;charset=utf-8' }));
  const link = window.document.createElement('a');
  link.href = url;
  link.download = `sprout-${purchase.kind}-${purchase.id.slice(0, 8)}.html`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function ToolsPage() {
  const [config, setConfig] = useState<ToolConfig | null>(null);
  const [wallet, setWallet] = useState<WalletState | null>(null);
  const [orders, setOrders] = useState<Purchase[]>([]);
  const [current, setCurrent] = useState<Purchase | null>(null);
  const [busy, setBusy] = useState(false),
    [message, setMessage] = useState(''),
    [error, setError] = useState('');
  const [hash, setHash] = useState('');
  const epoch = useRef(0);
  const signedOrder = useRef<string | null>(null);
  const paymentState = useRef<PaymentAttemptState>('idle');
  const connectionEpoch = useRef(0);
  useEffect(() => {
    document.title = 'Planning tools · Sprout';
    let active = true;
    request<ToolConfig>('/api/tools')
      .then((c) => active && setConfig(c))
      .catch(() => active && setError('Could not load tool availability.'));
    return () => {
      active = false;
      epoch.current++;
    };
  }, []);
  useEffect(() => {
    if (!wallet) return;
    const reset = () => {
      epoch.current++;
      connectionEpoch.current++;
      clearFamilySession();
      setWallet(null);
      setCurrent(null);
      setOrders([]);
      setHash('');
      setBusy(false);
      signedOrder.current = null;
      setMessage('Reconnect to access this wallet’s saved reports.');
    };
    wallet.provider.on?.('accountsChanged', reset);
    wallet.provider.on?.('chainChanged', reset);
    window.addEventListener('sprout-family-session-ended', reset);
    return () => {
      wallet.provider.removeListener?.('accountsChanged', reset);
      wallet.provider.removeListener?.('chainChanged', reset);
      window.removeEventListener('sprout-family-session-ended', reset);
    };
  }, [wallet]);

  async function connect() {
    const version = ++connectionEpoch.current;
    setBusy(true);
    setError('');
    let cleanup = () => {};
    try {
      const { chain } = await api.config();
      const connected = await connectWallet({
        chainId: chain.chainId,
        name: chain.name,
        rpcUrl: chain.walletRpcUrl,
      });
      const invalidate = () => {
        connectionEpoch.current++;
        epoch.current++;
        clearFamilySession();
        setWallet(null);
        setOrders([]);
        setCurrent(null);
        setBusy(false);
        setError('Wallet changed during sign in. Reconnect to continue.');
      };
      connected.provider.on?.('accountsChanged', invalidate);
      connected.provider.on?.('chainChanged', invalidate);
      cleanup = () => {
        connected.provider.removeListener?.('accountsChanged', invalidate);
        connected.provider.removeListener?.('chainChanged', invalidate);
      };
      if (version !== connectionEpoch.current) throw new Error('Wallet changed during sign in.');
      await authorizeFamily(connected);
      if (version !== connectionEpoch.current) throw new Error('Wallet changed during sign in.');
      const saved = await request<{ purchases: Purchase[] }>('/api/family/tools/purchases');
      if (version !== connectionEpoch.current) return;
      setWallet(connected);
      setOrders(saved.purchases);
      setMessage('Signed in. Preparing a report does not spend tokens.');
    } catch {
      if (version === connectionEpoch.current)
        setError('Connect your wallet and sign the login message to continue. No tokens were requested.');
    } finally {
      cleanup();
      if (version === connectionEpoch.current) setBusy(false);
    }
  }

  async function prepare(kind: ToolKind, input: unknown) {
    if (!wallet) {
      setError('Connect your wallet first.');
      return;
    }
    const version = epoch.current;
    setBusy(true);
    setError('');
    setMessage('Preparing your report and a SPROUT quote…');
    try {
      const order = await request<Purchase>('/api/family/tools/prepare', {
        kind,
        input,
      });
      if (version !== epoch.current) return;
      setCurrent(order);
      setOrders((items) => [order, ...items]);
      setHash('');
      signedOrder.current = null;
      paymentState.current = 'idle';
      setMessage('Report prepared. Review the token amount before paying.');
    } catch (e) {
      if (version === epoch.current) setError(e instanceof Error ? e.message : 'Could not prepare the report.');
    } finally {
      if (version === epoch.current) setBusy(false);
    }
  }

  async function verify(order: Purchase, transactionHash: string) {
    const verified = await request<Purchase>(`/api/family/tools/purchases/${order.id}/verify`, { txHash: transactionHash });
    return verified;
  }
  function accept(purchase: Purchase) {
    setCurrent(purchase);
    setOrders((items) => items.map((o) => (o.id === purchase.id ? purchase : o)));
    setMessage('Burn verified. Your report is ready, and you can download it again without another payment.');
  }

  async function pay() {
    if (
      !current ||
      !wallet ||
      !config?.enabled ||
      current.paidAt !== null ||
      hash ||
      signedOrder.current === current.id ||
      paymentState.current === 'ambiguous'
    )
      return;
    const order = current,
      version = epoch.current;
    signedOrder.current = order.id;
    setBusy(true);
    setError('');
    setMessage('Review the SPROUT transfer in your wallet.');
    let broadcast = false;
    let simulated = false;
    try {
      await ensureChain(wallet, {
        chainId: config.chainId,
        name: wallet.chainName,
        rpcUrl: wallet.chain.rpcUrls.default.http[0],
      });
      const args = {
        address: config.token,
        abi: erc20Abi,
        functionName: 'transfer',
        args: [config.deadAddress, BigInt(order.amount)],
      } as const;
      await wallet.publicClient.simulateContract({
        ...args,
        account: wallet.address,
      });
      simulated = true;
      if (version !== epoch.current) return;
      const tx = await claimPaymentAttempt(order.id, navigator.locks, localStorage, () => contractWriter(wallet)(args) as Promise<Hex>);
      broadcast = true;
      paymentState.current = 'submitted';
      // Public receipt reference only; no report inputs or access token are persisted here.
      try {
        localStorage.setItem(`sprout-tool-tx:${order.id}`, tx);
      } catch {
        /* in-memory recovery remains available */
      }
      if (version !== epoch.current) return;
      setHash(tx);
      setMessage('Transfer submitted. Waiting for three confirmations; do not pay again.');
      await wallet.publicClient.waitForTransactionReceipt({
        hash: tx,
        confirmations: 3,
      });
      if (version !== epoch.current) return;
      const paid = await verify(order, tx);
      if (version === epoch.current) accept(paid);
    } catch (e) {
      const disposition = paymentAttemptError(e, !simulated ? 'simulation' : broadcast ? 'receipt' : 'signing');
      if (disposition === 'retry') {
        signedOrder.current = null;
        paymentState.current = 'idle';
      } else {
        paymentState.current = 'ambiguous';
      }
      if (version === epoch.current)
        setError(
          broadcast
            ? 'Your transfer was submitted. Use Verify payment to recover the report; do not send another payment.'
            : 'The wallet did not return a confirmed transaction hash. Check wallet activity before retrying; if a transfer was sent, paste its hash below.',
        );
    } finally {
      if (version === epoch.current) setBusy(false);
    }
  }

  async function recover() {
    if (!current) return;
    const version = epoch.current;
    setBusy(true);
    setError('');
    try {
      const paid = await verify(current, hash);
      if (version === epoch.current) accept(paid);
    } catch (e) {
      if (version === epoch.current) setError(e instanceof Error ? e.message : 'Payment is not verified yet.');
    } finally {
      if (version === epoch.current) setBusy(false);
    }
  }

  function select(order: Purchase) {
    setCurrent(order);
    setError('');
    setMessage('');
    try {
      const saved = readPaymentState(order.id);
      paymentState.current = saved.state;
      signedOrder.current = saved.state === 'idle' ? null : order.id;
      setHash(saved.hash ?? localStorage.getItem(`sprout-tool-tx:${order.id}`) ?? order.txHash ?? '');
    } catch {
      paymentState.current = 'ambiguous';
      setHash(order.txHash ?? '');
      setError('Payment recovery storage is unavailable. You can verify an existing transaction below.');
    }
  }

  return (
    <div className="knowledge tools-page">
      <header className="knowledge-topbar">
        <a className="knowledge-brand" href="/">
          <span className="knowledge-brand-mark">
            <img src="/brand/sprout-logo.png" alt="" />
          </span>
          SPROUT
        </a>
        <nav>
          <a href="/dashboard">Dashboard</a>
          <a href="/perks">Holder perks</a>
          <a href="/tokenomics">Tokenomics</a>
        </nav>
      </header>
      <main className="tools-main">
        <section className="tools-page-intro">
          <p className="tools-eyebrow">Plan a little further</p>
          <h1>
            Useful tools.
            <br />A little SPROUT burned.
          </h1>
          <p>
            Prepare a report, review the price, then send SPROUT directly to the dead address to unlock it. No USDG payment or token
            approval is required.
          </p>
          <p>{config?.pricing ?? 'Checking tool availability…'}</p>
          <p>
            Paid reports and their inputs are saved privately to your wallet login until you delete your family data. Download a copy to
            keep it yourself.
          </p>
          {config && !config.enabled && <p className="tools-status">Preview only. Paid tools are not enabled yet.</p>}
          <button className="tools-prepare" disabled={busy} onClick={() => void connect()}>
            {wallet ? 'Refresh saved reports' : 'Connect wallet & sign in'}
          </button>
        </section>
        <ToolComposer busy={busy} disabled={!config?.enabled || !wallet} onPrepare={(kind, input) => void prepare(kind, input)} />
        {message && (
          <p className="tools-status" role="status">
            {message}
          </p>
        )}
        {error && (
          <p className="tools-error" role="alert">
            {error}
          </p>
        )}
        {current && (
          <section className="tools-checkout">
            <h2>{title(current.kind)}</h2>
            {current.result ? (
              <>
                <p>Your purchased result is ready.</p>
                <button className="tools-prepare" onClick={() => download(current)}>
                  Download report
                </button>
                <p>Open the downloaded HTML file to view it offline or print it to PDF.</p>
                <Report purchase={current} />
              </>
            ) : (
              <>
                <p>
                  <strong>{formatUnits(BigInt(current.amount), config?.decimals ?? 18)} SPROUT</strong>
                </p>
                <p>
                  One use. Network gas is separate. Tokens are permanently sent to the dead address. This spends from your connected wallet,
                  never a family sprout.
                </p>
                <p>Burning SPROUT may affect holder perks. Saved paid reports can be downloaded again without another charge.</p>
                <p>This token price stays fixed for this prepared report. A delayed confirmation can still unlock it.</p>
                <button
                  className="tools-prepare"
                  disabled={
                    busy || !config?.enabled || !!hash || signedOrder.current === current.id || paymentState.current === 'ambiguous'
                  }
                  onClick={() => void pay()}
                >
                  Burn SPROUT & unlock report
                </button>
                <details>
                  <summary>Already sent a payment? Recover your report</summary>
                  <p>Paste the transfer hash from your wallet. Verification never sends another transaction.</p>
                  <label>
                    Transaction hash
                    <input value={hash} onChange={(e) => setHash(e.target.value.trim())} placeholder="0x…" />
                  </label>
                  <button disabled={busy || !/^0x[0-9a-fA-F]{64}$/.test(hash)} onClick={() => void recover()}>
                    Verify payment
                  </button>
                </details>
              </>
            )}
          </section>
        )}
        {orders.length > 0 && (
          <section className="tools-library">
            <h2>Your reports & pending payments</h2>
            <p>Saved results are available without paying again. Recover a submitted payment here if the page was closed.</p>
            {orders.map((order) => (
              <button key={order.id} disabled={busy} onClick={() => select(order)}>
                {title(order.kind)} · {order.paidAt === null ? 'Awaiting verified payment' : 'Ready'} · {order.id.slice(0, 8)}
              </button>
            ))}
          </section>
        )}
      </main>
    </div>
  );
}
