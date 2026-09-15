import { useEffect, useState } from 'react';
import { AlertTriangle, X } from 'lucide-react';

/**
 * Risk disclosure for a beta product that moves real money.
 *
 * Every limitation named here is one the project already documents in its
 * README - unaudited contracts, automatic investing switched off, graduation
 * withdrawal and backup restore not yet verified against mainnet. None of it
 * was visible anywhere in the product, so the only people who knew were the
 * ones reading the repository.
 *
 * This is plain-language risk disclosure, not legal terms. Anything binding
 * should be written or reviewed by a lawyer.
 */

const DISMISSED_KEY = 'sprout-beta-notice-dismissed';

export const BETA_POINTS: string[] = [
  'The contracts have not been audited.',
  'Transactions settle on Robinhood Chain mainnet with real funds and cannot be reversed.',
  'Automatic weekly investing is switched off, so nothing invests on its own.',
  'Graduation withdrawal has not yet been verified on mainnet.',
  'Backup restoration has not yet been verified.',
  'Balances and activity are read from the chain and can lag behind it.',
  'Nothing here is financial advice.',
];

/** The full-width banner that sits above the dashboard. */
export function BetaNotice(): JSX.Element | null {
  const [dismissed, setDismissed] = useState(true);
  const [open, setOpen] = useState(false);

  // Read the flag after mount so the server-rendered markup and the first
  // client paint agree, then show the banner only if it has not been dismissed.
  useEffect(() => {
    try {
      setDismissed(window.localStorage.getItem(DISMISSED_KEY) === '1');
    } catch {
      setDismissed(false);
    }
  }, []);

  if (dismissed) return null;

  const dismiss = (): void => {
    try {
      window.localStorage.setItem(DISMISSED_KEY, '1');
    } catch {
      /* private mode - the banner simply returns next visit */
    }
    setDismissed(true);
  };

  return (
    <div className="beta-notice" role="region" aria-label="Beta risk notice">
      <span className="beta-notice-icon" aria-hidden><AlertTriangle size={17} /></span>
      <div className="beta-notice-body">
        <b>Sprout is in beta, and it moves real money.</b>{' '}
        <span>
          The contracts are not audited and mainnet transactions cannot be reversed. Only commit what
          you are prepared to lose.
        </span>
        <button type="button" className="beta-notice-more" onClick={() => setOpen(!open)} aria-expanded={open}>
          {open ? 'Hide details' : 'What else should I know?'}
        </button>
        {open ? (
          <ul className="beta-notice-list">
            {BETA_POINTS.map((point) => <li key={point}>{point}</li>)}
          </ul>
        ) : null}
      </div>
      <button type="button" className="beta-notice-close" onClick={dismiss} aria-label="Dismiss beta notice">
        <X size={16} />
      </button>
    </div>
  );
}

/**
 * The short form, shown inside the dialogs that actually spend money. This one
 * is deliberately not dismissible: it is the last thing in front of a signature.
 */
export function RiskLine({ action }: { action: string }): JSX.Element {
  return (
    <p className="risk-line" role="note">
      <AlertTriangle size={14} aria-hidden />
      <span>
        <b>Beta, real funds.</b> {action} settles on Robinhood Chain mainnet and cannot be undone.
        The contracts are not audited.
      </span>
    </p>
  );
}
