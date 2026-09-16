/**
 * Link previews for gift links.
 *
 * Chat apps and X read Open Graph tags from the served HTML and never run the
 * app, so a gift link would otherwise preview exactly like the home page. For
 * a known gift, the server rewrites the preview tags in index.html before
 * sending it. The gift's label is included because the parent chose it and it
 * already appears on the public gift page; nothing else about the sprout is.
 */

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
  // Labels are capped at 60 characters when a gift link is created; collapse
  // whitespace so a crafted label cannot break the preview layout.
  const label = gift.label?.replace(/\s+/g, ' ').trim().slice(0, 60) || null;
  const title = label ? `${label} · Help a sprout grow` : 'You’re invited to help a sprout grow';
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
