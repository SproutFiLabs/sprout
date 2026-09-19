import { sign, type WalletState } from '../wallet';

/**
 * Holder stock votes: fetch helpers and the small bits of arithmetic the
 * component shows. Types mirror server/src/votes.ts.
 */

export type TierId = 'seedling' | 'sapling' | 'bloom' | 'grove';

export interface PollOptionTotal {
  id: string;
  label: string;
  /** Sum of the tier weights of the wallets that chose this option. */
  weight: number;
  voters: number;
}

export interface Poll {
  id: string;
  question: string;
  opensAt: number;
  closesAt: number;
  status: 'upcoming' | 'open' | 'closed';
  options: PollOptionTotal[];
  totalWeight: number;
  totalVoters: number;
}

export interface PollVote {
  pollId: string;
  optionId: string;
  tier: TierId;
  weight: number;
  votedAt: number;
}

export interface PollList {
  polls: Poll[];
  weights: Record<TierId, number>;
}

/** An API failure, keeping the HTTP status and the server's own message. */
export class VotesApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

async function readResponse<T>(res: Response): Promise<T> {
  const text = await res.text();
  if (!res.ok) {
    let message = text;
    try {
      message = (JSON.parse(text) as { error?: string }).error ?? text;
    } catch {
      // not JSON; keep the text
    }
    throw new VotesApiError(res.status, message);
  }
  return JSON.parse(text) as T;
}

async function getJson<T>(url: string): Promise<T> {
  return readResponse<T>(await fetch(url));
}

/** Same signed-nonce flow as signedPostJson in ../api.ts. */
async function signedPostJson<T>(wallet: WalletState, url: string, purpose: string, body: unknown): Promise<T> {
  const challenge = await readResponse<{ nonce: string; message: string }>(
    await fetch('/api/auth/nonce', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ address: wallet.address, purpose }),
    }),
  );
  const signature = await sign(challenge.message, wallet);
  return readResponse<T>(
    await fetch(url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-sprout-address': wallet.address,
        'x-sprout-nonce': challenge.nonce,
        'x-sprout-signature': signature,
      },
      body: JSON.stringify(body),
    }),
  );
}

export const votesApi = {
  polls: () => getJson<PollList>('/api/polls'),
  mine: (pollId: string, address: string) =>
    getJson<{ vote: PollVote | null }>(`/api/polls/${encodeURIComponent(pollId)}/mine?address=${address}`),
  vote: (wallet: WalletState, pollId: string, optionId: string) =>
    signedPostJson<{ poll: Poll; vote: PollVote }>(wallet, `/api/polls/${encodeURIComponent(pollId)}/vote`, 'vote', { optionId }),
  /** The tier a wallet earned by holding (from /api/holders); null when it has none. */
  tier: async (address: string) => (await getJson<{ tier: TierId | null }>(`/api/holders/${address}`)).tier,
};

/**
 * Each option's share of the weighted vote as whole percentages that add up
 * to 100 (largest remainder), or all zeros before anyone votes.
 */
export function weightedShares(options: ReadonlyArray<{ weight: number }>): number[] {
  const total = options.reduce((sum, o) => sum + o.weight, 0);
  if (total <= 0) return options.map(() => 0);
  const exact = options.map((o) => (o.weight / total) * 100);
  const shares = exact.map(Math.floor);
  let left = 100 - shares.reduce((sum, s) => sum + s, 0);
  const order = exact.map((x, i) => ({ i, rest: x - Math.floor(x) })).sort((a, b) => b.rest - a.rest || a.i - b.i);
  for (const { i } of order) {
    if (left <= 0) break;
    shares[i]! += 1;
    left -= 1;
  }
  return shares;
}

/** Ids of the option(s) with the most weight; empty before anyone votes. Ties return every leader. */
export function leadingOptions(options: ReadonlyArray<{ id: string; weight: number }>): string[] {
  const top = Math.max(0, ...options.map((o) => o.weight));
  return top > 0 ? options.filter((o) => o.weight === top).map((o) => o.id) : [];
}
