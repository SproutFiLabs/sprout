import { ProofStudio } from './ProofStudio';
import { useEffect, useRef, useState } from 'react';
import {
  ShieldCheck,
  LockKeyhole,
  KeyRound,
  ArrowUpRight,
  X,
  Check,
  Copy,
  EyeOff,
  Sprout,
  Link2,
  Gift,
  ArrowRight,
  Download,
} from 'lucide-react';
import { api, authorizeFamily, lockFamilySession, type KidInvitation, type Sprout as FamilySprout } from '../api';
import type { WalletState } from '../wallet';
import {
  encryptedBackup,
  getPrivateLabel,
  hasPrivateVault,
  initializeLabels,
  labelsUnlocked,
  lockLabels,
  privateStoreError,
  unlockLabels,
} from '../localStore';
import { t, tj } from '../i18n';
import './privacy.css';
import './family-safety-fixes.css';
import { CheckupLaunch } from '../privacyPack/DiscreetControls';

export function PrivacyCenter({
  wallet,
  sprouts,
  onClose,
  onConnect,
  onLocked,
}: {
  wallet: WalletState | null;
  sprouts: FamilySprout[];
  onClose: () => void;
  onConnect: () => void;
  onLocked: () => void;
}) {
  const [version, update] = useState(0);
  // Remember the opener while rendering, before the page behind the dialog goes
  // inert; read in the effect instead, React's development double mount would
  // record the dialog itself and focus would fall to the page on close.
  const opener = useRef(typeof document === 'undefined' ? null : (document.activeElement as HTMLElement | null));
  const [passphrase, setPassphrase] = useState('');
  const [recoveryMode, setRecoveryMode] = useState(false);
  const [recovery, setRecovery] = useState('');
  const [restore, setRestore] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [vault, setVault] = useState(sprouts[0]?.id ?? '');
  const [invites, setInvites] = useState<KidInvitation[]>([]);
  const [link, setLink] = useState('');
  const [amounts, setAmounts] = useState(false);
  const [giftReady, setGiftReady] = useState(false);
  useEffect(() => {
    if (!sprouts.some((s) => s.id === vault)) setVault(sprouts[0]?.id ?? '');
  }, [sprouts, vault]);
  useEffect(() => {
    const change = () => update((v) => v + 1);
    window.addEventListener('sprout-privacy-change', change);
    return () => window.removeEventListener('sprout-privacy-change', change);
  }, []);
  useEffect(() => {
    const dialog = document.querySelector<HTMLElement>('.privacy-center');
    dialog?.focus();
    const keydown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      if (e.key === 'Tab' && dialog) {
        const items = [
          ...dialog.querySelectorAll<HTMLElement>('button:not(:disabled),input,select,textarea,a[href]'),
        ].filter((el) => el.offsetParent !== null);
        const first = items[0],
          last = items.at(-1);
        if (e.shiftKey && (document.activeElement === first || document.activeElement === dialog)) {
          e.preventDefault();
          last?.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first?.focus();
        }
      }
    };
    window.addEventListener('keydown', keydown);
    return () => {
      window.removeEventListener('keydown', keydown);
      opener.current?.focus();
    };
  }, [onClose]);
  const refresh = async () => {
    if (wallet && vault) {
      await authorizeFamily(wallet);
      setInvites((await api.kidInvites(vault)).invites);
    }
  };
  useEffect(() => {
    let live = true;
    if (wallet && vault)
      void api
        .kidInvites(vault)
        .then((r) => {
          if (live) setInvites(r.invites);
        })
        .catch(() => {});
    return () => {
      live = false;
    };
  }, [wallet, vault]);
  const run = async (task: () => Promise<void>) => {
    setBusy(true);
    setError('');
    setMessage('');
    try {
      await task();
      update((v) => v + 1);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Please try again.');
    } finally {
      setBusy(false);
    }
  };
  const saveBackup = async () => {
    const blob = new Blob([await encryptedBackup()], {
      type: 'application/json',
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'sprout-encrypted-family-backup.json';
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    setMessage('Encrypted backup downloaded. Store your recovery key separately.');
  };
  const unlocked = labelsUnlocked();
  useEffect(() => {
    if (!unlocked) {
      setRecovery('');
      setGiftReady(false);
    }
  }, [unlocked]);
  let exists = false;
  try {
    exists = hasPrivateVault();
  } catch {
    /* show storage error on write */
  }
  return (
    <div className="privacy-overlay">
      <main
        className="privacy-center"
        role="dialog"
        aria-modal="true"
        aria-labelledby="privacy-title"
        tabIndex={-1}
        data-testid="privacy-center"
        data-version={version}
      >
        <header className="privacy-top">
          <a href="/" className="privacy-brand">
            <img src="/brand/sprout-logo.png" alt="" />
            sprout<span>{t('FAMILY PRIVACY')}</span>
          </a>
          <button className="privacy-icon" aria-label={t('Close family privacy')} onClick={onClose}>
            <X size={22} />
          </button>
        </header>
        <a className="privacy-pill" href="/guardian" style={{display:"inline-flex",margin:"20px 0"}}>{t('Guardian wallets · recovery, passkeys & transfer limits ↗')}</a>
        <CheckupLaunch onOpen={onClose} />
        <section className="privacy-hero">
          <div>
            <span className="privacy-kicker">
              <span /> {t('A smaller digital footprint')}
            </span>
            <h1 id="privacy-title">
              {t('Let their future grow.')}
              <br />
              <em>{t('Keep their world small.')}</em>
            </h1>
            <p>
              {t('Less identity out in the open.')}
              <br />
              {t('More control in your family’s hands.')}
            </p>
            <div className="privacy-pills">
              <span>
                <ShieldCheck size={15} /> {t('Family access protected')}
              </span>
              <span className="privacy-public">
                <EyeOff size={15} /> {t('Blockchain still public')}
              </span>
            </div>
          </div>
          <div className="privacy-art" aria-hidden="true">
            <div className="privacy-orbit orbit-one" />
            <div className="privacy-orbit orbit-two" />
            <img src="/art/dashboard/hero-bouquet.png" alt="" />
            <div className="privacy-seal">
              <LockKeyhole size={24} />
              <span>{tj('FAMILY{br}FIRST', { br: <br /> })}</span>
            </div>
          </div>
        </section>
        {!wallet ? (
          <div className="privacy-connect">
            <p>{t('Connect your parent wallet to manage encryption and kid invitations.')}</p>
            <button onClick={onConnect} className="privacy-button">
              {t('Connect family wallet')} <ArrowUpRight size={16} />
            </button>
          </div>
        ) : null}
        <div className="privacy-grid">
          <ProofStudio key={`${wallet?.address ?? "none"}:${vault}`} wallet={wallet} vault={vault} sprouts={sprouts} onVaultChange={value => { setVault(value as typeof vault); setLink(''); }} />
          <section className="privacy-card" data-testid="privacy-labels">
            <div className="privacy-card-top">
              <span className="privacy-number">{t('01 / PRIVATE LABELS')}</span>
              <KeyRound size={22} />
            </div>
            <h2>
              {t('Their name.')}
              <br />
              {t('Your secret.')}
            </h2>
            <p>
              {t('Names, chore titles and gift labels are encrypted on this device. Unlock them with your passphrase. Sprout never receives that key.')}
            </p>
            <span className={`privacy-status ${unlocked ? 'is-on' : ''}`}>
              <span />
              {unlocked ? t('Encrypted vault unlocked') : exists ? t('Encrypted vault locked') : t('Set up encrypted storage')}
            </span>
            {!unlocked ? (
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  void run(async () => {
                    if (!wallet) throw new Error('Connect your wallet first.');
                    if (exists || restore) {
                      await unlockLabels(passphrase, recoveryMode, restore || undefined);
                      setMessage('Your private labels are unlocked.');
                    } else {
                      setRecovery(
                        await initializeLabels(
                          passphrase,
                          sprouts.map((s) => s.id),
                        ),
                      );
                      setMessage('Encrypted storage created. Save your recovery key and backup.');
                    }
                    setPassphrase('');
                    setRestore('');
                  });
                }}
              >
                <label className="privacy-field">
                  {recoveryMode ? t('Recovery key') : exists ? t('Your passphrase') : t('Create a passphrase (12+ characters)')}
                  <input
                    autoComplete="off"
                    type="password"
                    value={passphrase}
                    onChange={(e) => setPassphrase(e.target.value)}
                    disabled={!wallet || busy}
                    data-testid="privacy-passphrase"
                  />
                </label>
                <button className="privacy-button" disabled={!wallet || busy || !passphrase}>
                  {busy ? t('Working…') : exists || restore ? t('Unlock private labels') : t('Encrypt my family labels')}
                  <ArrowRight size={16} />
                </button>
                <label className="privacy-check">
                  <input type="checkbox" checked={recoveryMode} onChange={(e) => setRecoveryMode(e.target.checked)} />
                  {t('Use a recovery key')}
                </label>
                {!exists ? (
                  <label className="privacy-import">
                    {t('Restore an encrypted backup')}
                    <input
                      type="file"
                      accept="application/json,.json"
                      onChange={(e) => {
                        const file = e.target.files?.[0];
                        if (file && file.size < 2_000_000) void file.text().then(setRestore);
                      }}
                    />
                  </label>
                ) : null}
              </form>
            ) : (
              <div className="privacy-actions">
                <button className="privacy-button" onClick={() => void run(saveBackup)}>
                  <Download size={16} />
                  {t('Download encrypted backup')}
                </button>
                <button
                  className="privacy-secondary"
                  onClick={() => {
                    lockLabels();
                    setRecovery('');
                  }}
                >
                  {t('Lock labels')} <LockKeyhole size={14} />
                </button>
              </div>
            )}
            {recovery ? (
              <div className="privacy-recovery">
                <strong>{t('Your recovery key — save it somewhere private')}</strong>
                <code>{recovery}</code>
                <p>{t('Keep this key separate from your encrypted backup. Sprout cannot reset it.')}</p>
                <button className="privacy-secondary" onClick={() => setRecovery('')}>
                  {t('I saved my key')} <Check size={14} />
                </button>
              </div>
            ) : null}
            <small>
              {t('Keep an encrypted backup and save your recovery key separately. Together, they let you restore your family labels.')}
            </small>
          </section>
          <section className="privacy-card" data-testid="privacy-invites">
            <div className="privacy-card-top">
              <span className="privacy-number">{t('02 / KID ACCESS')}</span>
              <Link2 size={22} />
            </div>
            <h2>
              {t('A little window.')}
              <br />
              {t('No keys to the vault.')}
            </h2>
            <p>
              {t('One invitation. Their own little window. No name or wallet address in the link, and you decide when it closes.')}
            </p>
            <label className="privacy-field">
              {t('Choose a sprout')}
              <select
                value={vault}
                onChange={(e) => {
                  setVault(e.target.value as typeof vault);
                  setLink('');
                }}
                disabled={!wallet || busy}
              >
                {!sprouts.length ? (
                  <option>{t('No parent sprouts yet')}</option>
                ) : (
                  sprouts.map((s, i) => (
                    <option key={s.id} value={s.id}>
                      {t('Family sprout {n}', { n: i + 1 })}
                    </option>
                  ))
                )}
              </select>
            </label>
            <label className="privacy-check">
              <input type="checkbox" checked={amounts} onChange={(e) => setAmounts(e.target.checked)} />
              {t('Allow this device to see the total balance')}
            </label>
            <p className="privacy-caption">
              {t('Amounts hidden by default. Invitation expires in 7 days; device access lasts up to 24 hours after opening.')}
            </p>
            <button
              className="privacy-button"
              disabled={!wallet || !vault || busy}
              onClick={() =>
                void run(async () => {
                  const invite = await api.createKidInvite(wallet!, vault, amounts);
                  setLink(`${location.origin}/kid/${invite.id}#${invite.token}`);
                  await refresh();
                })
              }
            >
              {t('Create kid invitation')} <ArrowUpRight size={16} />
            </button>
            {link ? (
              <div className="privacy-link">
                <p>{t('Share privately with the child’s device. Whoever opens it first gets access.')}</p>
                <button
                  className="privacy-secondary"
                  onClick={() =>
                    void run(async () => {
                      await navigator.clipboard.writeText(link);
                      setMessage('Invitation copied. Share it privately.');
                    })
                  }
                >
                  <Copy size={15} />
                  {t('Copy private invitation')}
                </button>
              </div>
            ) : null}
            <div className="privacy-invites">
              {invites
                .filter((i) => !i.revoked && i.expiresAt > Date.now())
                .map((i, n) => (
                  <div className="privacy-invite" key={i.id}>
                    <div>
                      <b>{t('Kid access {n}', { n: n + 1 })}</b>
                      <span>
                        {i.redeemed ? t('Opened on a device') : t('Waiting to be opened')} ·{' '}
                        {i.showBalance ? t('Balance visible') : t('Amounts hidden')}
                      </span>
                    </div>
                    <button
                      disabled={busy}
                      onClick={() =>
                        void run(async () => {
                          await api.revokeKidInvite(wallet!, i.id);
                          setLink('');
                          await refresh();
                          setMessage('Access revoked, including any open kid session.');
                        })
                      }
                    >
                      {t('Revoke')}
                    </button>
                  </div>
                ))}
            </div>
          </section>
          <section className="privacy-card privacy-wide">
            <div className="privacy-card-top">
              <span className="privacy-number">{t('03 / THOUGHTFUL GIFTING')}</span>
              <Gift size={22} />
            </div>
            <div className="privacy-wide-content">
              <div>
                <h2>
                  {t('Share the love.')}
                  <br />
                  <em>{t('Leave the name out.')}</em>
                </h2>
                <p>
                  {t('Gift previews use a generic title. Private messages are encrypted in the sender’s browser and opened with your family key. No public message wall.')}
                </p>
              </div>
              <div className="privacy-gift-preview">
                <div className="privacy-gift-icon">
                  <Sprout size={30} />
                </div>
                <span>{t('SPROUT · GIFT INVITATION')}</span>
                <h3>{t('A gift for the future')}</h3>
                <p>{t('A little today. A world of possibilities.')}</p>
                <span className="privacy-status is-on">
                  <LockKeyhole size={12} />
                  {t('Their name stays with family')}
                </span>
              </div>
            </div>
            <button
              className="privacy-secondary"
              disabled={!wallet || !unlocked || busy}
              onClick={() =>
                void run(async () => {
                  const publicKey = getPrivateLabel('gift.publicKey');
                  if (!publicKey) throw new Error('Restore a backup with your gift key.');
                  await api.registerGiftKey(wallet!, publicKey);
                  setGiftReady(true);
                  setMessage('Encrypted gift messages enabled. Download an updated backup.');
                })
              }
            >
              {giftReady ? t('Encrypted gifting enabled') : t('Enable encrypted gift messages')}
              <ArrowRight size={15} />
            </button>
            <small>
              {t('The gift link and its payments can still be correlated on-chain. Existing plaintext messages are now family-only; they have not been retroactively encrypted.')}
            </small>
          </section>
        </div>
        <section className="privacy-boundary">
          <div>
            <span className="privacy-number">{t('YOUR PRIVACY, EXPLAINED')}</span>
            <h2>
              {t('Private family details.')}
              <br />
              {t('Public blockchain activity.')}
            </h2>
            <p>
              {t('Names and messages can stay out of public view in Sprout. Wallet relationships, balances and transfers remain visible on the blockchain. These controls reduce identity exposure; they do not hide on-chain wealth or guarantee physical safety.')}
            </p>
          </div>
          <div className="privacy-readiness">
            <span>
              <Check size={16} /> {t('Authenticated family views')}
            </span>
            <span>
              <Check size={16} /> {t('Revocable kid invitations')}
            </span>
            <span>
              <Check size={16} /> {t('Encrypted family labels')}
            </span>
          </div>
        </section>
        {error || privateStoreError() ? (
          <p className="privacy-error" role="alert">
            {t(error || privateStoreError())}
          </p>
        ) : null}
        {message ? (
          <p className="privacy-feedback" role="status">
            {t(message)}
          </p>
        ) : null}
        <footer className="privacy-footer">
          <span>
            <ShieldCheck size={17} /> {t('A quieter footprint. A growing future.')}
          </span>
          <button
            className="privacy-secondary"
            disabled={!wallet || busy}
            onClick={() =>
              void run(async () => {
                await lockFamilySession();
                onLocked();
              })
            }
          >
            {t('Lock family sessions')} <LockKeyhole size={15} />
          </button>
        </footer>
      </main>
    </div>
  );
}
