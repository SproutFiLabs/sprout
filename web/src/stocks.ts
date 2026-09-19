/**
 * Friendly names for the stock tokens Sprout can hold, keyed by ticker.
 *
 * Tickers are how the chain and the server name a token; parents and kids know
 * the company. Everything that shows a ticker to a person reads its name and a
 * one-line description from here. The text is English source text: translate
 * it with t() where it is shown (the Chinese lives in i18n/zh/components.ts,
 * and web/test/stocks.test.ts checks every entry has one).
 *
 * A ticker that is not listed here (the local demo's mock tokens, or a token
 * added to the config before this file) falls back to the ticker itself.
 */

import { t } from './i18n';

/** Most stocks one sprout can hold (SproutVault.MAX_ASSETS). */
export const MAX_STOCKS = 5;

export type StockCategory = 'Whole market' | 'Tech' | 'Space & future' | 'Chips' | 'Crypto' | 'Commodities' | 'Cash-like' | 'Fun' | 'Other';

/** Display order of the groups in the stock picker. */
export const STOCK_CATEGORIES: readonly StockCategory[] = ['Whole market', 'Tech', 'Space & future', 'Chips', 'Crypto', 'Commodities', 'Cash-like', 'Fun', 'Other'];

/**
 * The newest assets (the third factory's batch). Sprouts planted before they
 * were added cannot hold them: a factory's admitted list never changes.
 */
export const NEWEST_SYMBOLS: readonly string[] = ['WETH', 'CBBTC', 'CRCL', 'SGOV'];

export interface StockInfo {
  symbol: string;
  /** Short everyday name: "Apple", "SpaceX", "S&P 500". */
  name: string;
  /** One plain line on what it is. Empty for an unknown ticker. */
  description: string;
  category: StockCategory;
  /**
   * How the kid view finishes "a little piece of …" when the name alone would
   * read oddly (a fund, not a company). Defaults to `name`.
   */
  kidName?: string;
}

type Entry = Omit<StockInfo, 'symbol'>;

const CATALOGUE: Record<string, Entry> = {
  SPY: { name: 'S&P 500', description: '500 big US companies in one fund', category: 'Whole market', kidName: '500 big US companies' },
  QQQ: { name: 'Nasdaq-100', description: '100 big tech-heavy companies', category: 'Whole market', kidName: '100 big tech-heavy companies' },

  AAPL: { name: 'Apple', description: 'iPhone, Mac and the App Store', category: 'Tech' },
  MSFT: { name: 'Microsoft', description: 'Windows, Office and cloud computing', category: 'Tech' },
  GOOGL: { name: 'Google', description: 'Search, YouTube and Android', category: 'Tech' },
  AMZN: { name: 'Amazon', description: 'Online shopping and cloud computing', category: 'Tech' },
  META: { name: 'Meta', description: 'Facebook, Instagram and WhatsApp', category: 'Tech' },
  BABA: { name: 'Alibaba', description: 'Online shopping and cloud in China', category: 'Tech' },

  SPCX: { name: 'SpaceX', description: 'Rockets and Starlink internet', category: 'Space & future' },
  TSLA: { name: 'Tesla', description: 'Electric cars and batteries', category: 'Space & future' },
  PLTR: { name: 'Palantir', description: 'Software that makes sense of data', category: 'Space & future' },

  NVDA: { name: 'NVIDIA', description: 'Chips for games and AI', category: 'Chips' },
  AMD: { name: 'AMD', description: 'Computer and graphics chips', category: 'Chips' },
  TSM: { name: 'TSMC', description: 'Makes chips for Apple, NVIDIA and more', category: 'Chips' },
  ASML: { name: 'ASML', description: 'The machines that make chips', category: 'Chips' },
  MU: { name: 'Micron', description: 'Memory chips', category: 'Chips' },
  INTC: { name: 'Intel', description: 'Processors inside many computers', category: 'Chips' },
  SNDK: { name: 'Sandisk', description: 'Flash storage and memory cards', category: 'Chips' },

  SLV: { name: 'Silver', description: 'A fund that follows the price of silver', category: 'Commodities', kidName: 'a silver fund' },
  USO: { name: 'Oil', description: 'A fund that follows the price of oil', category: 'Commodities', kidName: 'an oil fund' },

  // Crypto: WETH and CBBTC are coins (held as tokens on Robinhood Chain); Circle is a company's stock token.
  WETH: { name: 'Ethereum', description: 'Ether, the coin of the Ethereum network', category: 'Crypto' },
  CBBTC: { name: 'Bitcoin', description: 'Bitcoin, held as Coinbase’s cbBTC token', category: 'Crypto' },
  CRCL: { name: 'Circle', description: 'The company behind the USDC digital dollar', category: 'Crypto' },

  SGOV: { name: 'US Treasury bills', description: 'A fund of short-term loans to the US government', category: 'Cash-like', kidName: 'a fund that lends to the US government' },

  GME: { name: 'GameStop', description: 'Video game shops', category: 'Fun' },
};

/** Every ticker the catalogue knows, in picker order. */
export const KNOWN_SYMBOLS: readonly string[] = STOCK_CATEGORIES.flatMap((c) =>
  Object.entries(CATALOGUE)
    .filter(([, e]) => e.category === c)
    .map(([symbol]) => symbol),
);

/** Whether the catalogue has a name and description for this ticker. */
export function isKnownStock(symbol: string): boolean {
  return CATALOGUE[symbol.trim().toUpperCase()] !== undefined;
}

/** The catalogue entry for a ticker; an unknown ticker is its own name. */
export function stockInfo(symbol: string): StockInfo {
  const key = symbol.trim().toUpperCase();
  const entry = CATALOGUE[key];
  if (entry) return { symbol: key, ...entry };
  return { symbol, name: symbol, description: '', category: 'Other' };
}

/** English name for a known ticker, else null. */
export function stockName(symbol: string): string | null {
  return isKnownStock(symbol) ? stockInfo(symbol).name : null;
}

/**
 * The name as shown beside the ticker (translated), or null when it would just
 * repeat the ticker (AMD in English) or the ticker is unknown.
 */
export function displayName(symbol: string): string | null {
  const name = stockName(symbol);
  if (!name) return null;
  const shown = t(name);
  return shown === symbol ? null : shown;
}

/** The one-line description as shown (translated), or null for an unknown ticker. */
export function displayDescription(symbol: string): string | null {
  const { description } = stockInfo(symbol);
  return description ? t(description) : null;
}

/** "Apple (AAPL)" for a known ticker, else just the ticker. */
export function displayLabel(symbol: string): string {
  const name = displayName(symbol);
  return name ? t('{name} ({symbol})', { name, symbol }) : symbol;
}

/** Case-insensitive match on ticker, name, description or group, in English and as shown. */
export function stockMatches(symbol: string, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  const info = stockInfo(symbol);
  const texts = isKnownStock(symbol)
    ? [info.symbol, info.name, t(info.name), info.description, t(info.description), info.category, t(info.category)]
    : [info.symbol];
  return texts.some((s) => s.toLowerCase().includes(q));
}
