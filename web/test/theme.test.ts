import { afterAll, beforeEach, describe, expect, test } from 'bun:test';

// A minimal browser: storage, a device that prefers dark, and a root element.
const store = new Map<string, string>();
let storageBlocked = false;
const storage = {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => void store.set(k, v),
  removeItem: (k: string) => void store.delete(k),
};
const root = { dataset: {} as Record<string, string>, style: {} as Record<string, string> };
Object.assign(globalThis, {
  window: {
    get localStorage() {
      if (storageBlocked) throw new Error('SecurityError');
      return storage;
    },
    matchMedia: () => ({ matches: true, addEventListener() {}, removeEventListener() {} }),
  },
  document: { documentElement: root },
});

const { initializeTheme, setAppearance } = await import('../src/theme/ThemeSettings');

// Other test files run in this process and expect no browser globals.
afterAll(() => {
  delete (globalThis as Record<string, unknown>).window;
  delete (globalThis as Record<string, unknown>).document;
});

beforeEach(() => {
  store.clear();
  storageBlocked = false;
  root.dataset = {};
});

describe('appearance on a dark-mode device', () => {
  test('a first visit opens in light', () => {
    expect(initializeTheme()).toBe('light');
    expect(root.dataset.appearance).toBe('light');
  });

  test('a browser that blocks storage still opens in light', () => {
    storageBlocked = true;
    expect(initializeTheme()).toBe('light');
    expect(root.dataset.appearance).toBe('light');
  });

  test('a dark choice saved before the light default is cleared once', () => {
    store.set('sprout-appearance', 'dark');
    expect(initializeTheme()).toBe('light');
    expect(store.has('sprout-appearance')).toBe(false);
  });

  test('a choice made after that is kept, System included', () => {
    initializeTheme();
    setAppearance('dark');
    expect(initializeTheme()).toBe('dark');
    setAppearance('system');
    expect(initializeTheme()).toBe('system');
    expect(root.dataset.appearance).toBe('dark');
  });
});
