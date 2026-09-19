import { useCallback, useEffect, useState } from 'react';
import { erc20Abi, parseUnits } from 'viem';
import type { Address } from 'viem';
import { sproutVaultAbi } from '@sprout/shared';
import { api, type ChainPublic, type GiftSummary, type LocalWalletInfo } from './api';
import { contractWriter, waitForSuccess, type WalletState } from './wallet';
import { TxnStatusLine, type TxnState } from './components/TxnStatus';
import { CampaignProgress, GiftNotesList, NAME_MAX, NOTE_MAX, giftAmountLabel, textProblem } from './components/Campaign';
import { t, tj } from './i18n';
import { LanguageToggle } from './i18n/LanguageToggle';
import { displayLabel } from './stocks';
import { assetDecimals } from './assetUnits';

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

/** The server's own message from an "NNN {json}" API error. */
function apiErrorText(e: unknown): string {
  const text = (e instanceof Error ? e.message : String(e)).replace(/^\d+\s*/, '');
  try {
    return (JSON.parse(text) as { error?: string }).error ?? text;
  } catch {
    return text;
  }
}

function short(address: string): string {
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

export function GiftPage({ giftId, chain, wallet, localWallet, connectTxn, onConnect, onConnectLocal }: GiftPageProps) {
  const [gift, setGift] = useState<Pick<GiftSummary, 'id' | 'label' | 'acceptedAssets' | 'status'> & { publicKey: string | null } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [txn, setTxn] = useState<TxnState | null>(null);
  const [form, setForm] = useState({ token: '', amount: '25', name: '', note: '' });
  const [noteProblem, setNoteProblem] = useState<string | null>(null);

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

  const decimalsFor = (asset: string): number => assetDecimals(chain.contracts, asset);
  // "Tesla (TSLA)" for a stock the catalogue knows, so family see a company rather than a ticker.
  const labelFor = (asset: string): string => {
    if (asset.toLowerCase() === chain.contracts.settlementToken?.toLowerCase()) return chain.contracts.settlementSymbol ?? t('Settlement');
    const symbol = chain.contracts.stockTokens.find((t) => t.address.toLowerCase() === asset.toLowerCase())?.symbol;
    return symbol ? displayLabel(symbol) : short(asset);
  };

  const pay = async () => {
    if (!wallet || !gift) return;
    // Refuse a note the server would refuse before any money moves.
    const problem = textProblem(form.name, NAME_MAX, 'Your name') ?? textProblem(form.note, NOTE_MAX, 'The note');
    setNoteProblem(problem);
    if (problem) return;
    setTxn({ label: t('Pay gift'), status: 'pending' });
    try {
      const token = form.token as Address;
      const amount = parseUnits(form.amount || '0', decimalsFor(token));
      if (amount <= 0n) throw new Error(t('Amount must be positive'));
      const checkout = await api.giftCheckout(wallet, gift.id);
      const write = contractWriter(wallet);
      const approveHash = await write({ address: token, abi: erc20Abi, functionName: 'approve', args: [checkout.vaultId, amount] });
      await waitForSuccess(wallet.publicClient, approveHash);
      const payHash = await write({
        address: checkout.vaultId,
        abi: sproutVaultAbi,
        functionName: 'payGift',
        args: [token, amount, gift.id],
      });
      await waitForSuccess(wallet.publicClient, payHash);
      // The backend also indexes the gift on its own; this call is what attaches
      // the name and note, so report it if that part fails.
      const message = { name: form.name.trim(), note: form.note.trim() };
      await api.recordGiftPayment(wallet, gift.id, payHash, message).catch((e: unknown) => {
        if (message.name || message.note) {
          setNoteProblem(t("Your gift went through, but the note couldn't be saved: {error}", { error: apiErrorText(e) }));
        }
      });
      setTxn({ label: t('Pay gift'), status: 'confirmed', hash: payHash });
      setForm((f) => ({ ...f, note: '' }));
      await load();
    } catch (e) {
      setTxn({ label: t('Pay gift'), status: 'failed', error: e instanceof Error ? e.message : String(e) });
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
            <LanguageToggle />
            <a className="garden-gift-link" href="/dashboard">{t('Dashboard')}</a>
            {wallet ? (
              <span className="garden-pill garden-pill--sm">{short(wallet.address)}</span>
            ) : (
              <button className="garden-pill garden-pill--dark" onClick={() => void onConnect()}>
                {t('Connect wallet')}
              </button>
            )}
          </div>
        </header>

        <main className="garden-gift-main">
          <div className="garden-gift-art" aria-hidden>
            <img src="/art/dashboard/hero-bouquet.png" alt="" />
          </div>
          <section className="garden-card garden-gift-card">
            <span className="garden-eyebrow">{t('Gift invitation')}</span>
            {error ? (
              <p className="garden-gift-warning" data-testid="gift-error">
                {error}
              </p>
            ) : null}
            {!gift && !error ? <p className="garden-empty-note">{t('Loading gift…')}</p> : null}
            {gift ? (
              <>
                <h1 className="garden-gift-title" data-testid="gift-page-title">{t('A gift for the future')}</h1>
                <p className="garden-gift-lead">{t('A little today. A world of possibilities. No child identity is shown in this preview.')}</p>
                <div className="garden-gift-facts">
                  <div>
                    <small>{t('Accepted assets')}</small>
                    <b>{gift.acceptedAssets.map(labelFor).join(', ')}</b>
                  </div>
                </div>
                <p className="garden-gift-notice">{t('Payments use a public blockchain. Signing checkout reveals the destination wallet; the payment and gift link can be traced on-chain. This link never grants withdrawal access.')}</p>

                {!chain.configured ? (
                  <p className="garden-gift-notice">{t('This chain is not configured, so paying is disabled. Nothing is guessed.')}</p>
                ) : !wallet ? (
                  <div className="garden-gift-form">
                    {localWallet?.enabled && onConnectLocal ? (
                      <button data-testid="gift-page-local" className="garden-pill garden-pill--dark garden-pill--wide" onClick={() => void onConnectLocal()}>
                        {t('Use local demo gifter')}
                      </button>
                    ) : null}
                    <button data-testid="gift-page-connect" className="garden-pill garden-pill--wide" onClick={() => void onConnect()}>
                      {t('Connect wallet to pay')}
                    </button>
                    <TxnStatusLine txn={connectTxn ?? null} explorerUrl={chain.explorerUrl} />
                  </div>
                ) : (
                  <div className="garden-gift-form">
                    <label>
                      {t('Asset')}
                      <select data-testid="gift-page-token" value={form.token} onChange={(e) => setForm({ ...form, token: e.target.value })}>
                        {gift.acceptedAssets.map((asset) => (
                          <option key={asset} value={asset}>
                            {labelFor(asset)}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label>
                      {t('Amount')}
                      <input data-testid="gift-page-amount" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} />
                    </label>
                    {gift.publicKey ? <><label>
                      <span>
                        {tj('Your name {optional}', { optional: <span className="garden-muted">{t('(optional)')}</span> })}
                      </span>
                      <input
                        data-testid="gift-page-name"
                        value={form.name}
                        maxLength={NAME_MAX * 2}
                        autoComplete="given-name"
                        onChange={(e) => setForm({ ...form, name: e.target.value })}
                      />
                    </label>
                    <label>
                      <span>
                        {tj('A note {optional}', {
                          optional: (
                            <span className="garden-muted">
                              {t('(optional, {count}/{max})', { count: [...form.note.trim()].length, max: NOTE_MAX })}
                            </span>
                          ),
                        })}
                      </span>
                      <textarea
                        data-testid="gift-page-note"
                        value={form.note}
                        rows={3}
                        maxLength={NOTE_MAX * 2}
                        placeholder={t('Happy birthday!')}
                        onChange={(e) => setForm({ ...form, note: e.target.value })}
                      />
                    </label>
                    <p className="garden-muted gift-note-privacy">{t('Your message is encrypted in this browser for the family. It never appears on a public wall.')}</p></> : <p className="garden-muted gift-note-privacy">{t('Private messages are unavailable until this family enables encryption. You can still send a gift.')}</p>}
                    {noteProblem ? (
                      <p className="garden-gift-warning" role="alert" data-testid="gift-note-problem">
                        {noteProblem}
                      </p>
                    ) : null}
                    <button data-testid="gift-page-submit" className="garden-pill garden-pill--dark garden-pill--wide" onClick={() => void pay()}>
                      {t('Approve and pay')}
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
