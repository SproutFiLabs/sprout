/**
 * Device-local private labels. These never leave the browser; the backend only
 * stores opaque vault ids.
 */
const NICKNAME_PREFIX = 'sprout.nickname.';
const FAVORITE_PREFIX = 'sprout.favorite.';
const MILESTONE_TITLE_PREFIX = 'sprout.milestone.';

function milestoneKey(chainId: number, vaultId: string, milestoneId: string): string {
  return `${MILESTONE_TITLE_PREFIX}${chainId}.${vaultId.toLowerCase()}.${milestoneId.toLowerCase()}`;
}

/** Device-local title for an on-chain allowance milestone ("chore"). Hash only on-chain. */
export function getMilestoneTitle(chainId: number, vaultId: string, milestoneId: string): string | null {
  try {
    return window.localStorage.getItem(milestoneKey(chainId, vaultId, milestoneId));
  } catch {
    return null;
  }
}

export function setMilestoneTitle(chainId: number, vaultId: string, milestoneId: string, title: string): void {
  try {
    const key = milestoneKey(chainId, vaultId, milestoneId);
    if (title.trim()) window.localStorage.setItem(key, title.trim());
    else window.localStorage.removeItem(key);
  } catch {
    // storage may be unavailable in private mode
  }
}

export function getNickname(vaultId: string): string | null {
  try {
    return window.localStorage.getItem(`${NICKNAME_PREFIX}${vaultId.toLowerCase()}`);
  } catch {
    return null;
  }
}

export function setNickname(vaultId: string, nickname: string): void {
  try {
    if (nickname.trim()) window.localStorage.setItem(`${NICKNAME_PREFIX}${vaultId.toLowerCase()}`, nickname.trim());
    else window.localStorage.removeItem(`${NICKNAME_PREFIX}${vaultId.toLowerCase()}`);
  } catch {
    // storage may be unavailable in private mode
  }
}

export function getFavorites(): string[] {
  try {
    const raw = window.localStorage.getItem(FAVORITE_PREFIX);
    return raw ? (JSON.parse(raw) as string[]) : [];
  } catch {
    return [];
  }
}

export function toggleFavorite(vaultId: string): string[] {
  const current = getFavorites();
  const lower = vaultId.toLowerCase();
  const next = current.includes(lower) ? current.filter((v) => v !== lower) : [...current, lower];
  try {
    window.localStorage.setItem(FAVORITE_PREFIX, JSON.stringify(next));
  } catch {
    // ignore
  }
  return next;
}
