import { useEffect, useState, type FormEvent } from 'react';
import { ArrowRight, RotateCcw, Sparkles } from 'lucide-react';
import { OnboardingIntro, WelcomeSprout } from './components/OnboardingIntro';
import { Preview } from './Preview';
import { SPROUTS } from './sampleData';

type TestStage = 'intro' | 'form' | 'dashboard';

/**
 * A fully local product walkthrough for visual QA and demos. It deliberately
 * never mounts App, a wallet provider, or an API client: creating a sprout here
 * only changes the in-memory sample name before showing the existing fixture.
 */
export function TestExperience() {
  const [stage, setStage] = useState<TestStage>('intro');
  const [introOpen, setIntroOpen] = useState(true);
  const [welcomeOpen, setWelcomeOpen] = useState(false);
  const [name, setName] = useState('Emma');
  const [draftName, setDraftName] = useState('Emma');

  useEffect(() => {
    if (!welcomeOpen) return;
    const timer = window.setTimeout(() => setWelcomeOpen(false), 1500);
    return () => window.clearTimeout(timer);
  }, [welcomeOpen]);

  const startSetup = () => {
    setIntroOpen(false);
    setStage('form');
  };

  const restart = () => {
    setStage('intro');
    setIntroOpen(true);
  };

  const createSample = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const nextName = draftName.trim() || 'Emma';
    setName(nextName);
    setStage('dashboard');
    setWelcomeOpen(true);
  };

  if (stage === 'dashboard') {
    return (
      <>
        <Preview displayName={name} onRestartTour={restart} />
        <WelcomeSprout open={welcomeOpen} onClose={() => setWelcomeOpen(false)} />
      </>
    );
  }

  return (
    <main className="test-experience" data-testid="test-experience">
      <header className="test-experience-header">
        <a className="test-experience-brand" href="/" aria-label="SPROUT home"><span>✦</span> SPROUT</a>
        <span className="test-experience-badge"><Sparkles size={14} /> Sample walkthrough</span>
      </header>
      {stage === 'form' ? (
        <section className="test-setup-card" aria-labelledby="test-setup-title">
          <img className="test-setup-art" src="/art/dashboard/motion/petal-orange.png" alt="" aria-hidden="true" />
          <span className="test-eyebrow">Sample walkthrough · no transactions</span>
          <h1 id="test-setup-title">Give their sprout a name.</h1>
          <p>Explore a prepared family wallet with sample balances. No signatures or transactions are involved.</p>
          <div className="test-wallet" aria-label="Simulated sample wallet">
            <div><span>Sample wallet</span><b>simulated</b></div>
            <input id="test-wallet-address" aria-label="Sample wallet address" value={SPROUTS[0]!.parent} readOnly />
          </div>
          <form onSubmit={createSample}>
            <label htmlFor="test-child-name">Child’s name</label>
            <input id="test-child-name" data-testid="test-child-name" value={draftName} onChange={(event) => setDraftName(event.target.value)} autoFocus maxLength={40} />
            <button type="submit" data-testid="test-create" className="test-primary">Create their sample sprout <ArrowRight size={16} /></button>
          </form>
          <button type="button" className="test-link" onClick={restart}><RotateCcw size={14} /> Restart tour</button>
        </section>
      ) : null}
      <OnboardingIntro
        open={introOpen}
        connected
        canConnect={false}
        onClose={startSetup}
        onConnect={startSetup}
        onPlant={startSetup}
      />
    </main>
  );
}
