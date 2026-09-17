import { useEffect, useState } from 'react';
import { Check, Moon, Sun, Monitor } from 'lucide-react';

export type Appearance = 'light' | 'dark' | 'system';
type ResolvedAppearance = Exclude<Appearance, 'system'>;
type Subscriber = () => void;

const STORAGE_KEY = 'sprout-appearance';
/**
 * Choices saved before light became the default (mostly from testing the
 * toggle) kept those browsers on dark. Bumping this clears a saved choice
 * once; anything picked after that is kept.
 */
const PREFERENCE_VERSION = '2';
const VERSION_KEY = 'sprout-appearance-version';
const subscribers = new Set<Subscriber>();
let mediaQuery: MediaQueryList | null = null;
let mediaListener: (() => void) | null = null;

function readPreference(): Appearance {
  if (typeof window === 'undefined') return 'system';
  try {
    const value = window.localStorage.getItem(STORAGE_KEY);
    // Light is the brand default; System stays available as an explicit choice.
    return value === 'light' || value === 'dark' || value === 'system' ? value : 'light';
  } catch {
    // Storage blocked (some in-app and private browsers): still light, never the device's dark mode.
    return 'light';
  }
}

function clearStalePreference(): void {
  try {
    const storage = window.localStorage;
    if (storage.getItem(VERSION_KEY) === PREFERENCE_VERSION) return;
    storage.removeItem(STORAGE_KEY);
    storage.setItem(VERSION_KEY, PREFERENCE_VERSION);
  } catch {
    /* storage can be unavailable */
  }
}

function prefersDark(): boolean {
  return typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia('(prefers-color-scheme: dark)').matches;
}

function resolve(preference: Appearance): ResolvedAppearance {
  return preference === 'system' ? (prefersDark() ? 'dark' : 'light') : preference;
}

function apply(preference: Appearance): void {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;
  const resolved = resolve(preference);
  root.dataset.appearance = resolved;
  root.dataset.appearancePreference = preference;
  root.style.colorScheme = resolved;
}

function notify(): void {
  subscribers.forEach((subscriber) => subscriber());
}

/** Apply the saved appearance before React paints, and keep System in sync. */
export function initializeTheme(): Appearance {
  if (typeof window !== 'undefined') clearStalePreference();
  const preference = readPreference();
  apply(preference);
  if (typeof window !== 'undefined' && typeof window.matchMedia === 'function') {
    const nextMedia = window.matchMedia('(prefers-color-scheme: dark)');
    if (mediaQuery !== nextMedia) {
      if (mediaQuery && mediaListener) mediaQuery.removeEventListener?.('change', mediaListener);
      mediaQuery = nextMedia;
      mediaListener = () => {
        if (readPreference() === 'system') { apply('system'); notify(); }
      };
      mediaQuery.addEventListener?.('change', mediaListener);
    }
  }
  return preference;
}

export function getAppearance(): Appearance {
  return readPreference();
}

export function setAppearance(preference: Appearance): void {
  try { window.localStorage.setItem(STORAGE_KEY, preference); } catch { /* storage can be unavailable */ }
  apply(preference);
  notify();
}

function useAppearance(): Appearance {
  const [preference, setPreference] = useState<Appearance>(() => getAppearance());
  const [, forceUpdate] = useState(0);
  useEffect(() => {
    initializeTheme();
    const update = () => { setPreference(getAppearance()); forceUpdate((value) => value + 1); };
    subscribers.add(update);
    return () => { subscribers.delete(update); };
  }, []);
  return preference;
}

const OPTIONS: Array<{ value: Appearance; label: string; description: string; icon: typeof Sun }> = [
  { value: 'light', label: 'Light', description: 'Warm paper and daylight contrast.', icon: Sun },
  { value: 'system', label: 'System', description: 'Follow your device automatically.', icon: Monitor },
  { value: 'dark', label: 'Dark', description: 'A quiet forest palette for evening.', icon: Moon },
];

export function ThemeSettings() {
  const preference = useAppearance();
  return (
    <section className="theme-settings" aria-labelledby="theme-settings-title">
      <div className="theme-settings-heading">
        <span className="theme-settings-eyebrow">Appearance</span>
        <h2 id="theme-settings-title">Choose your garden’s light.</h2>
        <p>This changes the way SPROUT looks on this device. Wallet and family settings stay separate.</p>
      </div>
      <div className="theme-settings-options" role="radiogroup" aria-label="Appearance preference">
        {OPTIONS.map(({ value, label, description, icon: Icon }) => (
          <label className={`theme-option${preference === value ? ' theme-option--selected' : ''}`} key={value}>
            <input type="radio" name="sprout-appearance" value={value} checked={preference === value} onChange={() => setAppearance(value)} />
            <span className="theme-option-icon"><Icon size={18} /></span>
            <span className="theme-option-copy"><b>{label}</b><small>{description}</small></span>
            <span className="theme-option-check" aria-hidden="true"><Check size={15} /></span>
          </label>
        ))}
      </div>
    </section>
  );
}

export function ThemeToggle({ className = '' }: { className?: string }) {
  const preference = useAppearance();
  const dark = resolve(preference) === 'dark';
  return (
    <button
      type="button"
      className={`theme-toggle${className ? ` ${className}` : ''}`}
      onClick={() => setAppearance(dark ? 'light' : 'dark')}
      aria-label={`Switch to ${dark ? 'light' : 'dark'} appearance`}
      title={`Switch to ${dark ? 'light' : 'dark'} appearance`}
    >
      {dark ? <Sun size={16} /> : <Moon size={16} />}
      <span className="theme-toggle-label">{dark ? 'Light' : 'Dark'}</span>
    </button>
  );
}
