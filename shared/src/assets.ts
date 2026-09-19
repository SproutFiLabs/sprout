/**
 * Which admitted assets are crypto coins rather than stock tokens.
 *
 * Stock token price feeds go quiet when US markets close (weekends and
 * holidays), so a stale stock price usually just means "wait for Monday".
 * Crypto feeds update around the clock, so the same wording would be wrong for
 * them; server and web both ask here which kind a ticker is.
 *
 * Keyed by the Sprout ticker (SPROUT_STOCK_TOKENS / config/stocks.json), which
 * is upper case: WETH is wrapped ether, CBBTC is Coinbase's wrapped Bitcoin
 * (cbBTC). Circle (CRCL) is a company's stock token, not a coin.
 */
export const CRYPTO_SYMBOLS: readonly string[] = ['WETH', 'CBBTC'];

export function isCryptoSymbol(symbol: string | null | undefined): boolean {
  return typeof symbol === 'string' && CRYPTO_SYMBOLS.includes(symbol.trim().toUpperCase());
}
