import { afterEach, describe, expect, test } from 'bun:test';
import { VotesApiError, leadingOptions, votesApi, weightedShares } from '../src/perks/votesApi';

describe('holder vote shares', () => {
  test('whole percentages of the weighted vote that add up to 100', () => {
    expect(weightedShares([{ weight: 3 }, { weight: 5 }, { weight: 10 }])).toEqual([17, 28, 55]);
    expect(weightedShares([{ weight: 1 }, { weight: 1 }, { weight: 1 }])).toEqual([34, 33, 33]);
    expect(weightedShares([{ weight: 10 }, { weight: 0 }])).toEqual([100, 0]);
    for (const weights of [[1, 2, 5, 10], [7, 7, 7, 7, 7, 7], [1, 1000]]) {
      expect(weightedShares(weights.map((weight) => ({ weight }))).reduce((a, b) => a + b, 0)).toBe(100);
    }
  });

  test('all zeros before anyone votes', () => {
    expect(weightedShares([{ weight: 0 }, { weight: 0 }])).toEqual([0, 0]);
    expect(weightedShares([])).toEqual([]);
  });

  test('the leading option, every option in a tie, none before any votes', () => {
    expect(leadingOptions([{ id: 'COIN', weight: 3 }, { id: 'PLTR', weight: 10 }])).toEqual(['PLTR']);
    expect(leadingOptions([{ id: 'COIN', weight: 5 }, { id: 'HOOD', weight: 5 }, { id: 'PLTR', weight: 1 }])).toEqual(['COIN', 'HOOD']);
    expect(leadingOptions([{ id: 'COIN', weight: 0 }, { id: 'HOOD', weight: 0 }])).toEqual([]);
  });
});

describe('votes api errors', () => {
  const realFetch = globalThis.fetch;
  afterEach(() => {
    globalThis.fetch = realFetch;
  });

  test("keep the HTTP status and the server's own message", async () => {
    globalThis.fetch = (async () => new Response(JSON.stringify({ error: 'poll not found' }), { status: 404 })) as unknown as typeof fetch;
    const error = await votesApi.mine('missing', '0x00000000000000000000000000000000000000aa').catch((e: unknown) => e);
    expect(error).toBeInstanceOf(VotesApiError);
    expect((error as VotesApiError).status).toBe(404);
    expect((error as VotesApiError).message).toBe('poll not found');
  });
});
