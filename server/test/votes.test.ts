import { describe, expect, test } from 'bun:test';
import { generatePrivateKey, privateKeyToAccount, type PrivateKeyAccount } from 'viem/accounts';
import { issueNonce } from '../src/auth';
import { createApp } from '../src/app';
import { loadPerksConfig, type HolderChecker, type TierId } from '../src/holders';
import { memoryDb, testimonialChain } from './helpers';

const TOKEN = '0x5ec27c931fb49911128dddf7d914c1754da9f49f';
const START_MS = 1_789_000_000_000;
const START = START_MS / 1000;
const DAY = 86_400;

interface PollJson {
  id: string;
  question: string;
  opensAt: number;
  closesAt: number;
  status: 'upcoming' | 'open' | 'closed';
  options: Array<{ id: string; label: string; weight: number; voters: number }>;
  totalWeight: number;
  totalVoters: number;
}

/** A holder checker whose tiers the test sets; `checks` counts tier reads. */
function fakeHolders() {
  const tiers = new Map<string, TierId | null>();
  const checks = { n: 0 };
  const checker: HolderChecker = {
    config: loadPerksConfig({ SPROUT_HOLDER_TOKEN: TOKEN }),
    async status() {
      throw new Error('not used by votes');
    },
    async tier(address) {
      checks.n++;
      return tiers.get(address.toLowerCase()) ?? null;
    },
  };
  return {
    checker,
    checks,
    set: (who: PrivateKeyAccount, tier: TierId | null) => void tiers.set(who.address.toLowerCase(), tier),
  };
}

function setup(opts: { adminToken?: string } = {}) {
  const db = memoryDb();
  const clock = { ms: START_MS };
  const holders = fakeHolders();
  const app = createApp({
    db,
    chain: testimonialChain(),
    localDemo: false,
    adminToken: opts.adminToken ?? 'secret',
    now: () => clock.ms,
    holders: holders.checker,
  });
  return { db, clock, holders, app };
}

type Ctx = ReturnType<typeof setup>;

async function signed(ctx: Ctx, who: PrivateKeyAccount, purpose = 'vote') {
  const challenge = issueNonce(ctx.db, { address: who.address, purpose, now: ctx.clock.ms });
  return {
    'content-type': 'application/json',
    'x-sprout-address': who.address,
    'x-sprout-nonce': challenge.nonce,
    'x-sprout-signature': await who.signMessage({ message: challenge.message }),
  };
}

const OPTIONS = [
  { id: 'COIN', label: 'Coinbase' },
  { id: 'HOOD', label: 'Robinhood' },
  { id: 'PLTR', label: 'Palantir' },
];

async function createPoll(ctx: Ctx, body: Record<string, unknown> = {}, token: string | null = 'secret') {
  return ctx.app.request('/api/polls', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(token ? { 'x-sprout-admin-token': token } : {}) },
    body: JSON.stringify({ question: 'Which stock should Sprout add next?', options: OPTIONS, closesAt: START + 7 * DAY, ...body }),
  });
}

async function openPoll(ctx: Ctx, body: Record<string, unknown> = {}): Promise<PollJson> {
  const res = await createPoll(ctx, body);
  expect(res.status).toBe(201);
  return ((await res.json()) as { poll: PollJson }).poll;
}

async function vote(ctx: Ctx, who: PrivateKeyAccount, pollId: string, optionId: string) {
  return ctx.app.request(`/api/polls/${pollId}/vote`, {
    method: 'POST',
    headers: await signed(ctx, who),
    body: JSON.stringify({ optionId }),
  });
}

async function listPolls(ctx: Ctx) {
  const res = await ctx.app.request('/api/polls');
  expect(res.status).toBe(200);
  return (await res.json()) as { polls: PollJson[]; weights: Record<TierId, number> };
}

const wallet = () => privateKeyToAccount(generatePrivateKey());
const option = (poll: PollJson, id: string) => poll.options.find((o) => o.id === id)!;

describe('holder votes', () => {
  test('votes count by tier: seedling 1, sapling 2, bloom 5, grove 10', async () => {
    const ctx = setup();
    const poll = await openPoll(ctx);
    expect(poll.status).toBe('open');
    const [a, b, c, d] = [wallet(), wallet(), wallet(), wallet()];
    ctx.holders.set(a, 'seedling');
    ctx.holders.set(b, 'sapling');
    ctx.holders.set(c, 'bloom');
    ctx.holders.set(d, 'grove');

    const first = await vote(ctx, a, poll.id, 'COIN');
    expect(first.status).toBe(200);
    const body = (await first.json()) as { poll: PollJson; vote: Record<string, unknown> };
    expect(body.vote).toEqual({ pollId: poll.id, optionId: 'COIN', tier: 'seedling', weight: 1, votedAt: START });
    expect(option(body.poll, 'COIN')).toMatchObject({ weight: 1, voters: 1 });

    expect((await vote(ctx, b, poll.id, 'COIN')).status).toBe(200);
    expect((await vote(ctx, c, poll.id, 'HOOD')).status).toBe(200);
    expect((await vote(ctx, d, poll.id, 'PLTR')).status).toBe(200);

    const { polls, weights } = await listPolls(ctx);
    expect(weights).toEqual({ seedling: 1, sapling: 2, bloom: 5, grove: 10 });
    expect(polls).toHaveLength(1);
    expect(polls[0]!.options).toEqual([
      { id: 'COIN', label: 'Coinbase', weight: 3, voters: 2 },
      { id: 'HOOD', label: 'Robinhood', weight: 5, voters: 1 },
      { id: 'PLTR', label: 'Palantir', weight: 10, voters: 1 },
    ]);
    expect(polls[0]!.totalWeight).toBe(18);
    expect(polls[0]!.totalVoters).toBe(4);
  });

  test('a wallet without a tier gets a 403 and nothing is counted', async () => {
    const ctx = setup();
    const poll = await openPoll(ctx);
    const nobody = wallet();
    const res = await vote(ctx, nobody, poll.id, 'COIN');
    expect(res.status).toBe(403);
    expect(((await res.json()) as { error: string }).error).toBe('Voting is for SPROUT holders');
    expect((await listPolls(ctx)).polls[0]!.totalVoters).toBe(0);
  });

  test('voting needs a signed request for the vote purpose', async () => {
    const ctx = setup();
    const poll = await openPoll(ctx);
    const holder = wallet();
    ctx.holders.set(holder, 'grove');
    const unsigned = await ctx.app.request(`/api/polls/${poll.id}/vote`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ optionId: 'COIN' }),
    });
    expect(unsigned.status).toBe(401);
    const wrongPurpose = await ctx.app.request(`/api/polls/${poll.id}/vote`, {
      method: 'POST',
      headers: await signed(ctx, holder, 'gift-create'),
      body: JSON.stringify({ optionId: 'COIN' }),
    });
    expect(wrongPurpose.status).toBe(401);
  });

  test('a wallet can change its vote, and the change carries its tier now', async () => {
    const ctx = setup();
    const poll = await openPoll(ctx);
    const holder = wallet();
    ctx.holders.set(holder, 'seedling');
    expect((await vote(ctx, holder, poll.id, 'COIN')).status).toBe(200);

    ctx.clock.ms += 3600_000;
    ctx.holders.set(holder, 'bloom');
    const changed = await vote(ctx, holder, poll.id, 'HOOD');
    expect(changed.status).toBe(200);
    const body = (await changed.json()) as { poll: PollJson; vote: { optionId: string; tier: string; weight: number; votedAt: number } };
    expect(body.vote).toMatchObject({ optionId: 'HOOD', tier: 'bloom', weight: 5, votedAt: START + 3600 });
    expect(option(body.poll, 'COIN')).toMatchObject({ weight: 0, voters: 0 });
    expect(option(body.poll, 'HOOD')).toMatchObject({ weight: 5, voters: 1 });
    expect(body.poll.totalVoters).toBe(1);
    expect(ctx.holders.checks.n).toBe(2);

    const mine = await ctx.app.request(`/api/polls/${poll.id}/mine?address=${holder.address}`);
    expect(mine.status).toBe(200);
    expect(((await mine.json()) as { vote: { optionId: string } | null }).vote?.optionId).toBe('HOOD');
    // The lookup ignores address case.
    const lower = await ctx.app.request(`/api/polls/${poll.id}/mine?address=${holder.address.toLowerCase()}`);
    expect(((await lower.json()) as { vote: { weight: number } | null }).vote?.weight).toBe(5);
  });

  test('mine is null for a wallet that has not voted, and checks its input', async () => {
    const ctx = setup();
    const poll = await openPoll(ctx);
    const res = await ctx.app.request(`/api/polls/${poll.id}/mine?address=${wallet().address}`);
    expect(await res.json()).toEqual({ vote: null });
    expect((await ctx.app.request(`/api/polls/${poll.id}/mine?address=nope`)).status).toBe(400);
    expect((await ctx.app.request(`/api/polls/missing/mine?address=${wallet().address}`)).status).toBe(404);
  });

  test('a closed poll refuses votes, keeps its result listed for 30 days, then drops off', async () => {
    const ctx = setup();
    const poll = await openPoll(ctx, { closesAt: START + DAY });
    const holder = wallet();
    ctx.holders.set(holder, 'sapling');
    expect((await vote(ctx, holder, poll.id, 'PLTR')).status).toBe(200);

    ctx.clock.ms = (START + DAY) * 1000;
    const late = await vote(ctx, holder, poll.id, 'COIN');
    expect(late.status).toBe(409);
    expect(((await late.json()) as { error: string }).error).toBe('This poll has closed');

    const listed = (await listPolls(ctx)).polls;
    expect(listed).toHaveLength(1);
    expect(listed[0]!.status).toBe('closed');
    expect(option(listed[0]!, 'PLTR')).toMatchObject({ weight: 2, voters: 1 });

    ctx.clock.ms = (START + DAY + 30 * DAY - 1) * 1000;
    expect((await listPolls(ctx)).polls).toHaveLength(1);
    ctx.clock.ms = (START + DAY + 30 * DAY) * 1000;
    expect((await listPolls(ctx)).polls).toHaveLength(0);
  });

  test('a poll that has not opened refuses votes and is not listed yet', async () => {
    const ctx = setup();
    const poll = await openPoll(ctx, { opensAt: START + DAY, closesAt: START + 3 * DAY });
    expect(poll.status).toBe('upcoming');
    const holder = wallet();
    ctx.holders.set(holder, 'grove');
    const early = await vote(ctx, holder, poll.id, 'COIN');
    expect(early.status).toBe(409);
    expect(((await early.json()) as { error: string }).error).toBe('This poll has not opened yet');
    expect((await listPolls(ctx)).polls).toHaveLength(0);

    ctx.clock.ms = (START + DAY) * 1000;
    expect((await listPolls(ctx)).polls.map((p) => p.status)).toEqual(['open']);
    expect((await vote(ctx, holder, poll.id, 'COIN')).status).toBe(200);
  });

  test('open polls come first (closing soonest), then closed ones (latest first)', async () => {
    const ctx = setup();
    const a = await openPoll(ctx, { question: 'A', closesAt: START + 2 * DAY });
    const b = await openPoll(ctx, { question: 'B', closesAt: START + 10 * DAY });
    const c = await openPoll(ctx, { question: 'C', closesAt: START + 5 * DAY });
    const d = await openPoll(ctx, { question: 'D', closesAt: START + 3 * DAY });
    ctx.clock.ms = (START + 4 * DAY) * 1000;
    const polls = (await listPolls(ctx)).polls;
    expect(polls.map((p) => p.id)).toEqual([c.id, b.id, d.id, a.id]);
    expect(polls.map((p) => p.status)).toEqual(['open', 'open', 'closed', 'closed']);
  });

  test('an unknown option is a 400 and an unknown poll a 404', async () => {
    const ctx = setup();
    const poll = await openPoll(ctx);
    const holder = wallet();
    ctx.holders.set(holder, 'grove');
    const res = await vote(ctx, holder, poll.id, 'TSLA');
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toBe('unknown option');
    expect((await vote(ctx, holder, 'missing', 'COIN')).status).toBe(404);
    expect((await listPolls(ctx)).polls[0]!.totalVoters).toBe(0);
  });

  test('only an admin can create a poll', async () => {
    const ctx = setup();
    expect((await createPoll(ctx, {}, null)).status).toBe(401);
    expect((await createPoll(ctx, {}, 'wrong')).status).toBe(401);
    expect((await listPolls(ctx)).polls).toHaveLength(0);

    // Without a configured admin token, a public server refuses outright.
    const db = memoryDb();
    const noToken = createApp({ db, chain: testimonialChain(), localDemo: false, holders: fakeHolders().checker, now: () => START_MS });
    const refused = await noToken.request('/api/polls', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ question: 'Q', options: OPTIONS, closesAt: START + DAY }),
    });
    expect(refused.status).toBe(403);

    const created = await createPoll(ctx, { question: '  Which   stock\nnext? ' });
    expect(created.status).toBe(201);
    const { poll } = (await created.json()) as { poll: PollJson };
    expect(poll.question).toBe('Which stock next?');
    expect(poll.opensAt).toBe(START);
    expect(poll.options.map((o) => o.id)).toEqual(['COIN', 'HOOD', 'PLTR']);
    expect(poll.totalWeight).toBe(0);
  });

  test('poll input is checked: 2-12 options, sane text and dates', async () => {
    const ctx = setup();
    const many = Array.from({ length: 13 }, (_, i) => ({ id: `S${i}`, label: `Stock ${i}` }));
    const cases: Array<Record<string, unknown>> = [
      { options: [OPTIONS[0]] },
      { options: many },
      { options: [OPTIONS[0], { id: 'coin', label: 'Coinbase again' }] },
      { options: [OPTIONS[0], { id: 'bad id!', label: 'Bad' }] },
      { options: [OPTIONS[0], { id: 'EMPTY', label: '   ' }] },
      { options: [OPTIONS[0], { id: 'LONG', label: 'x'.repeat(61) }] },
      { question: 'q'.repeat(141) },
      { question: '   ' },
      { question: 'Vote at https://example.com' },
      { closesAt: START },
      { opensAt: START + 2 * DAY, closesAt: START + DAY },
      { closesAt: START + 91 * DAY },
      { closesAt: 'soon' },
    ];
    for (const body of cases) {
      const res = await createPoll(ctx, body);
      expect({ body, status: res.status }).toEqual({ body, status: 400 });
    }
    expect((await createPoll(ctx, { options: many.slice(0, 12), closesAt: START + 90 * DAY })).status).toBe(201);
  });

  test('public totals never include wallet addresses', async () => {
    const ctx = setup();
    const poll = await openPoll(ctx);
    const voters = [wallet(), wallet(), wallet()];
    for (const [i, v] of voters.entries()) {
      ctx.holders.set(v, 'bloom');
      expect((await vote(ctx, v, poll.id, OPTIONS[i]!.id)).status).toBe(200);
    }
    const list = await (await ctx.app.request('/api/polls')).text();
    const voteResponse = await (await vote(ctx, voters[0]!, poll.id, 'HOOD')).text();
    for (const text of [list.toLowerCase(), voteResponse.toLowerCase()]) {
      expect(text).not.toContain('0x');
      for (const v of voters) expect(text).not.toContain(v.address.slice(2).toLowerCase());
    }
  });
});
