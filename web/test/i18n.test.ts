import { afterAll, describe, expect, test } from 'bun:test';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

// A minimal browser: storage, a Chinese-speaking visitor, a root element.
const store = new Map<string, string>();
const root = { lang: 'en' };
Object.assign(globalThis, {
  window: {
    localStorage: {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
      removeItem: (k: string) => void store.delete(k),
    },
  },
  document: { documentElement: root },
});
const navigatorBefore = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
Object.defineProperty(globalThis, 'navigator', { value: { language: 'zh-CN', languages: ['zh-CN', 'en'] }, configurable: true });

const { initializeLocale, setLocale, getLocale, missingTranslations, t, tc } = await import('../src/i18n');
const { ZH } = await import('../src/i18n/zh');

// Other test files run in this process and expect no browser globals.
afterAll(() => {
  setLocale('en');
  delete (globalThis as Record<string, unknown>).window;
  delete (globalThis as Record<string, unknown>).document;
  if (navigatorBefore) Object.defineProperty(globalThis, 'navigator', navigatorBefore);
  else delete (globalThis as Record<string, unknown>).navigator;
});

describe('language choice', () => {
  test('a browser set to Chinese opens in Chinese, and a saved choice wins', () => {
    expect(initializeLocale()).toBe('zh');
    expect(root.lang).toBe('zh-CN');
    setLocale('en');
    expect(store.get('sprout-locale')).toBe('en');
    expect(initializeLocale()).toBe('en');
    expect(root.lang).toBe('en');
  });

  test('English is the source text; Chinese is looked up by it, placeholders filled after', () => {
    setLocale('en');
    expect(t('Plant a sprout')).toBe('Plant a sprout');
    setLocale('zh');
    expect(t('Plant a sprout')).toBe(ZH['Plant a sprout']!);
    expect(t('{count} wallet confirmations.', { count: 3 })).toBe('需要在钱包里确认 3 次。');
    expect(t('A string nobody translated')).toBe('A string nobody translated');
    expect(missingTranslations().has('A string nobody translated')).toBe(true);
    expect(tc('lesson', 'Done')).toBe('已完成');
    expect(tc('button', 'Done')).toBe(ZH['Done']!);
    setLocale('en');
    expect(tc('lesson', 'Done')).toBe('Done');
    expect(getLocale()).toBe('en');
  });
});

/** Every literal passed to t(), tj() or tc() in the web source. */
function literalKeys(): Map<string, string> {
  const keys = new Map<string, string>();
  const walk = (dir: string): string[] =>
    readdirSync(dir).flatMap((name) => {
      const path = join(dir, name);
      return statSync(path).isDirectory() ? walk(path) : /\.tsx?$/.test(name) ? [path] : [];
    });
  const str = String.raw`'((?:\\.|[^'\\])*)'|"((?:\\.|[^"\\])*)"|\x60((?:\\.|[^\x60\\$])*)\x60`;
  const call = new RegExp(String.raw`\b(?:t|tj)\(\s*(?:${str})|\btc\(\s*(?:${str})\s*,\s*(?:${str})`, 'g');
  for (const file of walk(join(import.meta.dir, '..', 'src'))) {
    if (file.includes(`${join('src', 'i18n')}`)) continue;
    const source = readFileSync(file, 'utf8');
    for (const m of source.matchAll(call)) {
      const raw = m[1] ?? m[2] ?? m[3] ?? m[7] ?? m[8] ?? m[9];
      if (raw === undefined) continue;
      const text = raw.replace(/\\(['"\\\x60])/g, '$1').replace(/\\n/g, '\n');
      keys.set(text, file.slice(file.indexOf('src')));
    }
  }
  return keys;
}

const placeholders = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join(',');

describe('the Chinese dictionary', () => {
  test('every string the code translates has a Chinese entry', () => {
    const keys = literalKeys();
    // The privacy screens (App, DashboardShell, GiftPage, KidView, Landing) are not wrapped in t() yet in
    // this repository, so fewer strings are found here than on the English / Chinese site.
    expect(keys.size).toBeGreaterThan(150);
    const missing = [...keys].filter(([k]) => ZH[k] === undefined).map(([k, file]) => `${file}: ${k}`);
    expect(missing).toEqual([]);
  });

  test('entries keep their placeholders and are not empty or English', () => {
    const bad = Object.entries(ZH).filter(([k, v]) => !v.trim() || placeholders(k) !== placeholders(v) || (/[a-z]{4,} [a-z]{4,}/.test(v) && !/[\u3400-\u9fff]/.test(v)));
    expect(bad).toEqual([]);
  });
});
