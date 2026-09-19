/** Source-backed product facts. These describe reviewed issuer terms, not legal clearance. */
export const PASSPORT_REVIEWED = "2026-09-19";
export const FAMILY_SOURCES = [
  {
    id: "robinhood",
    title: "Robinhood Stock Token terms",
    url: "https://docs.robinhood.com/chain/stock-tokens/",
    date: PASSPORT_REVIEWED,
  },
  {
    id: "irs",
    title: "IRS digital asset reporting",
    url: "https://www.irs.gov/filing/digital-assets",
    date: PASSPORT_REVIEWED,
  },
  {
    id: "sec",
    title: "SEC tokenized securities statement",
    url: "https://www.sec.gov/newsroom/speeches-statements/corp-fin-statement-tokenized-securities-012826-statement-tokenized-securities",
    date: "2026-01-28",
  },
] as const;
export type LedgerKind =
  "purchase" | "sale" | "spend" | "transfer" | "gift" | "reward";
export interface LedgerEntry {
  id: string;
  date: string;
  kind: LedgerKind;
  asset: string;
  quantity: string;
  chainId: number;
  wallet: string;
  usdCents: number | null;
  basisCents: number | null;
  feeCents: number;
  txHash?: string;
  note: string;
  source: "manual" | "import" | "spend" | "harvest" | "rewards";
}
export function isDisposal(e: LedgerEntry) {
  return e.kind === "sale" || e.kind === "spend";
}
export function ledgerSummary(entries: LedgerEntry[]) {
  let knownGainCents = 0,
    completeDisposals = 0,
    missing = 0;
  for (const e of entries)
    if (isDisposal(e)) {
      if (e.usdCents === null || e.basisCents === null) missing++;
      else {
        knownGainCents += e.usdCents - e.basisCents - e.feeCents;
        completeDisposals++;
      }
    }
  return { knownGainCents, completeDisposals, missing, count: entries.length };
}
/** Exact cents. Reject extra precision, exponent notation, negatives and unsafe sizes. */
export function dollarsToCents(value: string): number | null {
  if (!value.trim()) return null;
  if (!/^\d{1,9}(\.\d{1,2})?$/.test(value.trim()))
    throw new Error("Use a dollar amount with up to two decimal places.");
  const [whole, fraction = ""] = value.trim().split(".");
  return Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
}
export function csvCell(value: unknown): string {
  let s = value === null || value === undefined ? "" : String(value);
  // A strict negative decimal is data, not a formula (for exported losses).
  if (/^[\s]*[=+\-@\t\r]/.test(s) && !/^-\d+(\.\d+)?$/.test(s)) s = `'${s}`;
  return `"${s.replaceAll('"', '""')}"`;
}
export function ledgerCsv(entries: LedgerEntry[], advanced = false): string {
  const columns = [
    "id",
    "date",
    "kind",
    "asset",
    "quantity",
    "chain_id",
    "wallet",
    "value_usd",
    "basis_usd",
    "fees_usd",
    "transaction",
    "source",
    "note",
  ];
  if (advanced) columns.push("estimated_gain_usd", "review");
  const usd = (n: number | null) => (n === null ? "" : (n / 100).toFixed(2));
  return [
    columns.map(csvCell).join(","),
    ...entries.map((e) => {
      const row: unknown[] = [
        e.id,
        e.date,
        e.kind,
        e.asset,
        e.quantity,
        e.chainId,
        e.wallet,
        usd(e.usdCents),
        usd(e.basisCents),
        usd(e.feeCents),
        e.txHash,
        e.source,
        e.note,
      ];
      if (advanced)
        row.push(
          isDisposal(e) && e.usdCents !== null && e.basisCents !== null
            ? usd(e.usdCents - e.basisCents - e.feeCents)
            : "",
          isDisposal(e) && (e.usdCents === null || e.basisCents === null)
            ? "Missing basis or value"
            : "Review with your accountant",
        );
      return row.map(csvCell).join(",");
    }),
  ].join("\r\n");
}
export interface AssetPassport {
  symbol: string;
  address: string;
  chainId: number;
  reviewedAt: string;
  verifiedIssuer: boolean;
  issuer: string;
  structure: string;
  ownership: string;
  dividends: string;
  redemption: string;
  trading: string;
  usAvailable: false;
  sources: typeof FAMILY_SOURCES;
}
export function assetPassport(
  asset: { symbol: string; address: string },
  chainId: number,
): AssetPassport {
  const known = chainId === 4663;
  return {
    symbol: asset.symbol,
    address: asset.address,
    chainId,
    reviewedAt: PASSPORT_REVIEWED,
    verifiedIssuer: known,
    issuer: known
      ? "Robinhood Assets (Jersey) Limited"
      : "Issuer not verified for this network",
    structure: known ? "Tokenized debt security" : "Unverified asset",
    ownership: known
      ? "Economic exposure to the underlying asset. No legal or beneficial rights in the underlying company."
      : "Do not assume share ownership. Review the issuer’s terms.",
    dividends: known
      ? "An onchain multiplier adjusts economic exposure. This is not a cash dividend paid directly by the underlying company."
      : "Not verified.",
    redemption: known
      ? "Secondary-market sale or issuer redemption subject to eligibility, availability and KYC/AML. Review the prospectus."
      : "Not verified.",
    trading: known
      ? "Transfers can be available around the clock. Minting, redemption and trading capabilities have separate windows."
      : "Not verified.",
    usAvailable: false,
    sources: FAMILY_SOURCES,
  };
}
export interface FamilyPlan {
  goal: string;
  targetCents: number;
  horizon: number;
  account: "parent" | "custodial";
  state: string;
  adult: boolean;
  savedAt?: number;
}
export interface InvestmentProvider {
  name: string;
  url: string;
  disclosureUrl: string;
  states: string[];
  reviewedAt: string;
  validUntil: string;
}
export interface RewardOffer {
  id: string;
  title: string;
  product: string;
  rateBps: number;
  budgetCents: number;
  reservedCents: number;
  endsAt: number;
  terms: string;
  treasury: string;
  createdAt: number;
}
export interface RewardClaim {
  id: string;
  orderId: string;
  offerId: string;
  owner: string;
  cents: number;
  status: "pending" | "confirmed" | "paid" | "cancelled";
  createdAt: number;
  txHash?: string;
  logIndex?: number;
}
export interface RewardQuote {
  offerId: string;
  title: string;
  cents: number;
  rateBps: number;
  terms: string;
}
export interface ToolsData {
  entries: LedgerEntry[];
  offers: RewardOffer[];
  claims: RewardClaim[];
  plan: FamilyPlan | null;
  premium: boolean;
  rewardReady: boolean;
}
export function rewardCents(valueDollars: number, rateBps: number): number {
  return Math.floor((valueDollars * rateBps) / 100);
}
