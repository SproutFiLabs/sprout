import { isKnownStock } from '../stocks';
import { findBasket } from './baskets';

/** The stock guide's pages: /stocks, /stocks/<SYMBOL>, /stocks/basket/<id>. */
export type GuideRoute = { page: 'index' } | { page: 'stock'; symbol: string } | { page: 'basket'; id: string } | { page: 'missing' };

export function parseGuidePath(path: string): GuideRoute {
  const parts = path.replace(/\/+$/, '').split('/').filter(Boolean);
  if (parts[0] !== 'stocks') return { page: 'missing' };
  if (parts.length === 1) return { page: 'index' };
  if (parts[1] === 'basket' && parts.length === 3) return findBasket(parts[2]!) ? { page: 'basket', id: parts[2]! } : { page: 'missing' };
  if (parts.length === 2) {
    const symbol = decodeURIComponent(parts[1]!).toUpperCase();
    return isKnownStock(symbol) ? { page: 'stock', symbol } : { page: 'missing' };
  }
  return { page: 'missing' };
}

