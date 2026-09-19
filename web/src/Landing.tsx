import './intelligence/intelligence.css';
import { useEffect, useRef, useState } from 'react';
import { ThemeToggle } from './theme/ThemeSettings';
import { LanguageToggle } from './i18n/LanguageToggle';
import { getLocale, t, tj } from './i18n';
import { api } from './api';
import { useAutomationEnabled } from './automationStatus';
import { BloomGarden } from './garden/BloomGarden';
import { PublicCa } from './components/PublicCa';
import { LandingRootedCounter } from './perks/RootBits';
import {
  ArrowUp, ArrowRight, ArrowLeft, ChevronDown, Menu, X, Play, Pause, Plus, Repeat2, Gift, Check,
  ShieldCheck, Leaf, LayoutGrid, GraduationCap,
} from 'lucide-react';
import './reference/hero-news.css';

const DASHBOARD = '/dashboard';

/**
 * Below this the real count reads as a warning rather than as momentum, so the
 * proof strip keeps its illustrative figure until there is something to show.
 */
const LIVE_COUNT_MINIMUM = 10;

/** The space between two sentences: English needs one, Chinese punctuation does not. */
const gap = (): string => (getLocale() === 'zh' ? '' : ' ');

function PlantedCount() {
  const [planted, setPlanted] = useState<number | null>(null);
  useEffect(() => {
    let live = true;
    api
      .stats()
      .then((s) => {
        if (live) setPlanted(s.sproutsPlanted);
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, []);
  if (planted === null || planted < LIVE_COUNT_MINIMUM) {
    return <div className="proof-number"><strong>$5</strong><span>{t('A little sample starting point')}</span></div>;
  }
  return (
    <div className="proof-number" data-testid="live-planted">
      <strong>{planted.toLocaleString('en-US')}</strong>
      <span>{t('Sprouts planted on Robinhood Chain')}</span>
    </div>
  );
}

const features = [
  {
    tag: 'Weekly investing',
    title: 'Build a little habit that grows with them',
    art: 'orange',
    items: [
      { title: 'Start with an amount that fits your family', text: 'A few dollars, every week. Set a recurring contribution and a starter stock mix for their sprout.' },
      { title: 'Give them little pieces of familiar names', text: 'Each contribution is divided across the selected stock-token mix, with clear allocations you can explore together.' },
      { title: 'Keep the rhythm in your hands', text: 'Adjust the amount or pause future contributions whenever family life changes. Pick it up again when you are ready.' },
    ],
  },
  {
    tag: 'Allowances & gifts',
    title: 'Turn everyday moments into a little ownership',
    art: 'lavender',
    items: [
      { title: 'Make little jobs mean a little more', text: 'Create a chore and set a reward. You approve the little win before its reward is released from the vault.' },
      { title: 'Give their people a simple way to give', text: 'A gift link for birthdays, holidays and just because. Each gift goes directly to their sprout.' },
      { title: 'Keep the thought behind every contribution', text: 'Gifts, earned rewards and regular contributions appear together, so they can see the people and habits helping them grow.' },
    ],
  },
  {
    tag: 'Growing independence',
    title: 'Help them grow into a future of their own',
    art: 'green',
    items: [
      { title: 'Make the ups and downs understandable', text: 'Friendly holdings and a clear history of what went in. Markets have red days too, and their view shows them.' },
      { title: 'Celebrate small milestones together', text: 'Their first contribution. A new growth ring. A habit of checking in together. Little moments that make ownership feel real.' },
      { title: 'Give them a little more freedom over time', text: 'Parent control ends at the graduation timestamp, when full control moves to the child. The final handover is irreversible.' },
    ],
  },
];

const questions: Array<[string, string]> = [
  ['What is a sprout?', 'A dedicated family portfolio for a child, built for tokenized stocks, regular contributions, earned allowances and gifts. A parent guides it until the scheduled handover.'],
  ['Can I look around before connecting?', 'The illustrations on this page show sample portfolios. Open the dashboard to connect your wallet and view your own sprouts. The hosted dashboard uses real assets; transactions require your signature.'],
  ['Which assets does SPROUT use?', 'SPROUT supports the stock tokens and settlement token configured for its vaults. The dashboard shows each supported asset, your token balance, and valuation when a current price is available.'],
  ['Who can fund a sprout?', 'A connected wallet can contribute supported tokens to a sprout. Family and friends can use its gift link. Bank and card payments are not available.'],
  ['Can I take money out early?', 'No. Nobody can withdraw before the graduation date, including the parent who planted the sprout. Before then, value only leaves as a chore reward you approve, which your child claims.'],
  ['What happens when they graduate?', 'Parent powers stop at the immutable graduation timestamp and full control moves to the child. That final handover is irreversible.'],
  ['Will the portfolio always grow?', 'No. Investments can lose value. The chart shows recorded portfolio values next to the money put in (deposits and gifts, less claims and withdrawals). Growth is the gap between the two, and it can be negative. No return is promised.'],
];

const principles = [
  { title: 'A little, on repeat.', text: 'You do not need to have it all figured out. A small start, a steady habit and a little care can make ownership part of growing up. One week, one little job, one birthday at a time.' },
  { title: 'Learn through every season.', text: 'Not every day is a green day. Seeing the ups and downs together is part of learning what investing means. Their contributions tell one story. The market tells another.' },
  { title: 'Always for their future.', text: 'A parent’s guidance. A grandparent’s gift. A little reward they earned themselves. Different ways to care, all finding a home in something they can grow into.' },
];

const stocks = [['AAPL', '35%'], ['NVDA', '25%'], ['SPY', '20%'], ['MSFT', '20%']] as const;

function SampleChart() {
  return (
    <svg className="scene-chart" viewBox="0 0 300 100" role="img" aria-label={t('Sample portfolio with rises and falls')}>
      <path d="M0 80 20 76 35 81 55 62 70 66 89 51 109 61 127 48 149 53 170 34 187 45 205 29 223 38 244 19 263 26 282 9 300 18" fill="none" stroke="#709656" strokeWidth="2" />
      <path d="M0 98H300" stroke="#dce3d2" />
    </svg>
  );
}

function Scene({ feature, active }: { feature: number; active: number }) {
  if (feature === 0) {
    return (
      <div className="scene" key={active}>
        <div className="scene-shell">
          <div className="scene-heading"><span className="scene-icon"><Repeat2 /></span>{t('Sample weekly plan')}<small>{t('SAMPLE')}</small></div>
          {active === 0 ? (
            <>
              <div className="scene-amount">$10<small>{t('/ week')}</small></div>
              <p>{t('A little, every Monday.')}</p>
              <div className="scene-days">{t('M T W T F S S').split(' ').map((d, i) => <span className={i === 0 ? 'chosen' : ''} key={i}>{i === 0 ? <Check size={12} /> : d}</span>)}</div>
            </>
          ) : active === 1 ? (
            <>
              <p>{t('Little pieces of familiar names.')}</p>
              <div className="scene-stocks">{stocks.map(([s, w]) => <div key={s}><b>{s}</b><small>{w}</small></div>)}</div>
            </>
          ) : (
            <>
              <div className="scene-amount">{t('Your rhythm.')}</div>
              <p>{t('Adjust the weekly amount or pause the plan when you need to.')}</p>
              <div className="scene-reward"><Pause size={14} /><span>{t('Future contributions paused')}</span></div>
            </>
          )}
          <div className="scene-footer"><ShieldCheck />{t('Guided by you. Growing for them.')}</div>
        </div>
        <div className="scene-chip"><span className="scene-icon"><Leaf /></span>{t('A small start is still a start.')}<a href={DASHBOARD}>{t('Try it')}</a></div>
      </div>
    );
  }
  if (feature === 1) {
    return (
      <div className="scene" key={active}>
        {active === 0 ? (
          <>
            <div className="scene-callout">{t('Garden watered. Future planted.')}</div>
            <div className="scene-shell">
              <div className="scene-heading"><span className="scene-icon"><Check /></span>{t('A little win')}<small>{t('SAMPLE')}</small></div>
              <div className="scene-amount">$3.00</div>
              <p>{t('Chore reward, ready for parent approval.')}</p>
              <div className="scene-footer"><ShieldCheck />{t('You are always in the loop.')}</div>
            </div>
          </>
        ) : active === 1 ? (
          <>
            <div className="scene-callout">{t('A little love from Grandma.')}</div>
            <div className="scene-shell">
              <div className="scene-message">{tj('For all the things{br}you will grow up to be.', { br: <br /> })}</div>
              <div className="scene-amount">$25.00</div>
              <p>{t('A gift towards their future.')}</p>
            </div>
          </>
        ) : (
          <div className="scene-shell">
            <div className="scene-heading"><span className="scene-icon"><Gift /></span>{t('Little things, adding up')}</div>
            {[['A gift from Grandma', '$25'], ['Garden watered', '$3'], ['Weekly contribution', '$10']].map(([a, b]) => <div className="scene-reward" key={a}><Check size={13} /><span>{t(a ?? '')}</span><b>+{b}</b></div>)}
            <p>{t('Illustrative family activity.')}</p>
          </div>
        )}
        <div className="scene-chip"><span className="scene-icon"><Gift /></span>{t('Love, in little shares.')}<a href="/gift">{t('Try a gift')}</a></div>
      </div>
    );
  }
  return (
    <div className="scene" key={active}>
      {active === 0 ? (
        <div className="scene-shell">
          <div className="scene-heading"><span className="scene-icon"><Leaf /></span>{t('Sample little portfolio')}<small>{t('SAMPLE')}</small></div>
          <div className="scene-amount">$2,480.65</div>
          <p>{t('Contributed $2,200 · Market change +$280.65')}</p>
          <SampleChart />
          <div className="scene-footer">{t('There are red days, too.')}</div>
        </div>
      ) : active === 1 ? (
        <>
          <div className="scene-ring"><img src="/brand/sprout-logo.png" alt="" /></div>
          <div className="scene-ring-label">{t('One ring at a time.')}</div>
          <div className="scene-callout" style={{ margin: '20px auto 0' }}>{t('Your first contribution. A new beginning.')}</div>
        </>
      ) : (
        <div className="scene-shell">
          <div className="scene-heading"><span className="scene-icon"><GraduationCap /></span>{t('A little more independence')}</div>
          <div className="scene-ladder">
            {[['13', t('Watch & learn'), t('Their own portfolio view')], ['16', t('Practice independence'), t('Parent-set allowance limits')], ['18', t('Their next chapter'), t('Full control · sample age')]].map(([n, t, d]) => <div key={n}><strong>{n}</strong><span>{t}<small>{d}</small></span></div>)}
          </div>
        </div>
      )}
      <div className="scene-chip"><span className="scene-icon"><Leaf /></span>{t('Their own tomorrow.')}<a href={DASHBOARD}>{t('Explore')}</a></div>
    </div>
  );
}

function Feature({ index, paused }: { index: number; paused: boolean }) {
  const f = features[index]!;
  const [active, setActive] = useState(0);
  const [manual, setManual] = useState(false);
  const [visible, setVisible] = useState(false);
  const el = useRef<HTMLElement>(null);
  useEffect(() => {
    const o = new IntersectionObserver(([e]) => setVisible(e?.isIntersecting ?? false), { threshold: 0.4 });
    if (el.current) o.observe(el.current);
    return () => o.disconnect();
  }, []);
  useEffect(() => {
    if (paused || manual || !visible) return;
    const t = setInterval(() => setActive((a) => (a + 1) % 3), 6500);
    return () => clearInterval(t);
  }, [paused, manual, visible, active]);
  return (
    <article ref={el} className={'reference-feature ' + (index === 1 ? 'reversed' : '')}>
      <div className="reference-feature-copy">
        <span className="reference-feature-tag">{t(f.tag)}</span>
        <h2>{t(f.title)}</h2>
        <div className="reference-feature-accordion">
          {f.items.map((item, i) => (
            <div className="accordion-item" key={item.title}>
              <button className="accordion-trigger" onClick={() => { setActive(i); setManual(true); }} aria-expanded={active === i}>
                {t(item.title)}
                <span aria-hidden="true">{active === i ? '−' : '+'}</span>
              </button>
              {active === i ? <div className="accordion-content">{t(item.text)}</div> : null}
            </div>
          ))}
        </div>
      </div>
      <div className={'reference-feature-art art-' + f.art}>
        <Scene feature={index} active={active} />
      </div>
    </article>
  );
}

export function Landing() {
  const automationEnabled = useAutomationEnabled();
  const [menu, setMenu] = useState(false);
  const [resources, setResources] = useState(false);
  const [paused, setPaused] = useState(false);
  const [step, setStep] = useState(0);
  const [role, setRole] = useState(0);
  const [principle, setPrinciple] = useState(0);
  const [query, setQuery] = useState('');
  const [answer, setAnswer] = useState(false);

  useEffect(() => {
    const m = matchMedia('(prefers-reduced-motion: reduce)');
    setPaused(m.matches);
    const fn = () => setPaused(m.matches);
    m.addEventListener('change', fn);
    return () => m.removeEventListener('change', fn);
  }, []);

  const terms = query.toLowerCase().replace(/[^a-z0-9 ]/g, '').split(/\s+/).filter((w) => w.length > 2);
  const matches = questions
    .map((item) => ({ item, score: terms.reduce((n, t) => n + (item[0].toLowerCase().includes(t) ? 3 : 0) + (item[1].toLowerCase().includes(t) ? 1 : 0), 0) }))
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score)
    .map((x) => x.item);
  const answers = query.trim() ? matches : questions.slice(0, 2);

  const plantFromForm = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    try { sessionStorage.removeItem('sprout-pending-nickname'); } catch { /* local only */ }
    location.href = `${DASHBOARD}?new=1`;
  };

  return (
    <main className="reference-landing">
      <header className="reference-nav wrap">
        <Brand />
        <div className={'reference-nav-right ' + (menu ? 'mobile-open' : '')}>
          <div className="reference-resources">
            <button aria-expanded={resources} onClick={() => setResources(!resources)}>{t('Explore')} <ChevronDown size={15} /></button>
            {resources ? (
              <nav className="resource-menu" aria-label={t('Explore SPROUT')}>
                <a href="/intelligence">SPROUT Intelligence</a>
                <a href="/spend">Spend</a>
                <a href="/family-tools">Family toolkit</a>
                <a href="/harvest">{t('Harvest')}</a>
                <a href="/guardian">{t('Guardian wallets')}</a>
                <a href="#how-it-works" onClick={() => { setResources(false); setMenu(false); }}>{t('How it works')}</a>
                <a href="#family" onClick={() => { setResources(false); setMenu(false); }}>{t('For your family')}</a>
                <a href="#questions" onClick={() => { setResources(false); setMenu(false); }}>{t('Good to know')}</a>
                <a href="/faq">{t('Questions')}</a>
                <a href="/guide">{t('Getting started')}</a>
                <a href="/docs">{t('Documentation')}</a>
                <a href="/whitepaper">{t('Whitepaper')}</a>
                <a href="/settings">{t('Appearance')}</a>
              </nav>
            ) : null}
          </div>
          <ThemeToggle />
          <LanguageToggle />
          <a className="nav-signin" href={DASHBOARD}>{t('Dashboard')}</a>
          <a className="btn button-primary" href={`${DASHBOARD}?new=1`}>{t('Plant a sprout')}</a>
        </div>
        <button className="reference-mobile-toggle" aria-label={menu ? t('Close menu') : t('Open menu')} aria-expanded={menu} onClick={() => setMenu(!menu)}>{menu ? <X /> : <Menu />}</button>
      </header>

      <section className="reference-hero">
        <div className="reference-hero-copy">
          <a className="hero-news" href={`${DASHBOARD}?new=1`} data-testid="hero-news">
            <b>{t('New')}</b>
            <span>{t('21 stocks now, including Tesla and SpaceX')}</span>
            <ArrowRight aria-hidden />
          </a>
          <h1>{tj('A little portfolio{br}for their big future', { br: <br /> })}</h1>
          <p>{t('Weekly investing, allowances & gifts.')}<br className="hero-copy-break" />{gap()}{t('A future you can grow together.')}</p>
          <div className="reference-actions">
            <a className="btn button-primary" href={DASHBOARD}><Leaf size={16} />{t('Open the dashboard')}</a>
            <a className="btn button-secondary" href={`${DASHBOARD}?new=1`}>{t('Plant a sprout')}</a>
          </div>
          <PublicCa variant="landing" />
          <LandingRootedCounter />
        </div>
        <div className={'reference-hero-wave ' + (paused ? 'is-paused' : '')}>
          <BloomGarden variant="landing" paused={paused} />
          <button className="reference-motion" aria-label={paused ? t('Play background animation') : t('Pause background animation')} onClick={() => setPaused(!paused)}>{paused ? <Play size={12} /> : <Pause size={12} />}</button>
        </div>
        <div className="reference-capabilities wrap">
          <span><Repeat2 />{t('Weekly investing')}</span>
          <span><Check />{t('Earned allowances')}</span>
          <span><Gift />{t('Family gifts')}</span>
          <span><Leaf />{t('Growing independence')}</span>
        </div>
      </section>

      <div className="wrap">
        <section className="reference-proof">
          <PlantedCount />
          <div className="proof-number"><strong>3</strong><span>{t('Ways to add to their future')}</span></div>
          <div className="proof-note">
            <p>{t('Weekly contributions, earned allowances and thoughtful gifts. The things your family already does, coming together in one little portfolio.')}</p>
            <div className="proof-signature"><img src="/brand/sprout-logo.png" alt="" /><div>{t('Small beginnings. Big possibilities.')}<small>{t('The SPROUT way')}</small></div></div>
          </div>
        </section>

        <section className="si-landing-invite"><div><small>MEET SPROUT INTELLIGENCE</small><h2>A little clarity for their big future.</h2><p>A thoughtful AI companion for parents. Explore ideas, understand trade-offs and ask better questions. Free for verified holders of 1 million SPROUT. Not financial advice.</p></div><a href="/intelligence">Explore Intelligence <ArrowRight size={16}/></a></section>
        <section className="reference-demo" id="take-a-look">
          <div className="demo-botanical" />
          <div className="demo-emblem"><img src="/brand/sprout-logo.png" alt={t('SPROUT botanical emblem')} /></div>
          <span className="demo-satellite" /><span className="demo-satellite two" /><span className="demo-satellite three" />
          <div className="reference-demo-copy">
            <span>{t('A little preview')}</span>
            <h2>{t('See SPROUT in action')}</h2>
            <p>{t('Connect your wallet to see your family’s portfolios.')}</p>
            <a className="btn button-primary" href={DASHBOARD}><Leaf size={16} />{t('Open the dashboard')}</a>
          </div>
        </section>
      </div>

      <section className="reference-features wrap" id="how-it-works">
        <div className="reference-section-intro">
          <h2>{tj('A little support for every{br}step of growing up', { br: <br /> })}</h2>
          <p>{t('Small contributions. Everyday effort. A gift from someone who cares.')}<br />{t('Give each moment a place in the future they’re growing into.')}</p>
        </div>
        {features.map((f, i) => <Feature key={f.tag} index={i} paused={paused} />)}
      </section>

      <div className="wrap">
        <section className="reference-setup">
          <h2>{t('Get started with a little')}</h2>
          <div className="reference-setup-grid">
            <div className="reference-setup-steps">
              <div role="tablist" aria-label={t('How to start')}>
                {['Give their future a name. A nickname for their very own sprout.', 'Choose a weekly amount and a starter mix that fits your family.', 'Plan the little steps towards independence and full control.'].map((s, i) => (
                  <button className="reference-setup-step" key={s} role="tab" id={`setup-tab-${i}`} aria-selected={step === i} tabIndex={step === i ? 0 : -1} onClick={() => setStep(i)}>
                    <span>{i + 1}.</span><p>{t(s)}</p>
                  </button>
                ))}
              </div>
              <div className="setup-start">
                <a className="btn button-primary" href={`${DASHBOARD}?new=1`}>{t('Get started')}</a>
                <small>{t('Open the dashboard. Plant a sprout in minutes.')}</small>
              </div>
            </div>
            <div role="tabpanel" aria-labelledby={`setup-tab-${step}`}>
              <div className="reference-setup-art">
                <div className="setup-window">
                  <div className="setup-window-side">
                    <img src="/brand/sprout-logo.png" alt="" />
                    <span><LayoutGrid />{t('Overview')}</span>
                    <span><Leaf />{t('Portfolio')}</span>
                    <span><Repeat2 />{t('Auto-invest')}</span>
                    <span><Gift />{t('Gifts')}</span>
                  </div>
                  <div className="setup-window-content">
                    <h3>{t('Their little portfolio')}</h3>
                    <div className="setup-window-label">{t('YOUR SPROUTS')}</div>
                    <div className="setup-window-field">{t('A sample sprout')}</div>
                    <div className="setup-window-balance">$2,480.65</div>
                    <div className="setup-window-small">{t('Sample value · $2,200 contributed')}</div>
                    <SampleChart />
                  </div>
                </div>
                <div className="setup-float" key={step}>
                  <span>{t('PLANT A SPROUT / 0{n}', { n: step + 1 })}</span>
                  <h3>{t(['A little name. A big future.', 'Find your family’s rhythm.', 'Theirs, when it’s time.'][step] ?? '')}</h3>
                  <p>{t(['Pick a nickname. Keep their name on your device.', '$10 a week · A starter stock mix. Just a sample.', 'Watch at 13. Learn at 16. Full control at graduation.'][step] ?? '')}</p>
                </div>
              </div>
            </div>
          </div>
        </section>

        <section className="reference-family" id="family">
          <div className="reference-section-intro">
            <h2>{tj('A whole little village.{br}One growing future.', { br: <br /> })}</h2>
            <p>{t('Give everyone a way to care. Parents guide, kids learn, and their people can add a little love along the way.')}</p>
          </div>
          <div className="reference-family-grid">
            <div className="reference-create">
              <h2>{t(['Plant their first sprout', 'A little world to discover', 'Give a little possibility'][role] ?? '')}</h2>
              <p>{t(['A small start, for someone with a big future.', 'See how a little portfolio grows up with them.', 'Something for the person they’re becoming.'][role] ?? '')}</p>
              <div className="family-orbs" aria-hidden="true">
                <span className="family-orb"><Gift /></span>
                <span className="family-orb center"><img src="/brand/sprout-logo.png" alt="" /></span>
                <span className="family-orb"><Leaf /></span>
              </div>
              <small>{t('A real, connected portfolio.')}<br />{t('Nothing moves until you sign.')}</small>
              {role === 2 ? (
                <div className="create-form"><a className="btn button-primary" href="/gift">{t('Preview a gift')}</a></div>
              ) : (
                <form className="create-form" onSubmit={plantFromForm}>
                  <small>{t('Add their private nickname after unlocking your family space.')}</small>
                  <button type="submit" className="btn button-primary">{t('Plant a sprout')}</button>
                </form>
              )}
            </div>
            <div className="reference-role-list">
              {[[t('For the parent'), t('A steady habit, a little guidance, and a front-row seat.')], [t('For the kid'), t('Watch, earn and learn. A little more independence.')], [t('For their people'), t('Thoughtful gifts, from their whole little village.')]].map(([t, d], i) => (
                <button className={'reference-role ' + (role === i ? 'active' : '')} key={t} onClick={() => setRole(i)} aria-pressed={role === i}><h3>{t}</h3><p>{d}</p></button>
              ))}
            </div>
          </div>
        </section>

        <section className="reference-principles">
          <h2>{t('Little things worth remembering')}</h2>
          <p className="principle-copy serif-copy" key={principle}>{t(principles[principle]!.text)}</p>
          <div className="principle-bottom">
            <div className="principle-author">
              <img src="/brand/sprout-logo.png" alt="" />
              <div>{t(principles[principle]!.title)}<small>{t('The SPROUT way · {n} / 3', { n: principle + 1 })}</small></div>
            </div>
            <div className="principle-controls">
              <button aria-label={t('Previous principle')} onClick={() => setPrinciple((principle + 2) % 3)}><ArrowLeft size={19} /></button>
              <button aria-label={t('Next principle')} onClick={() => setPrinciple((principle + 1) % 3)}><ArrowRight size={19} /></button>
            </div>
          </div>
        </section>
      </div>

      <div className="reference-ending">
        <div className="wrap">
          <section className="reference-faq" id="questions">
            <h2>{t('Frequently asked questions')}</h2>
            {questions.map(([q, a], i) => (
              <div className="accordion-item" key={q}>
                <details>
                  <summary className="accordion-trigger">{t(q)}<span className="faq-plus" aria-hidden="true"><Plus /></span></summary>
                  <div className="accordion-content">{t(a)}</div>
                </details>
              </div>
            ))}
            <p className="reference-faq-more"><a href="/faq">{t('More questions: costs, safety, gift links and beta →')}</a></p>
          </section>
          <section className="reference-closing">
            <div className="closing-leaf left" /><div className="closing-leaf right" />
            <div>
              <h2>{t('A little care today. Their whole tomorrow.')}</h2>
              <a className="btn button-primary" href={`${DASHBOARD}?new=1`}>{t('Plant a sprout')}</a>
            </div>
          </section>
          <footer className="reference-footer">
            <div className="reference-footer-copy">
              <p>{t('SPROUT brings family portfolios, earned rewards and gifts together. Balances and permissions live in a vault; nicknames stay on your device.')}</p>
              <p>{t('Investments can fall in value. Graduation transfers full control to the beneficiary at the date chosen when the sprout is planted.')}</p>
              <p className="reference-footer-risk">
                <strong>{t('Beta software, real money.')}</strong>{gap()}{t('Sprout settles on Robinhood Chain mainnet and transactions cannot be reversed.')}
                {automationEnabled === false ? gap() + t('Automatic weekly investing is currently switched off.') : ''}
                {gap()}{t('The contracts have not been independently audited, and graduation withdrawal and backup restoration have not yet been verified on mainnet.')}
                {gap()}{t('Only commit what you are prepared to lose.')}{gap()}{t('Nothing here is financial advice.')}
              </p>
              <p>{t('© {year} SPROUT. A little, together.', { year: new Date().getFullYear() })}</p>
            </div>
            <div className="reference-footer-links">
              <div><span>SPROUT</span><a href={DASHBOARD}>{t('Dashboard')}</a><a href={`${DASHBOARD}?new=1`}>{t('Plant a sprout')}</a><a href="/gift">{t('Gift preview')}</a><a href="/intelligence">Intelligence</a></div>
              <div><span>{t('Learn')}</span><a href="/faq">{t('Questions')}</a><a href="/guide">{t('Getting started')}</a><a href="/docs">{t('Documentation')}</a><a href="/whitepaper">{t('Whitepaper')}</a><a href="/settings">{t('Appearance')}</a></div>
            </div>
          </footer>
        </div>
      </div>

      <div className="reference-dock">
        <form onSubmit={(e) => { e.preventDefault(); setAnswer(true); }}>
          <span className="dock-avatar"><img src="/brand/sprout-logo.png" alt="" /></span>
          <input aria-label={t('Find an answer about SPROUT')} placeholder={t('How does SPROUT work?')} value={query} onChange={(e) => setQuery(e.target.value)} maxLength={120} />
          <button type="submit" aria-label={t('Find an answer')}><ArrowUp size={18} /></button>
        </form>
        <a className="btn button-primary" href={DASHBOARD}><Leaf size={16} />{t('Open the dashboard')}</a>
      </div>

      {answer ? (
        <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label={t('A little clarity')} onClick={() => setAnswer(false)}>
          <div className="modal sprout-dialog" onClick={(e) => e.stopPropagation()}>
            <div className="modal-head">
              <h2>{t('A little clarity.')}</h2>
              <button className="btn btn--small" onClick={() => setAnswer(false)} aria-label={t('Close')}>{t('Close')}</button>
            </div>
            <p className="muted">{t('Answers from the SPROUT product overview. This is a local FAQ search.')}</p>
            <div className="answer-list">
              {answers.length ? answers.slice(0, 3).map(([q, a]) => <div className="answer-item" key={q}><h3>{t(q)}</h3><p>{t(a)}</p></div>) : <div className="answer-item"><h3>{t('Let’s find the right place.')}</h3><p>{t('Try “gift”, “stock”, “fund”, “graduate”, “grow” or “demo”.')}</p></div>}
            </div>
            <div className="answer-links"><a href={DASHBOARD}>{t('Explore the dashboard')}</a><a href="#questions" onClick={() => setAnswer(false)}>{t('All questions')}</a></div>
          </div>
        </div>
      ) : null}
    </main>
  );
}

function Brand({ footer = false }: { footer?: boolean }) {
  return <a href="/" className={'brand' + (footer ? ' brand-footer' : '')} aria-label={t('SPROUT home')}><span className="brand-mark"><img src="/brand/sprout-logo.png" alt="" /></span><span>SPROUT</span></a>;
}
