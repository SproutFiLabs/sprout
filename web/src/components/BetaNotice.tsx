import { useState } from 'react';
import { AlertTriangle } from 'lucide-react';

/**
 * Risk disclosure for a beta product that moves real money.
 *
 * Every limitation named here is one the project already documents in its
 * README - unaudited contracts, automatic investing (when switched off), graduation
 * withdrawal and backup restore not yet verified against mainnet. The lead line
 * and the in-dialog note stay short on purpose; the full list sits one click
 * away rather than shouting at every screen. None of it
 * was visible anywhere in the product, so the only people who knew were the
 * ones reading the repository.
 *
 * This is plain-language risk disclosure, not legal terms. Anything binding
 * should be written or reviewed by a lawyer.
 */

export const BETA_POINTS: string[] = [
  'Transactions settle on Robinhood Chain mainnet with real funds and cannot be reversed.',
  'The contracts have not been independently audited.',
  'Graduation withdrawal has not yet been verified on mainnet.',
  'Backup restoration has not yet been verified.',
  'Balances and activity are read from the chain and can lag behind it.',
  'Nothing here is financial advice.',
];

/**
 * The detail list, with the automation line taken from the server rather than
 * hard-coded: it has to stop saying "switched off" the day a keeper runs.
 */
export function betaPoints(automationEnabled: boolean | null): string[] {
  const automation =
    automationEnabled === false
      ? ['Automatic weekly investing is switched off, so nothing invests on its own.']
      : automationEnabled === true
        ? ['Weekly plans run automatically from a service wallet; a run can be delayed or skipped when prices are stale.']
        : [];
  return [...BETA_POINTS.slice(0, 2), ...automation, ...BETA_POINTS.slice(2)];
}

/**
 * The full-width banner that sits above the dashboard. It cannot be dismissed:
 * "automatic investing is switched off" is the kind of thing someone closes on
 * day one and has forgotten by week three, and being wrong about it costs real
 * money. Only the detail list collapses.
 */
export function BetaNotice({ automationEnabled = null }: { automationEnabled?: boolean | null }): JSX.Element {
  const [open, setOpen] = useState(false);

  return (
    <div className="beta-notice" role="region" aria-label="Beta risk notice">
      <span className="beta-notice-icon" aria-hidden><AlertTriangle size={17} /></span>
      <div className="beta-notice-body">
        <b>Sprout is in beta, and it moves real money.</b>{' '}
        <span>
          Mainnet transactions settle with real funds and cannot be reversed. Only commit what you
          are prepared to lose.
        </span>
        <button type="button" className="beta-notice-more" onClick={() => setOpen(!open)} aria-expanded={open}>
          {open ? 'Hide details' : 'What else should I know?'}
        </button>
        {open ? (
          <>
            <ul className="beta-notice-list">
              {betaPoints(automationEnabled).map((point) => <li key={point}>{point}</li>)}
            </ul>
            <a className="beta-notice-more" href="/faq">Read the full FAQ</a>
          </>
        ) : null}
      </div>
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
      </span>
    </p>
  );
}
