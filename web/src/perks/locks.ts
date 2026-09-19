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

/**
 * Holder-only one-tap mixes, different from the free starter mixes (Big tech,
 * Space & future, The whole market, Chips, Mostly the S&P 500). At most five
 * stocks each (a sprout holds five).
 */
export const HOLDER_BOUQUETS: HolderBouquet[] = [
  { id: 'moonshots', label: 'Moonshots', note: 'Tesla, SpaceX, Palantir, AMD and Micron. Bigger swings, both ways.', weights: { TSLA: 25, SPCX: 25, PLTR: 20, AMD: 15, MU: 15 }, tier: 'seedling' },
  { id: 'ai-builders', label: 'AI Builders', note: 'The companies building AI: NVIDIA, Palantir, Microsoft, Meta and TSMC.', weights: { NVDA: 30, PLTR: 20, MSFT: 20, META: 15, TSM: 15 }, tier: 'seedling' },
  { id: 'brands', label: 'Brands They Know', note: 'Apple, Amazon, Tesla, Meta and Google: names a kid already knows.', weights: { AAPL: 25, AMZN: 25, TSLA: 20, META: 15, GOOGL: 15 }, tier: 'seedling' },
  { id: 'silver-lining', label: 'Silver Lining', note: 'Silver next to the S&P 500 and the Nasdaq-100.', weights: { SLV: 40, SPY: 40, QQQ: 20 }, tier: 'seedling' },
];

/** Bouquets in the shape the mix row takes, with a lock for wallets below the bouquet's tier. */
export function holderBouquets(holder: Holder, availableSymbols: readonly string[]) {
  if (!holder.perks?.enabled) return [];
  const have = new Set(availableSymbols.map((s) => s.toUpperCase()));
  let explained = false;
  return HOLDER_BOUQUETS.filter((b) => Object.keys(b.weights).every((s) => have.has(s))).map((b) => {
    const locked = !tierAtLeast(holder.status?.tier, b.tier);
    // One line explains the locks; the rest keep their own description as a tooltip.
    const explain = locked && !explained;
    if (explain) explained = true;
    return {
      id: `bouquet-${b.id}`,
      label: `💐 ${t(b.label)}`,
      note: `${t(b.note)} ${t('Examples, not advice.')}`,
      weights: b.weights,
      locked,
      lockNote: explain ? t('Bouquets marked 💐 are for SPROUT holders ({tier} and up).', { tier: tierLabel(b.tier) }) : undefined,
    };
  });
}
