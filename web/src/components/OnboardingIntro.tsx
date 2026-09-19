import { useEffect, useRef, useState, type RefObject } from 'react';
import { OnboardingGarden } from './OnboardingGarden';
import { ArrowRight, Check, Copy, Gift, Leaf, Repeat2, ShieldCheck, Sprout, Unplug, X } from 'lucide-react';
import { copyToClipboard, shortCa } from './PublicCa';
import { t } from '../i18n';

export interface OnboardingIntroProps {
  open: boolean;
  connected: boolean;
  canConnect: boolean;
  onClose: () => void;
  onConnect: () => void;
  onPlant: () => void;
}

const reasons: Array<{ icon: typeof Repeat2; title: string; text: string }> = [
  { icon: Repeat2, title: 'Weekly investing', text: 'A small amount, on repeat, gives their future a steady rhythm.' },
  { icon: Gift, title: 'Gifts from their people', text: 'Birthdays and little surprises can join the same growing portfolio.' },
  { icon: Leaf, title: 'Earned rewards', text: 'Everyday effort can become an allowance they can see and understand.' },
];

/**
 * The last panel before anyone plants: where the money lives, who it can go
 * to, and that it does not depend on this website. Kept plain and prominent
 * on purpose; the guide has the steps.
 */
const promises: Array<{ icon: typeof Repeat2; title: string; text: string }> = [
  { icon: ShieldCheck, title: 'Sprout can’t touch it', text: 'Each sprout is its own contract on Robinhood Chain. Nobody at Sprout can move, freeze or refund the money in it.' },
  { icon: Gift, title: 'It only ever goes to your child', text: 'As rewards you approve before the big day, and all of it on the big day. Pick a child’s wallet your family can open: it can’t be changed later.' },
  { icon: Unplug, title: 'It doesn’t need this website', text: 'If Sprout ever shuts down, the money stays put. Save your sprout’s address, and free tools can still take it out.' },
];

const PANELS = [
  { eyebrow: 'A little introduction', title: 'A little future, grown together.', text: 'SPROUT gives a child a place of their own for contributions, rewards and thoughtful gifts.' },
  { eyebrow: 'A little introduction', title: 'Small ways to help it grow.', text: 'One sprout can hold the habits and moments your family already shares.' },
  { eyebrow: 'Before you add money', title: 'The money stays theirs, not ours.', text: 'Here is what that means, in plain words.' },
] as const;

function useDialogFocus(open: boolean, onClose: () => void, ref: RefObject<HTMLDivElement>) {
  const returnFocus = useRef<HTMLElement | null>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    if (!open) return;
    returnFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const focusFirst = () => ref.current?.querySelector<HTMLElement>('[data-onboarding-primary], button')?.focus();
    const timer = window.setTimeout(focusFirst, 0);
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); closeRef.current(); return; }
      if (event.key !== 'Tab' || !ref.current) return;
      const nodes = [...ref.current.querySelectorAll<HTMLElement>('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])')].filter((node) => !node.hasAttribute('disabled'));
      if (!nodes.length) return;
      const first = nodes[0]!;
      const last = nodes[nodes.length - 1]!;
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = previousOverflow;
      returnFocus.current?.focus();
    };
  }, [open, ref]);
}

export function OnboardingIntro({ open, connected, canConnect, onClose, onConnect, onPlant }: OnboardingIntroProps) {
  const [stage, setStage] = useState<0 | 1 | 2>(0);
  const ref = useRef<HTMLDivElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  useDialogFocus(open, onClose, ref);
  // Reset while closed so an explicit reopen always starts at the first panel.
  useEffect(() => { if (!open) setStage(0); }, [open]);
  useEffect(() => { if (open) heading.current?.focus(); }, [open, stage]);
  if (!open) return null;
  const primary = () => {
    if (stage < 2) { setStage(stage === 0 ? 1 : 2); return; }
    if (connected) onPlant(); else if (canConnect) onConnect();
  };
  return (
    <div className="onboarding-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <div className="onboarding-dialog" data-testid="onboarding-dialog" ref={ref} role="dialog" aria-modal="true" aria-labelledby="onboarding-title" aria-describedby="onboarding-description">
        <button className="onboarding-close" type="button" onClick={onClose} aria-label={t('Close welcome tour')}><X size={18} /></button>
        <OnboardingGarden chapter={stage} />
        <div className="onboarding-content onboarding-chapter-enter" key={stage}>
          <span className="garden-eyebrow">{t(PANELS[stage].eyebrow)}</span>
          <h2 id="onboarding-title" ref={heading} tabIndex={-1}>{t(PANELS[stage].title)}</h2>
          <p id="onboarding-description">{t(PANELS[stage].text)}</p>
          {stage === 2 ? (
            <div className="onboarding-reasons onboarding-promises" data-testid="onboarding-promises">
              {promises.map(({ icon: Icon, title, text }) => <div className="onboarding-reason" key={title}><span><Icon size={20} /></span><div><b>{t(title)}</b><p>{t(text)}</p></div></div>)}
              <a className="onboarding-guide-link" href="/guide#without-sprout">{t('How to take money out without Sprout')} <ArrowRight size={14} /></a>
            </div>
          ) : stage === 1 ? (
            <div className="onboarding-reasons">
              {reasons.map(({ icon: Icon, title, text }) => <div className="onboarding-reason" key={title}><span><Icon size={18} /></span><div><b>{t(title)}</b><p>{t(text)}</p></div></div>)}
            </div>
          ) : <div className="onboarding-quote">{t('A small beginning can become something they can carry into their own future.')}</div>}
          <div className="onboarding-actions">
            <button type="button" data-onboarding-primary className="garden-pill garden-pill--dark" onClick={primary} disabled={stage === 2 && !connected && !canConnect}>
              {stage === 0 ? <>{t('See how it grows')} <ArrowRight size={15} /></> : stage === 1 ? <>{t('Where the money lives')} <ArrowRight size={15} /></> : connected ? <>{t('Plant their first sprout')} <Sprout size={15} /></> : <>{t('Connect & plant')} <ArrowRight size={15} /></>}
            </button>
            <button type="button" className="onboarding-skip" onClick={onClose}>{stage === 0 ? t('Skip for now') : t('I’ll explore myself')}</button>
          </div>
          <div className="onboarding-dots" aria-label={t('Introduction panel {n} of {total}', { n: stage + 1, total: PANELS.length })}>{PANELS.map((panel, i) => <i key={panel.title} className={stage === i ? 'active' : ''} />)}</div>
        </div>
      </div>
    </div>
  );
}

export function WelcomeSprout({ open, onClose, onFund, address }: { open: boolean; onClose: () => void; onFund?: () => void; address?: string | null }) {
  const ref = useRef<HTMLDivElement>(null);
  const [fading, setFading] = useState(false);
  useDialogFocus(open, onClose, ref);
  useEffect(() => { if (!open) setFading(false); }, [open]);
  // The fade is an exit, not a timer: it runs when Continue is pressed and the
  // overlay unmounts once it has played. Reduced motion skips straight to the
  // close, and the stylesheet already suppresses the fade animation there.
  const dismiss = (): void => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) { onClose(); return; }
    setFading(true);
    window.setTimeout(onClose, 300);
  };
  if (!open) return null;
  return (
    <div className={'welcome-sprout-backdrop' + (fading ? ' is-fading' : '')} data-testid="welcome-sprout">
      <div className="welcome-sprout" ref={ref} role="dialog" aria-modal="true" aria-labelledby="welcome-title">
        <OnboardingGarden />
        <div className="welcome-sprout-copy"><span className="garden-eyebrow">{t('The first little beginning')}</span><h2 id="welcome-title">{t('Welcome.')}</h2><p>{t('Their sprout is ready to grow. It has no money in it yet — adding the first funds is the next step.')}</p>{address ? <SaveSproutAddress address={address} /> : null}<div className="welcome-sprout-actions">{onFund ? <button type="button" data-testid="welcome-fund" className="garden-pill garden-pill--light" onClick={() => { onFund(); dismiss(); }}>{t('Add the first funds')} <ArrowRight size={15} /></button> : null}<button type="button" data-testid="welcome-continue" className="welcome-sprout-later" onClick={dismiss}>{t('I’ll do this later')}</button></div></div>
      </div>
    </div>
  );
}

/** The one thing to write down after planting: the sprout's own address. */
function SaveSproutAddress({ address }: { address: string }) {
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const timer = window.setTimeout(() => setCopied(false), 1800);
    return () => window.clearTimeout(timer);
  }, [copied]);
  return (
    <div className="welcome-sprout-address" data-testid="welcome-address">
      <span>{t('Save this sprout’s address. With it, the money can be reached even if Sprout ever shuts down.')}</span>
      <button type="button" title={address} aria-label={t('Copy this sprout’s address {address}', { address })} onClick={() => void copyToClipboard(address).then(setCopied)}>
        <code>{shortCa(address)}</code>
        {copied ? <><Check size={15} aria-hidden /> {t('Copied')}</> : <><Copy size={15} aria-hidden /> {t('Copy')}</>}
      </button>
    </div>
  );
}
