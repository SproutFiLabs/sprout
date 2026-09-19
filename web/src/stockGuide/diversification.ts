/**
 * The diversification meter: how spread out a mix is, from "Concentrated" to
 * "Spread out", with one sentence saying why.
 *
 * It describes; it does not judge or advise. The reading comes from three
 * things a parent can check for themselves, in this order:
 *   1. whether a broad index fund is in the mix (SPY holds about 500
 *      companies; QQQ about 100, many of them tech),
 *   2. how much sits in one theme (profiles.ts tags every asset), and
 *   3. how many holdings there are, across how many themes.
 *
 * Shares are the entered percentages, normalised; while nothing is entered
 * yet, every pick counts equally. A mix with a stock the guide doesn't know
 * (the local demo's mock tokens) gets no reading rather than a guess.
 */

import { t } from '../i18n';
import { THEMES, profileOf, type ThemeId } from './profiles';

export interface MixPick {
  symbol: string;
  /** Percent (or any non-negative weight). */
  weight: number;
}

export type SpreadLevel = 0 | 1 | 2 | 3;

/** English source labels, lowest (most concentrated) first. */
export const SPREAD_LABELS: readonly string[] = ['Concentrated', 'Fairly concentrated', 'Fairly spread', 'Spread out'];

/** Thresholds, as shares of the mix. */
export const BROAD_FUND_SHARE = 0.5;
export const ONE_THEME_SHARE = 0.8;
export const MOSTLY_ONE_THEME_SHARE = 0.5;
export const MOSTLY_TECH_SHARE = 0.8;
export const SPREAD_HOLDINGS = 4;
export const SPREAD_THEMES = 3;

export interface SpreadReading {
  level: SpreadLevel;
  /** Why, in one sentence (English source key and its values; see spreadText). */
  reason: string;
  vars: Record<string, string | number>;
  /** Which of `vars` are English source text to translate. */
  textVars?: string[];
  /** The theme holding the biggest share. */
  topTheme: ThemeId;
}

/** Every sentence a reading can give (English source text). */
export const SPREAD_REASONS = {
  spyAlone: 'SPY alone holds about 500 large US companies.',
  spyShare: '{pct}% is in SPY, which holds about 500 large US companies.',
  qqqAlone: 'QQQ alone holds about 100 companies, many of them in tech.',
  qqqShare: '{pct}% is in QQQ, which holds about 100 companies, many of them in tech.',
  oneCommodity: 'Everything follows the price of one commodity.',
  oneCompany: 'Everything is in one company.',
  allOneTheme: 'All in one theme: {theme}.',
  oneTheme: '{pct}% is in one theme: {theme}.',
  allTech: 'All in tech companies: chips, software or big tech.',
  mostlyTech: '{pct}% is in tech companies: chips, software or big tech.',
  across: '{count} holdings across {themes} themes.',
} as const;

const pct = (share: number) => Math.round(share * 100);

export function spreadReading(picks: readonly MixPick[]): SpreadReading | null {
  const entered = picks.filter((p) => p.weight > 0);
  const counted = entered.length > 0 ? entered : picks;
  if (counted.length === 0) return null;
  const profiles = counted.map((p) => profileOf(p.symbol));
  if (profiles.some((p) => p === null)) return null;
  const total = entered.length > 0 ? entered.reduce((n, p) => n + p.weight, 0) : counted.length;
  const shareOf = (i: number) => (entered.length > 0 ? counted[i]!.weight : 1) / total;

  const bySymbol = new Map<string, number>();
  const byTheme = new Map<ThemeId, number>();
  let tech = 0;
  counted.forEach((p, i) => {
    const share = shareOf(i);
    const profile = profiles[i]!;
    const symbol = p.symbol.toUpperCase();
    bySymbol.set(symbol, (bySymbol.get(symbol) ?? 0) + share);
    byTheme.set(profile.theme, (byTheme.get(profile.theme) ?? 0) + share);
    if (THEMES[profile.theme].tech) tech += share;
  });
  const spy = bySymbol.get('SPY') ?? 0;
  const qqq = bySymbol.get('QQQ') ?? 0;
  const [topTheme, topShare] = [...byTheme].sort((a, b) => b[1] - a[1])[0]!;
  const holdings = bySymbol.size;
  const themes = byTheme.size;
  const theme = THEMES[topTheme].lower;
  const reading = (level: SpreadLevel, reason: string, vars: Record<string, string | number> = {}, textVars?: string[]): SpreadReading => ({
    level,
    reason,
    vars,
    textVars,
    topTheme,
  });

  if (spy >= BROAD_FUND_SHARE) {
    return spy >= 0.995
      ? reading(3, SPREAD_REASONS.spyAlone)
      : reading(3, SPREAD_REASONS.spyShare, { pct: pct(spy) });
  }
  if (holdings === 1) {
    const kind = profiles[0]!.kind;
    if (qqq > 0) return reading(2, SPREAD_REASONS.qqqAlone);
    if (kind === 'commodity-fund') return reading(0, SPREAD_REASONS.oneCommodity);
    return reading(0, SPREAD_REASONS.oneCompany);
  }
  if (spy > 0) return reading(2, SPREAD_REASONS.spyShare, { pct: pct(spy) });
  if (qqq >= BROAD_FUND_SHARE) return reading(2, SPREAD_REASONS.qqqShare, { pct: pct(qqq) });
  if (topShare >= 0.995) return reading(0, SPREAD_REASONS.allOneTheme, { theme }, ['theme']);
  if (topShare >= ONE_THEME_SHARE) return reading(0, SPREAD_REASONS.oneTheme, { pct: pct(topShare), theme }, ['theme']);
  if (topShare >= MOSTLY_ONE_THEME_SHARE) return reading(1, SPREAD_REASONS.oneTheme, { pct: pct(topShare), theme }, ['theme']);
  if (tech >= 0.995) return reading(1, SPREAD_REASONS.allTech);
  if (tech >= MOSTLY_TECH_SHARE) return reading(1, SPREAD_REASONS.mostlyTech, { pct: pct(tech) });
  if (holdings >= SPREAD_HOLDINGS && themes >= SPREAD_THEMES) {
    return reading(2, SPREAD_REASONS.across, { count: holdings, themes });
  }
  return reading(1, SPREAD_REASONS.across, { count: holdings, themes });
}

/** The label and sentence, in the page's language. */
export function spreadText(reading: SpreadReading): { label: string; sentence: string } {
  const vars = Object.fromEntries(
    Object.entries(reading.vars).map(([k, v]) => [k, reading.textVars?.includes(k) ? t(String(v)) : v]),
  );
  return { label: t(SPREAD_LABELS[reading.level]!), sentence: t(reading.reason, vars) };
}
