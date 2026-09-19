import { useEffect, useRef, useState } from 'react';
import { parseUnits, type Address } from 'viem';
import { formatUnits, sproutVaultAbi } from '@sprout/shared';
import { api, type ChainPublic, type InvestQuote } from '../api';
import { contractWriter, waitForSuccess, type WalletState } from '../wallet';
import { RiskLine } from './BetaNotice';
import { rememberOneOffSchedule } from '../localStore';
import { t, tj, getLocale } from '../i18n';

/**
 * "Invest now": the parent buys the sprout's stock mix from its own wallet.
 *
 * The vault only spends through its schedule: a purchase runs when the
 * schedule is active and due, and spends exactly the scheduled amount. So a
 * one-off purchase is up to three signatures: set the amount (due now), buy,
 * and clear the schedule again unless the parent wants to keep it as a weekly
 * plan. When a plan already exists, this runs that plan's purchase now.
 */

const WEEK_SECONDS = 604_800n;
const ONE_OFF_PREFIX = 'sprout.investNow.oneOff.';

/**
 * A schedule this dialog set up for a one-off purchase that did not finish
 * (the buy was rejected, or the page closed). Without the note the next visit
 * would read it as the parent's weekly plan.
 */
function readOneOff(vault: string): string | null {
  try {
    return window.localStorage.getItem(ONE_OFF_PREFIX + vault.toLowerCase());
  } catch {
    return null;
  }
}

function writeOneOff(vault: string, amount: bigint | null): void {
  try {
    const key = ONE_OFF_PREFIX + vault.toLowerCase();
    if (amount === null) window.localStorage.removeItem(key);
    else window.localStorage.setItem(key, amount.toString());
  } catch {
    // storage may be unavailable in private mode
  }
}

/**
 * The server's blocker messages (server/src/invest.ts), by code, so they can be
 * shown translated. `{symbol}` and `{name}` are read back out of the server's
 * own text; if the server's wording no longer matches, its text is shown as sent.
 */
const BLOCKER_TEXT: Record<string, string> = {
  'not-configured': 'Buying is not configured on this server.',
  graduated: 'This sprout has graduated, so it no longer buys anything.',
  'venue-not-allowed': 'This sprout was planted without a trading venue, so it cannot buy stocks.',
  'nothing-to-buy': 'Enter an amount large enough to buy something.',
  'insufficient-funds': 'That is more than this sprout has available to invest. Add funds first, or choose a smaller amount.',
  'pool-too-far':
    'The trading pool is pricing these stocks too far from the market price right now, so the purchase would be refused. Try again shortly.',
  'stale-price':
    'The {symbol} price has not updated recently, so buying is paused to protect the price you get. This usually means US markets are closed; try again once they reopen.',
  'price-paused': 'The {symbol} price feed is paused right now, so {symbol} cannot be bought. Try again later.',
  'price-unavailable': 'The {symbol} price could not be read just now. Try again in a minute.',
  unknown: 'The purchase could not be prepared. Try again in a minute.',
};
const UNKNOWN_NAMED = 'The purchase could not be prepared ({name}). Try again in a minute.';

export function blockerText(blocker: { code: string; message: string }): string {
  const symbol = /^The (\S+) price/.exec(blocker.message)?.[1];
  const name = /^The purchase could not be prepared \((.+)\)\./.exec(blocker.message)?.[1];
  const text = blocker.code === 'unknown' && name ? UNKNOWN_NAMED : BLOCKER_TEXT[blocker.code];
  if (!text) return blocker.message;
  const vars: Record<string, string> = {};
  if (symbol) vars.symbol = symbol;
  if (name) vars.name = name;
  const english = text.replace(/\{(\w+)\}/g, (whole, key: string) => vars[key] ?? whole);
  return english === blocker.message ? t(text, vars) : blocker.message;
}

export interface InvestNowFormProps {
  wallet: WalletState;
  vault: Address;
  chain: ChainPublic;
  /** Settlement currently in the vault (base units), used for the default amount. */
  settlementBalance: string | null;
  runTxn: (label: string, fn: () => Promise<string | void>) => Promise<void>;
  /** From /api/health; decides what "keep as a weekly plan" means. */
  automationEnabled: boolean | null;
  onDone: () => Promise<void>;
  onClose: () => void;
}

export function InvestNowForm({ wallet, vault, chain, settlementBalance, runTxn, automationEnabled, onDone, onClose }: InvestNowFormProps) {
  const decimals = chain.contracts.settlementDecimals;
  const ticker = chain.contracts.settlementSymbol ?? t('settlement');
  const [amount, setAmount] = useState(() => {
    const balance = settlementBalance ? BigInt(settlementBalance) : 0n;
    // Whole units keep the default readable; the preview reports what is spendable.
    const whole = balance / 10n ** BigInt(decimals);
    return whole > 0n ? whole.toString() : '10';
  });
  const [keepPlan, setKeepPlan] = useState(false);
  const [preview, setPreview] = useState<InvestQuote | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  // English step text and its values; translated where it is shown.
  const [step, setStep] = useState<{ text: string; vars?: Record<string, number> } | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const requestId = useRef(0);

  const oneOff = readOneOff(vault);
  // An active schedule is the parent's plan unless this dialog left it behind.
  const plan =
    preview?.schedule.active && preview.schedule.amount !== oneOff
      ? { amount: BigInt(preview.schedule.amount), periodSeconds: preview.schedule.periodSeconds }
      : null;

  let parsed: bigint | null = null;
  try {
    parsed = plan ? plan.amount : amount.trim() ? parseUnits(amount.trim(), decimals) : null;
  } catch {
    parsed = null;
  }

  useEffect(() => {
    if (parsed === null || parsed <= 0n) {
      setPreview((p) => (p && plan ? p : null));
      return;
    }
    const id = ++requestId.current;
    const timer = setTimeout(() => {
      api
        .investQuote(vault, parsed!)
        .then((q) => {
          if (id !== requestId.current) return;
          setPreview(q);
          setPreviewError(null);
        })
        .catch((error: unknown) => {
          if (id !== requestId.current) return;
          setPreviewError(error instanceof Error ? error.message : String(error));
        });
    }, 350);
    return () => clearTimeout(timer);
    // `plan` derives from preview; re-running on it would loop.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vault, parsed?.toString()]);

  const blocker = preview?.blocker ?? null;
  const legs = preview?.legs.filter((leg) => leg.amountIn !== '0') ?? [];
  const willClear = !plan && !keepPlan;
  const signatures = (preview?.due ? 1 : 2) + (willClear ? 1 : 0);
  const canSubmit = !busy && !done && parsed !== null && parsed > 0n && preview !== null && !blocker;

  const submit = async () => {
    if (parsed === null || !preview) return;
    const spend = parsed;
    setBusy(true);
    await runTxn(t('Invest now'), async () => {
      const write = contractWriter(wallet);
      let quote = await api.investQuote(vault, spend);
      if (quote.blocker) throw new Error(blockerText(quote.blocker));
      const clearAfter = willClear;
      const total = (quote.due ? 1 : 2) + (clearAfter ? 1 : 0);
      let n = 0;

      if (!quote.due) {
        setStep({ text: 'Step {n} of {total}: set the amount. Confirm in your wallet.', vars: { n: ++n, total } });
        const period = plan ? BigInt(plan.periodSeconds) : WEEK_SECONDS;
        const setHash = await write({ address: vault, abi: sproutVaultAbi, functionName: 'scheduleInvestment', args: [spend, period, 0n] });
        if (clearAfter) {
          writeOneOff(vault, spend);
          rememberOneOffSchedule(vault, setHash);
        }
        const block = await waitForSuccess(wallet.publicClient, setHash);
        setStep({ text: 'Checking prices before you buy…' });
        quote = await api.investQuote(vault, spend, block);
        if (quote.blocker) throw new Error(blockerText(quote.blocker));
      }
      if (!quote.due || !quote.minOuts || !quote.venue) {
        throw new Error(t('The purchase is not ready yet. Wait a moment and press Invest now again.'));
      }

      setStep({ text: 'Step {n} of {total}: buy. Confirm in your wallet.', vars: { n: ++n, total } });
      const buyHash = await write({
        address: vault,
        abi: sproutVaultAbi,
        functionName: 'executeInvestment',
        args: [quote.venue, quote.minOuts.map((m) => BigInt(m))],
      });
      await waitForSuccess(wallet.publicClient, buyHash);

      if (clearAfter) {
        setStep({ text: 'Step {n} of {total}: clear the one-off amount. This moves no money.', vars: { n: ++n, total } });
        const clearHash = await write({ address: vault, abi: sproutVaultAbi, functionName: 'cancelInvestment', args: [] });
        await waitForSuccess(wallet.publicClient, clearHash);
        writeOneOff(vault, null);
      } else {
        writeOneOff(vault, null);
      }
      setStep(null);
      setDone(true);
      await onDone();
      return buyHash;
    });
    setBusy(false);
    setStep(null);
  };

  const fmt = (raw: string, tokenDecimals: number, digits = 4) => formatUnits(BigInt(raw), tokenDecimals, digits);
  const stockDecimals = (asset: Address) =>
    chain.contracts.stockTokens.find((t) => t.address.toLowerCase() === asset.toLowerCase())?.decimals ?? 18;

  return (
    <div className="invest-now" data-testid="invest-now-form">
      <RiskLine action={t('Buying stock tokens')} />
      {plan ? (
        <p className="invest-now-lead">
          {tj('Runs your plan’s {amount} purchase now instead of waiting for it. The plan keeps its schedule from today.', {
            amount: (
              <b>
                {fmt(plan.amount.toString(), decimals, 2)} {ticker}
              </b>
            ),
          })}
        </p>
      ) : (
        <>
          <label>
            {t('Amount to invest ({ticker})', { ticker })}
            <input
              data-testid="invest-now-amount"
              inputMode="decimal"
              value={amount}
              disabled={busy || done}
              onChange={(e) => setAmount(e.target.value)}
            />
          </label>
          {preview ? (
            <p className="muted invest-now-available">
              {t('Available to invest: {amount} {ticker}', { amount: fmt(preview.available, decimals, 2), ticker })}
            </p>
          ) : null}
        </>
      )}

      {legs.length > 0 ? (
        <ul className="invest-now-legs" data-testid="invest-now-legs">
          {legs.map((leg) => (
            <li key={leg.asset}>
              <span>{fmt(leg.amountIn, decimals, 2)} {ticker}</span>
              <span aria-hidden>→</span>
              <b>{t('about {amount} {symbol}', { amount: fmt(leg.expectedOut, stockDecimals(leg.asset)), symbol: leg.symbol })}</b>
            </li>
          ))}
        </ul>
      ) : null}

      {blocker ? (
        <p className="garden-notice invest-now-blocker" role="alert" data-testid="invest-now-blocker">
          {blockerText(blocker)}
        </p>
      ) : null}
      {previewError ? <p className="garden-notice" role="alert">{t('Could not check prices: {error}', { error: previewError })}</p> : null}

      {!plan ? (
        <label className="invest-now-keep">
          <input
            type="checkbox"
            data-testid="invest-now-keep"
            checked={keepPlan}
            disabled={busy || done}
            onChange={(e) => setKeepPlan(e.target.checked)}
          />
          <span>{t('Keep this amount as a weekly plan')}</span>
        </label>
      ) : null}

      <p className="muted invest-now-note">
        {preview && !blocker
          ? `${signatures === 1 ? t('One wallet confirmation.') : t('{count} wallet confirmations.', { count: signatures })}${getLocale() === 'zh' ? '' : ' '}`
          : ''}
        {t('Prices come from the market feed; the purchase is refused if the pool pays much less than that price.')}
        {!plan && keepPlan
          ? automationEnabled
            ? ` ${t('After this, the plan buys automatically each week.')}`
            : ` ${t('Automatic weekly buying is switched off for now, so you can run each week’s purchase from here.')}`
          : ''}
      </p>

      {step ? (
        <p className="invest-now-step" role="status" data-testid="invest-now-step">
          {t(step.text, step.vars)}
        </p>
      ) : null}

      {done ? (
        <button className="btn btn--primary" data-testid="invest-now-close" onClick={onClose}>
          {t('Done')}
        </button>
      ) : (
        <button className="btn btn--primary" data-testid="invest-now-submit" disabled={!canSubmit} onClick={() => void submit()}>
          {busy ? t('Investing…') : t('Invest now')}
        </button>
      )}
    </div>
  );
}
