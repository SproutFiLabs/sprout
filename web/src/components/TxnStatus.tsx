import { useEffect, useRef } from 'react';

export interface TxnState {
  label: string;
  status: 'idle' | 'pending' | 'confirmed' | 'failed';
  hash?: string;
  error?: string;
}

export function TxnStatusLine({ txn, explorerUrl }: { txn: TxnState | null; explorerUrl?: string }) {
  const ref = useRef<HTMLParagraphElement>(null);
  // Bring the status into view when it changes (e.g. an error inside a scrolled
  // modal on a small screen).
  useEffect(() => {
    if (txn && txn.status !== 'idle') ref.current?.scrollIntoView({ block: 'nearest' });
  }, [txn?.status, txn?.hash, txn?.error]);

  if (!txn || txn.status === 'idle') return null;
  return (
    <p ref={ref} className={`txn txn--${txn.status}`} role="status" data-testid="txn-status">
      <strong>{txn.label}:</strong> {txn.status}
      {txn.hash ? (
        <>
          {' '}
          {explorerUrl ? (
            <a href={`${explorerUrl}/tx/${txn.hash}`} target="_blank" rel="noreferrer">
              {txn.hash.slice(0, 12)}...
            </a>
          ) : (
            <code>{txn.hash.slice(0, 18)}...</code>
          )}
        </>
      ) : null}
      {txn.error ? <span className="txn-error"> {txn.error}</span> : null}
    </p>
  );
}
