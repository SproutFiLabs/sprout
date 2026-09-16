import { useEffect, useMemo, useRef, useState, type RefObject } from 'react';
import { ArrowLeft, ArrowRight, BookOpen, Check, Leaf, Lightbulb, Shrub, Sprout as SproutIcon, TreeDeciduous, X } from 'lucide-react';
import { findLesson, orderLessons, type Lesson, type QuizOption } from './lessons';
import { BADGES, badgeProgress, loadProgress, markLessonDone, type Badge } from './progress';

/**
 * The Learn section of the kid view: lessons tied to what the sprout holds, a
 * one-question quiz each, and badges. Progress stays in this browser only.
 * Every control here opens, closes or answers a lesson; none moves money, and
 * each carries data-learn-control so the browser checks can tell them apart.
 */

const BADGE_ICON: Record<Badge['id'], typeof Leaf> = {
  seedling: SproutIcon,
  sprout: Leaf,
  sapling: Shrub,
  tree: TreeDeciduous,
};

interface Outcome {
  firstTime: boolean;
  earned: Badge | null;
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

function tagFor(lesson: Lesson, held: boolean): string {
  if (held) return 'In your sprout';
  return lesson.kind === 'company' ? 'Company' : 'Basics';
}

export function KidLearn({
  vault,
  heldSymbols,
  openId,
  onNavigate,
}: {
  vault: string;
  heldSymbols: readonly string[];
  openId: string | null;
  onNavigate: (lessonId: string | null) => void;
}) {
  const heldKey = heldSymbols.join(',');
  const lessons = useMemo(() => orderLessons(heldKey ? heldKey.split(',') : []), [heldKey]);
  const heldIds = useMemo(() => {
    const upper = new Set(heldKey.split(',').map((s) => s.trim().toUpperCase()));
    return new Set(lessons.filter((l) => l.kind === 'company' && upper.has(l.symbol ?? '')).map((l) => l.id));
  }, [lessons, heldKey]);
  const [done, setDone] = useState<string[]>(() => loadProgress(vault));
  const open = findLesson(openId);
  const progress = badgeProgress(done.length, lessons.length);

  const sectionRef = useRef<HTMLElement>(null);
  const articleRef = useRef<HTMLElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const shownId = useRef<string | null | undefined>(undefined);

  useEffect(() => {
    setDone(loadProgress(vault));
  }, [vault]);

  // Focus follows the view: into the lesson when one opens, back to its card
  // when it closes.
  useEffect(() => {
    const previous = shownId.current;
    shownId.current = open?.id ?? null;
    if (previous === (open?.id ?? null)) return;
    if (open) {
      articleRef.current?.scrollIntoView({ block: 'start' });
      headingRef.current?.focus({ preventScroll: true });
    } else if (previous) {
      sectionRef.current?.querySelector<HTMLButtonElement>(`button[data-lesson-id="${previous}"]`)?.focus();
    }
  }, [open?.id]);

  /** Records a right answer; says whether it finished the lesson and earned a badge. */
  const complete = (lesson: Lesson): Outcome => {
    if (done.includes(lesson.id)) return { firstTime: false, earned: null };
    const before = badgeProgress(done.length, lessons.length).current;
    const next = markLessonDone(vault, lesson.id, done);
    const after = badgeProgress(next.length, lessons.length).current;
    setDone(next);
    return { firstTime: true, earned: after && after.id !== before?.id ? after : null };
  };

  const CurrentIcon = progress.current ? BADGE_ICON[progress.current.id] : SproutIcon;
  const status = !progress.next
    ? 'You finished every lesson.'
    : progress.current
      ? `${plural(progress.toNext, 'more lesson')} to ${progress.next.name}`
      : `Finish a lesson to earn your first badge: ${progress.next.name}`;

  return (
    <section className="kid-card kid-learn" id="learn" ref={sectionRef} aria-labelledby="kid-learn-title" data-testid="kid-learn">
      <div className="kid-learn-head">
        <div className="kid-learn-intro">
          <h2 id="kid-learn-title"><BookOpen size={20} aria-hidden /> Learn</h2>
          <p className="kid-muted">Short lessons about what’s in your sprout. Answer the question at the end of each one to earn badges.</p>
        </div>
        <div className="kid-learn-progress" data-testid="kid-learn-progress">
          <div className="kid-award-now" data-badge={progress.current?.id ?? 'none'}>
            <span className="kid-award-icon" aria-hidden><CurrentIcon size={26} /></span>
            <div>
              <b data-testid="kid-badge-name">{progress.current ? `${progress.current.name} badge` : 'No badge yet'}</b>
              <span data-testid="kid-badge-next">{status}</span>
            </div>
          </div>
          <div className="kid-learn-bar" aria-hidden>
            <span style={{ width: `${Math.round((done.length / Math.max(1, lessons.length)) * 100)}%` }} />
          </div>
          <p className="kid-learn-count" data-testid="kid-learn-count">{done.length} of {plural(lessons.length, 'lesson')} done</p>
          <ol className="kid-awards" aria-label="Badges">
            {BADGES.map((badge) => {
              const Icon = BADGE_ICON[badge.id];
              const need = progress.needs[badge.id];
              const has = done.length >= need && done.length > 0;
              return (
                <li key={badge.id} data-earned={has} data-testid={`kid-badge-${badge.id}`}>
                  <Icon size={18} aria-hidden />
                  <span>{badge.name}</span>
                  <small>{badge.need === 'all' ? 'all lessons' : plural(need, 'lesson')}</small>
                  <span className="kid-sr">{has ? ', earned' : ', not earned yet'}</span>
                </li>
              );
            })}
          </ol>
        </div>
      </div>

      {open ? (
        <LessonView
          key={open.id}
          lesson={open}
          held={heldIds.has(open.id)}
          done={done.includes(open.id)}
          next={nextLesson(lessons, done, open.id)}
          articleRef={articleRef}
          headingRef={headingRef}
          onCorrect={() => complete(open)}
          onNavigate={onNavigate}
        />
      ) : (
        <ul className="kid-lessons" data-testid="kid-lessons">
          {lessons.map((lesson) => {
            const isDone = done.includes(lesson.id);
            return (
              <li key={lesson.id}>
                <button
                  type="button"
                  className="kid-lesson-card"
                  data-learn-control
                  data-testid="kid-lesson-card"
                  data-lesson-id={lesson.id}
                  data-done={isDone}
                  data-held={heldIds.has(lesson.id)}
                  onClick={() => onNavigate(lesson.id)}
                >
                  <span className={`kid-lesson-tag${heldIds.has(lesson.id) ? ' kid-lesson-tag--held' : ''}`}>{tagFor(lesson, heldIds.has(lesson.id))}</span>
                  <span className="kid-lesson-name">{lesson.title}</span>
                  <span className="kid-lesson-summary">{lesson.summary}</span>
                  <span className="kid-lesson-state">
                    {isDone ? <><Check size={15} aria-hidden /> Done</> : 'Not done yet'}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}

      <p className="kid-learn-foot">These lessons are for learning, not financial advice.</p>
    </section>
  );
}

/** The next unfinished lesson after this one, wrapping around; null when all are done. */
function nextLesson(lessons: readonly Lesson[], done: readonly string[], currentId: string): Lesson | null {
  const at = lessons.findIndex((l) => l.id === currentId);
  for (let step = 1; step < lessons.length; step += 1) {
    const candidate = lessons[(at + step) % lessons.length]!;
    if (!done.includes(candidate.id)) return candidate;
  }
  return null;
}

function LessonView({
  lesson,
  held,
  done,
  next,
  articleRef,
  headingRef,
  onCorrect,
  onNavigate,
}: {
  lesson: Lesson;
  held: boolean;
  done: boolean;
  next: Lesson | null;
  articleRef: RefObject<HTMLElement>;
  headingRef: RefObject<HTMLHeadingElement>;
  onCorrect: () => Outcome;
  onNavigate: (lessonId: string | null) => void;
}) {
  const [picked, setPicked] = useState<string | null>(null);
  const [outcome, setOutcome] = useState<Outcome>({ firstTime: false, earned: null });
  const onAnswer = (option: QuizOption) => {
    if (option.id === picked) return;
    setPicked(option.id);
    if (option.correct) setOutcome(onCorrect());
  };
  const { firstTime, earned } = outcome;
  const choice = lesson.quiz.options.find((o) => o.id === picked) ?? null;
  const result = !choice ? 'none' : choice.correct ? 'right' : 'wrong';
  const questionId = `kid-quiz-${lesson.id}`;

  return (
    <article className="kid-lesson" ref={articleRef} aria-labelledby="kid-lesson-title" data-testid="kid-lesson" data-lesson-id={lesson.id} data-done={done}>
      <button type="button" className="kid-learn-back" data-learn-control data-testid="kid-lesson-back" onClick={() => onNavigate(null)}>
        <ArrowLeft size={16} aria-hidden /> All lessons
      </button>
      <div className="kid-lesson-top">
        <span className={`kid-lesson-tag${held ? ' kid-lesson-tag--held' : ''}`}>{tagFor(lesson, held)}</span>
        {done ? <span className="kid-lesson-done" data-testid="kid-lesson-done"><Check size={14} aria-hidden /> Done</span> : null}
      </div>
      <h3 id="kid-lesson-title" ref={headingRef} tabIndex={-1}>{lesson.title}</h3>
      {held && lesson.symbol ? <p className="kid-lesson-held">Your sprout holds {lesson.symbol}, so this lesson is about part of it.</p> : null}
      <div className="kid-lesson-body">
        {lesson.body.map((paragraph) => <p key={paragraph}>{paragraph}</p>)}
      </div>

      <div className="kid-quiz">
        <p className="kid-quiz-label"><Lightbulb size={16} aria-hidden /> Try it</p>
        <p className="kid-quiz-question" id={questionId}>{lesson.quiz.question}</p>
        <div className="kid-quiz-options" role="group" aria-labelledby={questionId}>
          {lesson.quiz.options.map((option, index) => {
            const chosen = option.id === picked;
            return (
              <button
                key={option.id}
                type="button"
                className="kid-quiz-option"
                aria-pressed={chosen}
                data-state={chosen ? (option.correct ? 'right' : 'wrong') : undefined}
                data-learn-control
                data-testid="kid-quiz-option"
                data-option-id={option.id}
                onClick={() => onAnswer(option)}
              >
                <span className="kid-quiz-letter" aria-hidden>{'ABC'[index]}</span>
                <span className="kid-quiz-text">{option.text}</span>
                {chosen ? (option.correct ? <Check size={18} aria-hidden /> : <X size={18} aria-hidden />) : null}
              </button>
            );
          })}
        </div>
        <div className="kid-quiz-feedback" role="status" data-testid="kid-quiz-feedback" data-result={result}>
          {result === 'right' ? (
            <>
              <b>That’s right!</b> {lesson.quiz.explanation}
              {earned ? <> <b>You earned the {earned.name} badge.</b></> : firstTime ? ' Lesson done.' : null}
            </>
          ) : result === 'wrong' ? (
            <>
              <b>Not quite.</b> {lesson.quiz.explanation} Try another answer.
            </>
          ) : null}
        </div>
        {result === 'right' ? (
          <div className="kid-lesson-actions">
            {next ? (
              <button type="button" className="kid-learn-next" data-learn-control data-testid="kid-lesson-next" onClick={() => onNavigate(next.id)}>
                Next: {next.title} <ArrowRight size={16} aria-hidden />
              </button>
            ) : null}
            <button type="button" className="kid-learn-back" data-learn-control onClick={() => onNavigate(null)}>
              <ArrowLeft size={16} aria-hidden /> All lessons
            </button>
          </div>
        ) : null}
      </div>
    </article>
  );
}
