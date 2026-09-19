import { formatUnits } from '@sprout/shared';
import type { GiftCampaign, GiftNote } from '../api';
import { dateLocale, t } from '../i18n';

/**
 * Birthday campaigns: a gift link with a title, a dollar goal and an end date,
 * plus the notes family leave with their gifts. The server enforces the same
 * text rules; checking them here first means a gifter hears about a refused
 * note before paying, not after.
 */

export const NOTE_MAX = 140;
export const NAME_MAX = 40;
export const TITLE_MAX = 60;

const LINKISH = /(https?:\/\/|www\.|\b[a-z0-9-]+\.(com|net|org|io|xyz|app|gg|co|me|ly|tech|link|site|online|finance|money)\b)/i;

/**
 * The server's text rule, for early feedback. Returns an error message or null.
 * `field` is English ("The note"); it is translated here with the message.
 */
export function textProblem(text: string, max: number, field: string): string | null {
  const clean = text.replace(/\s+/g, ' ').trim();
  if ([...clean].length > max) return t('{field} can be at most {max} characters.', { field: t(field), max });
  if (LINKISH.test(clean)) return t("{field} can't include links.", { field: t(field) });
  return null;
}

export function dollars(cents: number): string {
  const whole = cents % 100 === 0;
  return `$${(cents / 100).toLocaleString('en-US', { minimumFractionDigits: whole ? 0 : 2, maximumFractionDigits: 2 })}`;
}

export function progressPercent(c: Pick<GiftCampaign, 'raisedCents' | 'goalCents'>): number {
  if (c.goalCents <= 0) return 0;
  return Math.max(0, Math.min(100, Math.round((c.raisedCents / c.goalCents) * 100)));
}

/** "Ends today", "3 days left", "Ended Sep 30". */
export function timeLeftText(endsAt: number, nowMs: number): string {
  const msLeft = endsAt * 1000 - nowMs;
  const date = new Date(endsAt * 1000).toLocaleDateString(dateLocale(), { month: 'short', day: 'numeric', timeZone: 'UTC' });
  if (msLeft <= 0) return t('Ended {date}', { date });
  const days = Math.ceil(msLeft / 86_400_000);
  if (days <= 1) return t('Ends today');
  return t('{days} days left · ends {date}', { days, date });
}

/** The last second (UTC) of a yyyy-mm-dd date. */
export function endOfDayUtc(date: string): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!m) return null;
  return Math.floor(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 23, 59, 59) / 1000);
}

export function CampaignProgress({ campaign, nowMs, compact = false }: { campaign: GiftCampaign; nowMs: number; compact?: boolean }) {
  const pct = progressPercent(campaign);
  return (
    <div className={'campaign-progress' + (compact ? ' campaign-progress--compact' : '')} data-testid="campaign-progress">
      <div className="campaign-progress-figures">
        <b>{dollars(campaign.raisedCents)}</b>
        <span>{t('raised of {goal}', { goal: dollars(campaign.goalCents) })}</span>
        <small>{timeLeftText(campaign.endsAt, nowMs)}</small>
      </div>
      <div
        className="campaign-progress-bar"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={pct}
        aria-label={t('{pct}% of the goal', { pct })}
      >
        <span style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

export function GiftNotesList({
  notes,
  tokenLabel,
  onToggleHidden,
  emptyText,
}: {
  notes: GiftNote[];
  /** Formats a gift amount, e.g. "$25" or "0.01 NVDA". */
  tokenLabel: (token: string, amount: string) => string;
  onToggleHidden?: (note: GiftNote) => void;
  emptyText?: string;
}) {
  if (notes.length === 0) return emptyText ? <p className="garden-empty-note">{emptyText}</p> : null;
  return (
    <ul className="gift-notes" data-testid="gift-notes">
      {notes.map((n) => (
        <li key={`${n.txHash}:${n.logIndex}`} className={'gift-note' + (n.hidden ? ' gift-note--hidden' : '')}>
          <div className="gift-note-head">
            <b>{n.name ?? t('Someone who cares')}</b>
            {n.token && n.amount ? <span>{tokenLabel(n.token, n.amount)}</span> : null}
          </div>
          {n.note ? <p>{n.note}</p> : null}
          {onToggleHidden ? (
            <button type="button" className="garden-see-all gift-note-toggle" data-testid="gift-note-toggle" onClick={() => onToggleHidden(n)}>
              {n.hidden ? t('Show on the gift page') : t('Hide')}
            </button>
          ) : null}
        </li>
      ))}
    </ul>
  );
}

/** "$25" for the settlement token (treated as $1), "0.01 NVDA" otherwise. */
export function giftAmountLabel(
  token: string,
  amount: string,
  chain: { settlementToken?: string; settlementDecimals: number; stockTokens: Array<{ address: string; symbol: string; decimals: number }> },
): string {
  if (token.toLowerCase() === chain.settlementToken?.toLowerCase()) {
    const cents = Number(BigInt(amount) / 10n ** BigInt(Math.max(0, chain.settlementDecimals - 2)));
    return dollars(cents);
  }
  const stock = chain.stockTokens.find((t) => t.address.toLowerCase() === token.toLowerCase());
  return `${formatUnits(BigInt(amount), stock?.decimals ?? 18, 4)} ${stock?.symbol ?? ''}`.trim();
}
