/**
 * One-tap starting points for a sprout's stock mix. Parents stalled on typing
 * percentages that add up to exactly 100; a mix picks the stocks and fills the
 * fields in, and every value stays editable.
 *
 * A named mix only appears when every stock it names is admitted for the
 * sprout being planted or edited (older sprouts were admitted AAPL, NVDA, MSFT
 * and SPY only), so a mix can never pick a stock the contract would refuse.
 * The even split works on whatever is picked, which is all the local demo's
 * two mock tokens offer.
 */

import { t } from '../i18n';
import { MAX_STOCKS } from '../stocks';

export interface MixToken {
  symbol: string;
  address: string;
}

export interface StarterMix {
  id: string;
  label: string;
  note: string;
  /** Whole percentages by ticker, at most 5 stocks, totalling 100; null means an even split of the picked stocks. */
  weights: Record<string, number> | null;
}

export const STARTER_MIXES: StarterMix[] = [
  { id: 'even', label: 'Even split', note: 'The same share of each stock.', weights: null },
  {
    id: 'big-tech',
    label: 'Big tech',
    note: 'Apple, Microsoft, NVIDIA, Google and Amazon, 20% each.',
    weights: { AAPL: 20, MSFT: 20, NVDA: 20, GOOGL: 20, AMZN: 20 },
  },
  {
    id: 'space',
    label: 'Space & future',
    note: '30% SpaceX, 25% Tesla, 20% NVIDIA, 15% Palantir and 10% in the Nasdaq-100.',
    weights: { SPCX: 30, TSLA: 25, NVDA: 20, PLTR: 15, QQQ: 10 },
  },
  {
    id: 'market',
    label: 'The whole market',
    note: '60% SPY, which follows 500 large US companies, and 40% QQQ, which follows the Nasdaq-100.',
    weights: { SPY: 60, QQQ: 40 },
  },
  {
    id: 'chips',
    label: 'Chips',
    note: 'NVIDIA, TSMC, AMD, ASML and Micron, 20% each.',
    weights: { NVDA: 20, TSM: 20, AMD: 20, ASML: 20, MU: 20 },
  },
  {
    id: 'index',
    label: 'Mostly the S&P 500',
    note: '70% SPY, which follows 500 large US companies; the rest split across Apple, NVIDIA and Microsoft.',
    weights: { SPY: 70, AAPL: 10, NVDA: 10, MSFT: 10 },
  },
];

/** What a mix does to the form: the stocks it picks (addresses, in order) and their field values. */
export interface MixChoice {
  selected: string[];
  percents: Record<string, string>;
}

/**
 * The picks and field values for a mix, or null when it does not apply:
 * a named mix needs every stock it names among `admitted` (and at most five);
 * the even split needs at least one stock in `selected`.
 */
export function mixPercents(mix: StarterMix, admitted: MixToken[], selected: MixToken[]): MixChoice | null {
  if (mix.weights === null) {
    if (selected.length === 0) return null;
    const base = Math.floor(100 / selected.length);
    const extra = 100 - base * selected.length;
    return {
      selected: selected.map((s) => s.address),
      percents: Object.fromEntries(selected.map((s, i) => [s.address, String(base + (i < extra ? 1 : 0))])),
    };
  }
  const bySymbol = new Map(admitted.map((a) => [a.symbol, a]));
  const picks = Object.entries(mix.weights).map(([symbol, weight]) => ({ token: bySymbol.get(symbol), weight }));
  if (picks.length > MAX_STOCKS || picks.some((p) => !p.token)) return null;
  return {
    selected: picks.map((p) => p.token!.address),
    percents: Object.fromEntries(picks.map((p) => [p.token!.address, String(p.weight)])),
  };
}

function sameChoice(selected: string[], percents: Record<string, string>, choice: MixChoice): boolean {
  if (selected.length !== choice.selected.length) return false;
  const picked = new Set(selected.map((a) => a.toLowerCase()));
  return choice.selected.every((a) => picked.has(a.toLowerCase()) && Number(percents[a] ?? 0) === Number(choice.percents[a]));
}

/**
 * A mix supplied from outside the built-in list (a later update adds some).
 * Text fields are English source text, translated here with t(), or text the
 * caller already translated. A locked mix is shown with a 🔒 and its note, and
 * cannot be picked.
 */
export type ExtraMix = StarterMix & { locked?: boolean; lockNote?: string };

/** Whether a stock can be picked right now; `note` says why not. Nothing is locked by default. */
export type StockLock = (symbol: string) => { locked: boolean; note?: string };

export interface MixOption {
  mix: StarterMix;
  choice: MixChoice;
  locked: boolean;
  lockNote: string | null;
}

/**
 * The mixes to offer, built-in first: each only when it fits the admitted
 * stocks (see mixPercents). A mix is locked when it says so, or when it names a
 * stock `stockLock` locks (the even split never is: it only reshares picks).
 */
export function starterMixOptions(
  admitted: MixToken[],
  selected: MixToken[],
  extraMixes: ExtraMix[] = [],
  stockLock?: StockLock,
): MixOption[] {
  const bySymbol = new Map(admitted.map((a) => [a.address.toLowerCase(), a.symbol]));
  const options: MixOption[] = [];
  for (const mix of [...STARTER_MIXES, ...extraMixes] as ExtraMix[]) {
    const choice = mixPercents(mix, admitted, selected);
    if (!choice) continue;
    const stockLocks = mix.weights === null || !stockLock
      ? []
      : choice.selected.map((a) => stockLock(bySymbol.get(a.toLowerCase()) ?? '')).filter((l) => l.locked);
    const locked = Boolean(mix.locked) || stockLocks.length > 0;
    options.push({ mix, choice, locked, lockNote: locked ? (mix.lockNote ?? stockLocks.find((l) => l.note)?.note ?? null) : null });
  }
  return options;
}

export function StarterMixPicker({
  admitted,
  selected,
  percents,
  onPick,
  extraMixes,
  stockLock,
}: {
  /** Stocks this sprout may hold. */
  admitted: MixToken[];
  /** Stocks picked right now, in order. */
  selected: MixToken[];
  percents: Record<string, string>;
  onPick: (choice: MixChoice) => void;
  /** Mixes offered after the built-in ones. */
  extraMixes?: ExtraMix[];
  /** Stocks that cannot be picked right now; a mix naming one is locked too. */
  stockLock?: StockLock;
}) {
  const options = starterMixOptions(admitted, selected, extraMixes, stockLock);
  if (options.length === 0) return null;
  const addresses = selected.map((s) => s.address);
  // A named mix of equal shares is also an even split of its stocks; name it by the mix.
  const matches = options.filter((o) => !o.locked && sameChoice(addresses, percents, o.choice));
  const active = matches.find((o) => o.mix.weights !== null) ?? matches[0];
  const lockedNotes = options.filter((o) => o.locked && o.lockNote);
  return (
    <div className="starter-mixes">
      <div className="starter-mix-row" role="group" aria-label={t('Starter mixes')}>
        {options.map(({ mix, choice, locked, lockNote }) => (
          <button
            key={mix.id}
            type="button"
            className={'starter-mix' + (active?.mix.id === mix.id ? ' starter-mix--active' : '') + (locked ? ' starter-mix--locked' : '')}
            aria-pressed={active?.mix.id === mix.id}
            data-testid={`starter-mix-${mix.id}`}
            data-locked={locked ? 'true' : undefined}
            disabled={locked}
            title={locked && lockNote ? t(lockNote) : t(mix.note)}
            onClick={() => onPick(choice)}
          >
            {locked ? <span aria-hidden="true">🔒 </span> : null}
            {t(mix.label)}
          </button>
        ))}
      </div>
      <p className="fine-print starter-mix-note" aria-live="polite">
        {active ? `${t(active.mix.note)} ` : ''}
        {t('Starter mixes are examples to start from, not advice.')}
      </p>
      {lockedNotes.map(({ mix, lockNote }) => (
        <p key={mix.id} className="fine-print starter-mix-note starter-mix-lock-note" data-testid={`starter-mix-lock-${mix.id}`}>
          <span aria-hidden="true">🔒 </span>
          {t('{label}: {note}', { label: t(mix.label), note: t(lockNote!) })}
        </p>
      ))}
    </div>
  );
}

/** Running total of the picked stocks' percentages. */
export function AllocationTotal({ selected, percents }: { selected: MixToken[]; percents: Record<string, string> }) {
  const total = selected.reduce((n, s) => n + (Number(percents[s.address] ?? 0) || 0), 0);
  return (
    <p className={'starter-mix-total' + (total === 100 ? ' starter-mix-total--ok' : '')} data-testid="allocation-total">
      {total === 100 ? t('Total {total}%', { total }) : t('Total {total}% of 100%', { total })}
    </p>
  );
}
