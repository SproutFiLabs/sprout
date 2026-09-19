import { useEffect, useState } from 'react';
import { t } from '../i18n';
interface Snapshot { checkedAt: number | null; assets: {symbol: string; status: string}[] }
/** Selection is allowed while a market is closed; buying still requires every leg to pass. */
export function MarketNotice() {
  const [market, setMarket] = useState<Snapshot | null>(null);
  useEffect(() => {
    let active = true;
    const controller = new AbortController();
    const read = () => fetch('/api/markets', {signal: controller.signal}).then(r => {
      if (!r.ok) throw new Error('Unavailable');
      return r.json() as Promise<Snapshot>;
    }).then(d => { if (active) setMarket(d); }).catch(() => { if (active) setMarket(null); });
    void read();
    const timer = setInterval(read, 60_000);
    return () => { active = false; controller.abort(); clearInterval(timer); };
  }, []);
  const stale = market?.assets.filter(a => a.status === 'stale-price' || a.status === 'price-paused').map(a => a.symbol) ?? [];
  const far = market?.assets.filter(a => a.status === 'pool-too-far').map(a => a.symbol) ?? [];
  const unknown = market?.assets.filter(a => a.status === 'unavailable').map(a => a.symbol) ?? [];
  return <div className="fine-print" role="status" data-testid="market-availability">
    {stale.length > 0 && <p>{t('Buying paused while prices update: {symbols}.', {symbols: stale.join(', ')})}</p>}
    {far.length > 0 && <p>{t('Current $100 quotes exceed the default price limit: {symbols}. Smaller purchases may differ.', {symbols: far.join(', ')})}</p>}
    {unknown.length > 0 && <p>{t('Market status unavailable: {symbols}.', {symbols: unknown.join(', ')})}</p>}
    <p>{t('You can choose assets while markets are closed. Every asset must pass the price checks before a basket purchase can go through; no partial purchase is made.')}</p>
    {(!market || !market.checkedAt) && <p>{t('Live market status could not be confirmed. Prices are checked again before buying.')}</p>}
  </div>;
}
