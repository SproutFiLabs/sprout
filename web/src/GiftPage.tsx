import { useCallback, useEffect, useState } from 'react';
import { erc20Abi, parseUnits } from 'viem';
import type { Address } from 'viem';
import { sproutVaultAbi } from '@sprout/shared';
import { api, type ChainPublic, type GiftSummary, type LocalWalletInfo } from './api';
import { contractWriter, waitForSuccess, type WalletState } from './wallet';
import { TxnStatusLine, type TxnState } from './components/TxnStatus';

interface GiftPageProps {
  giftId: string;
  chain: ChainPublic;
  wallet: WalletState | null;
  localWallet?: LocalWalletInfo | null;
  /** Connect status from the parent App, so gift-page connect errors are visible. */
  connectTxn?: TxnState | null;
  onConnect: () => Promise<void>;
  onConnectLocal?: () => Promise<void>;
}

function short(address: string): string {
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

export function GiftPage({ giftId, chain, wallet, localWallet, connectTxn, onConnect, onConnectLocal }: GiftPageProps) {
  const [gift, setGift] = useState<GiftSummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [txn, setTxn] = useState<TxnState | null>(null);
  const [form, setForm] = useState({ token: '', amount: '25' });

  const load = useCallback(async () => {
    try {
      const data = await api.gift(giftId);
      setGift(data);
      setForm((prev) => ({ ...prev, token: prev.token || data.acceptedAssets[0] || '' }));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [giftId]);

  useEffect(() => {
    void load();
  }, [load]);

  const decimalsFor = (asset: string): number => {
    if (asset.toLowerCase() === chain.contracts.settlementToken?.toLowerCase()) return chain.contracts.settlementDecimals;
    return chain.contracts.stockTokens.find((t) => t.address.toLowerCase() === asset.toLowerCase())?.decimals ?? 18;
  };
  const labelFor = (asset: string): string => {
    if (asset.toLowerCase() === chain.contracts.settlementToken?.toLowerCase()) return 'Settlement';
    return chain.contracts.stockTokens.find((t) => t.address.toLowerCase() === asset.toLowerCase())?.symbol ?? short(asset);
  };

  const pay = async () => {
    if (!wallet || !gift) return;
    setTxn({ label: 'Pay gift', status: 'pending' });
    try {
      const token = form.token as Address;
      const amount = parseUnits(form.amount || '0', decimalsFor(token));
      if (amount <= 0n) throw new Error('Amount must be positive');
      const write = contractWriter(wallet);
      const approveHash = await write({ address: token, abi: erc20Abi, functionName: 'approve', args: [gift.vaultId, amount] });
      await waitForSuccess(wallet.publicClient, approveHash);
      const payHash = await write({
        address: gift.vaultId,
        abi: sproutVaultAbi,
        functionName: 'payGift',
        args: [token, amount, gift.id],
      });
      await waitForSuccess(wallet.publicClient, payHash);
      // Best-effort callback; the backend also indexes the event on its own.
      await api.recordGiftPayment(wallet, gift.id, payHash).catch(() => undefined);
      setTxn({ label: 'Pay gift', status: 'confirmed', hash: payHash });
      await load();
    } catch (e) {
      setTxn({ label: 'Pay gift', status: 'failed', error: e instanceof Error ? e.message : String(e) });
    }
  };

  return (
    <div className="garden-root">
      <div className="garden garden--gift">
        <header className="garden-gift-topbar">
          <a className="garden-brand" href="/">
            <span className="garden-brand-mark"><img src="/brand/sprout-logo.png" alt="" /></span>
            <span>SPROUT</span>
          </a>
          <div className="garden-gift-topright">
            <a className="garden-gift-link" href="/dashboard">Dashboard</a>
            {wallet ? (
              <span className="garden-pill garden-pill--sm">{short(wallet.address)}</span>
            ) : (
              <button className="garden-pill garden-pill--dark" onClick={() => void onConnect()}>
                Connect wallet
              </button>
            )}
          </div>
        </header>

        <main className="garden-gift-main">
          <div className="garden-gift-art" aria-hidden>
            <img src="/art/dashboard/hero-bouquet.png" alt="" />
          </div>
          <section className="garden-card garden-gift-card">
            <span className="garden-eyebrow">Gift preview</span>
            {error ? (
              <p className="garden-gift-warning" data-testid="gift-error">
                {error}
              </p>
            ) : null}
            {!gift && !error ? <p className="garden-empty-note">Loading gift…</p> : null}
            {gift ? (
              <>
                <h1 className="garden-gift-title">{gift.label ?? 'Gift link'}</h1>
                <p className="garden-gift-lead">This link adds funds to one fixed vault. It never grants withdrawal access.</p>
                <div className="garden-gift-facts">
                  <div>
                    <small>Accepted assets</small>
                    <b>{gift.acceptedAssets.map(labelFor).join(', ')}</b>
                  </div>
                  <div>
                    <small>Gifts received</small>
                    <b>{gift.paymentCount}</b>
                  </div>
                </div>

                {!chain.configured ? (
                  <p className="garden-gift-notice">This chain is not configured, so paying is disabled. Nothing is guessed.</p>
                ) : !wallet ? (
                  <div className="garden-gift-form">
                    {localWallet?.enabled && onConnectLocal ? (
                      <button data-testid="gift-page-local" className="garden-pill garden-pill--dark garden-pill--wide" onClick={() => void onConnectLocal()}>
                        Use local demo gifter
                      </button>
                    ) : null}
                    <button data-testid="gift-page-connect" className="garden-pill garden-pill--wide" onClick={() => void onConnect()}>
                      Connect wallet to pay
                    </button>
                    <TxnStatusLine txn={connectTxn ?? null} explorerUrl={chain.explorerUrl} />
                  </div>
                ) : (
                  <div className="garden-gift-form">
                    <label>
                      Asset
                      <select data-testid="gift-page-token" value={form.token} onChange={(e) => setForm({ ...form, token: e.target.value })}>
                        {gift.acceptedAssets.map((asset) => (
                          <option key={asset} value={asset}>
                            {labelFor(asset)}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label>
                      Amount
                      <input data-testid="gift-page-amount" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} />
                    </label>
                    <button data-testid="gift-page-submit" className="garden-pill garden-pill--dark garden-pill--wide" onClick={() => void pay()}>
                      Approve and pay
                    </button>
                  </div>
                )}
                <TxnStatusLine txn={txn} explorerUrl={chain.explorerUrl} />
              </>
            ) : null}
          </section>
        </main>
      </div>
    </div>
  );
}
