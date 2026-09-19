/**
 * Sprout baskets: every named starter mix and every holder bouquet, shown as
 * an ETF-style factsheet in the stock guide. The mixes stay defined where the
 * stock picker reads them (STARTER_MIXES, HOLDER_BOUQUETS); nothing is copied.
 *
 * Fields are read generically so mixes added later show up on their own: `id`,
 * `label`, `note` and `weights` always; `code` (ticker-style, e.g. SPRT-CHIPS),
 * `theme` and `tier` when a mix has them. Without a code, the label is the name.
 */

import { STARTER_MIXES } from '../components/StarterMixes';
import { HOLDER_BOUQUETS } from '../perks/locks';
import { THEMES, profileOf, type ThemeId } from './profiles';

export interface Basket {
  id: string;
  /** Ticker-style code when the mix has one. */
  code: string | null;
  /** English source text. */
  label: string;
  note: string;
  /** Whole percentages by ticker, largest first. */
  weights: Array<{ symbol: string; weight: number }>;
  /** The mix's own theme, as written there (English source text or a theme id). */
  theme: string | null;
  /** Holder tier needed to pick it (holder bouquets). */
  tier: string | null;
  source: 'starter' | 'holder';
}

export type MixLike = { id: string; label: string; note: string; weights: Record<string, number> | null; code?: unknown; theme?: unknown; tier?: unknown };

const text = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim() : null);

/** A mix as a basket, or null for one without fixed weights (the even split). */
export function basketFromMix(mix: MixLike, source: Basket['source']): Basket | null {
  if (!mix.weights) return null;
  const weights = Object.entries(mix.weights)
    .map(([symbol, weight]) => ({ symbol: symbol.toUpperCase(), weight }))
    .filter((w) => w.weight > 0)
    .sort((a, b) => b.weight - a.weight);
  if (weights.length === 0) return null;
  return { id: mix.id, code: text(mix.code), label: mix.label, note: mix.note, weights, theme: text(mix.theme), tier: text(mix.tier), source };
}

export function allBaskets(): Basket[] {
  const out: Basket[] = [];
  for (const mix of STARTER_MIXES as unknown as MixLike[]) {
    const b = basketFromMix(mix, 'starter');
    if (b) out.push(b);
  }
  for (const mix of HOLDER_BOUQUETS as unknown as MixLike[]) {
    const b = basketFromMix(mix, 'holder');
    if (b) out.push(b);
  }
  // Ids are unique within each list; a later list could reuse one, so keep the first.
  return out.filter((b, i) => out.findIndex((o) => o.id === b.id) === i);
}

export function findBasket(id: string): Basket | null {
  const key = decodeURIComponent(id).toLowerCase();
  return allBaskets().find((b) => b.id.toLowerCase() === key || b.code?.toLowerCase() === key) ?? null;
}

/** Baskets that hold a ticker, with its weight in each. */
export function basketsWith(symbol: string): Array<{ basket: Basket; weight: number }> {
  const key = symbol.toUpperCase();
  return allBaskets().flatMap((basket) => {
    const w = basket.weights.find((x) => x.symbol === key);
    return w ? [{ basket, weight: w.weight }] : [];
  });
}

/**
 * The theme to show: the mix's own, matched to a guide theme when it names one
 * (by id or label); otherwise the theme holding the most weight, if it holds
 * at least half.
 */
export function basketTheme(basket: Basket): { themeId: ThemeId | null; text: string } | null {
  if (basket.theme) {
    const raw = basket.theme.toLowerCase();
    const match = Object.values(THEMES).find((t) => t.id === raw || t.label.toLowerCase() === raw);
    return match ? { themeId: match.id, text: match.label } : { themeId: null, text: basket.theme };
  }
  const byTheme = new Map<ThemeId, number>();
  const total = basket.weights.reduce((n, w) => n + w.weight, 0);
  for (const w of basket.weights) {
    const profile = profileOf(w.symbol);
    if (profile) byTheme.set(profile.theme, (byTheme.get(profile.theme) ?? 0) + w.weight / total);
  }
  const top = [...byTheme].sort((a, b) => b[1] - a[1])[0];
  if (!top || top[1] < 0.5) return null;
  return { themeId: top[0], text: THEMES[top[0]].label };
}
