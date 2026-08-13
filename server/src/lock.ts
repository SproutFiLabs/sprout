/**
 * Minimal in-process serialization primitive. The backend is a single Bun
 * process, so a promise queue is enough to prevent overlapping maintenance,
 * indexer and job passes from racing each other.
 */
export function createMutex(): <T>(fn: () => Promise<T>) => Promise<T> {
  let tail: Promise<unknown> = Promise.resolve();
  return function runExclusive<T>(fn: () => Promise<T>): Promise<T> {
    const run = tail.then(fn, fn);
    tail = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  };
}
