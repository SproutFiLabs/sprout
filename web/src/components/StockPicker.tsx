/**
 * Choosing a sprout's stocks and their shares, used when planting and when a
 * parent edits the mix later.
 *
 * A sprout holds at most five stocks (the vault's MAX_ASSETS), picked from the
 * ones its factory admitted: every configured token for a new sprout; for an
 * older one, the original four (first factory) or the 21 stocks without the
 * crypto batch (second factory). Parents search or browse by theme, pick up to
 * five, then set a percentage for each pick.
 */

import { MarketNotice } from './MarketNotice';
import { useState } from 'react';
import { Check, Search, X } from 'lucide-react';
import { t } from '../i18n';
import { KNOWN_SYMBOLS, MAX_STOCKS, STOCK_CATEGORIES, displayDescription, displayName, stockInfo, stockMatches } from '../stocks';
import { AllocationTotal, StarterMixPicker, type ExtraMix, type MixToken, type StockLock } from './StarterMixes';
import { DiversificationMeter } from '../stockGuide/DiversificationMeter';

export { MAX_STOCKS };
export type { ExtraMix, StockLock };

export interface StockMix {
  /** Picked token addresses, in the order they were picked. */
  selected: string[];
  /** Percent field values by token address. */
  percents: Record<string, string>;
}

const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();

/**
 * What starts picked. With five or fewer stocks to choose from there is
 * nothing to choose, so all of them are (the local demo's two mock tokens,
 * and older sprouts' four). Otherwise the sprout's current stocks, if any.
 */
export function initialPicks(candidates: MixToken[], current: string[] = []): string[] {
  if (candidates.length <= MAX_STOCKS) return candidates.map((c) => c.address);
  return current.filter((a) => candidates.some((c) => same(c.address, a))).slice(0, MAX_STOCKS);
}

/** The picked tokens, in pick order, limited to the candidates. */
export function pickedTokens(candidates: MixToken[], selected: string[]): MixToken[] {
  return selected.flatMap((a) => candidates.filter((c) => same(c.address, a)).slice(0, 1));
}

/**
 * How one stock in the picker behaves. A locked stock can't be picked, and
 * shows its lock note instead of its description; one that is already picked
 * stays clickable, but only to remove it. Past the five-stock limit, only
 * picked stocks stay clickable.
 */
export function pickAvailability(
  symbol: string,
  picked: boolean,
  atMax: boolean,
  stockLock?: StockLock,
): { locked: boolean; note: string | null; disabled: boolean } {
  const lock = stockLock?.(symbol) ?? { locked: false };
  return { locked: lock.locked, note: lock.locked ? (lock.note ?? null) : null, disabled: !picked && (atMax || lock.locked) };
}

function catalogueOrder(symbol: string): number {
  const i = KNOWN_SYMBOLS.indexOf(symbol.toUpperCase());
  return i === -1 ? Number.MAX_SAFE_INTEGER : i;
}

export function StockMixEditor({
  candidates,
  value,
  onChange,
  weightTestId,
  stockLock,
  extraMixes,
}: {
  /** Stocks this sprout may hold. */
  candidates: MixToken[];
  value: StockMix;
  onChange: (next: StockMix) => void;
  /** Test id for a picked stock's percent field (plant-weight-AAPL, allocation-AAPL). */
  weightTestId: (symbol: string) => string;
  /** Stocks that can't be picked right now (and why). Default: nothing is locked. */
  stockLock?: StockLock;
  /** Starter mixes offered after the built-in ones. */
  extraMixes?: ExtraMix[];
}) {
  const [query, setQuery] = useState('');
  const picked = pickedTokens(candidates, value.selected);
  const isPicked = (token: MixToken) => picked.some((p) => same(p.address, token.address));
  const atMax = picked.length >= MAX_STOCKS;

  const toggle = (token: MixToken) => {
    if (isPicked(token)) {
      const percents = { ...value.percents };
      delete percents[token.address];
      onChange({ selected: picked.filter((p) => !same(p.address, token.address)).map((p) => p.address), percents });
    } else if (!pickAvailability(token.symbol, false, atMax, stockLock).disabled) {
      onChange({ selected: [...picked.map((p) => p.address), token.address], percents: value.percents });
    }
  };

  const ordered = candidates
    .map((token, index) => ({ token, index }))
    .sort((a, b) => catalogueOrder(a.token.symbol) - catalogueOrder(b.token.symbol) || a.index - b.index)
    .map((o) => o.token);
  const groups = STOCK_CATEGORIES.map((category) => ({
    category,
    tokens: ordered.filter((token) => stockInfo(token.symbol).category === category && stockMatches(token.symbol, query)),
  })).filter((g) => g.tokens.length > 0);
  const showHeadings = new Set(candidates.map((c) => stockInfo(c.symbol).category)).size > 1;

  return (
    <div className="stock-mix-editor">
      <MarketNotice />
      <StarterMixPicker
        admitted={candidates}
        selected={picked}
        percents={value.percents}
        onPick={(choice) => onChange({ selected: choice.selected, percents: choice.percents })}
        extraMixes={extraMixes}
        stockLock={stockLock}
      />

      <div className="stock-picker">
        <div className="stock-picker-head">
          <b>{t('Pick up to {max} stocks', { max: MAX_STOCKS })}</b>
          <span className="fine-print" data-testid="stock-pick-count">{t('{count} of {max} picked', { count: picked.length, max: MAX_STOCKS })}</span>
          <a className="stock-picker-guide" href="/stocks" target="_blank" rel="noopener noreferrer" data-testid="stock-guide-link">{t('What are these?')}</a>
        </div>
        <div className="stock-search">
          <Search size={15} aria-hidden />
          <input
            type="search"
            data-testid="stock-search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t('Search by name or ticker')}
            aria-label={t('Search stocks')}
            autoComplete="off"
          />
        </div>
        <div className="stock-picker-groups">
          {groups.map((group) => (
            <section key={group.category} className="stock-picker-group" aria-label={t(group.category)}>
              {showHeadings ? <h3>{t(group.category)}</h3> : null}
              <div className="stock-picker-grid">
                {group.tokens.map((token) => {
                  const on = isPicked(token);
                  const name = displayName(token.symbol);
                  const lock = pickAvailability(token.symbol, on, atMax, stockLock);
                  const description = lock.note ? t(lock.note) : displayDescription(token.symbol);
                  return (
                    <button
                      key={token.address}
                      type="button"
                      className={'stock-pick' + (on ? ' stock-pick--on' : '') + (lock.locked ? ' stock-pick--locked' : '')}
                      data-testid={`stock-pick-${token.symbol}`}
                      data-locked={lock.locked ? 'true' : undefined}
                      aria-pressed={on}
                      disabled={lock.disabled}
                      title={lock.note ? t(lock.note) : undefined}
                      onClick={() => toggle(token)}
                    >
                      <span className="stock-pick-top">
                        <b>{token.symbol}</b>
                        {lock.locked ? <span aria-hidden="true">🔒</span> : on ? <Check size={14} aria-hidden /> : null}
                      </span>
                      {name ? <span className="stock-pick-name">{name}</span> : null}
                      {description ? <small>{description}</small> : null}
                    </button>
                  );
                })}
              </div>
            </section>
          ))}
          {groups.length === 0 ? <p className="fine-print">{t('No stocks match “{query}”.', { query: query.trim() })}</p> : null}
        </div>
        {atMax ? (
          <p className="fine-print stock-picker-limit" role="status" data-testid="stock-pick-limit">
            {t('A sprout can hold up to 5 stocks.')}
          </p>
        ) : null}
      </div>

      {picked.map((token) => {
        const name = displayName(token.symbol);
        return (
          <div key={token.address} className="stock-weight">
            <label className="inline">
              <span className="stock-weight-name">
                <b>{token.symbol}</b>
                {name ? <small>{name}</small> : null}
              </span>
              <input
                data-testid={weightTestId(token.symbol)}
                type="number"
                min={0}
                max={100}
                step="1"
                value={value.percents[token.address] ?? '0'}
                onChange={(e) => onChange({ selected: picked.map((p) => p.address), percents: { ...value.percents, [token.address]: e.target.value } })}
              />
            </label>
            <button
              type="button"
              className="stock-weight-remove"
              data-testid={`stock-remove-${token.symbol}`}
              aria-label={t('Remove {symbol}', { symbol: token.symbol })}
              title={t('Remove {symbol}', { symbol: token.symbol })}
              onClick={() => toggle(token)}
            >
              <X size={14} aria-hidden />
            </button>
          </div>
        );
      })}
      {picked.length > 0 ? <AllocationTotal selected={picked} percents={value.percents} /> : null}
      {picked.length > 0 ? (
        <DiversificationMeter picks={picked.map((token) => ({ symbol: token.symbol, weight: Number(value.percents[token.address] ?? 0) || 0 }))} />
      ) : null}
    </div>
  );
}
