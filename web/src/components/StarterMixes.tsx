/**
 * One-tap starting points for a sprout's stock mix. Planting asked parents to
 * type four percentages that add up to exactly 100, which is where most of
 * them stalled. These fill the fields in; every value stays editable.
 *
 * A mix only appears when every stock it names is admitted on this chain, so
 * the local demo (two mock tokens) only offers the even split.
 */

import { t } from '../i18n';

interface MixToken {
  symbol: string;
  address: string;
}

interface StarterMix {
  id: string;
  label: string;
  note: string;
  /** Whole percentages by ticker, totalling 100; null means an even split. */
  weights: Record<string, number> | null;
}

export const STARTER_MIXES: StarterMix[] = [
  { id: 'even', label: 'Even split', note: 'The same share of each stock.', weights: null },
  {
    id: 'index',
    label: 'Mostly the S&P 500',
    note: '70% SPY, which follows 500 large US companies; the rest split across Apple, NVIDIA and Microsoft.',
    weights: { SPY: 70, AAPL: 10, NVDA: 10, MSFT: 10 },
  },
  {
    id: 'companies',
    label: 'Just the companies',
    note: 'Apple, NVIDIA and Microsoft, and no index fund.',
    weights: { AAPL: 34, NVDA: 33, MSFT: 33, SPY: 0 },
  },
];

/** Field values (by token address) for a mix, or null if the mix does not fit these tokens. */
export function mixPercents(mix: StarterMix, tokens: MixToken[]): Record<string, string> | null {
  if (tokens.length === 0) return null;
  if (mix.weights === null) {
    const base = Math.floor(100 / tokens.length);
    const extra = 100 - base * tokens.length;
    return Object.fromEntries(tokens.map((t, i) => [t.address, String(base + (i < extra ? 1 : 0))]));
  }
  const weights = mix.weights;
  const symbols = new Set(tokens.map((t) => t.symbol));
  // Every named stock must exist here, and no admitted stock may be left unaccounted for.
  if (Object.keys(weights).some((s) => !symbols.has(s)) || tokens.some((t) => weights[t.symbol] === undefined)) return null;
  return Object.fromEntries(tokens.map((t) => [t.address, String(weights[t.symbol] ?? 0)]));
}

function samePercents(a: Record<string, string>, b: Record<string, string>): boolean {
  return Object.keys(b).every((k) => Number(a[k] ?? 0) === Number(b[k]));
}

export function StarterMixPicker({
  tokens,
  percents,
  onPick,
}: {
  tokens: MixToken[];
  percents: Record<string, string>;
  onPick: (percents: Record<string, string>) => void;
}) {
  const options = STARTER_MIXES.map((mix) => ({ mix, values: mixPercents(mix, tokens) })).filter(
    (o): o is { mix: StarterMix; values: Record<string, string> } => o.values !== null,
  );
  if (options.length === 0) return null;
  const total = tokens.reduce((n, t) => n + (Number(percents[t.address] ?? 0) || 0), 0);
  const active = options.find((o) => samePercents(percents, o.values));
  return (
    <div className="starter-mixes">
      <div className="starter-mix-row" role="group" aria-label={t('Starter mixes')}>
        {options.map(({ mix, values }) => (
          <button
            key={mix.id}
            type="button"
            className={'starter-mix' + (active?.mix.id === mix.id ? ' starter-mix--active' : '')}
            aria-pressed={active?.mix.id === mix.id}
            data-testid={`starter-mix-${mix.id}`}
            title={t(mix.note)}
            onClick={() => onPick(values)}
          >
            {t(mix.label)}
          </button>
        ))}
      </div>
      <p className="fine-print starter-mix-note" aria-live="polite">
        {active ? `${t(active.mix.note)} ` : ''}
        {t('Starter mixes are examples to start from, not advice.')}
      </p>
      <p className={'starter-mix-total' + (total === 100 ? ' starter-mix-total--ok' : '')} data-testid="allocation-total">
        {total === 100 ? t('Total {total}%', { total }) : t('Total {total}% of 100%', { total })}
      </p>
    </div>
  );
}
