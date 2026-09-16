/**
 * Short lessons for the kid view (/kid/<vault>), for readers of about 8 to 14.
 *
 * Content rules: timeless facts only (no prices, market sizes or rankings), no
 * predictions, and nothing that tells anyone what to do with money. Each
 * lesson ends with one multiple-choice question that has exactly one right
 * answer and an explanation shown whichever answer was picked.
 */

export interface QuizOption {
  id: string;
  text: string;
  correct?: true;
}

export interface Lesson {
  /** URL-safe, stable: progress is stored by id. */
  id: string;
  kind: 'general' | 'company';
  /** Ticker the lesson is about (company lessons only). */
  symbol?: string;
  /** Short name for links such as "Learn about Apple" (company lessons only). */
  name?: string;
  title: string;
  /** One line for the lesson card. */
  summary: string;
  /** Two to four short paragraphs. */
  body: string[];
  quiz: {
    question: string;
    options: [QuizOption, QuizOption, QuizOption];
    /** Shown after any answer, right or wrong. */
    explanation: string;
  };
}

const COMPANY_LESSONS: Lesson[] = [
  {
    id: 'aapl',
    kind: 'company',
    symbol: 'AAPL',
    name: 'Apple',
    title: 'Apple',
    summary: 'The company behind the iPhone and the Mac.',
    body: [
      'Apple makes the iPhone, the Mac, the iPad and the Apple Watch.',
      'It also runs services that people pay for, like the App Store, Apple Music and iCloud storage for photos and files.',
      'When people pick Apple products and services, that money goes to the company. How well Apple does, and how people feel about its future, both help decide what an Apple share is worth. That can go up or down.',
    ],
    quiz: {
      question: 'Which of these does Apple make?',
      options: [
        { id: 'xbox', text: 'The Xbox' },
        { id: 'iphone', text: 'The iPhone', correct: true },
        { id: 'windows', text: 'Windows' },
      ],
      explanation: 'Apple makes the iPhone. The Xbox and Windows come from Microsoft.',
    },
  },
  {
    id: 'nvda',
    kind: 'company',
    symbol: 'NVDA',
    name: 'NVIDIA',
    title: 'NVIDIA',
    summary: 'A company that designs chips for games, graphics and AI.',
    body: [
      'NVIDIA designs computer chips. Its best-known chips are GPUs (graphics processing units), which draw the pictures you see in video games.',
      'GPUs are very good at doing lots of small math problems at the same time. That makes them useful for graphics, video and artificial intelligence (AI), which needs a huge amount of math.',
      'NVIDIA designs the chips, and factories run by other companies usually build them.',
    ],
    quiz: {
      question: 'What are NVIDIA’s GPUs used for?',
      options: [
        { id: 'sneakers', text: 'Making sneakers' },
        { id: 'packages', text: 'Delivering packages' },
        { id: 'graphics', text: 'Games, graphics and AI', correct: true },
      ],
      explanation: 'NVIDIA designs GPUs, chips that draw game graphics and do the math behind AI.',
    },
  },
  {
    id: 'msft',
    kind: 'company',
    symbol: 'MSFT',
    name: 'Microsoft',
    title: 'Microsoft',
    summary: 'Windows, Office, Xbox and cloud computing.',
    body: [
      'Microsoft makes Windows, which runs on lots of computers, and Office apps like Word, Excel and PowerPoint.',
      'It makes the Xbox game console, and it owns the studio behind Minecraft.',
      'A big part of its business is cloud computing: other companies rent Microsoft’s powerful computers over the internet instead of running all of their own.',
    ],
    quiz: {
      question: 'What is cloud computing?',
      options: [
        { id: 'internet', text: 'Using powerful computers over the internet', correct: true },
        { id: 'sky', text: 'Computers that float in the sky' },
        { id: 'weather', text: 'A way to forecast the weather' },
      ],
      explanation: 'Cloud computing means using computers in big data centers over the internet, like Microsoft’s.',
    },
  },
  {
    id: 'spy',
    kind: 'company',
    symbol: 'SPY',
    name: 'SPY',
    title: 'SPY: lots of companies at once',
    summary: 'One piece holds a sliver of about 500 big US companies.',
    body: [
      'SPY isn’t one company. It’s a fund that follows the S&P 500, a list of about 500 large companies in the United States.',
      'One piece of SPY holds a tiny sliver of all of those companies at once, including Apple, NVIDIA and Microsoft.',
      'Because it is spread across so many companies, one company’s bad day matters less to SPY. When most companies fall together, SPY falls too.',
    ],
    quiz: {
      question: 'What does one piece of SPY hold?',
      options: [
        { id: 'one', text: 'A piece of just one company' },
        { id: 'many', text: 'A sliver of about 500 companies', correct: true },
        { id: 'cash', text: 'Only dollars' },
      ],
      explanation: 'SPY follows the S&P 500, so each piece holds a little bit of about 500 large US companies.',
    },
  },
];

const GENERAL_LESSONS: Lesson[] = [
  {
    id: 'share',
    kind: 'general',
    title: 'What is a share?',
    summary: 'A tiny piece of a company.',
    body: [
      'Big companies are owned by lots of people. A share is one tiny piece of a company.',
      'Picture a company as a giant pizza cut into millions of slices. One share is one slice.',
      'You can own part of a share, too, like a sliver of a slice. That’s why your sprout can show numbers like 0.04.',
    ],
    quiz: {
      question: 'What is a share?',
      options: [
        { id: 'piece', text: 'A tiny piece of a company', correct: true },
        { id: 'coupon', text: 'A coupon for free things from a store' },
        { id: 'loan', text: 'Money you have to pay back' },
      ],
      explanation: 'A share is a small piece of a company, like one slice of a very big pizza.',
    },
  },
  {
    id: 'tokens',
    kind: 'general',
    title: 'What your sprout really holds',
    summary: 'Tokens that follow the price of a share.',
    body: [
      'Your sprout doesn’t keep paper shares in a drawer. It holds stock tokens made by Robinhood: digital pieces built to follow the price of a real share.',
      'When an Apple share gets more expensive, the Apple token does too. When the share gets cheaper, so does the token.',
      'A token isn’t exactly the same as owning the share yourself. For example, it doesn’t give you a vote at the company’s meetings.',
      'Money that hasn’t been planted in stocks yet waits as USDG, a digital dollar that is designed to stay worth $1.',
    ],
    quiz: {
      question: 'What does a stock token in your sprout do?',
      options: [
        { id: 'same', text: 'Stays at the same price forever' },
        { id: 'boss', text: 'Lets you run the company' },
        { id: 'follows', text: 'Follows the price of a real share', correct: true },
      ],
      explanation: 'A stock token moves with the price of its share, up and down. It doesn’t put you in charge of the company.',
    },
  },
  {
    id: 'big-day',
    kind: 'general',
    title: 'Why your sprout waits for the big day',
    summary: 'A savings jar that opens on one special date.',
    body: [
      'Your sprout is like a savings jar with a lid that opens on one date: the big day. That date was picked when the sprout was planted, and it can’t be changed.',
      'Until then, a grown-up looks after it. They can add money, plant it in stocks and set up chores. Nobody can take the money out early, except chore rewards once they’re ready for you.',
      'The wait keeps the money planted for years instead of being spent on something quick. On the big day, the sprout becomes yours.',
    ],
    quiz: {
      question: 'When does the sprout become yours?',
      options: [
        { id: 'birthday', text: 'On any birthday you choose' },
        { id: 'bigday', text: 'On the big day picked when it was planted', correct: true },
        { id: 'anytime', text: 'Whenever a grown-up says so' },
      ],
      explanation: 'The big day was set when the sprout was planted, and it doesn’t move. That’s when the sprout becomes yours.',
    },
  },
  {
    id: 'prices',
    kind: 'general',
    title: 'Why prices go up and down',
    summary: 'Buyers, sellers and news move prices every day.',
    body: [
      'A share’s price is what buyers and sellers agree on right now.',
      'When more people want a company’s shares, maybe because it made something popular, the price tends to rise. When more people want to sell, maybe after a hard year or worrying news, it tends to fall.',
      'Prices can change every day, sometimes a lot, and nobody knows for sure what comes next.',
    ],
    quiz: {
      question: 'What usually happens when many more people want a share than want to sell it?',
      options: [
        { id: 'same', text: 'The price never changes' },
        { id: 'zero', text: 'The price drops to zero' },
        { id: 'rise', text: 'The price tends to go up', correct: true },
      ],
      explanation: 'More people wanting a share pushes the price up. More people selling pushes it down.',
    },
  },
  {
    id: 'baskets',
    kind: 'general',
    title: 'Don’t put all your eggs in one basket',
    summary: 'Why spreading out can help.',
    body: [
      'If you carry all your eggs in one basket and drop it, they might all break. Spread them across a few baskets and one slip won’t break them all.',
      'Owning pieces of different companies works the same way. If one company has a hard year, others might be doing fine.',
      'Spreading out doesn’t stop values from falling, but it means one company’s bad luck matters less.',
    ],
    quiz: {
      question: 'Why might someone own pieces of several companies instead of one?',
      options: [
        { id: 'less', text: 'So one company’s bad year matters less', correct: true },
        { id: 'up', text: 'So prices can only go up' },
        { id: 'rule', text: 'Because owning one company isn’t allowed' },
      ],
      explanation: 'Spreading out means trouble at one company hurts less. It can’t stop all the ups and downs, though.',
    },
  },
  {
    id: 'patience',
    kind: 'general',
    title: 'Time and patience',
    summary: 'Small amounts, many years, and honest ups and downs.',
    body: [
      'Small amounts added again and again can add up over the years. If the companies grow, the pieces you own can be worth more, and growth can build on earlier growth.',
      'But it isn’t a promise. Values can fall, sometimes for a long time, and a sprout can end up worth less than what was put in.',
      'Checking every day can feel like a roller coaster. Looking across years instead of days shows the bigger picture.',
    ],
    quiz: {
      question: 'Which is true about saving small amounts for many years?',
      options: [
        { id: 'double', text: 'It always doubles every year' },
        { id: 'big', text: 'Only big amounts can grow' },
        { id: 'honest', text: 'It can add up, but values can also fall', correct: true },
      ],
      explanation: 'Small amounts can add up over time, but nothing is certain. Values can go down as well as up.',
    },
  },
  {
    id: 'gifts',
    kind: 'general',
    title: 'Gifts and chore rewards',
    summary: 'What each one does to your sprout.',
    body: [
      'When family sends a gift with a gift link, it adds more to your sprout. It can be planted in stocks and grow along with everything else.',
      'A chore reward works the other way around. A grown-up sets aside some of what’s already in your sprout for a chore. Once they say it’s done, you can claim the reward and use it now.',
      'Whatever you claim leaves the sprout, so it stops growing there. Now or later is a good thing to talk about with your grown-up.',
    ],
    quiz: {
      question: 'What does a gift from family do to your sprout?',
      options: [
        { id: 'unlock', text: 'Opens it before the big day' },
        { id: 'adds', text: 'Adds more to it', correct: true },
        { id: 'takes', text: 'Takes money out of it' },
      ],
      explanation: 'A gift adds to your sprout so it has more that can grow. It doesn’t change the big day.',
    },
  },
];

/** Every lesson in catalog order: general lessons, then companies. */
export const LESSONS: readonly Lesson[] = [...GENERAL_LESSONS, ...COMPANY_LESSONS];

export function findLesson(id: string | null | undefined): Lesson | null {
  if (!id) return null;
  return LESSONS.find((l) => l.id === id) ?? null;
}

/**
 * Company lessons for stocks the sprout holds come first (in holdings order),
 * then the general lessons, then the other company lessons. Tickers without a
 * lesson are ignored.
 */
export function orderLessons(heldSymbols: readonly string[], lessons: readonly Lesson[] = LESSONS): Lesson[] {
  const held = new Set<Lesson>();
  for (const symbol of heldSymbols) {
    const upper = symbol.trim().toUpperCase();
    const lesson = lessons.find((l) => l.kind === 'company' && l.symbol === upper);
    if (lesson) held.add(lesson);
  }
  return [
    ...held,
    ...lessons.filter((l) => l.kind === 'general'),
    ...lessons.filter((l) => l.kind === 'company' && !held.has(l)),
  ];
}

/** The lesson for a ticker, if there is one. */
export function lessonForSymbol(symbol: string): Lesson | null {
  const upper = symbol.trim().toUpperCase();
  return LESSONS.find((l) => l.kind === 'company' && l.symbol === upper) ?? null;
}

export function correctOption(lesson: Lesson): QuizOption {
  const option = lesson.quiz.options.find((o) => o.correct);
  if (!option) throw new Error(`lesson ${lesson.id} has no correct answer`);
  return option;
}
