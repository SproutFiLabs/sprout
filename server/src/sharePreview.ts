/** Generic gift unfurls. Family-provided labels never enter public social metadata. */

export const DEFAULT_PUBLIC_ORIGIN = 'https://www.sproutfy.tech';

const GIFT_DESCRIPTION =
  'You’re invited to add a gift to a child’s Sprout, a savings portfolio of real stock tokens. You’ll need a wallet on Robinhood Chain.';

function escapeAttribute(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function setMeta(html: string, attribute: 'property' | 'name', key: string, value: string): string {
  const pattern = new RegExp(`(<meta ${attribute}="${key.replace(/[.:]/g, '\\$&')}" content=")[^"]*(")`);
  return html.replace(pattern, (_, start: string, end: string) => `${start}${escapeAttribute(value)}${end}`);
}

export interface GiftPreviewInput {
  label: string | null;
}

export function giftPreviewHtml(indexHtml: string, gift: GiftPreviewInput, pageUrl: string, origin: string): string {
  // Never publish family-provided text in unfurl previews.
  const title = 'You’re invited to help a sprout grow';
  const image = `${origin}/og-gift.jpg`;
  const alt = 'You’re invited to help a sprout grow.';
  let html = indexHtml.replace(/<title>[^<]*<\/title>/, `<title>${escapeAttribute(title)}</title>`);
  html = setMeta(html, 'property', 'og:url', pageUrl);
  html = setMeta(html, 'property', 'og:title', title);
  html = setMeta(html, 'property', 'og:description', GIFT_DESCRIPTION);
  html = setMeta(html, 'property', 'og:image', image);
  html = setMeta(html, 'property', 'og:image:alt', alt);
  html = setMeta(html, 'name', 'twitter:title', title);
  html = setMeta(html, 'name', 'twitter:description', GIFT_DESCRIPTION);
  html = setMeta(html, 'name', 'twitter:image', image);
  html = setMeta(html, 'name', 'twitter:image:alt', alt);
  html = setMeta(html, 'name', 'description', GIFT_DESCRIPTION);
  return html;
}
