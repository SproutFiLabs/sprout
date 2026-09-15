import { useEffect, useRef, useState, type RefObject } from 'react';
import { OnboardingGarden } from './OnboardingGarden';
import { ArrowRight, Gift, Leaf, Repeat2, Sprout, X } from 'lucide-react';

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
  const [stage, setStage] = useState<0 | 1>(0);
  const ref = useRef<HTMLDivElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  useDialogFocus(open, onClose, ref);
  // Reset while closed so an explicit reopen always starts at the first panel.
  useEffect(() => { if (!open) setStage(0); }, [open]);
  useEffect(() => { if (open) heading.current?.focus(); }, [open, stage]);
  if (!open) return null;
  const primary = () => {
    if (stage === 0) { setStage(1); return; }
    if (connected) onPlant(); else if (canConnect) onConnect();
  };
  return (
    <div className="onboarding-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <div className="onboarding-dialog" data-testid="onboarding-dialog" ref={ref} role="dialog" aria-modal="true" aria-labelledby="onboarding-title" aria-describedby="onboarding-description">
        <button className="onboarding-close" type="button" onClick={onClose} aria-label="Close welcome tour"><X size={18} /></button>
        <OnboardingGarden chapter={stage} />
        <div className="onboarding-content onboarding-chapter-enter" key={stage}>
          <span className="garden-eyebrow">A little introduction</span>
          <h2 id="onboarding-title" ref={heading} tabIndex={-1}>{stage === 0 ? 'A little future, grown together.' : 'Small ways to help it grow.'}</h2>
          <p id="onboarding-description">{stage === 0 ? 'SPROUT gives a child a place of their own for contributions, rewards and thoughtful gifts.' : 'One sprout can hold the habits and moments your family already shares.'}</p>
          {stage === 1 ? (
            <div className="onboarding-reasons">
              {reasons.map(({ icon: Icon, title, text }) => <div className="onboarding-reason" key={title}><span><Icon size={18} /></span><div><b>{title}</b><p>{text}</p></div></div>)}
            </div>
          ) : <div className="onboarding-quote">A small beginning can become something they can carry into their own future.</div>}
          <div className="onboarding-actions">
            <button type="button" data-onboarding-primary className="garden-pill garden-pill--dark" onClick={primary} disabled={stage === 1 && !connected && !canConnect}>
              {stage === 0 ? <>See how it grows <ArrowRight size={15} /></> : connected ? <>Plant their first sprout <Sprout size={15} /></> : <>Connect &amp; plant <ArrowRight size={15} /></>}
            </button>
            <button type="button" className="onboarding-skip" onClick={onClose}>{stage === 0 ? 'Skip for now' : 'I’ll explore myself'}</button>
          </div>
          <div className="onboarding-dots" aria-label={`Introduction panel ${stage + 1} of 2`}><i className={stage === 0 ? 'active' : ''} /><i className={stage === 1 ? 'active' : ''} /></div>
        </div>
      </div>
    </div>
  );
}

export function WelcomeSprout({ open, onClose, onFund }: { open: boolean; onClose: () => void; onFund?: () => void }) {
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
        <div className="welcome-sprout-copy"><span className="garden-eyebrow">The first little beginning</span><h2 id="welcome-title">Welcome.</h2><p>Their sprout is ready to grow. It has no money in it yet — adding the first funds is the next step.</p><div className="welcome-sprout-actions">{onFund ? <button type="button" data-testid="welcome-fund" className="garden-pill garden-pill--light" onClick={() => { onFund(); dismiss(); }}>Add the first funds <ArrowRight size={15} /></button> : null}<button type="button" data-testid="welcome-continue" className="welcome-sprout-later" onClick={dismiss}>I{'\u2019'}ll do this later</button></div></div>
      </div>
    </div>
  );
}
