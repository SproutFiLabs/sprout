import { createElement, Fragment, useEffect, useState, type ReactNode } from 'react';
import { ZH } from './zh';

/**
 * Sprout's two languages. English is the source text and the default; Simplified
 * Chinese is looked up by that same English string, so components keep reading
 * in English and a missing translation falls back to English, never to a key.
 */
export type Locale = 'en' | 'zh';

const STORAGE_KEY = 'sprout-locale';
const subscribers = new Set<() => void>();
let current: Locale = 'en';

/** Strings looked up in Chinese that have no translation yet (read by the test harnesses). */
const missing = new Set<string>();
if (typeof window !== 'undefined') (window as unknown as { __sproutMissingZh?: Set<string> }).__sproutMissingZh = missing;

function detect(): Locale {
  try {
    const saved = window.localStorage.getItem(STORAGE_KEY);
    if (saved === 'en' || saved === 'zh') return saved;
  } catch {
    /* storage can be unavailable */
  }
  const languages = typeof navigator === 'undefined' ? [] : navigator.languages?.length ? navigator.languages : [navigator.language];
  return languages.some((l) => /^zh\b/i.test(l ?? '')) ? 'zh' : 'en';
}

function apply(locale: Locale): void {
  current = locale;
  if (typeof document !== 'undefined') document.documentElement.lang = locale === 'zh' ? 'zh-CN' : 'en';
}

/** Strings looked up in Chinese that had no translation (tests read this). */
export function missingTranslations(): ReadonlySet<string> {
  return missing;
}

/** Pick the language before React paints: a saved choice, else the browser's. */
export function initializeLocale(): Locale {
  apply(typeof window === 'undefined' ? 'en' : detect());
  return current;
}

export function getLocale(): Locale {
  return current;
}

export function setLocale(locale: Locale): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, locale);
  } catch {
    /* storage can be unavailable */
  }
  apply(locale);
  subscribers.forEach((fn) => fn());
}

/** Re-render when the language changes. The root uses this, so the whole tree follows. */
export function useLocale(): Locale {
  const [locale, setState] = useState<Locale>(current);
  useEffect(() => {
    const update = () => setState(current);
    subscribers.add(update);
    update();
    return () => {
      subscribers.delete(update);
    };
  }, []);
  return locale;
}

/** Text a caller already translated (it holds Chinese characters) passes through as is. */
const ALREADY_CHINESE = /[㐀-鿿]/;

function lookup(text: string): string {
  if (current !== 'zh') return text;
  const hit = ZH[text];
  if (hit !== undefined) return hit;
  if (!ALREADY_CHINESE.test(text)) missing.add(text);
  return text;
}

/**
 * Translate an English UI string. `{name}` placeholders are filled from `vars`
 * after lookup, so the dictionary key keeps the placeholder:
 *   t('{amount} is waiting to be invested.', { amount: '$25' })
 */
export function t(text: string, vars?: Record<string, string | number>): string {
  const out = lookup(text);
  if (!vars) return out;
  return out.replace(/\{(\w+)\}/g, (whole, name: string) => (name in vars ? String(vars[name]) : whole));
}

/**
 * `t` for a word whose Chinese depends on where it is used: looks up
 * `'{text}|{context}'` first, then `text`. English always shows `text`.
 *   tc('lesson', 'Done')   // 已完成, where t('Done') on a button is 完成
 */
export function tc(context: string, text: string, vars?: Record<string, string | number>): string {
  if (current === 'zh' && ZH[`${text}|${context}`] !== undefined) return t(`${text}|${context}`, vars);
  return t(text, vars);
}

/**
 * Like `t`, but placeholders may be React nodes (links, bold text):
 *   tj('Read the {faq} first.', { faq: <a href="/faq">{t('FAQ')}</a> })
 */
export function tj(text: string, vars: Record<string, ReactNode>): ReactNode {
  const out = lookup(text);
  const parts = out.split(/\{(\w+)\}/g);
  return createElement(
    Fragment,
    null,
    ...parts.map((part, i) => (i % 2 === 1 ? createElement(Fragment, { key: i }, part in vars ? vars[part] : `{${part}}`) : part)),
  );
}

/** BCP 47 tag for dates and numbers in the current language. */
export function dateLocale(): string {
  return current === 'zh' ? 'zh-CN' : 'en-US';
}
