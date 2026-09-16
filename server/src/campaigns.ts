import type { SproutDb } from './db';
import {
  countHiddenGiftNotes,
  getGiftCampaign,
  listGiftNotes,
  listGiftPayments,
  type GiftNoteRecord,
} from './repo';

/**
 * Birthday campaigns and gift notes.
 *
 * A campaign is a gift link with a title, a dollar goal and an end date. The
 * contract knows nothing about it: gifts still go straight into the vault, and
 * still arrive after the end date. Progress counts gifts made through the link
 * in the settlement token (USDG, treated as $1); stock-token gifts are listed
 * separately rather than priced.
 *
 * Notes are a gifter's name and a short message, attached only to a gift the
 * server has verified on-chain as coming from the signing wallet. They are
 * public to anyone with the link, so they are plain text, short, and may not
 * contain links; the parent can hide any of them.
 */

export const NOTE_MAX = 140;
export const NAME_MAX = 40;
export const TITLE_MAX = 60;
export const GOAL_MAX_DOLLARS = 100_000;
export const CAMPAIGN_MAX_DAYS = 366;

const LINKISH = /(https?:\/\/|www\.|\b[a-z0-9-]+\.(com|net|org|io|xyz|app|gg|co|me|ly|tech|link|site|online|finance|money)\b)/i;

export class TextRuleError extends Error {}

/** Collapse whitespace, drop control characters, and refuse links. Returns null for empty input. */
export function cleanText(input: string | undefined | null, max: number, field: string): string | null {
  if (input === undefined || input === null) return null;
  const text = input
    .normalize('NFC')
    .replace(/\p{Cc}/gu, ' ')
    // Invisible and direction-changing characters (but not the zero-width
    // joiner that emoji sequences need).
    .replace(/[\u200B\u200C\u200E\u200F\u202A-\u202E\u2060-\u2064\u2066-\u2069\uFEFF]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (text.length === 0) return null;
  if ([...text].length > max) throw new TextRuleError(`${field} can be at most ${max} characters`);
  if (LINKISH.test(text)) throw new TextRuleError(`${field} can't include links`);
  return text;
}

export interface PublicNote {
  name: string | null;
  note: string | null;
  token: string | null;
  amount: string | null;
  blockNumber: number | null;
  txHash: string;
  logIndex: number;
  hidden?: boolean;
}

export interface CampaignView {
  title: string;
  goalCents: number;
  endsAt: number;
  raisedCents: number;
  /** Stock-token gifts through the link, by token address, in base units. */
  otherGifts: Record<string, string>;
  ended: boolean;
}

export function noteView(n: GiftNoteRecord, withHidden = false): PublicNote {
  return {
    name: n.name,
    note: n.note,
    token: n.token,
    amount: n.amount,
    blockNumber: n.blockNumber,
    txHash: n.txHash,
    logIndex: n.logIndex,
    ...(withHidden ? { hidden: n.hidden } : {}),
  };
}

export function campaignView(
  db: SproutDb,
  giftId: string,
  opts: { settlementToken?: string; settlementDecimals: number; nowSeconds: number },
): CampaignView | null {
  const campaign = getGiftCampaign(db, giftId);
  if (!campaign) return null;
  const settlement = opts.settlementToken?.toLowerCase();
  let raised = 0n;
  const otherGifts: Record<string, string> = {};
  for (const p of listGiftPayments(db, giftId)) {
    if (p.token.toLowerCase() === settlement) raised += BigInt(p.amount);
    else otherGifts[p.token] = (BigInt(otherGifts[p.token] ?? '0') + BigInt(p.amount)).toString();
  }
  // Base units to cents, rounded down: a campaign never shows more than arrived.
  const scale = 10n ** BigInt(Math.max(0, opts.settlementDecimals - 2));
  return {
    title: campaign.title,
    goalCents: campaign.goalCents,
    endsAt: campaign.endsAt,
    raisedCents: Number(raised / scale),
    otherGifts,
    ended: opts.nowSeconds >= campaign.endsAt,
  };
}

/** What a gift page (or the parent's summary) shows about notes. */
export function notesView(db: SproutDb, giftId: string, limit = 50): { notes: PublicNote[]; hiddenNotes: number } {
  return {
    notes: listGiftNotes(db, giftId)
      .slice(0, limit)
      .map((n) => noteView(n)),
    hiddenNotes: countHiddenGiftNotes(db, giftId),
  };
}
