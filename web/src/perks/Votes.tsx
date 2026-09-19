import { useCallback, useEffect, useState } from 'react';
import type { WalletState } from '../wallet';
import { dateLocale, t } from '../i18n';
import { VotesApiError, leadingOptions, votesApi, weightedShares, type Poll, type PollList, type PollVote, type TierId } from './votesApi';
import './votes.css';

/**
 * Holder stock votes: SPROUT holders choose which stock Sprout adds next.
 * A vote counts by the tier the wallet earned by holding, and can be changed
 * until the poll closes. Anyone can see the weighted totals; only the viewer's
 * own choice is shown back to them.
 */

const TIER_NAMES: Record<TierId, string> = { seedling: 'Seedling', sapling: 'Sapling', bloom: 'Bloom', grove: 'Grove' };

function whenText(poll: Poll): string {
  const date = new Date(poll.closesAt * 1000).toLocaleString(dateLocale(), { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
  return poll.status === 'closed' ? t('Closed {date}', { date }) : t('Closes {date}', { date });
}

function voteProblem(e: unknown): string {
  if (e instanceof VotesApiError) {
    if (e.status === 403) return t('Voting is for SPROUT holders.');
    if (e.status === 409) return t('This poll is not taking votes right now.');
    if (e.status === 401) return t('Your wallet signature could not be checked. Please try again.');
    return t('Your vote was not counted: {reason}', { reason: e.message });
  }
  // A wallet that declined to sign, or a dropped connection.
  return t('Your vote was not counted: {reason}', { reason: e instanceof Error ? e.message : String(e) });
}

function PollCard({
  poll,
  mine,
  showVote,
  votingFor,
  locked,
  problem,
  onVote,
}: {
  poll: Poll;
  mine: PollVote | null;
  showVote: boolean;
  /** The option this poll is sending a vote for. */
  votingFor: string | null;
  /** A vote is in flight somewhere on the page. */
  locked: boolean;
  problem: string | null;
  onVote: (optionId: string) => void;
}) {
  const shares = weightedShares(poll.options);
  const leaders = poll.status === 'closed' ? leadingOptions(poll.options) : [];
  const chosen = poll.options.find((o) => o.id === mine?.optionId);
  return (
    <article className={'holder-poll' + (poll.status === 'closed' ? ' holder-poll--closed' : '')} data-testid="holder-poll">
      <h3>{poll.question}</h3>
      <p className="holder-poll-meta">
        {whenText(poll)}
        {' · '}
        {poll.totalVoters === 1 ? t('1 holder voted') : t('{count} holders voted', { count: poll.totalVoters })}
      </p>
      <ul className="holder-poll-options">
        {poll.options.map((o, i) => {
          const share = shares[i] ?? 0;
          const isMine = mine?.optionId === o.id;
          const isLeader = leaders.includes(o.id);
          return (
            <li key={o.id} className={'holder-poll-option' + (isMine ? ' is-mine' : '') + (isLeader ? ' is-leader' : '')}>
              <div className="holder-poll-row">
                <span className="holder-poll-label">
                  {o.label}
                  {isLeader ? <em>{leaders.length > 1 ? t('Tied') : t('Top choice')}</em> : null}
                  {isMine ? <em>{t('Your vote')}</em> : null}
                </span>
                <span className="holder-poll-share">{share}%</span>
                {showVote ? (
                  <button
                    type="button"
                    className="garden-pill garden-pill--sm"
                    data-testid="holder-poll-vote"
                    disabled={locked || isMine}
                    onClick={() => onVote(o.id)}
                  >
                    {votingFor === o.id ? t('Voting…') : isMine ? t('Voted') : mine ? t('Change to this') : t('Vote')}
                  </button>
                ) : null}
              </div>
              <div
                className="holder-poll-bar"
                role="progressbar"
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={share}
                aria-label={t('{option}: {pct}% of the weighted vote', { option: o.label, pct: share })}
              >
                <span style={{ width: `${share}%` }} />
              </div>
            </li>
          );
        })}
      </ul>
      {chosen && poll.status === 'open' ? (
        <p className="holder-poll-note">{t('You voted for {option}. You can change your vote until the poll closes.', { option: chosen.label })}</p>
      ) : null}
      {chosen && poll.status === 'closed' ? <p className="holder-poll-note">{t('You voted for {option}.', { option: chosen.label })}</p> : null}
      {problem ? (
        <p className="holder-poll-problem" role="alert">
          {problem}
        </p>
      ) : null}
    </article>
  );
}

export function HolderVotes({ wallet, onConnect }: { wallet: WalletState | null; onConnect: () => void }) {
  const [list, setList] = useState<PollList | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  // undefined: not known (no wallet, still checking, or the check failed, in which case the server decides).
  const [tier, setTier] = useState<TierId | null | undefined>(undefined);
  const [mine, setMine] = useState<Record<string, PollVote | null>>({});
  const [busy, setBusy] = useState<{ pollId: string; optionId: string } | null>(null);
  const [problems, setProblems] = useState<Record<string, string>>({});
  const address = wallet?.address ?? null;

  const load = useCallback(async () => {
    try {
      setList(await votesApi.polls());
      setLoadFailed(false);
    } catch {
      setLoadFailed(true);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    setTier(undefined);
    if (!address) return;
    let live = true;
    votesApi
      .tier(address)
      .then((found) => live && setTier(found))
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [address]);

  const pollIds = list?.polls.map((p) => p.id).join(',') ?? '';
  useEffect(() => {
    setMine({});
    if (!address || !pollIds) return;
    let live = true;
    for (const id of pollIds.split(',')) {
      votesApi
        .mine(id, address)
        .then((r) => live && setMine((prev) => ({ ...prev, [id]: r.vote })))
        .catch(() => undefined);
    }
    return () => {
      live = false;
    };
  }, [address, pollIds]);

  const castVote = async (poll: Poll, optionId: string) => {
    if (!wallet) {
      onConnect();
      return;
    }
    setBusy({ pollId: poll.id, optionId });
    setProblems((prev) => {
      const next = { ...prev };
      delete next[poll.id];
      return next;
    });
    try {
      const result = await votesApi.vote(wallet, poll.id, optionId);
      setList((prev) => prev && { ...prev, polls: prev.polls.map((p) => (p.id === poll.id ? result.poll : p)) });
      setMine((prev) => ({ ...prev, [poll.id]: result.vote }));
      setTier(result.vote.tier);
    } catch (e) {
      if (e instanceof VotesApiError && e.status === 403) setTier(null);
      // The poll closed (or the list is stale): show where it stands now.
      if (e instanceof VotesApiError && e.status === 409) void load();
      setProblems((prev) => ({ ...prev, [poll.id]: voteProblem(e) }));
    } finally {
      setBusy(null);
    }
  };

  const open = list?.polls.filter((p) => p.status === 'open') ?? [];
  const closed = list?.polls.filter((p) => p.status === 'closed') ?? [];
  const weights = list?.weights;

  return (
    <section className="holder-votes" data-testid="holder-votes" aria-labelledby="holder-votes-title">
      <header className="holder-votes-head">
        <h2 id="holder-votes-title">{t('Holder votes')}</h2>
        <p>{t('SPROUT holders choose which stock Sprout adds next. The more SPROUT a wallet has held, the more its vote counts.')}</p>
        {weights ? (
          <p className="holder-votes-weights">
            {t('Votes by tier: Seedling {seedling}, Sapling {sapling}, Bloom {bloom}, Grove {grove}.', weights)}
          </p>
        ) : null}
      </header>

      {!wallet ? (
        <div className="holder-votes-status">
          <span>{t('Connect the wallet that holds your SPROUT to vote.')}</span>
          <button type="button" className="garden-pill garden-pill--sm" onClick={onConnect}>
            {t('Connect wallet')}
          </button>
        </div>
      ) : tier === null ? (
        <p className="holder-votes-status holder-votes-locked" data-testid="holder-votes-locked">
          <b>{t('Hold SPROUT to vote')}</b>
          <a href="/perks">{t('See how holder tiers work')}</a>
        </p>
      ) : tier && weights ? (
        <p className="holder-votes-status">{t('Your holder tier is {tier}, so your vote counts {weight}.', { tier: t(TIER_NAMES[tier]), weight: weights[tier] })}</p>
      ) : null}

      {loadFailed ? <p className="holder-votes-empty">{t('Votes could not be loaded. Please try again shortly.')}</p> : null}
      {list && open.length === 0 ? <p className="holder-votes-empty">{t('No votes are open right now.')}</p> : null}

      {open.map((poll) => (
        <PollCard
          key={poll.id}
          poll={poll}
          mine={mine[poll.id] ?? null}
          showVote={tier !== null}
          votingFor={busy?.pollId === poll.id ? busy.optionId : null}
          locked={busy !== null}
          problem={problems[poll.id] ?? null}
          onVote={(optionId) => void castVote(poll, optionId)}
        />
      ))}

      {closed.length > 0 ? <h3 className="holder-votes-subhead">{t('Recent results')}</h3> : null}
      {closed.map((poll) => (
        <PollCard key={poll.id} poll={poll} mine={mine[poll.id] ?? null} showVote={false} votingFor={null} locked problem={problems[poll.id] ?? null} onVote={() => undefined} />
      ))}
    </section>
  );
}
