import { t } from '../i18n';
import { dateLocale } from '../i18n';
import { tierAtLeast, tierLabel, type Holder, type TierId } from './holder';

/**
 * What a holder tier unlocks inside the stock picker. These are app-side
 * locks: the factory admits every stock for anyone who calls it directly.
 */

export interface StockLock {
  locked: boolean;
  note?: string;
}

/** First dibs: stocks in early access are locked below the early-access tier until the date passes. */
export function stockLockFor(holder: Holder, nowMs: number = Date.now()): (symbol: string) => StockLock {
  const early = holder.perks?.enabled ? holder.perks.earlyAccess : null;
  const open = !early || early.until === null || nowMs >= early.until * 1000;
  return (raw) => {
    const symbol = raw.toUpperCase();
    if (open || !early!.symbols.includes(symbol)) return { locked: false };
    if (tierAtLeast(holder.status?.tier, early!.tier)) return { locked: false };
    const date = new Date(early!.until! * 1000).toLocaleDateString(dateLocale(), { month: 'short', day: 'numeric' });
    return { locked: true, note: t('SPROUT holders ({tier} and up) get {symbol} first, until {date}.', { tier: tierLabel(early!.tier), symbol, date }) };
  };
}

export interface HolderBouquet {
  id: string;
  label: string;
  note: string;
  weights: Record<string, number>;
  tier: TierId;
}

/** Holder-only one-tap mixes. At most five stocks each (a sprout holds five). */
export const HOLDER_BOUQUETS: HolderBouquet[] = [
  { id: 'space-ai', label: 'Space & AI', note: 'SpaceX, NVIDIA and Palantir.', weights: { SPCX: 40, NVDA: 30, PLTR: 30 }, tier: 'seedling' },
  { id: 'big-tech', label: 'Big Tech', note: 'Apple, Microsoft, NVIDIA, Amazon and Google, evenly.', weights: { AAPL: 20, MSFT: 20, NVDA: 20, AMZN: 20, GOOGL: 20 }, tier: 'seedling' },
  { id: 'chips', label: 'The Chip Garden', note: 'The companies that make the chips: NVIDIA, AMD, TSMC, Micron and ASML.', weights: { NVDA: 30, AMD: 20, TSM: 20, MU: 15, ASML: 15 }, tier: 'seedling' },
  { id: 'moonshots', label: 'Moonshots', note: 'Tesla, SpaceX, Palantir and AMD. Bigger swings, both ways.', weights: { TSLA: 25, SPCX: 25, PLTR: 25, AMD: 25 }, tier: 'seedling' },
  { id: 'steady', label: 'Steady Roots', note: 'The S&P 500 and the Nasdaq-100, for a broad start.', weights: { SPY: 60, QQQ: 40 }, tier: 'seedling' },
];

/** Bouquets in the shape the mix row takes, with a lock for wallets below the bouquet's tier. */
export function holderBouquets(holder: Holder, availableSymbols: readonly string[]) {
  if (!holder.perks?.enabled) return [];
  const have = new Set(availableSymbols.map((s) => s.toUpperCase()));
  return HOLDER_BOUQUETS.filter((b) => Object.keys(b.weights).every((s) => have.has(s))).map((b) => {
    const locked = !tierAtLeast(holder.status?.tier, b.tier);
    return {
      id: `bouquet-${b.id}`,
      label: `💐 ${t(b.label)}`,
      note: `${t(b.note)} ${t('Examples, not advice.')}`,
      weights: b.weights,
      locked,
      lockNote: locked ? t('A holder bouquet: hold SPROUT ({tier}) to use it.', { tier: tierLabel(b.tier) }) : undefined,
    };
  });
}
