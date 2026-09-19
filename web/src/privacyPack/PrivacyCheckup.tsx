import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import {
  ArrowUpRight,
  Check,
  CircleAlert,
  Eye,
  EyeOff,
  Globe,
  KeyRound,
  Lightbulb,
  Link2,
  RefreshCw,
  ScanEye,
  ShieldCheck,
  Trash2,
  Wrench,
  X,
} from 'lucide-react';
import type { Address } from 'viem';
import { formatUnits, sproutFactoryAbi } from '@sprout/shared';
import { api, authorizeFamily, type ChainPublic, type Holdings } from '../api';
import type { WalletState } from '../wallet';
import { encryptGift, decryptGift } from '../privacy/crypto';
import { flushPrivateLabels, getNickname, getPrivateLabel, hasPrivateVault, labelsUnlocked, setPrivateLabel } from '../localStore';
import { formatUtcDate } from '../dates';
import { t, tj, useLocale } from '../i18n';
import {
  errorMessage,
  localFamilyData,
  moveLabelsIntoVault,
  packApi,
  publicHoldings,
  publicPicture,
  type FamilyFootprint,
  type PublicPicture,
  type SproutFootprint,
  type WalletActivity,
} from './data';
import { setDiscreet, useDiscreet } from './discreet';
import { EraseFamilyData } from './EraseFamilyData';
import { useDialog } from './useDialog';
import '../privacy/privacy.css';
import './privacy-pack.css';

interface SproutView {
  footprint: SproutFootprint;
  holdings: Holdings | null;
  /** null: the public history could not be read, so nothing is claimed about it. */
  picture: PublicPicture | null;
}

interface Loaded {
  report: FamilyFootprint;
  sprouts: SproutView[];
  /** Sprouts the factory lists for this wallet, read through the wallet's own connection; null if that failed. */
  direct: number | null;
}

const short = (a: string) => (a.length > 12 ? `${a.slice(0, 6)}…${a.slice(-4)}` : a);
const SHOWN_WALLETS = 5;

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return Promise.race([promise, new Promise<T>((_, reject) => setTimeout(() => reject(new Error('timeout')), ms))]);
}

/** The factory's own list of sprouts this wallet planted, asked without Sprout's server. */
async function readFactoryDirectly(wallet: WalletState, chain: ChainPublic | null, sprouts: SproutFootprint[]): Promise<number | null> {
  const factories = [...new Set(sprouts.map((s) => (s.factory ?? chain?.contracts.factory ?? '').toLowerCase()).filter(Boolean))];
  if (!factories.length) return null;
  try {
    const lists = await withTimeout(
      Promise.all(
        factories.map(
          (factory) =>
            wallet.publicClient.readContract({
              address: factory as Address,
              abi: sproutFactoryAbi,
              functionName: 'sproutsOf',
              args: [wallet.address],
            }) as Promise<readonly string[]>,
        ),
      ),
      8000,
    );
    return lists.reduce((n, list) => n + list.length, 0);
  } catch {
    return null;
  }
}

type Tone = 'public' | 'private' | 'plain' | 'off';

function Status({ tone, children }: { tone: Tone; children: ReactNode }) {
  return <span className={`pp-chip pp-tone-${tone}`}>{children}</span>;
}

function Fact({ label, value, note, testId }: { label: string; value: ReactNode; note?: ReactNode; testId?: string }) {
  return (
    <div className="pp-fact" data-testid={testId}>
      <dt>{label}</dt>
      <dd>
        <span className="pp-fact-value">{value}</span>
        {note ? <small>{note}</small> : null}
      </dd>
    </div>
  );
}

interface Fix {
  id: string;
  title: string;
  why: string;
  action?: { label: string; run: () => void | Promise<void> };
  /** Why there is no one-tap action yet. */
  blocked?: string;
  done?: boolean;
}

export function PrivacyCheckup({
  wallet,
  chain,
  onClose,
  onConnect,
}: {
  wallet: WalletState | null;
  chain: ChainPublic | null;
  onClose: () => void;
  onConnect: () => void;
}) {
  useLocale();
  const discreet = useDiscreet();
  const ref = useRef<HTMLElement>(null);
  const [data, setData] = useState<Loaded | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  // The wallet is kept for the dialog: erasing ends the session, which signs the app out.
  const [eraseWallet, setEraseWallet] = useState<WalletState | null>(null);
  const eraseOpen = eraseWallet !== null;
  const [, refresh] = useState(0);
  const loadId = useRef(0);
  useDialog(ref, onClose, { fallback: '[data-testid="privacy-open"]' });
  // Layout effect: the page is live again before the delete dialog's cleanup returns focus to it.
  useLayoutEffect(() => {
    if (ref.current) ref.current.inert = eraseOpen;
  }, [eraseOpen]);

  useEffect(() => {
    const changed = () => refresh((v) => v + 1);
    window.addEventListener('sprout-privacy-change', changed);
    return () => window.removeEventListener('sprout-privacy-change', changed);
  }, []);

  const load = useCallback(async () => {
    const id = ++loadId.current;
    if (!wallet) {
      setData(null);
      return;
    }
    setLoading(true);
    setLoadError('');
    try {
      await authorizeFamily(wallet);
      const report = await packApi.report();
      const sprouts = await Promise.all(
        report.sprouts.map(async (footprint): Promise<SproutView> => {
          const [holdings, events] = await Promise.all([
            api.holdings(footprint.id).catch(() => null),
            api.events(footprint.id).then((r) => r.events).catch(() => null),
          ]);
          return { footprint, holdings, picture: events ? publicPicture(events, wallet.address) : null };
        }),
      );
      const direct = await readFactoryDirectly(wallet, chain, report.sprouts);
      if (id !== loadId.current) return;
      setData({ report, sprouts, direct });
    } catch (e) {
      if (id === loadId.current) setLoadError(errorMessage(e));
    } finally {
      if (id === loadId.current) setLoading(false);
    }
  }, [wallet, chain]);

  useEffect(() => {
    void load();
  }, [load]);
  // Signed out (for example after an erase): drop messages about the last family.
  useEffect(() => {
    if (!wallet) {
      setMessage('');
      setError('');
    }
  }, [wallet]);

  const run = async (id: string, task: () => Promise<string>) => {
    setBusy(id);
    setError('');
    setMessage('');
    try {
      setMessage(await task());
      await load();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(null);
    }
  };

  const openFamilyPrivacy = () => {
    onClose();
    window.dispatchEvent(new Event('sprout-open-privacy'));
  };

  // ---- formatting -------------------------------------------------------------
  const settlement = chain?.contracts.settlementToken?.toLowerCase();
  const tokenInfo = (address: string) => {
    const a = address.toLowerCase();
    if (a === settlement) return { symbol: chain?.contracts.settlementSymbol ?? t('Settlement'), decimals: chain?.contracts.settlementDecimals ?? 6 };
    const stock = chain?.contracts.stockTokens.find((s) => s.address.toLowerCase() === a);
    return { symbol: stock?.symbol ?? short(address), decimals: stock?.decimals ?? 18 };
  };
  const amountText = (amounts: Record<string, bigint>) =>
    Object.entries(amounts)
      .map(([token, raw]) => {
        const info = tokenInfo(token);
        return `${formatUnits(raw, info.decimals, 4)} ${info.symbol}`;
      })
      .join(' + ');
  const usd = (holdings: Holdings) => {
    try {
      return holdings.totalValueUsd === null ? null : `$${formatUnits(BigInt(holdings.totalValueUsd), holdings.feedDecimals, 2)}`;
    } catch {
      return null;
    }
  };
  const explorer = (address: string) => (chain?.explorerUrl ? `${chain.explorerUrl.replace(/\/$/, '')}/address/${address}` : null);
  const addressValue = (address: string) => {
    const href = explorer(address);
    return href ? (
      <a className="pp-address" href={href} target="_blank" rel="noreferrer noopener">
        {address} <ArrowUpRight size={13} aria-hidden />
      </a>
    ) : (
      <code className="pp-address">{address}</code>
    );
  };
  const walletList = (wallets: WalletActivity[]) => (
    <ul className="pp-wallets">
      {wallets.slice(0, SHOWN_WALLETS).map((w) => (
        <li key={w.address}>
          <code>{short(w.address)}</code>
          <span>
            {w.count === 1 ? t('1 time') : t('{n} times', { n: w.count })} · {amountText(w.amounts)}
          </span>
        </li>
      ))}
      {wallets.length > SHOWN_WALLETS ? <li className="pp-muted">{t('and {n} more', { n: wallets.length - SHOWN_WALLETS })}</li> : null}
    </ul>
  );

  // ---- derived facts ------------------------------------------------------------
  const report = data?.report ?? null;
  const vaults = report?.sprouts.map((s) => s.id) ?? [];
  let vaultOnDevice = false;
  try {
    vaultOnDevice = wallet ? hasPrivateVault() : false;
  } catch {
    vaultOnDevice = false;
  }
  const local = wallet && report ? localFamilyData(wallet.address, vaults) : null;
  const unlocked = labelsUnlocked();
  const sum = (pick: (s: SproutFootprint) => number) => (report?.sprouts ?? []).reduce((n, s) => n + pick(s), 0);
  const plainNotes = sum((s) => s.notes.plain);
  const totalNotes = sum((s) => s.notes.total);
  const hiddenNotes = sum((s) => s.notes.hidden);
  const workingLinks = sum((s) => s.invites.waiting + s.invites.openNow);
  const legacyLabels = sum((s) => s.gifts.plainLabels);
  const legacyTitles = sum((s) => s.gifts.plainCampaignTitles);
  const campaigns = sum((s) => s.gifts.campaigns);
  const giftKeyInVault = unlocked && !!getPrivateLabel('gift.publicKey') && !!getPrivateLabel('gift.privateKey');
  const movedText = (n: number) => (n === 1 ? t('1 label moved into your encrypted vault.') : t('{n} labels moved into your encrypted vault.', { n }));
  const needsKey = vaultOnDevice ? t('Unlock first') : t('Set up Family privacy first');
  const nameOf = (id: string, i: number) => (unlocked ? getNickname(id) : null) ?? t('Family sprout {n}', { n: i + 1 });

  // ---- fixes ----------------------------------------------------------------------
  const fixes: Fix[] = [];
  if (report && wallet) {
    if (!vaultOnDevice) {
      fixes.push({
        id: 'setup',
        title: t('Set up Family privacy on this device'),
        why: !local?.plainLabels.length
          ? t('Names, chore titles and gift labels you add are encrypted with your passphrase, and Sprout never receives them.')
          : local.plainLabels.length === 1
            ? t('Names, chore titles and gift labels you add are encrypted with your passphrase. Setting it up also encrypts the older label already on this device.')
            : t('Names, chore titles and gift labels you add are encrypted with your passphrase. Setting it up also encrypts the {n} older labels already on this device.', { n: local.plainLabels.length }),
        action: { label: t('Open Family privacy'), run: openFamilyPrivacy },
      });
    } else if (!unlocked && (local?.plainLabels.length || report.legacyText.length || plainNotes)) {
      fixes.push({
        id: 'unlock',
        title: t('Unlock Family privacy to finish these fixes'),
        why: t('Moving older labels and messages into encrypted storage needs your family key, which only unlocks on this device.'),
        action: { label: t('Open Family privacy'), run: openFamilyPrivacy },
      });
    }
    if (vaultOnDevice && local?.plainLabels.length) {
      fixes.push({
        id: 'local-labels',
        title: local.plainLabels.length === 1 ? t('Encrypt 1 older label on this device') : t('Encrypt {n} older labels on this device', { n: local.plainLabels.length }),
        why: t('They were saved before Family privacy and sit in this browser unencrypted. They move into your encrypted vault, then the plain copies are removed.'),
        action: unlocked
          ? { label: t('Encrypt now'), run: () => run('local-labels', async () => movedText(await moveLabelsIntoVault(wallet.address, vaults))) }
          : undefined,
        blocked: needsKey,
      });
    }
    if (report.legacyText.length) {
      fixes.push({
        id: 'server-labels',
        title:
          legacyLabels + legacyTitles === 1
            ? t('Move 1 older gift label off Sprout’s server')
            : t('Move {n} older gift labels off Sprout’s server', { n: legacyLabels + legacyTitles }),
        why: t('Older gift links stored their label or campaign title in plain text. They move into your encrypted vault, and Sprout’s server keeps only generic text instead. Copies made before now, such as backups, aren’t changed.'),
        action: unlocked
          ? {
              label: t('Move into my vault'),
              run: () =>
                run('server-labels', async () => {
                  for (const item of report.legacyText) {
                    if (item.label && getPrivateLabel(`gift.label.${item.giftId}`) === null) setPrivateLabel(`gift.label.${item.giftId}`, item.label);
                    if (item.title && getPrivateLabel(`gift.title.${item.giftId}`) === null) setPrivateLabel(`gift.title.${item.giftId}`, item.title);
                  }
                  // Only once the vault has saved them does the server copy go.
                  await flushPrivateLabels();
                  const done = await packApi.clearServerLabels(wallet, report.legacyText.map((x) => x.giftId));
                  return movedText(done.labels + done.titles);
                }),
            }
          : undefined,
        blocked: needsKey,
      });
    }
    if (plainNotes > 0) {
      fixes.push({
        id: 'notes',
        title: plainNotes === 1 ? t('Encrypt 1 older gift message') : t('Encrypt {n} older gift messages', { n: plainNotes }),
        why: t('They arrived before encrypted messages and are stored in plain text. Your browser encrypts each one to your family key and checks it opens before Sprout replaces it. Sprout’s server has already seen them, and copies made before now, such as backups, aren’t changed.'),
        action:
          unlocked && giftKeyInVault
            ? {
                label: t('Encrypt now'),
                run: () =>
                  run('notes', async () => {
                    const publicKey = getPrivateLabel('gift.publicKey');
                    const privateKey = getPrivateLabel('gift.privateKey');
                    if (!publicKey || !privateKey) throw new Error(t('Restore a backup with your gift key.'));
                    const { notes } = await packApi.plainNotes(wallet);
                    const sealed = [];
                    for (const n of notes) {
                      const message = { ...(n.name ? { name: n.name } : {}), ...(n.note ? { note: n.note } : {}) };
                      const encryptedNote = await encryptGift(publicKey, n.giftId, message);
                      // Never replace a readable message with one the family can't open.
                      const back = await decryptGift(privateKey, n.giftId, encryptedNote);
                      if ((back.name ?? null) !== (n.name || null) || (back.note ?? null) !== (n.note || null)) throw new Error(t('A message could not be encrypted safely. Nothing was changed.'));
                      sealed.push({ giftId: n.giftId, txHash: n.txHash, logIndex: n.logIndex, encryptedNote });
                    }
                    let encrypted = 0;
                    for (let i = 0; i < sealed.length; i += 100) encrypted += (await packApi.encryptNotes(wallet, sealed.slice(i, i + 100))).encrypted;
                    return encrypted === 1 ? t('1 gift message encrypted.') : t('{n} gift messages encrypted.', { n: encrypted });
                  }),
              }
            : undefined,
        blocked: unlocked ? t('Needs your gift key: restore your encrypted backup') : needsKey,
      });
    }
    if (workingLinks > 0) {
      fixes.push({
        id: 'kid-links',
        title: workingLinks === 1 ? t('Revoke 1 kid link that still works') : t('Revoke {n} kid links that still work', { n: workingLinks }),
        why: t('Whoever opens an unopened link first gets its access, and an opened one keeps working on that device for up to 24 hours. Revoking ends both. It can’t undo what was already seen.'),
        action: {
          label: t('Revoke now'),
          run: () =>
            run('kid-links', async () => {
              const { revoked } = await packApi.revokeAllKidLinks(wallet);
              return revoked === 1 ? t('1 kid link revoked.') : t('{n} kid links revoked.', { n: revoked });
            }),
        },
      });
    }
    if (!report.giftKeyRegistered && report.sprouts.length) {
      fixes.push({
        id: 'gift-key',
        title: t('Turn on encrypted gift messages'),
        why: t('Gifters can leave a message only once this is on. Each message is encrypted in the gifter’s browser to your family key.'),
        action: { label: t('Open Family privacy'), run: openFamilyPrivacy },
      });
    }
  }
  fixes.push({
    id: 'discreet',
    title: t('Hide amounts when you share your screen'),
    why: t('Discreet mode hides the amounts Sprout shows on this device until you turn it off. Shortcut: Alt+Shift+H.'),
    action: discreet ? undefined : { label: t('Turn on discreet mode'), run: () => setDiscreet(true) },
    done: discreet,
  });

  const advice: Array<{ title: string; text: string }> = [
    {
      title: t('Balances and transfers stay public'),
      text: t('Nothing in Sprout can hide what is on the blockchain. Deleting your family’s data doesn’t change it either.'),
    },
    {
      title: t('The graduation date is public'),
      text: t('It is written into the contract. If you chose a birthday, it can reveal their age.'),
    },
    {
      title: t('One wallet links your sprouts'),
      text: t('Every sprout planted from the same wallet can be listed together. A sprout planted from a different wallet wouldn’t share that link, but existing sprouts stay linked.'),
    },
    {
      title: t('Gifts and deposits show the sender’s wallet'),
      text: t('Suggest sending from a wallet that isn’t linked to anyone’s name. A fresh wallet only helps if it isn’t funded straight from one that is: that transfer is public too.'),
    },
    {
      title: t('Share kid links privately'),
      text: t('A kid link carries no name or wallet address, but whoever opens it first gets access. Screenshots and anything already seen can’t be revoked.'),
    },
  ];

  const fixable = fixes.filter((f) => f.action && !f.done).length;

  return (
    <div className="privacy-overlay pp-overlay">
      <main
        className="privacy-center pp-page"
        role="dialog"
        aria-modal="true"
        aria-labelledby="pp-title"
        tabIndex={-1}
        ref={ref}
        data-testid="privacy-checkup"
      >
        <header className="privacy-top">
          <a href="/" className="privacy-brand">
            <img src="/brand/sprout-logo.png" alt="" />
            sprout<span>{t('PRIVACY CHECKUP')}</span>
          </a>
          <button type="button" className="privacy-icon" aria-label={t('Close privacy checkup')} onClick={onClose} data-testid="checkup-close">
            <X size={22} />
          </button>
        </header>

        <section className="pp-hero">
          <div>
          <span className="privacy-kicker">
            <span /> {t('Your family’s footprint, checked live')}
          </span>
          <h1 id="pp-title">
            {t('What’s public.')}
            <br />
            <em>{t('What’s yours.')}</em>
          </h1>
          <p>
            {t('A look at the sprouts you planted: what anyone can read on the blockchain, what Sprout keeps, and what you can tighten. Read just now from the blockchain and from Sprout.')}
          </p>
          {report ? (
            <div className="privacy-pills" data-testid="checkup-summary">
              <span>
                <Globe size={15} aria-hidden /> {report.sprouts.length === 1 ? t('1 sprout checked') : t('{n} sprouts checked', { n: report.sprouts.length })}
              </span>
              <span className="privacy-public">
                <Wrench size={15} aria-hidden /> {fixable === 1 ? t('1 fix available') : t('{n} fixes available', { n: fixable })}
              </span>
              <button type="button" className="privacy-secondary pp-refresh" onClick={() => void load()} disabled={loading}>
                <RefreshCw size={14} aria-hidden /> {loading ? t('Checking…') : t('Check again')}
              </button>
            </div>
          ) : null}
          </div>
          <div className="privacy-art pp-art" aria-hidden="true">
            <div className="privacy-orbit orbit-one" />
            <div className="privacy-orbit orbit-two" />
            <img src="/art/dashboard/hero-bouquet.png" alt="" />
            <div className="privacy-seal">
              <ScanEye size={24} />
              <span>{t('CHECKED LIVE')}</span>
            </div>
          </div>
        </section>

        {!wallet ? (
          <div className="privacy-connect" data-testid="checkup-connect">
            <p>{t('Connect your parent wallet to check the sprouts you planted.')}</p>
            <button type="button" onClick={onConnect} className="privacy-button">
              {t('Connect family wallet')} <ArrowUpRight size={16} />
            </button>
          </div>
        ) : loadError ? (
          <div className="privacy-connect" role="alert">
            <p>{t('The checkup couldn’t be read just now: {error}', { error: loadError })}</p>
            <button type="button" onClick={() => void load()} className="privacy-button">
              {t('Try again')}
            </button>
          </div>
        ) : !report ? (
          <p className="pp-loading" role="status">
            {t('Reading your sprouts from the blockchain and from Sprout…')}
          </p>
        ) : null}

        {wallet && report ? (
          <>
            {/* 01 — public */}
            <section className="pp-section" aria-labelledby="pp-public-title" data-testid="checkup-public">
              <div className="privacy-card-top">
                <span className="privacy-number">{t('01 / WHAT ANYONE CAN SEE')}</span>
                <Globe size={22} aria-hidden />
              </div>
              <h2 id="pp-public-title">
                {t('On the blockchain.')} <em>{t('For good.')}</em>
              </h2>
              <p className="pp-section-lead">
                {t('Anyone who looks at the blockchain can read everything below. They won’t see names unless they can connect a wallet to you some other way.')}
              </p>
              <div className="pp-wallet-link" data-testid="checkup-wallet-link">
                <Link2 size={18} aria-hidden />
                <div>
                  <b>
                    {tj('Your wallet {wallet} is the parent of every sprout below.', { wallet: <code>{short(wallet.address)}</code> })}
                  </b>
                  <p>
                    {data?.direct !== null && data?.direct !== undefined
                      ? t('Anyone can ask the Sprout factory contract to list the sprouts a wallet planted. We just asked it through your wallet’s own connection, without Sprout’s server: it lists {n} for yours.', { n: data.direct })
                      : t('Anyone can ask the Sprout factory contract to list the sprouts a wallet planted.')}
                  </p>
                </div>
              </div>
              {report.sprouts.length === 0 ? (
                <p className="pp-muted" data-testid="checkup-no-sprouts">
                  {report.beneficiaryOf
                    ? t('This wallet hasn’t planted a sprout. It is the beneficiary of {n}; their parent’s checkup covers them.', { n: report.beneficiaryOf })
                    : t('This wallet hasn’t planted a sprout yet.')}
                </p>
              ) : (
                <div className="pp-sprouts">
                  {data!.sprouts.map((view, i) => {
                    const f = view.footprint;
                    const held = publicHoldings(view.holdings);
                    const value = view.holdings?.available ? usd(view.holdings) : null;
                    const p = view.picture;
                    return (
                      <article className="privacy-card pp-sprout" key={f.id} data-testid="checkup-sprout">
                        <h3>{nameOf(f.id, i)}</h3>
                        <dl className="pp-facts">
                          <Fact label={t('Sprout contract')} value={addressValue(f.id)} testId="checkup-contract" />
                          <Fact label={t('Beneficiary wallet')} value={addressValue(f.beneficiary)} note={t('Written into the contract. Only this wallet can ever take money out.')} testId="checkup-beneficiary" />
                          <Fact label={t('Graduation date')} value={formatUtcDate(f.graduationTimestamp)} note={t('If this is a birthday, it can reveal their age.')} />
                          <Fact
                            label={t('Balance')}
                            testId="checkup-balance"
                            value={value ?? t('Unavailable right now')}
                            note={
                              held.length
                                ? held.map((h) => `${formatUnits(BigInt(h.rawBalance), h.decimals, 4)} ${h.kind === 'settlement' ? tokenInfo(h.address).symbol : h.symbol}`).join(' · ')
                                : view.holdings?.available
                                  ? t('Nothing held yet.')
                                  : t('Anyone can read each token balance, even when Sprout can’t price it.')
                            }
                          />
                          {p ? (
                            <>
                              <Fact
                                label={t('Gifts')}
                                testId="checkup-gifts"
                                value={
                                  p.gifts.count === 0
                                    ? t('No gifts yet')
                                    : t('{gifts} from {wallets}', {
                                        gifts: p.gifts.count === 1 ? t('1 gift') : t('{n} gifts', { n: p.gifts.count }),
                                        wallets: p.gifts.wallets.length === 1 ? t('1 wallet') : t('{n} wallets', { n: p.gifts.wallets.length }),
                                      })
                                }
                                note={p.gifts.count ? walletList(p.gifts.wallets) : undefined}
                              />
                              <Fact
                                label={t('Deposits')}
                                testId="checkup-deposits"
                                value={
                                  p.deposits.fromParent === 0 && p.deposits.fromOthers.length === 0
                                    ? t('No deposits yet')
                                    : t('{mine} from your wallet · {others} from other wallets', {
                                        mine: p.deposits.fromParent,
                                        others: p.deposits.fromOthers.reduce((n, w) => n + w.count, 0),
                                      })
                                }
                                note={p.deposits.fromOthers.length ? walletList(p.deposits.fromOthers) : undefined}
                              />
                              <Fact
                                label={t('Other activity')}
                                value={[
                                  p.purchases === 1 ? t('1 purchase') : t('{n} purchases', { n: p.purchases }),
                                  p.choreRewards === 1 ? t('1 chore reward') : t('{n} chore rewards', { n: p.choreRewards }),
                                  p.claims === 1 ? t('1 allowance claim') : t('{n} allowance claims', { n: p.claims }),
                                  p.withdrawals.count === 1 ? t('1 withdrawal') : t('{n} withdrawals', { n: p.withdrawals.count }),
                                ].join(' · ')}
                                note={t('Each one is a public transaction with its amount.')}
                              />
                            </>
                          ) : (
                            <Fact label={t('Gifts and deposits')} value={t('This sprout’s public history couldn’t be read just now.')} />
                          )}
                        </dl>
                      </article>
                    );
                  })}
                </div>
              )}
              <p className="pp-caveat" data-testid="checkup-public-caveat">
                <CircleAlert size={16} aria-hidden />
                {t('This stays public. Nothing in Sprout can hide or delete it: not this checkup, not discreet mode, and not deleting your family’s data.')}
              </p>
            </section>

            {/* 02 — private */}
            <section className="pp-section" aria-labelledby="pp-private-title" data-testid="checkup-private">
              <div className="privacy-card-top">
                <span className="privacy-number">{t('02 / WHAT SPROUT KEEPS PRIVATE')}</span>
                <KeyRound size={22} aria-hidden />
              </div>
              <h2 id="pp-private-title">
                {t('Your family’s details.')} <em>{t('Where they live.')}</em>
              </h2>
              <div className="privacy-card pp-private-list">
                <div className="pp-private-row" data-testid="private-names">
                  <div>
                    <b>{t('Names, chore titles and favourites')}</b>
                    <small>
                      {!local?.plainLabels.length
                        ? t('Kept only on this device. Sprout’s server never receives them.')
                        : local.plainLabels.length === 1
                          ? t('1 older label on this device is not encrypted.')
                          : t('{n} older labels on this device are not encrypted.', { n: local.plainLabels.length })}
                    </small>
                  </div>
                  {vaultOnDevice ? (
                    <Status tone="private">{unlocked ? t('Encrypted · unlocked') : t('Encrypted · locked')}</Status>
                  ) : (
                    <Status tone="off">{t('Not set up on this device')}</Status>
                  )}
                </div>
                <div className="pp-private-row" data-testid="private-gift-labels">
                  <div>
                    <b>{t('Gift link labels and campaign titles')}</b>
                    <small>
                      {legacyLabels + legacyTitles === 0
                        ? t('Sprout’s server stores only generic text; yours stay encrypted on this device.')
                        : legacyLabels + legacyTitles === 1
                          ? t('1 from an older link is stored in plain text on Sprout’s server.')
                          : t('{n} from older links are stored in plain text on Sprout’s server.', { n: legacyLabels + legacyTitles })}
                    </small>
                  </div>
                  {legacyLabels + legacyTitles ? <Status tone="plain">{t('Plain text')}</Status> : <Status tone="private">{t('Generic on the server')}</Status>}
                </div>
                {campaigns ? (
                  <div className="pp-private-row">
                    <div>
                      <b>{t('Campaign goals and end dates')}</b>
                      <small>{t('Sprout uses them to show each campaign’s progress in your dashboard.')}</small>
                    </div>
                    <Status tone="plain">{t('Plain text')}</Status>
                  </div>
                ) : null}
                <div className="pp-private-row" data-testid="private-notes">
                  <div>
                    <b>{t('Gift messages')}</b>
                    <small>
                      {totalNotes === 0
                        ? t('No messages yet.')
                        : t('{encrypted} encrypted · {plain} in plain text · {hidden} hidden by you', {
                            encrypted: totalNotes - plainNotes,
                            plain: plainNotes,
                            hidden: hiddenNotes,
                          })}
                    </small>
                  </div>
                  {plainNotes ? (
                    <Status tone="plain">{t('{n} in plain text', { n: plainNotes })}</Status>
                  ) : totalNotes ? (
                    <Status tone="private">{t('Encrypted')}</Status>
                  ) : (
                    <Status tone="off">{t('None')}</Status>
                  )}
                </div>
                <div className="pp-private-row" data-testid="private-gift-key">
                  <div>
                    <b>{t('Encrypted gift messages')}</b>
                    <small>
                      {report.giftKeyRegistered
                        ? t('New messages are encrypted in the gifter’s browser to your family key.')
                        : t('Off, so gifters can’t leave a message yet.')}
                    </small>
                  </div>
                  {report.giftKeyRegistered ? <Status tone="private">{t('On')}</Status> : <Status tone="off">{t('Off')}</Status>}
                </div>
                <div className="pp-private-row" data-testid="private-kid-links">
                  <div>
                    <b>{t('Kid links')}</b>
                    <small>
                      {t('{waiting} waiting to be opened · {open} open on a device · {balance} can see the balance', {
                        waiting: sum((s) => s.invites.waiting),
                        open: sum((s) => s.invites.openNow),
                        balance: sum((s) => s.invites.balanceVisible),
                      })}
                    </small>
                  </div>
                  {workingLinks ? <Status tone="public">{t('{n} working', { n: workingLinks })}</Status> : <Status tone="private">{t('None working')}</Status>}
                </div>
                <div className="pp-private-row">
                  <div>
                    <b>{t('Milestone proofs')}</b>
                    <small>{t('Sprout keeps each certificate, not the balance behind it, to answer status checks.')}</small>
                  </div>
                  <Status tone={sum((s) => s.proofs.active) ? 'public' : 'off'}>{t('{n} active', { n: sum((s) => s.proofs.active) })}</Status>
                </div>
                <div className="pp-private-row">
                  <div>
                    <b>{t('Family sign-in')}</b>
                    <small>{t('Sessions end after 30 minutes. Sprout stores only a hash of each session token.')}</small>
                  </div>
                  <Status tone="private">{t('Hashed')}</Status>
                </div>
                <div className="pp-private-row">
                  <div>
                    <b>{t('Sprout’s copy of public data')}</b>
                    <small>
                      {t('Copies of blockchain data Sprout needs to run: on-chain events ({events}), value snapshots ({snapshots}) and your weekly plan.', {
                        events: report.kept.events,
                        snapshots: report.kept.snapshots,
                      })}
                    </small>
                  </div>
                  <Status tone="public">{t('Public anyway')}</Status>
                </div>
              </div>
            </section>

            {/* 03 — fixes */}
            <section className="pp-section" aria-labelledby="pp-fixes-title" data-testid="checkup-fixes">
              <div className="privacy-card-top">
                <span className="privacy-number">{t('03 / FIXES')}</span>
                <Wrench size={22} aria-hidden />
              </div>
              <h2 id="pp-fixes-title">
                {t('Small steps.')} <em>{t('Real difference.')}</em>
              </h2>
              <div className="pp-fixes">
                {fixes.map((fix) => (
                  <div className={`privacy-card pp-fix${fix.done ? ' is-done' : ''}`} key={fix.id} data-testid={`fix-${fix.id}`}>
                    <div>
                      <b>
                        {fix.done ? <Check size={16} aria-hidden /> : null} {fix.title}
                      </b>
                      <p>{fix.why}</p>
                    </div>
                    {fix.action ? (
                      <button
                        type="button"
                        className="privacy-button"
                        disabled={busy !== null}
                        onClick={() => void fix.action!.run()}
                        data-testid={`fix-${fix.id}-action`}
                      >
                        {busy === fix.id ? t('Working…') : fix.action.label}
                      </button>
                    ) : fix.done ? (
                      <Status tone="private">{t('Done')}</Status>
                    ) : (
                      <Status tone="off">{fix.blocked ?? needsKey}</Status>
                    )}
                  </div>
                ))}
              </div>
              <h3 className="pp-advice-title">
                <Lightbulb size={17} aria-hidden /> {t('Good to know')}
              </h3>
              <ul className="pp-advice">
                {advice.map((a) => (
                  <li key={a.title}>
                    <b>{a.title}</b>
                    <span>{a.text}</span>
                  </li>
                ))}
              </ul>
            </section>

            {/* 04 — delete */}
            <section className="pp-section pp-danger-zone" aria-labelledby="pp-delete-title" data-testid="checkup-delete">
              <div className="privacy-card-top">
                <span className="privacy-number">{t('04 / DELETE')}</span>
                <Trash2 size={22} aria-hidden />
              </div>
              <h2 id="pp-delete-title">{t('Delete my family’s data')}</h2>
              <p className="pp-section-lead">
                {t('Permanently erase what Sprout stores off the blockchain for your sprouts: gift links, campaigns, gift messages, kid links, milestone proofs and your sign-ins, plus this browser’s family data. What is on the blockchain stays, and so does your sprouts’ money.')}
              </p>
              <button type="button" className="privacy-button pp-danger" onClick={() => setEraseWallet(wallet)} data-testid="erase-open">
                <Trash2 size={15} aria-hidden /> {t('Review and delete…')}
              </button>
            </section>
          </>
        ) : null}

        {error ? (
          <p className="privacy-error" role="alert" data-testid="checkup-error">
            {error}
          </p>
        ) : null}
        {message ? (
          <p className="privacy-feedback" role="status" data-testid="checkup-message">
            {message}
          </p>
        ) : null}
        <footer className="privacy-footer pp-footer">
          <span>
            <ShieldCheck size={17} aria-hidden /> {t('A quieter footprint. A growing future.')}
          </span>
          <button type="button" className="privacy-secondary" onClick={() => setDiscreet(!discreet)} data-testid="checkup-discreet">
            {discreet ? <Eye size={15} aria-hidden /> : <EyeOff size={15} aria-hidden />}
            {discreet ? t('Show amounts') : t('Hide amounts')}
          </button>
        </footer>
      </main>
      {eraseWallet ? (
        <EraseFamilyData
          wallet={eraseWallet}
          onClose={() => setEraseWallet(null)}
          onDone={() => {
            setEraseWallet(null);
            onClose();
          }}
        />
      ) : null}
    </div>
  );
}
