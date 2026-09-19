import { useCallback, useEffect, useRef, useState } from 'react';
import { Check, Flame, Loader2 } from 'lucide-react';
import { BurnFlowError, runBuyAndBurn, type BurnStep, type BurnWallet } from '@sprout/shared';
import type { Hex } from 'viem';
import { t } from '../i18n';
import { contractWriter, ensureChain, waitForSuccess, type WalletState } from '../wallet';
import { burnFloor, fetchBurnQuote, reportBurn, slippageLabel, sproutText, usdText, writeBurnOptIn, type BurnConfigInfo, type BurnQuoteInfo } from './burn';
import './burn.css';

/**
 * The buy & burn transaction flow, shared by the /perks panel and the $1 offer
 * after a buy: the wallet approves exactly the amount (USDG to Uniswap's
 * Permit2, then Permit2 to the router, each only when missing), then sends one
 * router transaction that buys SPROUT and sends it to the dead address. The
 * transactions come from the wallet; nothing is taken from any sprout.
 */

export type BurnPhase = 'idle' | BurnStep | 'done' | 'error';

export interface BurnRunState {
  phase: BurnPhase;
  n: number;
  total: number;
  amount: bigint | null;
  hash: Hex | null;
  /** SPROUT that reached the dead address, as the server recorded it (else the quote). */
  burned: bigint | null;
  problem: string | null;
}

const IDLE: BurnRunState = { phase: 'idle', n: 0, total: 0, amount: null, hash: null, burned: null, problem: null };

function burnWallet(wallet: WalletState): BurnWallet {
  const write = contractWriter(wallet);
  return {
    address: wallet.address,
    read: (args) => wallet.publicClient.readContract(args as never) as Promise<unknown>,
    write: (args) => write(args),
    wait: (hash) => waitForSuccess(wallet.publicClient, hash),
    now: () => Math.floor(Date.now() / 1000),
  };
}

/** A wallet's plain-language reason a burn did not go through. */
export function burnProblem(e: unknown, config: BurnConfigInfo): string {
  const err = e as { code?: number; name?: string; shortMessage?: string; message?: string; cause?: { code?: number }; detail?: bigint };
  if (err?.code === 4001 || err?.cause?.code === 4001 || err?.name === 'UserRejectedRequestError' || /user (rejected|denied)/i.test(err?.message ?? '')) {
    return t('You cancelled it in your wallet. No USDG was spent.');
  }
  if (e instanceof BurnFlowError && e.code === 'balance') {
    return t('This wallet has {amount} USDG. Pick a smaller amount, or add USDG to this wallet first.', { amount: usdText(e.detail ?? 0n, config.route.usdgDecimals) });
  }
  const text = `${err?.shortMessage ?? ''} ${err?.message ?? ''}`;
  if (/TooLittleReceived|0x8b063d73/i.test(text)) {
    return t('The price moved more than {floor} since the quote, so nothing was burned and no USDG was spent. Try again.', { floor: slippageLabel(config.slippageBps) });
  }
  if (e instanceof Error && e.name === 'BurnApiError') return t('Couldn’t get a price from the pool just now. Try again in a moment.');
  return t('That didn’t go through: {reason}', { reason: err?.shortMessage ?? err?.message ?? String(e) });
}

/** Runs one buy & burn from `wallet`; `onBurned` fires once the counter has it. */
export function useBurnRunner(config: BurnConfigInfo | null, onBurned?: () => void) {
  const [state, setState] = useState<BurnRunState>(IDLE);
  const live = useRef(true);
  useEffect(() => {
    live.current = true;
    return () => {
      live.current = false;
    };
  }, []);
  const set = (next: Partial<BurnRunState>) => live.current && setState((s) => ({ ...s, ...next }));

  const run = useCallback(
    async (wallet: WalletState, usdgIn: bigint) => {
      if (!config) return;
      setState({ ...IDLE, phase: 'check', amount: usdgIn });
      try {
        await ensureChain(wallet, { chainId: wallet.expectedChainId, name: wallet.chainName, rpcUrl: wallet.chain.rpcUrls.default.http[0] });
        const usd = usdText(usdgIn, config.route.usdgDecimals).replace(/,/g, '');
        const result = await runBuyAndBurn({
          wallet: burnWallet(wallet),
          route: config.route,
          usdgIn,
          slippageBps: config.slippageBps,
          quote: async () => BigInt((await fetchBurnQuote(usd)).sproutOut),
          onStep: (phase, n, total) => set({ phase, n, total }),
        });
        set({ phase: 'done', hash: result.hash, burned: result.quoted });
        const recorded = await reportBurn(result.hash, wallet.address);
        if (recorded) set({ burned: BigInt(recorded.sprout) });
        onBurned?.();
      } catch (e) {
        set({ phase: 'error', problem: burnProblem(e, config) });
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [config, onBurned],
  );
  const reset = useCallback(() => setState(IDLE), []);
  const busy = state.phase !== 'idle' && state.phase !== 'done' && state.phase !== 'error';
  return { state, run, reset, busy };
}

/** The step line under the button: what the wallet is asking for, then the result with its explorer link. */
export function BurnStatus({ state, config }: { state: BurnRunState; config: BurnConfigInfo }) {
  if (state.phase === 'idle') return null;
  const amount = state.amount === null ? '' : `$${usdText(state.amount, config.route.usdgDecimals)}`;
  const vars = { n: state.n, total: state.total, amount };
  const text: Record<Exclude<BurnPhase, 'idle'>, string> = {
    check: t('Checking the price and your wallet…'),
    'approve-sign': t('Step {n} of {total}: let Uniswap’s Permit2 use exactly {amount} of your USDG. Confirm in your wallet.', vars),
    'approve-wait': t('Step {n} of {total}: waiting for the approval to confirm…', vars),
    'permit-sign': t('Step {n} of {total}: let the Uniswap router spend that {amount}, for the next 30 minutes. Confirm in your wallet.', vars),
    'permit-wait': t('Step {n} of {total}: waiting for Permit2 to confirm…', vars),
    'burn-sign': t('Step {n} of {total}: confirm the buy & burn in your wallet.', vars),
    'burn-wait': t('Step {n} of {total}: waiting for the burn to confirm…', vars),
    done: state.burned !== null ? t('Burned. {sprout} SPROUT went to the dead address for good.', { sprout: sproutText(state.burned, config.route.sproutDecimals) }) : t('Burned.'),
    error: state.problem ?? '',
  };
  const busy = state.phase !== 'done' && state.phase !== 'error';
  return (
    <p className={'burn-step burn-step--' + state.phase} role={state.phase === 'error' ? 'alert' : 'status'} data-testid="burn-step">
      {busy ? <Loader2 size={15} className="root-spin" aria-hidden /> : state.phase === 'done' ? <Check size={15} aria-hidden /> : null}
      <span>
        {text[state.phase]}
        {state.hash && config.explorerUrl ? (
          <>
            {' '}
            <a href={`${config.explorerUrl}/tx/${state.hash}`} target="_blank" rel="noreferrer" data-testid="burn-tx-link">
              {t('View the transaction')}
            </a>
          </>
        ) : null}
      </span>
    </p>
  );
}

/** "≈ 40,445 SPROUT will be burned", and the floor under it. */
export function BurnQuoteLine({ quote, config, loading }: { quote: BurnQuoteInfo | null; config: BurnConfigInfo; loading?: boolean }) {
  if (!quote) return <p className="perks-muted">{loading ? t('Getting a price…') : t('Pick an amount to see how much SPROUT it burns.')}</p>;
  const floor = burnFloor(quote.sproutOut, config.slippageBps);
  return (
    <>
      <p className="burn-quote-main" data-testid="burn-quote">
        {t('≈ {sprout} SPROUT will be burned', { sprout: sproutText(quote.sproutOut, config.route.sproutDecimals) })}
      </p>
      <p className="perks-muted">
        {t('If fewer than {floor} SPROUT would reach the dead address ({slippage} under this price), the burn is cancelled and no USDG is spent. The price includes the pool’s 2% trading fee.', {
          floor: sproutText(floor, config.route.sproutDecimals),
          slippage: slippageLabel(config.slippageBps),
        })}
      </p>
    </>
  );
}

/** The plain note shown wherever a burn can start. */
export function BurnNote() {
  return (
    <p className="burn-note" role="note" data-testid="burn-note">
      {t('This buys SPROUT on the open market with your USDG and burns it for good. It’s voluntary, it pays you nothing, and it’s not advice.')}
    </p>
  );
}

/**
 * The $1 offer after the parent's own deposit or Invest now, for people who
 * turned on "Add a $1 burn to my buys". It only asks: nothing is sent until
 * they press the button and confirm in their wallet.
 */
export function BurnOffer({ wallet, config, onClose, inline = false }: { wallet: WalletState; config: BurnConfigInfo; onClose: () => void; /** Inside another dialog that has its own Done button. */ inline?: boolean }) {
  const usdgIn = 10n ** BigInt(config.route.usdgDecimals); // $1
  const [quote, setQuote] = useState<BurnQuoteInfo | null>(null);
  const { state, run, busy } = useBurnRunner(config);
  useEffect(() => {
    let alive = true;
    void fetchBurnQuote('1')
      .then((q) => alive && setQuote(q))
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, []);
  const done = state.phase === 'done';
  return (
    <div className="burn-offer" data-testid="burn-offer">
      <h3>
        <Flame size={17} aria-hidden /> {t('Add your $1 buy & burn?')}
      </h3>
      <p>{t('You asked to add a $1 burn to your buys. It spends $1 of USDG from your wallet, never from the sprout, to buy SPROUT and burn it.')}</p>
      <BurnNote />
      <BurnQuoteLine quote={quote} config={config} loading />
      <BurnStatus state={state} config={config} />
      <div className="burn-offer-actions">
        {done ? (
          inline ? null : (
            <button className="btn btn--primary" data-testid="burn-offer-close" onClick={onClose}>
              {t('Done')}
            </button>
          )
        ) : (
          <>
            <button className="btn btn--primary" data-testid="burn-offer-go" disabled={busy || !quote} onClick={() => void run(wallet, usdgIn)}>
              {busy ? <Loader2 size={15} className="root-spin" aria-hidden /> : null} {t('Buy & burn $1 🔥')}
            </button>
            <button className="btn" data-testid="burn-offer-skip" disabled={busy} onClick={onClose}>
              {t('Not now')}
            </button>
            <button
              className="btn btn--small burn-offer-stop"
              data-testid="burn-offer-stop"
              disabled={busy}
              onClick={() => {
                writeBurnOptIn(false);
                onClose();
              }}
            >
              {t('Stop asking')}
            </button>
          </>
        )}
      </div>
    </div>
  );
}
