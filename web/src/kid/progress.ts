import { LESSONS } from './lessons';

/**
 * Learning progress lives only in this browser, one entry per vault. Storage
 * can be missing or throw (private mode, blocked site data), so every read and
 * write is guarded and the page keeps working for the visit either way.
 */

const PREFIX = 'sprout.learn.';

export type ProgressStorage = Pick<Storage, 'getItem' | 'setItem'>;

export function progressKey(vault: string): string {
  return `${PREFIX}${vault.toLowerCase()}`;
}

function browserStorage(): ProgressStorage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

/** Finished lesson ids, limited to lessons that still exist, without repeats. */
export function loadProgress(vault: string, storage: ProgressStorage | null = browserStorage()): string[] {
  try {
    const raw = storage?.getItem(progressKey(vault));
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    const done = parsed && typeof parsed === 'object' ? (parsed as { done?: unknown }).done : null;
    if (!Array.isArray(done)) return [];
    const known = new Set(LESSONS.map((l) => l.id));
    return [...new Set(done.filter((id): id is string => typeof id === 'string' && known.has(id)))];
  } catch {
    return [];
  }
}

/** Returns false when the browser would not keep it. */
export function saveProgress(vault: string, done: readonly string[], storage: ProgressStorage | null = browserStorage()): boolean {
  try {
    if (!storage) return false;
    storage.setItem(progressKey(vault), JSON.stringify({ done }));
    return true;
  } catch {
    return false;
  }
}

/**
 * Adds a finished lesson and returns the new list. The list is returned even
 * if saving failed, so the badge still updates for this visit.
 */
export function markLessonDone(
  vault: string,
  lessonId: string,
  current: readonly string[],
  storage: ProgressStorage | null = browserStorage(),
): string[] {
  const saved = loadProgress(vault, storage);
  const next = [...new Set([...saved, ...current, lessonId])];
  saveProgress(vault, next, storage);
  return next;
}

export interface Badge {
  id: 'seedling' | 'sprout' | 'sapling' | 'tree';
  name: string;
  /** Lessons needed; `all` means every lesson. */
  need: number | 'all';
}

export const BADGES: readonly Badge[] = [
  { id: 'seedling', name: 'Seedling', need: 1 },
  { id: 'sprout', name: 'Sprout', need: 3 },
  { id: 'sapling', name: 'Sapling', need: 6 },
  { id: 'tree', name: 'Tree', need: 'all' },
];

export interface BadgeProgress {
  /** Highest badge earned, or null before the first lesson. */
  current: Badge | null;
  /** Next badge to earn, or null once every lesson is done. */
  next: Badge | null;
  /** Lessons still needed for `next` (0 when there is none). */
  toNext: number;
  /** Lessons needed for each badge with `all` resolved. */
  needs: Record<Badge['id'], number>;
}

export function badgeProgress(doneCount: number, total: number = LESSONS.length): BadgeProgress {
  const needOf = (b: Badge) => (b.need === 'all' ? total : Math.min(b.need, total));
  const done = Math.max(0, Math.min(doneCount, total));
  let current: Badge | null = null;
  let next: Badge | null = null;
  for (const badge of BADGES) {
    if (needOf(badge) <= done && done > 0) current = badge;
    else if (!next) next = badge;
  }
  const needs = Object.fromEntries(BADGES.map((b) => [b.id, needOf(b)])) as BadgeProgress['needs'];
  return { current, next, toNext: next ? needOf(next) - done : 0, needs };
}
