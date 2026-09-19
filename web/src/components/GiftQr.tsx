import { useMemo, useState } from 'react';
import { Download, Printer } from 'lucide-react';
import { encodeQr, qrToSvg } from '../qr';
import { getLocale, t } from '../i18n';

/**
 * A printable QR code for a gift link, for birthday cards and party
 * invitations: grandparents scan it instead of typing a 97-character URL.
 * Encoded in the browser (no service sees the link) at error-correction level
 * Q, so a card that gets a little creased still scans.
 */

const PNG_SIZE = 1200;

function slug(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'gift';
}

function svgDataUrl(svg: string): string {
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

async function downloadPng(svgUrl: string, filename: string): Promise<void> {
  const image = new Image();
  image.src = svgUrl;
  await image.decode();
  const canvas = document.createElement('canvas');
  canvas.width = PNG_SIZE;
  canvas.height = PNG_SIZE;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error(t('This browser cannot draw the image.'));
  // Keep module edges sharp when scaling the vector up.
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(image, 0, 0, PNG_SIZE, PNG_SIZE);
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
  if (!blob) throw new Error(t('The image could not be created.'));
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.append(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

export function GiftQrCard({ url, label }: { url: string; label: string | null }) {
  const [error, setError] = useState<string | null>(null);
  const locale = getLocale();
  const svg = useMemo(() => qrToSvg(encodeQr(url, 'Q'), { title: t('Gift link QR code') }), [url, locale]);
  const src = svgDataUrl(svg);
  const name = `sprout-${slug(label ?? 'gift')}-qr`;

  return (
    <div className="gift-qr">
      <div className="gift-qr-print" data-testid="gift-qr-card">
        <p className="gift-qr-kicker">{t('Help a sprout grow 🌱')}</p>
        {label ? <p className="gift-qr-label">{label}</p> : null}
        <img className="gift-qr-image" src={src} alt={t('QR code that opens the gift link')} data-testid="gift-qr-image" />
        <p className="gift-qr-instructions">{t('Scan with a phone camera to add a gift.')}</p>
        <p className="gift-qr-url">{url}</p>
      </div>
      <p className="muted gift-qr-note">
        {t('Anyone who scans it can add money to this sprout from their own wallet. It gives nobody any control, and gifts can’t be taken back.')}
      </p>
      {error ? <p className="garden-notice" role="alert">{error}</p> : null}
      <div className="gift-qr-actions">
        <button
          type="button"
          className="btn btn--primary"
          data-testid="gift-qr-png"
          onClick={() => {
            setError(null);
            downloadPng(src, `${name}.png`).catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)));
          }}
        >
          <Download size={15} aria-hidden /> {t('Download PNG')}
        </button>
        <a className="btn" href={src} download={`${name}.svg`} data-testid="gift-qr-svg">
          SVG
        </a>
        <button type="button" className="btn" onClick={() => window.print()} data-testid="gift-qr-print">
          <Printer size={15} aria-hidden /> {t('Print')}
        </button>
      </div>
    </div>
  );
}
