import { describe, expect, test } from 'bun:test';
import { correctOption, findLesson, LESSONS, lessonForSymbol, orderLessons } from '../src/kid/lessons';
import { BADGES, badgeProgress, loadProgress, markLessonDone, progressKey, saveProgress, type ProgressStorage } from '../src/kid/progress';
import { kidLessonPath, parseKidPath } from '../src/KidView';

const VAULT = '0x00000000000000000000000000000000000000A1';
const GENERAL = ['share', 'tokens', 'big-day', 'prices', 'baskets', 'patience', 'gifts'];

function memoryStorage(): ProgressStorage & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return {
    data,
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => void data.set(key, value),
  };
}

const throwing: ProgressStorage = {
  getItem: () => {
    throw new Error('SecurityError: storage is disabled');
  },
  setItem: () => {
    throw new Error('QuotaExceededError');
  },
};

describe('lesson content', () => {
  test('covers the general topics and one lesson per company', () => {
    expect(LESSONS.filter((l) => l.kind === 'general').map((l) => l.id)).toEqual(GENERAL);
    expect(LESSONS.filter((l) => l.kind === 'company').map((l) => l.symbol)).toEqual(['AAPL', 'NVDA', 'MSFT', 'SPY']);
  });

  test('every lesson has a title, 2 to 4 paragraphs and a url-safe unique id', () => {
    expect(new Set(LESSONS.map((l) => l.id)).size).toBe(LESSONS.length);
    for (const lesson of LESSONS) {
      expect(lesson.id).toMatch(/^[a-z0-9-]+$/);
      expect(lesson.title.trim().length).toBeGreaterThan(0);
      expect(lesson.summary.trim().length).toBeGreaterThan(0);
      expect(lesson.body.length).toBeGreaterThanOrEqual(2);
      expect(lesson.body.length).toBeLessThanOrEqual(4);
      for (const paragraph of lesson.body) expect(paragraph.trim().length).toBeGreaterThan(0);
    }
  });

  test('every quiz has three options, exactly one right answer and an explanation', () => {
    for (const lesson of LESSONS) {
      const { options, question, explanation } = lesson.quiz;
      expect(question.trim().length).toBeGreaterThan(0);
      expect(options).toHaveLength(3);
      expect(options.filter((o) => o.correct === true)).toHaveLength(1);
      expect(new Set(options.map((o) => o.id)).size).toBe(3);
      for (const option of options) expect(option.text.trim().length).toBeGreaterThan(0);
      expect(explanation.trim().length).toBeGreaterThan(0);
      expect(correctOption(lesson).correct).toBe(true);
    }
  });

  test('the right answer is not always in the same place', () => {
    const positions = new Set(LESSONS.map((l) => l.quiz.options.findIndex((o) => o.correct)));
    expect(positions.size).toBe(3);
  });

  test('reads as teaching, not advice or hype', () => {
    for (const lesson of LESSONS) {
      const text = [lesson.title, lesson.summary, ...lesson.body, lesson.quiz.question, ...lesson.quiz.options.map((o) => o.text), lesson.quiz.explanation].join(' ');
      expect(text).not.toMatch(/\bshould\b|\bbest investment\b|\bbuy (it|now|more|this|shares?)\b|\bguarantee(d)?\b|to the moon/i);
      // Nothing that goes stale: no dollar prices other than USDG's $1 target, no percentages, no years.
      expect(text.replace('worth $1', '')).not.toMatch(/\$\d|\d+ ?%|\b(19|20)\d\d\b|trillion|billion/i);
    }
  });

  test('says plainly that values can fall', () => {
    expect(findLesson('patience')!.body.join(' ')).toMatch(/Values can fall/);
  });

  test('looks lessons up by id and ticker', () => {
    expect(findLesson('aapl')?.symbol).toBe('AAPL');
    expect(findLesson('nope')).toBeNull();
    expect(findLesson(null)).toBeNull();
    expect(lessonForSymbol(' nvda ')?.id).toBe('nvda');
    expect(lessonForSymbol('AAA')).toBeNull();
  });
});

describe('lesson order', () => {
  const ids = (symbols: string[]) => orderLessons(symbols).map((l) => l.id);

  test('puts held companies first, in holdings order, then basics, then other companies', () => {
    expect(ids(['MSFT', 'AAPL'])).toEqual(['msft', 'aapl', ...GENERAL, 'nvda', 'spy']);
    expect(ids(['SPY'])).toEqual(['spy', ...GENERAL, 'aapl', 'nvda', 'msft']);
  });

  test('starts with the basics when nothing held has a lesson', () => {
    expect(ids([])).toEqual([...GENERAL, 'aapl', 'nvda', 'msft', 'spy']);
    expect(ids(['AAA', 'BBB'])).toEqual([...GENERAL, 'aapl', 'nvda', 'msft', 'spy']);
  });

  test('ignores case, repeats and unknown tickers and never drops a lesson', () => {
    const order = ids(['aapl', 'AAA', 'AAPL', '', 'nvda']);
    expect(order.slice(0, 2)).toEqual(['aapl', 'nvda']);
    expect(order).toHaveLength(LESSONS.length);
    expect(new Set(order).size).toBe(LESSONS.length);
  });
});

describe('progress storage', () => {
  test('saves and loads per vault, ignoring address case', () => {
    const storage = memoryStorage();
    expect(loadProgress(VAULT, storage)).toEqual([]);
    expect(saveProgress(VAULT, ['share', 'aapl'], storage)).toBe(true);
    expect(loadProgress(VAULT.toLowerCase(), storage)).toEqual(['share', 'aapl']);
    expect(loadProgress('0x00000000000000000000000000000000000000b2', storage)).toEqual([]);
    expect([...storage.data.keys()]).toEqual([progressKey(VAULT)]);
    expect(progressKey(VAULT)).toBe('sprout.learn.0x00000000000000000000000000000000000000a1');
  });

  test('marking a lesson done adds it once', () => {
    const storage = memoryStorage();
    let done = markLessonDone(VAULT, 'share', [], storage);
    done = markLessonDone(VAULT, 'share', done, storage);
    done = markLessonDone(VAULT, 'prices', done, storage);
    expect(done).toEqual(['share', 'prices']);
    expect(loadProgress(VAULT, storage)).toEqual(['share', 'prices']);
  });

  test('drops unknown ids, repeats and malformed data', () => {
    const storage = memoryStorage();
    storage.setItem(progressKey(VAULT), JSON.stringify({ done: ['share', 'share', 'retired-lesson', 7, null, 'spy'] }));
    expect(loadProgress(VAULT, storage)).toEqual(['share', 'spy']);
    for (const raw of ['not json', 'null', '[]', '{"done":"share"}', '42']) {
      storage.setItem(progressKey(VAULT), raw);
      expect(loadProgress(VAULT, storage)).toEqual([]);
    }
  });

  test('keeps working when storage throws or is missing', () => {
    expect(loadProgress(VAULT, throwing)).toEqual([]);
    expect(saveProgress(VAULT, ['share'], throwing)).toBe(false);
    expect(markLessonDone(VAULT, 'share', ['prices'], throwing)).toEqual(['prices', 'share']);
    expect(loadProgress(VAULT, null)).toEqual([]);
    expect(saveProgress(VAULT, ['share'], null)).toBe(false);
    expect(markLessonDone(VAULT, 'share', [], null)).toEqual(['share']);
  });

  test('without a browser the default storage is treated as unavailable', () => {
    expect(loadProgress(VAULT)).toEqual([]);
    expect(saveProgress(VAULT, ['share'])).toBe(false);
  });
});

describe('badges', () => {
  const total = LESSONS.length;

  test('are Seedling, Sprout, Sapling and Tree at 1, 3, 6 and all lessons', () => {
    expect(BADGES.map((b) => [b.name, b.need])).toEqual([
      ['Seedling', 1],
      ['Sprout', 3],
      ['Sapling', 6],
      ['Tree', 'all'],
    ]);
    expect(badgeProgress(0).needs).toEqual({ seedling: 1, sprout: 3, sapling: 6, tree: total });
  });

  test('track the current badge and how many lessons to the next', () => {
    const at = (n: number) => {
      const p = badgeProgress(n, total);
      return [p.current?.name ?? null, p.next?.name ?? null, p.toNext];
    };
    expect(at(0)).toEqual([null, 'Seedling', 1]);
    expect(at(1)).toEqual(['Seedling', 'Sprout', 2]);
    expect(at(2)).toEqual(['Seedling', 'Sprout', 1]);
    expect(at(3)).toEqual(['Sprout', 'Sapling', 3]);
    expect(at(5)).toEqual(['Sprout', 'Sapling', 1]);
    expect(at(6)).toEqual(['Sapling', 'Tree', total - 6]);
    expect(at(total - 1)).toEqual(['Sapling', 'Tree', 1]);
    expect(at(total)).toEqual(['Tree', null, 0]);
  });

  test('stay sensible outside the normal range', () => {
    expect(badgeProgress(total + 4, total).current?.name).toBe('Tree');
    expect(badgeProgress(-2, total).current).toBeNull();
    // With fewer lessons than a threshold, the higher badges collapse onto "all".
    const small = badgeProgress(2, 2);
    expect(small.current?.name).toBe('Tree');
    expect(small.next).toBeNull();
    expect(badgeProgress(1, 2).next?.name).toBe('Sprout');
    expect(badgeProgress(1, 2).toNext).toBe(1);
  });
});

describe('lesson addresses', () => {
  const vault = '0x00000000000000000000000000000000000000a1';

  test('parse the kid view with and without a lesson', () => {
    expect(parseKidPath(`/kid/${vault}`)).toEqual({ vault, lessonId: null });
    expect(parseKidPath(`/kid/${vault}/`)).toEqual({ vault, lessonId: null });
    expect(parseKidPath(`/kid/${vault}/learn/share`)).toEqual({ vault, lessonId: 'share' });
    expect(parseKidPath(`/kid/${vault}/learn/%E0%A4%A`)).toEqual({ vault, lessonId: null });
    expect(parseKidPath(`/kid/${vault}/learn`)).toBeNull();
    expect(parseKidPath(`/kid/${vault}/learn/a/b`)).toBeNull();
    expect(parseKidPath('/kid/0x123')).toBeNull();
  });

  test('build lesson links that keep the name', () => {
    expect(kidLessonPath(vault, 'aapl', '?name=Maya')).toBe(`/kid/${vault}/learn/aapl?name=Maya`);
    expect(kidLessonPath(vault, null, '?name=Maya')).toBe(`/kid/${vault}?name=Maya`);
    expect(kidLessonPath(vault, 'share')).toBe(`/kid/${vault}/learn/share`);
  });
});
