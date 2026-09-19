import { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, Check, Loader2, Lock, Wallet } from 'lucide-react';
import { erc20Abi, type Address } from 'viem';
import { rootMultiplier, sproutRootLockAbi } from '@sprout/shared';
import { dateLocale, t, tj } from '../i18n';
import { contractWriter, ensureChain, waitForSuccess, type WalletState } from '../wallet';
import { holdPeriod, tierLabel, type HolderStatus, type PerksInfo, type RootInfo, type RootLock } from './holder';
import { multiplierLabel, parseSprout, previewRoot, rootDurations, wholeSprout, type RootDays } from './root';
import { RootedCounter } from './RootBits';
import './root.css';

/**
 * "Root your SPROUT" on /perks: the two ways to reach a tier, the optional lock
 * from the visitor's own wallet (approve, then lock), their locks with a
 * withdraw button once due, and the public rooted counter. Rendered only when
 * the server has a lock contract configured.
 */

const dateText = (unix: number) => new Date(unix * 1000).toLocaleDateString(dateLocale(), { year: 'numeric', month: 'long', day: 'numeric' });

/** A wallet's plain-language reason a transaction did not go through. */
function txProblem(e: unknown): string {
  const err = e as { code?: number; name?: string; shortMessage?: string; message?: string; cause?: { code?: number } };
  if (err?.code === 4001 || err?.cause?.code === 4001 || err?.name === 'UserRejectedRequestError' || /user (rejected|denied)/i.test(err?.message ?? '')) {
    return t('You cancelled it in your wallet. Nothing was locked or moved.');
  }
  return t('That didn’t go through: {reason}', { reason: err?.shortMessage ?? err?.message ?? String(e) });
}

/** The public /api/perks root block, re-read after this page's own lock or withdrawal. */
function useRootInfo(initial: RootInfo | undefined, after: number): RootInfo | undefined {
  const [info, setInfo] = useState(initial);
  useEffect(() => setInfo(initial), [initial]);
  useEffect(() => {
    if (!after) return;
    let live = true;
    void fetch(`/api/perks?after=${after}`)
      .then((r) => (r.ok ? (r.json() as Promise<PerksInfo>) : null))
      .then((p) => live && p?.root && setInfo(p.root))
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [after]);
  return info;
}

type Step = 'idle' | 'approve-sign' | 'approve-wait' | 'lock-sign' | 'lock-wait' | 'done' | 'error';

export function RootPanel({
  perks,
  status,
  address,
  wallet,
  onConnect,
  after,
  onChanged,
}: {
  perks: PerksInfo;
  status: HolderStatus | null;
  address: string | null;
  wallet: WalletState | null;
  onConnect: () => void;
  /** The last block this page's own transaction confirmed in (0: none yet). */
  after: number;
  onChanged: (block: number) => void;
}) {
  const root = useRootInfo(perks.root, after);
  const durations = root ? rootDurations(root) : [];
  const [amountText, setAmountText] = useState('');
  const [days, setDays] = useState<RootDays>(90);
  const [understood, setUnderstood] = useState(false);
  const [step, setStep] = useState<Step>('idle');
  const [problem, setProblem] = useState<string | null>(null);
  const [withdrawing, setWithdrawing] = useState<string | null>(null);
  const [withdrawProblem, setWithdrawProblem] = useState<string | null>(null);

  const decimals = status?.decimals ?? root?.decimals ?? 18;
  const amount = parseSprout(amountText, decimals);
  const balance = BigInt(status?.balance ?? '0');
  const tooMuch = amount !== null && amount > balance;
  const preview = useMemo(() => (status && amount && !tooMuch ? previewRoot(status, amount, days, perks.tiers) : null), [status, amount, tooMuch, days, perks.tiers]);
  const chainNow = status?.chainTime ?? Math.floor(Date.now() / 1000);
  const busy = step === 'approve-sign' || step === 'approve-wait' || step === 'lock-sign' || step === 'lock-wait';
  const locks = status?.locks ?? [];

  if (!root) return null;
  const token = perks.token as Address;
  const lockAddress = root.contract as Address;

  async function lockNow() {
    if (!wallet || !amount || !understood || tooMuch) return;
    setProblem(null);
    try {
      await ensureChain(wallet, { chainId: wallet.expectedChainId, name: wallet.chainName, rpcUrl: wallet.chain.rpcUrls.default.http[0] });
      const write = contractWriter(wallet);
      const [held, allowance] = await Promise.all([
        wallet.publicClient.readContract({ address: token, abi: erc20Abi, functionName: 'balanceOf', args: [wallet.address] }),
        wallet.publicClient.readContract({ address: token, abi: erc20Abi, functionName: 'allowance', args: [wallet.address, lockAddress] }),
      ]);
      if (held < amount) throw new Error(t('This wallet holds {amount} SPROUT.', { amount: wholeSprout(held, decimals) }));
      if (allowance < amount) {
        setStep('approve-sign');
        const hash = await write({ address: token, abi: erc20Abi, functionName: 'approve', args: [lockAddress, amount] });
        setStep('approve-wait');
        await waitForSuccess(wallet.publicClient, hash);
      }
      setStep('lock-sign');
      const hash = await write({ address: lockAddress, abi: sproutRootLockAbi, functionName: 'lock', args: [amount, BigInt(days)] });
      setStep('lock-wait');
      const block = await waitForSuccess(wallet.publicClient, hash);
      setStep('done');
      setAmountText('');
      setUnderstood(false);
      onChanged(block);
    } catch (e) {
      setStep('error');
      setProblem(txProblem(e));
    }
  }

  async function withdrawNow(lock: RootLock) {
    if (!wallet) return;
    setWithdrawProblem(null);
    setWithdrawing(lock.id);
    try {
      await ensureChain(wallet, { chainId: wallet.expectedChainId, name: wallet.chainName, rpcUrl: wallet.chain.rpcUrls.default.http[0] });
      const hash = await contractWriter(wallet)({ address: lockAddress, abi: sproutRootLockAbi, functionName: 'withdraw', args: [BigInt(lock.id)] });
      onChanged(await waitForSuccess(wallet.publicClient, hash));
    } catch (e) {
      setWithdrawProblem(txProblem(e));
    } finally {
      setWithdrawing(null);
    }
  }

  const stepText: Record<Step, string | null> = {
    idle: null,
    'approve-sign': t('Step 1 of 2: approve in your wallet, so the lock can take exactly this amount.'),
    'approve-wait': t('Step 1 of 2: waiting for the approval to confirm…'),
    'lock-sign': t('Step 2 of 2: confirm the lock in your wallet.'),
    'lock-wait': t('Step 2 of 2: waiting for the lock to confirm…'),
    done: t('Rooted. Your SPROUT is locked and already counts toward your tier.'),
    error: problem,
  };

  let form: JSX.Element;
  if (!address || !wallet) {
    form = (
      <div className="root-connect">
        <p>{t('Connect the wallet that holds your SPROUT to root some of it. You approve and lock from your own wallet, and only that wallet can withdraw it.')}</p>
        <button className="perks-button" data-testid="root-connect" onClick={onConnect}>
          <Wallet size={16} aria-hidden /> {t('Connect wallet')}
        </button>
      </div>
    );
  } else if (!status) {
    form = <p className="perks-muted">{t('Checking your SPROUT…')}</p>;
  } else {
    const unlockPreview = chainNow + days * 86_400;
    form = (
      <form
        className="root-form"
        data-testid="root-form"
        onSubmit={(e) => {
          e.preventDefault();
          void lockNow();
        }}
      >
        <label className="root-field">
          <span>{t('How much SPROUT to lock')}</span>
          <span className="root-amount">
            <input
              data-testid="root-amount"
              inputMode="decimal"
              autoComplete="off"
              placeholder="800,000"
              value={amountText}
              disabled={busy}
              aria-invalid={amountText !== '' && (amount === null || tooMuch)}
              onChange={(e) => {
                setAmountText(e.target.value);
                if (step === 'done' || step === 'error') setStep('idle');
              }}
            />
            <button type="button" className="root-max" disabled={busy || balance === 0n} onClick={() => setAmountText(wholeSprout(balance, decimals))}>
              {t('All')}
            </button>
          </span>
          <small className={tooMuch || (amountText !== '' && amount === null) ? 'root-invalid' : 'perks-muted'}>
            {amountText !== '' && amount === null
              ? t('Enter an amount of SPROUT, like 250,000.')
              : tooMuch
                ? t('That’s more than this wallet holds ({amount} SPROUT).', { amount: wholeSprout(balance, decimals) })
                : t('This wallet holds {amount} SPROUT.', { amount: wholeSprout(balance, decimals) })}
          </small>
        </label>

        <fieldset className="root-days" disabled={busy}>
          <legend>{t('For how long')}</legend>
          {durations.map((d) => (
            <label key={d} className={'root-day' + (days === d ? ' is-on' : '')} data-testid={`root-days-${d}`}>
              <input
                type="radio"
                name="root-days"
                value={d}
                checked={days === d}
                onChange={() => {
                  setDays(d);
                  setUnderstood(false); // a new date needs a new "I understand"
                }}
              />
              <b>{t('{n} days', { n: d })}</b>
              <span>{t('counts {multiplier}', { multiplier: multiplierLabel(d) })}</span>
            </label>
          ))}
        </fieldset>

        <div className="root-preview" data-testid="root-preview" aria-live="polite">
          {preview && amount ? (
            <>
              <p>
                {t('{amount} SPROUT locked for {days} days counts as {credit} SPROUT toward your tier, starting now.', {
                  amount: wholeSprout(amount, decimals),
                  days,
                  credit: wholeSprout(preview.credit, decimals),
                })}
              </p>
              <p className="root-preview-tier">
                {tj('Your tier after rooting: {tier}', { tier: <b data-testid="root-preview-tier">{preview.tier ? tierLabel(preview.tier) : t('Not a holder tier yet')}</b> })}
              </p>
              <p className="perks-muted">{t('Unlocks on {date}. You can withdraw it then, not before.', { date: dateText(unlockPreview) })}</p>
            </>
          ) : (
            <p className="perks-muted">{t('Pick an amount and a length to see what it counts for (×{a}, ×{b} or ×{c} while locked).', { a: rootMultiplier(30), b: rootMultiplier(90), c: rootMultiplier(180) })}</p>
          )}
        </div>

        <label className="root-understand">
          <input type="checkbox" data-testid="root-understand" checked={understood} disabled={busy} onChange={(e) => setUnderstood(e.target.checked)} />
          <span>{t('I understand this SPROUT stays locked until {date}, and nobody can unlock it early.', { date: dateText(unlockPreview) })}</span>
        </label>

        <button className="perks-button" type="submit" data-testid="root-submit" disabled={busy || !amount || tooMuch || !understood}>
          {busy ? <Loader2 size={16} className="root-spin" aria-hidden /> : <Lock size={16} aria-hidden />}
          {t('Approve and lock')}
        </button>
        {stepText[step] ? (
          <p className={'root-step root-step--' + step} role={step === 'error' ? 'alert' : 'status'} data-testid="root-step">
            {step === 'done' ? <Check size={15} aria-hidden /> : null} {stepText[step]}
          </p>
        ) : null}
      </form>
    );
  }

  return (
    <section className="perks-card root-card" id="root" aria-labelledby="root-title" data-testid="root-panel">
      <h2 id="root-title">🌳 {t('Two ways to reach a tier')}</h2>
      <div className="root-paths">
        <article className="root-path">
          <h3>{t('Hold')}</h3>
          <p>{t('Keep SPROUT in your wallet. It counts once you’ve held it for {period}, and you can move it any time.', { period: holdPeriod((perks.holdDays || 7) * 86_400) })}</p>
        </article>
        <article className="root-path root-path--root">
          <h3>{t('Root it (optional)')}</h3>
          <p>{t('Lock SPROUT for 30, 90 or 180 days. It counts right away, and counts for more while it’s locked: ×1.25, ×1.5 or ×2.')}</p>
        </article>
      </div>
      <p className="root-warning" role="note" data-testid="root-warning">
        <AlertTriangle size={17} aria-hidden />
        <span>{t('Locked SPROUT can’t be withdrawn before the date you pick. Nobody, Sprout included, can unlock it early.')}</span>
      </p>
      <p className="perks-muted">
        {t('Rooting only changes your access and status inside Sprout. It pays nothing, and you get back exactly the SPROUT you locked, to the same wallet.')}
      </p>
      <RootedCounter root={root} variant="perks" />
      {form}

      {locks.length ? (
        <div className="root-locks" data-testid="root-locks">
          <h3>{t('Your locks')}</h3>
          <ul>
            {locks.map((l) => (
              <li key={l.id} data-testid="root-lock">
                <div>
                  <b>{t('{amount} SPROUT', { amount: wholeSprout(l.amount, decimals) })}</b>
                  <span className="perks-muted">
                    {l.due
                      ? t('{n} days · unlocked {date} · counts as held SPROUT until you withdraw', { n: l.days, date: dateText(l.unlockAt) })
                      : t('{n} days · counts {multiplier} · unlocks {date}', { n: l.days, multiplier: multiplierLabel(l.days as RootDays), date: dateText(l.unlockAt) })}
                  </span>
                </div>
                {l.due ? (
                  wallet ? (
                    <button className="perks-button perks-button--light" data-testid="root-withdraw" disabled={withdrawing !== null} onClick={() => void withdrawNow(l)}>
                      {withdrawing === l.id ? <Loader2 size={15} className="root-spin" aria-hidden /> : null}
                      {withdrawing === l.id ? t('Withdrawing…') : t('Withdraw')}
                    </button>
                  ) : (
                    <button className="perks-button perks-button--light" onClick={onConnect}>
                      {t('Connect to withdraw')}
                    </button>
                  )
                ) : (
                  <span className="root-locked-chip">
                    <Lock size={13} aria-hidden /> {t('Locked')}
                  </span>
                )}
              </li>
            ))}
          </ul>
          {withdrawProblem ? (
            <p className="root-step root-step--error" role="alert">
              {withdrawProblem}
            </p>
          ) : null}
          <p className="perks-muted">{t('After you withdraw, that SPROUT is back in your wallet and counts again once you’ve held it for {period}.', { period: holdPeriod(status?.holdSeconds ?? (perks.holdDays || 7) * 86_400) })}</p>
        </div>
      ) : null}
    </section>
  );
}
