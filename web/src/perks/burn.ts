import { minOutFor, parseBurnUsd, type BurnRoute } from '@sprout/shared';
import { compactSprout, wholeSprout } from './root';

/**
 * "Buy & burn": the browser side's numbers and server calls. The server says
 * whether the feature is on and quotes the route; the wallet flow itself is
 * runBuyAndBurn in @sprout/shared (the same code the mainnet-fork rehearsal
 * runs). Nothing here touches a sprout.
 */

export interface BurnConfigInfo {
  enabled: true;
  chainId: number;
  route: BurnRoute;
  deadAddress: string;
  slippageBps: number;
  minUsd: number;
  maxUsd: number;
  presets: number[];
  explorerUrl: string | null;
}

export interface BurnView {
  wallet: string;
  sprout: string;
  usdg: string;
  tx: string;
  at: number;
}

export interface BurnSummaryInfo {
  enabled: true;
  token: string;
  decimals: number;
  usdgDecimals: number;
  deadAddress: string;
  count: number;
  sproutBurned: string;
  usdgSpent: string;
  latest: BurnView[];
  deadBalance: string | null;
  asOf: number;
}

export interface BurnQuoteInfo {
  usdgIn: string;
  ethMid: string;
  sproutOut: string;
  minSproutOut: string;
  slippageBps: number;
  quotedAt: number;
}

let configPromise: Promise<BurnConfigInfo | null> | null = null;

/** The route and limits, or null when buy & burn is off (or the server can't be reached). */
export function loadBurnConfig(): Promise<BurnConfigInfo | null> {
  configPromise ??= fetch('/api/burns/config')
    .then((r) => (r.ok ? (r.json() as Promise<{ enabled: boolean }>) : null))
    .then((c) => (c?.enabled ? (c as BurnConfigInfo) : null))
    .catch(() => {
      configPromise = null;
      return null;
    });
  return configPromise;
}

export async function loadBurnSummary(): Promise<BurnSummaryInfo | null> {
  try {
    const r = await fetch('/api/burns/summary');
    if (!r.ok) return null;
    const s = (await r.json()) as { enabled: boolean };
    return s.enabled ? (s as BurnSummaryInfo) : null;
  } catch {
    return null;
  }
}

export class BurnApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = 'BurnApiError';
  }
}

/** A quote for `usd` dollars ("5", "12.50"). */
export async function fetchBurnQuote(usd: string): Promise<BurnQuoteInfo> {
  const r = await fetch(`/api/burns/quote?usd=${encodeURIComponent(usd)}`);
  const body = (await r.json().catch(() => ({}))) as BurnQuoteInfo & { error?: string };
  if (!r.ok) throw new BurnApiError(r.status, body.error ?? `quote failed (${r.status})`);
  return body;
}

/**
 * Tells the server about a confirmed burn so the counter includes it, and
 * returns the burn as recorded. A burn the server can't see yet (409) is tried
 * again a few times; null when it never could.
 */
export async function reportBurn(txHash: string, wallet: string, tries = 4, delayMs = 2_500): Promise<BurnView | null> {
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetch('/api/burns', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ txHash, wallet }) });
      if (r.ok) return ((await r.json()) as { burn: BurnView }).burn;
      if (r.status !== 409 && r.status !== 503 && r.status !== 429) return null;
    } catch {
      // network: try again
    }
    if (i < tries - 1) await new Promise((resolve) => setTimeout(resolve, delayMs * (i + 1)));
  }
  return null;
}

// ---------------------------------------------------------------------------
// Numbers

/** Dollars the person picked, in USDG base units, or null when outside the server's limits. */
export function burnAmount(usd: string, config: Pick<BurnConfigInfo, 'minUsd' | 'maxUsd'> & { route: Pick<BurnRoute, 'usdgDecimals'> }): bigint | null {
  return parseBurnUsd(usd, config.route.usdgDecimals, config.minUsd, config.maxUsd);
}

/** The SPROUT floor the browser signs with: the quote less the slippage, rounded down. */
export function burnFloor(quotedSproutOut: bigint | string, slippageBps: number): bigint {
  return minOutFor(BigInt(quotedSproutOut), slippageBps);
}

/** "3%" for 300 basis points, "2.5%" for 250. */
export function slippageLabel(bps: number): string {
  return `${Number((bps / 100).toFixed(2))}%`;
}

/** "5", "12.50": the dollars in USDG base units, for display and for the quote URL. */
export function usdText(raw: bigint | string, decimals: number): string {
  const cents = (BigInt(raw) * 100n) / 10n ** BigInt(decimals);
  const whole = cents / 100n;
  const rest = cents % 100n;
  return rest === 0n ? whole.toLocaleString('en-US') : `${whole.toLocaleString('en-US')}.${rest.toString().padStart(2, '0')}`;
}

/** Whole SPROUT, grouped ("40,445"). */
export const sproutText = (raw: bigint | string, decimals: number) => wholeSprout(raw, decimals);

/** The public counter's two numbers: burned via Sprout, and everything at the dead address. */
export function burnCounter(summary: BurnSummaryInfo | null | undefined): { viaSprout: string; total: string | null; count: number } | null {
  if (!summary) return null;
  return {
    viaSprout: compactSprout(summary.sproutBurned, summary.decimals),
    total: summary.deadBalance === null ? null : compactSprout(summary.deadBalance, summary.decimals),
    count: summary.count,
  };
}

// ---------------------------------------------------------------------------
// "Add a $1 burn to my buys" (per device, off by default)

const OPT_IN_KEY = 'sprout.burn.afterBuys';
const optInListeners = new Set<(on: boolean) => void>();
/** The choice when storage can't be used (private mode): kept for this page only. */
let optInMemory = false;

export function readBurnOptIn(): boolean {
  try {
    return window.localStorage.getItem(OPT_IN_KEY) === '1';
  } catch {
    return optInMemory;
  }
}

export function writeBurnOptIn(on: boolean): void {
  optInMemory = on;
  try {
    if (on) window.localStorage.setItem(OPT_IN_KEY, '1');
    else window.localStorage.removeItem(OPT_IN_KEY);
  } catch {
    // storage may be unavailable (private mode): the choice lasts for this page only
  }
  optInListeners.forEach((fn) => fn(on));
}

export function onBurnOptIn(fn: (on: boolean) => void): () => void {
  optInListeners.add(fn);
  return () => optInListeners.delete(fn);
}

/** Should a buy that just confirmed be followed by the $1 burn offer? Only when opted in and burns are on. */
export async function burnOfferWanted(walletChainId?: number): Promise<boolean> {
  if (!readBurnOptIn()) return false;
  const config = await loadBurnConfig();
  return !!config && (walletChainId === undefined || walletChainId === config.chainId);
}
