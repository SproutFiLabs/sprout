import { AlertTriangle } from 'lucide-react';

/**
 * Risk disclosure for a beta product that moves real money.
 *
 * The full list is the FAQ's "What are the risks?" answer; it used to be a
 * banner above the dashboard. The short RiskLine stays inside every dialog
 * that spends money, as the last thing in front of a signature.
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
