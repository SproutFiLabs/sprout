/**
 * What each asset a sprout can hold is, for the stock guide and the
 * diversification meter: a single company or a fund, the theme it belongs to,
 * and roughly how many companies one token spreads across.
 *
 * This is the one place themes are tagged. Text is English source text,
 * translated with t() where it is shown (Chinese in i18n/zh/stocks-guide.ts;
 * web/test/stock-guide.test.ts checks every entry and every configured stock).
 */

export type AssetKind = 'company' | 'index-fund' | 'commodity-fund';

export type ThemeId =
  | 'broad-market'
  | 'tech-index'
  | 'big-tech'
  | 'chips'
  | 'software'
  | 'space-ev'
  | 'china'
  | 'retail-meme'
  | 'commodities';

export interface Theme {
  id: ThemeId;
  /** Heading form: "Big tech". */
  label: string;
  /** Mid-sentence form: "Mostly one theme: big tech." */
  lower: string;
  /** Counts toward "mostly tech" in the diversification meter. */
  tech: boolean;
}

export const THEMES: Record<ThemeId, Theme> = {
  'broad-market': { id: 'broad-market', label: 'Broad market', lower: 'the broad market', tech: false },
  'tech-index': { id: 'tech-index', label: 'Tech-heavy index', lower: 'a tech-heavy index', tech: false },
  'big-tech': { id: 'big-tech', label: 'Big tech', lower: 'big tech', tech: true },
  chips: { id: 'chips', label: 'Chips', lower: 'chips', tech: true },
  software: { id: 'software', label: 'Software & data', lower: 'software and data', tech: true },
  'space-ev': { id: 'space-ev', label: 'Space & EV', lower: 'space and electric cars', tech: false },
  china: { id: 'china', label: 'China', lower: 'China', tech: false },
  'retail-meme': { id: 'retail-meme', label: 'Retail & meme stocks', lower: 'retail and meme stocks', tech: false },
  commodities: { id: 'commodities', label: 'Commodities', lower: 'commodities', tech: false },
};

export interface AssetProfile {
  kind: AssetKind;
  theme: ThemeId;
  /**
   * About how many companies one token spreads across: 1 for a company (and
   * for a commodity fund, which holds one commodity, not companies).
   */
  companies: number;
}

export const PROFILES: Record<string, AssetProfile> = {
  SPY: { kind: 'index-fund', theme: 'broad-market', companies: 500 },
  QQQ: { kind: 'index-fund', theme: 'tech-index', companies: 100 },

  AAPL: { kind: 'company', theme: 'big-tech', companies: 1 },
  MSFT: { kind: 'company', theme: 'big-tech', companies: 1 },
  GOOGL: { kind: 'company', theme: 'big-tech', companies: 1 },
  AMZN: { kind: 'company', theme: 'big-tech', companies: 1 },
  META: { kind: 'company', theme: 'big-tech', companies: 1 },

  NVDA: { kind: 'company', theme: 'chips', companies: 1 },
  AMD: { kind: 'company', theme: 'chips', companies: 1 },
  TSM: { kind: 'company', theme: 'chips', companies: 1 },
  ASML: { kind: 'company', theme: 'chips', companies: 1 },
  MU: { kind: 'company', theme: 'chips', companies: 1 },
  INTC: { kind: 'company', theme: 'chips', companies: 1 },
  SNDK: { kind: 'company', theme: 'chips', companies: 1 },

  PLTR: { kind: 'company', theme: 'software', companies: 1 },

  TSLA: { kind: 'company', theme: 'space-ev', companies: 1 },
  SPCX: { kind: 'company', theme: 'space-ev', companies: 1 },

  BABA: { kind: 'company', theme: 'china', companies: 1 },

  GME: { kind: 'company', theme: 'retail-meme', companies: 1 },

  SLV: { kind: 'commodity-fund', theme: 'commodities', companies: 1 },
  USO: { kind: 'commodity-fund', theme: 'commodities', companies: 1 },
};

export const KIND_LABEL: Record<AssetKind, string> = {
  company: 'Single company',
  'index-fund': 'Index fund',
  'commodity-fund': 'Commodity fund',
};

/** The guide's group headings and one-line introductions. */
export const KIND_HEADING: Record<AssetKind, string> = {
  company: 'Company stocks',
  'index-fund': 'Index funds',
  'commodity-fund': 'Commodity funds',
};

export const KIND_INTRO: Record<AssetKind, string> = {
  company: 'A piece of one company. When that company has a great year or a hard one, you feel all of it.',
  'index-fund': 'One token that holds many companies at once.',
  'commodity-fund': 'One token that follows the price of one raw material.',
};

/** Display order of the guide's groups. */
export const KIND_ORDER: readonly AssetKind[] = ['company', 'index-fund', 'commodity-fund'];

export function profileOf(symbol: string): AssetProfile | null {
  return PROFILES[symbol.trim().toUpperCase()] ?? null;
}

export function themeOf(symbol: string): Theme | null {
  const profile = profileOf(symbol);
  return profile ? THEMES[profile.theme] : null;
}
