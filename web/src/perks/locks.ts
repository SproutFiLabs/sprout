import { t } from '../i18n';
import { dateLocale } from '../i18n';
import type { BasketTheme, ExtraMix } from '../components/StarterMixes';
import { tierAtLeast, tierLabel, TIER_ORDER, type Holder, type TierId } from './holder';

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
  /** Also the basket's id: its factsheet lives at /stocks/basket/<id>. Unique across STARTER_MIXES too. */
  id: string;
  label: string;
  note: string;
  weights: Record<string, number>;
  /** The lowest tier that unlocks it. Every tier adds baskets of its own and keeps the ones below. */
  tier: TierId;
  /** Ticker-style basket code shown beside the name ("SPRT-MOON"): unique, uppercase, at most 10 characters. Never translated. */
  code?: string;
  theme?: BasketTheme;
}

/**
 * Holder baskets ("bouquets" in the code): holder-only one-tap mixes, different
 * from the free starter mixes (Big tech, Space & future, The whole market, Chips,
 * Mostly the S&P 500, Spread out). Like the starter mixes, they are ETF-style
 * bundles of the admitted stocks. At most five stocks each (a sprout holds
 * five), whole percentages totalling 100. A note says plainly when a basket
 * swings more than most; none promises a return.
 */
export const HOLDER_BOUQUETS: HolderBouquet[] = [
  { id: 'moonshots', label: 'Moonshots', note: 'Tesla, SpaceX, Palantir, AMD and Micron. Bigger swings, both ways.', weights: { TSLA: 25, SPCX: 25, PLTR: 20, AMD: 15, MU: 15 }, tier: 'seedling', code: 'SPRT-MOON', theme: 'Innovation' },
  { id: 'ai-builders', label: 'AI Builders', note: 'The companies building AI: NVIDIA, Palantir, Microsoft, Meta and TSMC.', weights: { NVDA: 30, PLTR: 20, MSFT: 20, META: 15, TSM: 15 }, tier: 'seedling', code: 'SPRT-AI', theme: 'AI' },
  { id: 'brands', label: 'Brands They Know', note: 'Apple, Amazon, Tesla, Meta and Google: names a kid already knows.', weights: { AAPL: 25, AMZN: 25, TSLA: 20, META: 15, GOOGL: 15 }, tier: 'seedling', code: 'SPRT-BRAND', theme: 'Brands' },
  { id: 'crypto-circle', label: 'Crypto & Circle', note: 'Bitcoin, Ethereum and Circle, the company behind the USDC digital dollar. All three tend to rise and fall with crypto, and can swing hard.', weights: { CBBTC: 40, WETH: 30, CRCL: 30 }, tier: 'seedling', code: 'SPRT-COIN', theme: 'Crypto' },
  { id: 'silver-lining', label: 'Silver Lining', note: 'Silver next to the S&P 500 and the Nasdaq-100.', weights: { SLV: 40, SPY: 40, QQQ: 20 }, tier: 'seedling', code: 'SPRT-SILV', theme: 'Commodities' },
  { id: 'behind-the-chips', label: 'Behind the Chips', note: 'The chip factories, machines and memory: TSMC, ASML, Intel, Micron and Sandisk. Chip stocks often rise and fall together.', weights: { TSM: 25, ASML: 25, MU: 20, INTC: 15, SNDK: 15 }, tier: 'sapling', code: 'SPRT-FAB', theme: 'Chips' },
  { id: 'around-the-world', label: 'Around the World', note: 'TSMC, ASML and Alibaba, big companies based outside the US, next to the S&P 500.', weights: { SPY: 40, TSM: 20, ASML: 20, BABA: 20 }, tier: 'sapling', code: 'SPRT-WORLD', theme: 'Global' },
  { id: 'down-to-earth', label: 'Down to Earth', note: 'Silver and oil next to the S&P 500. Silver and oil prices can jump or drop fast.', weights: { SPY: 50, SLV: 25, USO: 25 }, tier: 'bloom', code: 'SPRT-EARTH', theme: 'Commodities' },
  { id: 'game-on', label: 'Game On', note: 'Microsoft, NVIDIA, AMD, Apple and GameStop: the consoles, chips, app store and shops behind the games kids play. GameStop’s price can swing hard.', weights: { MSFT: 25, NVDA: 25, AMD: 20, AAPL: 15, GME: 15 }, tier: 'bloom', code: 'SPRT-GAME', theme: 'Games' },
  { id: 'deep-roots', label: 'Deep Roots', note: 'Mostly the S&P 500 and the Nasdaq-100, with a little Microsoft, Google and Amazon. It still falls when the market falls.', weights: { SPY: 50, QQQ: 20, MSFT: 10, GOOGL: 10, AMZN: 10 }, tier: 'grove', code: 'SPRT-ROOTS', theme: 'Market' },
  { id: 'wild-card', label: 'Wild Card', note: 'GameStop, SpaceX, Palantir, Sandisk and oil in one mix. Big swings, both ways.', weights: { GME: 25, SPCX: 20, PLTR: 20, SNDK: 20, USO: 15 }, tier: 'grove', code: 'SPRT-WILD', theme: 'Speculative' },
];

/**
 * The tier that unlocks a bouquet on this deployment: its own tier, or the next
 * one up when the server leaves that tier out. Null when no configured tier
 * reaches it, so nobody could ever pick it. Before the tiers load, every tier counts.
 */
export function bouquetTier(bouquet: HolderBouquet, tiers: readonly TierId[]): TierId | null {
  const configured = tiers.length ? tiers : TIER_ORDER;
  return TIER_ORDER.find((id) => configured.includes(id) && tierAtLeast(id, bouquet.tier)) ?? null;
}

/** The bouquets each tier adds, lowest tier first; tiers that add none are left out. */
export function bouquetsByTier(tiers: readonly TierId[]): Array<{ tier: TierId; bouquets: HolderBouquet[] }> {
  return TIER_ORDER.map((tier) => ({ tier, bouquets: HOLDER_BOUQUETS.filter((b) => bouquetTier(b, tiers) === tier) })).filter((g) => g.bouquets.length > 0);
}

/** How many bouquets a wallet at `tier` can pick. */
export function bouquetCount(tier: TierId, tiers: readonly TierId[]): number {
  return HOLDER_BOUQUETS.filter((b) => {
    const unlock = bouquetTier(b, tiers);
    return unlock !== null && tierAtLeast(tier, unlock);
  }).length;
}

/**
 * Bouquets in the shape the mix row takes, with a lock for wallets below the
 * bouquet's tier. Each locked one names the tier it needs; the picker gathers
 * bouquets that share a tier onto one line.
 */
export function holderBouquets(holder: Holder, availableSymbols: readonly string[]): ExtraMix[] {
  if (!holder.perks?.enabled) return [];
  const have = new Set(availableSymbols.map((s) => s.toUpperCase()));
  const tiers = holder.perks.tiers.map((x) => x.id);
  return HOLDER_BOUQUETS.flatMap((b): ExtraMix[] => {
    const tier = bouquetTier(b, tiers);
    if (!tier || !Object.keys(b.weights).every((s) => have.has(s))) return [];
    const locked = !tierAtLeast(holder.status?.tier, tier);
    return [{
      id: `bouquet-${b.id}`,
      label: `💐 ${t(b.label)}`,
      note: `${t(b.note)} ${t('Examples, not advice.')}`,
      weights: b.weights,
      code: b.code,
      theme: b.theme,
      basketId: b.id,
      locked,
      lockNote: locked ? t('For SPROUT holders ({tier} and up).', { tier: tierLabel(tier) }) : undefined,
    }];
  });
}
