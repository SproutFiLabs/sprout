import { useEffect, useState } from 'react';
import { t } from '../i18n';
import { sproutText } from './burn';

type Burn = { txHash: string; amount: string; at: number };
type Summary = { count: number; totalAmount: string; latest: Burn[] };

export function ToolBurnSummary() {
  const [summary, setSummary] = useState<Summary | null>(null);
  useEffect(() => { fetch('/api/tools/burns').then((r) => r.ok ? r.json() as Promise<Summary> : null).then(setSummary).catch(() => {}); }, []);
  if (!summary || summary.count === 0) return null;
  return <section className="perks-card" data-testid="tool-burn-summary" aria-labelledby="tool-burn-title">
    <h2 id="tool-burn-title">{t('Premium tools: SPROUT burned')}</h2>
    <p>{t('{count} premium tool burns · {amount} SPROUT sent to the dead address', { count: summary.count, amount: sproutText(summary.totalAmount, 18) })}</p>
    <ul>{summary.latest.slice(0, 5).map((burn) => <li key={burn.txHash}><span>{sproutText(burn.amount, 18)} SPROUT · {new Date(burn.at * 1000).toLocaleDateString()}</span>{<a href={`https://robinhoodchain.blockscout.com/tx/${burn.txHash}`} target="_blank" rel="noreferrer">{t('View the transaction')}</a>}</li>)}</ul>
    <p className="perks-muted">{t('This is separate from voluntary Buy & burn activity. Core Sprout features remain free; these optional reports burn SPROUT.')}</p>
  </section>;
}
