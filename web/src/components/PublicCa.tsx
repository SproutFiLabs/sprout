import { useEffect, useState } from 'react';
import { Check, Copy } from 'lucide-react';
import './public-ca.css';

/**
 * The token contract address ("CA") with a one-tap copy, on the landing page
 * and the dashboard. The server sends it in /api/config from
 * SPROUT_PUBLIC_CA; with nothing set, this renders nothing.
 */

let pending: Promise<string | null> | null = null;

export function loadPublicCa(): Promise<string | null> {
  pending ??= fetch('/api/config')
    .then((res) => (res.ok ? res.json() : null))
    .then((body: { publicCa?: unknown } | null) => (typeof body?.publicCa === 'string' && body.publicCa ? body.publicCa : null))
    .catch(() => null);
  return pending;
}

/** "0x1234…abcd": the start and end people check an address by. */
export function shortCa(ca: string): string {
  return ca.length > 14 ? `${ca.slice(0, 6)}…${ca.slice(-4)}` : ca;
}

async function copyToClipboard(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // Some embedded browsers refuse the clipboard API; fall back to a selection.
    const area = document.createElement('textarea');
    area.value = text;
    area.setAttribute('readonly', '');
    area.style.position = 'fixed';
    area.style.opacity = '0';
    document.body.appendChild(area);
    area.select();
    let ok = false;
    try {
      ok = document.execCommand('copy');
    } catch {
      ok = false;
    }
    area.remove();
    return ok;
  }
}

export function PublicCa({ variant }: { variant: 'landing' | 'dashboard' }) {
  const [ca, setCa] = useState<string | null>(null);
  const [copied, setCopied] = useState<'yes' | 'no' | null>(null);

  useEffect(() => {
    let live = true;
    void loadPublicCa().then((value) => {
      if (live) setCa(value);
    });
    return () => {
      live = false;
    };
  }, []);

  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(null), 1800);
    return () => clearTimeout(timer);
  }, [copied]);

  if (!ca) return null;

  return (
    <button
      type="button"
      className={`public-ca public-ca--${variant}`}
      data-testid="public-ca"
      title={ca}
      aria-label={`Copy contract address ${ca}`}
      onClick={() => void copyToClipboard(ca).then((ok) => setCopied(ok ? 'yes' : 'no'))}
    >
      <span className="public-ca-label">CA</span>
      <code className="public-ca-full" data-testid="public-ca-address">{ca}</code>
      <code className="public-ca-short" aria-hidden="true">{shortCa(ca)}</code>
      <span className="public-ca-action" role="status" data-testid="public-ca-status">
        {copied === 'yes' ? <Check size={14} aria-hidden /> : <Copy size={14} aria-hidden />}
        <span className="public-ca-action-text">{copied === 'yes' ? 'Copied' : copied === 'no' ? 'Copy failed' : 'Copy'}</span>
      </span>
    </button>
  );
}
