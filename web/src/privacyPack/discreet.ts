/**
 * Discreet mode: one switch that hides every amount on screen, for
 * screensharing or a public place. Remembered per device.
 *
 * It works on what is rendered, not on each formatter, so it covers every page,
 * dialog, the chart's axis and tooltip, and the kid view without a change at
 * each of the many places that format money:
 *
 * - `maskSegments` (pure, tested) finds amounts in text: "$2,480.65", "US$5",
 *   "12.5 AAPL", "25 USDG", "0.3 shares", "0.3 股". The digits become a fixed
 *   "••••", so not even the length shows. React renders "$" + {amount} as two
 *   text nodes, so neighbouring text nodes are read together.
 * - Numbers shown without a $ or ticker (the holdings "Tokens" column, a chore's
 *   reward figure) are amounts only by position; `MONEY_SELECTOR` names them,
 *   and new code can mark any element with `data-sprout-money`.
 * - A MutationObserver masks text nodes (and `title`/`aria-label`) in place
 *   while the mode is on and restores the originals when it is switched off.
 *   React only ever writes text nodes and never reads them back, so a new value
 *   is simply masked again before the browser paints.
 * - Amount fields are masked with CSS under the root class.
 *
 * Tapping a hidden amount shows that one for a few seconds.
 */
import { useEffect, useState } from 'react';
import { KNOWN_SYMBOLS } from '../stocks';

export const DISCREET_STORAGE_KEY = 'sprout-discreet';
export const DISCREET_CLASS = 'sprout-discreet';
export const MASK = '••••';
export const REVEAL_MS = 8000;

/** Elements whose numbers are all amounts, even with no $ or ticker beside them. */
export const MONEY_SELECTOR = [
  '[data-sprout-money]',
  '.garden-table td.garden-tabular',
  '.garden-chores-amount',
].join(', ');

/** Tokens a number can be an amount of, besides the configured stock tickers. */
const BASE_SYMBOLS = ['USDG', 'USDC', 'USDT', 'DAI', 'ETH', 'WETH', 'SPROUT', 'Settlement', 'SETTLEMENT', ...KNOWN_SYMBOLS];
const symbols = new Set<string>(BASE_SYMBOLS);

const NUM = String.raw`\d(?:[\d,]*\d)?(?:\.\d+)?`;
const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

let cachedPattern: { key: string; re: RegExp } | null = null;
/**
 * The amount pattern for a symbol set. Group 1, 2 or 3 is the number that is
 * hidden. No lookbehind or `d` flag, so older Safari builds the pattern too.
 */
export function moneyPattern(extra: Iterable<string> = symbols): RegExp {
  const list = [...new Set(extra)].filter((s) => /^[A-Za-z][A-Za-z0-9.]{0,11}$/.test(s)).sort((a, b) => b.length - a.length);
  const key = list.join('|');
  if (cachedPattern?.key === key) return cachedPattern.re;
  const tickers = list.map(escape).join('|');
  // A number standing on its own: at the start, or after something that is not part of a word or number.
  const alone = String.raw`(?:^|[^\w.,])`;
  const re = new RegExp(
    [
      // $2,480.65 · US$5 · $ 25 · $1.2K
      String.raw`(?:US)?\$\s?(${NUM}(?:\s?[KMB]\b)?)`,
      // 12.5 AAPL · 25 USDG (not part of a longer word)
      // Tickers match in any case: the local demo shows its settlement token as "settlement".
      tickers ? String.raw`${alone}(${NUM})\s?(?:${tickers})(?![A-Za-z0-9])` : '(?!)',
      // 0.3 shares · 0.3 股 · 350 结算代币 (the settlement token's name in Chinese)
      String.raw`${alone}(${NUM})\s?(?:shares?\b|股|结算代币)`,
    ].join('|'),
    'gi',
  );
  cachedPattern = { key, re };
  return re;
}

/** Every run of digits (for elements that only hold amounts). */
const BARE = new RegExp(String.raw`(${NUM})`, 'g');

/**
 * Mask the amounts in a run of neighbouring text pieces. Returns the new pieces
 * (same count) or null when nothing needs hiding. `bare`: every number counts.
 */
export function maskSegments(segments: readonly string[], opts: { bare?: boolean; symbols?: Iterable<string> } = {}): string[] | null {
  const full = segments.join('');
  if (!/\d/.test(full)) return null;
  const re = opts.bare ? BARE : moneyPattern(opts.symbols ?? symbols);
  re.lastIndex = 0;
  const spans: Array<[number, number]> = [];
  for (const m of full.matchAll(re)) {
    const num = m[1] ?? m[2] ?? m[3];
    if (!num) continue;
    // Nothing before the number in a match is a digit, so its first occurrence is the one.
    const start = (m.index ?? 0) + m[0].indexOf(num);
    spans.push([start, start + num.length]);
  }
  if (spans.length === 0) return null;
  const out: string[] = [];
  let offset = 0;
  let span = 0;
  for (const segment of segments) {
    let piece = '';
    for (let j = 0; j < segment.length; j++) {
      const at = offset + j;
      while (span < spans.length && at >= spans[span]![1]) span++;
      const current = spans[span];
      if (current && at >= current[0] && at < current[1]) {
        if (at === current[0]) piece += MASK;
      } else piece += segment[j];
    }
    out.push(piece);
    offset += segment.length;
  }
  return out.some((s, i) => s !== segments[i]) ? out : null;
}

/** Mask one string (a title, a label). */
export function maskText(text: string, opts: { bare?: boolean; symbols?: Iterable<string> } = {}): string {
  return maskSegments([text], opts)?.[0] ?? text;
}

// ---- state ------------------------------------------------------------------

let enabled = false;
const subscribers = new Set<() => void>();

function readStored(): boolean {
  try {
    return window.localStorage.getItem(DISCREET_STORAGE_KEY) === '1';
  } catch {
    return false;
  }
}

export function isDiscreet(): boolean {
  return enabled;
}

export function setDiscreet(on: boolean): void {
  try {
    if (on) window.localStorage.setItem(DISCREET_STORAGE_KEY, '1');
    else window.localStorage.removeItem(DISCREET_STORAGE_KEY);
  } catch {
    /* storage can be unavailable; the switch still works for this visit */
  }
  apply(on);
  subscribers.forEach((fn) => fn());
}

export function toggleDiscreet(): void {
  setDiscreet(!enabled);
}

/** Re-render when discreet mode changes. */
export function useDiscreet(): boolean {
  const [on, setOn] = useState(enabled);
  useEffect(() => {
    const update = () => setOn(enabled);
    subscribers.add(update);
    update();
    return () => {
      subscribers.delete(update);
    };
  }, []);
  return on;
}

/** Add tickers the page knows about (the configured stock tokens). */
export function addMoneySymbols(list: Iterable<string>): void {
  let added = false;
  for (const s of list) {
    if (s && !symbols.has(s)) {
      symbols.add(s);
      added = true;
    }
  }
  if (added && enabled && typeof document !== 'undefined') scan(document.body);
}

// ---- the DOM side -------------------------------------------------------------

interface Tracked {
  original: string;
  masked: string;
}
const texts = new WeakMap<Text, Tracked>();
const attrs = new WeakMap<Element, Map<string, Tracked>>();
const revealed = new Set<Element>();
const MASKED_ATTRS = ['title', 'aria-label'];
const SKIP = 'script, style, textarea, noscript, [contenteditable="true"], [data-discreet-ignore]';
let observer: MutationObserver | null = null;
let symbolsRequested = false;

function isRevealed(node: Node | null): boolean {
  if (revealed.size === 0) return false;
  for (let el = node instanceof Element ? node : node?.parentElement ?? null; el; el = el.parentElement) {
    if (revealed.has(el)) return true;
  }
  return false;
}

function originalOf(node: Text): string {
  const tracked = texts.get(node);
  return tracked && node.nodeValue === tracked.masked ? tracked.original : node.nodeValue ?? '';
}

function restoreText(node: Text): void {
  const tracked = texts.get(node);
  if (!tracked) return;
  if (node.nodeValue === tracked.masked) node.nodeValue = tracked.original;
  texts.delete(node);
}

function maskRun(run: Text[], bare: boolean, hide: boolean): void {
  const values = run.map(originalOf);
  const masked = hide ? maskSegments(values, { bare }) : null;
  run.forEach((node, i) => {
    const next = masked?.[i] ?? values[i]!;
    if (next !== values[i]) {
      texts.set(node, { original: values[i]!, masked: next });
      if (node.nodeValue !== next) node.nodeValue = next;
    } else if (texts.has(node)) {
      restoreText(node);
    }
  });
}

/** Mask (or restore) the text children of one element. */
function processParent(parent: Node | null): void {
  if (!(parent instanceof Element)) return;
  if (parent.closest(SKIP)) return;
  const hide = enabled && !isRevealed(parent);
  const bare = parent.closest(MONEY_SELECTOR) !== null;
  let run: Text[] = [];
  const flush = () => {
    if (run.length) maskRun(run, bare, hide);
    run = [];
  };
  for (const child of parent.childNodes) {
    if (child.nodeType === Node.TEXT_NODE) run.push(child as Text);
    else flush();
  }
  flush();
}

function processAttributes(el: Element): void {
  if (el.closest(SKIP)) return;
  const hide = enabled && !isRevealed(el);
  for (const name of MASKED_ATTRS) {
    const value = el.getAttribute(name);
    const map = attrs.get(el);
    const tracked = map?.get(name);
    if (value === null) {
      map?.delete(name);
      continue;
    }
    const original = tracked && value === tracked.masked ? tracked.original : value;
    const next = hide ? maskText(original) : original;
    if (next !== original) {
      const entry = map ?? new Map<string, Tracked>();
      entry.set(name, { original, masked: next });
      attrs.set(el, entry);
      if (value !== next) el.setAttribute(name, next);
    } else if (tracked) {
      if (value !== original) el.setAttribute(name, original);
      map!.delete(name);
    }
  }
}

/** Mask or restore everything under `root`. */
function scan(root: Node | null): void {
  if (!root) return;
  const parents = new Set<Node>();
  if (root.nodeType === Node.TEXT_NODE) parents.add(root.parentNode!);
  else {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT);
    if (root instanceof Element) processAttributes(root);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      if (node.nodeType === Node.TEXT_NODE) {
        if (node.parentNode) parents.add(node.parentNode);
      } else if ((node as Element).hasAttribute('title') || (node as Element).hasAttribute('aria-label')) {
        processAttributes(node as Element);
      }
    }
  }
  parents.forEach(processParent);
}

function onMutations(records: MutationRecord[]): void {
  const parents = new Set<Node>();
  const roots = new Set<Node>();
  for (const record of records) {
    if (record.type === 'characterData') {
      if (record.target.parentNode) parents.add(record.target.parentNode);
    } else if (record.type === 'attributes') {
      processAttributes(record.target as Element);
    } else {
      parents.add(record.target);
      record.addedNodes.forEach((node) => {
        if (node.nodeType === Node.ELEMENT_NODE) roots.add(node);
      });
    }
  }
  parents.forEach(processParent);
  roots.forEach(scan);
}

function loadConfiguredSymbols(): void {
  if (symbolsRequested || typeof fetch === 'undefined') return;
  symbolsRequested = true;
  void fetch('/api/config', { cache: 'no-store' })
    .then((res) => (res.ok ? res.json() : null))
    .then((body: { chain?: { contracts?: { settlementSymbol?: string; stockTokens?: Array<{ symbol?: string }> } } } | null) => {
      const contracts = body?.chain?.contracts;
      if (!contracts) return;
      addMoneySymbols([contracts.settlementSymbol ?? '', ...(contracts.stockTokens ?? []).map((t) => t.symbol ?? '')]);
    })
    .catch(() => {
      /* the built-in tickers still apply */
    });
}

function apply(on: boolean): void {
  enabled = on;
  if (typeof document === 'undefined') return;
  document.documentElement.classList.toggle(DISCREET_CLASS, on);
  if (on) {
    loadConfiguredSymbols();
    if (!observer && typeof MutationObserver !== 'undefined') {
      observer = new MutationObserver(onMutations);
      observer.observe(document.documentElement, {
        subtree: true,
        childList: true,
        characterData: true,
        attributes: true,
        attributeFilter: MASKED_ATTRS,
      });
    }
    scan(document.body);
  } else {
    observer?.disconnect();
    observer = null;
    revealed.clear();
    scan(document.body);
  }
}

/** Show the hidden amounts inside one element for a few seconds. */
export function revealFor(el: Element, ms = REVEAL_MS): void {
  revealed.add(el);
  scan(el);
  window.setTimeout(() => {
    revealed.delete(el);
    if (el.isConnected) scan(el);
  }, ms);
}

const INTERACTIVE = 'button, a[href], input, select, textarea, label, summary, [role="button"], [role="link"], [role="tab"]';

function onClick(event: MouseEvent): void {
  if (!enabled) return;
  const target = event.target instanceof Element ? event.target : null;
  if (!target || target.closest(INTERACTIVE)) return;
  // The smallest element around the tap that holds a hidden amount.
  for (let el: Element | null = target; el && el !== document.body; el = el.parentElement) {
    if ((el.textContent ?? '').includes(MASK)) {
      revealFor(el);
      return;
    }
  }
}

function isEditable(target: EventTarget | null): boolean {
  return target instanceof HTMLElement && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName));
}

/** Alt+Shift+H (Option+Shift+H on a Mac) switches discreet mode, except while typing. */
export function isDiscreetShortcut(e: Pick<KeyboardEvent, 'altKey' | 'shiftKey' | 'ctrlKey' | 'metaKey' | 'code'>): boolean {
  return e.altKey && e.shiftKey && !e.ctrlKey && !e.metaKey && e.code === 'KeyH';
}

let installed = false;
/** Apply the saved choice before React paints, and listen for the shortcut and taps. */
export function initializeDiscreet(): boolean {
  if (typeof window === 'undefined') return false;
  if (!installed) {
    installed = true;
    window.addEventListener('keydown', (e) => {
      if (!isDiscreetShortcut(e) || isEditable(e.target)) return;
      e.preventDefault();
      toggleDiscreet();
    });
    document.addEventListener('click', onClick);
  }
  apply(readStored());
  return enabled;
}
