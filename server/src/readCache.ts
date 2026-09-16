/**
 * A small in-memory cache for chain reads.
 *
 * Every dashboard visit used to cost about thirty RPC requests, and the
 * maintenance loop repeated that for every sprout every thirty seconds. The
 * free RPC tiers this service runs on rate-limit well below what a launch spike
 * would ask for, and a rate-limited RPC is what made funded vaults look empty.
 *
 * Two properties matter more than the TTLs themselves:
 *   - single flight: concurrent callers for the same key share one pending
 *     load, so a hundred people opening the same page cost one read;
 *   - failures are never cached: a rejected load is dropped immediately, so the
 *     next caller retries instead of being served the error.
 */
export interface ReadCache {
  get<T>(key: string, ttlMs: number, load: () => Promise<T>): Promise<T>;
  /** The cached value if it is still fresh, without loading. */
  peek<T>(key: string): T | undefined;
  set<T>(key: string, value: T, ttlMs: number): void;
  /** Drop every entry whose key starts with `prefix` (all entries when omitted). */
  invalidate(prefix?: string): void;
}

interface Entry {
  value?: unknown;
  hasValue: boolean;
  expiresAt: number;
  pending?: Promise<unknown>;
}

export function createReadCache(now: () => number = Date.now): ReadCache {
  const entries = new Map<string, Entry>();

  const fresh = (entry: Entry | undefined): boolean =>
    entry !== undefined && entry.hasValue && entry.expiresAt > now();

  return {
    async get<T>(key: string, ttlMs: number, load: () => Promise<T>): Promise<T> {
      const existing = entries.get(key);
      if (existing && fresh(existing)) return existing.value as T;
      if (existing?.pending) return existing.pending as Promise<T>;

      const entry: Entry = existing ?? { hasValue: false, expiresAt: 0 };
      const pending = load().then(
        (value) => {
          // An invalidate() while loading replaced or removed the entry; the
          // value is still returned to its callers but not stored.
          if (entries.get(key) === entry) {
            entry.value = value;
            entry.hasValue = true;
            entry.expiresAt = now() + ttlMs;
            entry.pending = undefined;
          }
          return value;
        },
        (error: unknown) => {
          if (entries.get(key) === entry) {
            entry.pending = undefined;
            if (!fresh(entry)) entries.delete(key);
          }
          throw error;
        },
      );
      entry.pending = pending;
      entries.set(key, entry);
      return pending;
    },

    peek<T>(key: string): T | undefined {
      const entry = entries.get(key);
      return entry && fresh(entry) ? (entry.value as T) : undefined;
    },

    set<T>(key: string, value: T, ttlMs: number): void {
      entries.set(key, { value, hasValue: true, expiresAt: now() + ttlMs });
    },

    invalidate(prefix?: string): void {
      if (prefix === undefined) {
        entries.clear();
        return;
      }
      for (const key of [...entries.keys()]) {
        if (key.startsWith(prefix)) entries.delete(key);
      }
    },
  };
}

/** Effectively forever, for values the chain never changes (decimals, vault parties). */
export const FOREVER_MS = 365 * 24 * 3600 * 1000;
