import { useEffect, useState } from 'react';
import { api, type Health } from './api';

/**
 * Whether the server is running automatic weekly purchases, from /api/health.
 *
 * Several pages warn that automatic investing is switched off. Those warnings
 * have to follow the server, not the copy: the day a keeper is configured, a
 * hard-coded "switched off" becomes false. `null` means not known yet (or the
 * server could not be reached); callers say nothing either way in that case.
 */
let pending: Promise<Health['automation'] | null> | null = null;

/** The server's automation block, fetched once per page. */
export function loadAutomation(): Promise<Health['automation'] | null> {
  pending ??= api
    .health()
    .then((h) => h.automation)
    .catch(() => {
      pending = null;
      return null;
    });
  return pending;
}

export function loadAutomationEnabled(): Promise<boolean | null> {
  return loadAutomation().then((automation) => automation?.enabled ?? null);
}

export function useAutomationEnabled(initial: boolean | null = null): boolean | null {
  const [enabled, setEnabled] = useState<boolean | null>(initial);
  useEffect(() => {
    if (initial !== null) return;
    let live = true;
    void loadAutomationEnabled().then((value) => {
      if (live) setEnabled(value);
    });
    return () => {
      live = false;
    };
  }, [initial]);
  return initial ?? enabled;
}
