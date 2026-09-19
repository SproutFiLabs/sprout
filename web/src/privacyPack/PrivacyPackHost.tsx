import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { ChainPublic } from '../api';
import type { WalletState } from '../wallet';
import { addMoneySymbols } from './discreet';
import { PrivacyCheckup } from './PrivacyCheckup';

export const CHECKUP_PATH = '/privacy-checkup';
const onCheckupPath = () => window.location.pathname.replace(/\/+$/, '') === CHECKUP_PATH;

/**
 * Hosts the privacy checkup for the dashboard app: opens it on
 * `sprout-open-checkup` (Family privacy, the wallet menu) and at
 * /privacy-checkup, keeps that URL while it is open so Back closes it, and
 * makes the page behind it inert.
 */
export function PrivacyPackHost({ wallet, chain, onConnect }: { wallet: WalletState | null; chain: ChainPublic | null; onConnect: () => void }) {
  const [open, setOpen] = useState(onCheckupPath);
  const pushed = useRef(false);
  const layer = useRef<HTMLDivElement | null>(null);

  // Discreet mode learns this deployment's tickers from the config the app already loaded.
  useEffect(() => {
    if (chain) addMoneySymbols([chain.contracts.settlementSymbol ?? '', ...chain.contracts.stockTokens.map((s) => s.symbol)]);
  }, [chain]);

  useEffect(() => {
    const show = () => {
      if (!onCheckupPath()) {
        window.history.pushState(window.history.state, '', CHECKUP_PATH);
        pushed.current = true;
      }
      setOpen(true);
    };
    const pop = () => {
      if (!onCheckupPath()) pushed.current = false;
      setOpen(onCheckupPath());
    };
    window.addEventListener('sprout-open-checkup', show);
    window.addEventListener('popstate', pop);
    return () => {
      window.removeEventListener('sprout-open-checkup', show);
      window.removeEventListener('popstate', pop);
    };
  }, []);

  const close = useCallback(() => {
    setOpen(false);
    if (!onCheckupPath()) return;
    if (pushed.current) {
      pushed.current = false;
      window.history.back();
    } else {
      window.history.replaceState(window.history.state, '', '/dashboard');
    }
  }, []);

  // aria-modal promises the rest of the page is out of reach: make it inert. A
  // layout effect, so the page is live again before the checkup's own cleanup
  // hands focus back to whatever opened it.
  useLayoutEffect(() => {
    if (!open) return;
    const others = [...document.body.children].filter(
      (el): el is HTMLElement => el instanceof HTMLElement && el !== layer.current && !el.inert,
    );
    others.forEach((el) => (el.inert = true));
    return () => others.forEach((el) => (el.inert = false));
  }, [open]);

  if (!open) return null;
  return createPortal(
    <div ref={layer} className="pp-layer">
      <PrivacyCheckup wallet={wallet} chain={chain} onClose={close} onConnect={onConnect} />
    </div>,
    document.body,
  );
}
