import { ProofVerifier } from './privacy/ProofVerifier';
import { StrictMode, lazy, Suspense } from 'react';
const IntelligencePage=lazy(()=>import('./intelligence/IntelligencePage').then(m=>({default:m.IntelligencePage})));
const HarvestPage=lazy(()=>import('./harvest/HarvestPage').then(m=>({default:m.HarvestPage})));
const ManualHarvestPage=lazy(()=>import('./harvest/ManualHarvestPage').then(m=>({default:m.ManualHarvestPage})));
const HarvestOperator=lazy(()=>import('./harvest/HarvestOperator').then(m=>({default:m.HarvestOperator})));
const GuardianPage=lazy(()=>import('./guardian/GuardianPage').then(m=>({default:m.GuardianPage})));

import { createRoot } from 'react-dom/client';
import { App } from './App';
import { Landing } from './Landing';
import { GiftLanding } from './GiftLanding';
import { Preview } from './Preview';
import { TestExperience } from './TestExperience';
import { KnowledgePage } from './knowledge/KnowledgePages';
import { AppearancePage } from './AppearancePage';
import { PerksPage } from './perks/PerksPage';
import { KidView, parseKidPath } from './KidView';
import { initializeTheme } from './theme/ThemeSettings';
import { initializeLocale, t, useLocale } from './i18n';
import './app.css';
import './reference/landing.css';
import './reference/dashboard.css';
import './reference/premium.css';
import './garden/garden.css';
import './typography.css';
import './test-experience.css';
import './garden/animation-refinements.css';
import './resources.css';
import './knowledge/knowledge.css';
import './theme/theme.css';

initializeTheme();
initializeLocale();

function currentPath(): string {
  return window.location.pathname.replace(/\/+$/, '') || '/';
}

function Root() {
  useLocale(); // the whole tree re-renders in the new language
  const path = currentPath();
  if (path === '/' || path === '/index.html') return <Landing />;
  if (path === '/harvest') return <Suspense fallback={<main style={{padding:'64px'}}>{t('Opening Harvest…')}</main>}>{new URLSearchParams(window.location.search).get('demo')==='1'?<HarvestPage/>:<ManualHarvestPage/>}</Suspense>;
  if (path === '/harvest/operator') return <Suspense fallback={<main style={{padding:'64px'}}>{t('Opening operator desk…')}</main>}><HarvestOperator/></Suspense>;
  if (path === '/intelligence') return <Suspense fallback={<main style={{padding:'64px'}}>{t('Opening Intelligence…')}</main>}><IntelligencePage /></Suspense>;
  if (path === '/guardian') return <Suspense fallback={<main style={{padding:'64px',fontFamily:'sans-serif'}}>{t('Opening Guardian…')}</main>}><GuardianPage /></Suspense>;
  if (path === '/verify') return <ProofVerifier />;
  if (path === '/gift') return <GiftLanding />;
  if (path === '/dashboard/preview') return <Preview />;
  if (path === '/docs' || path === '/whitepaper' || path === '/guide' || path === '/faq') {
    return <KnowledgePage page={path.slice(1) as 'docs' | 'whitepaper' | 'guide' | 'faq'} />;
  }
  if (path === '/settings') return <AppearancePage />;
  if (path === '/perks') return <PerksPage />;
  const kid = parseKidPath(path);
  if (kid) return <KidView vault={kid.vault} lessonId={kid.lessonId} />;
  if (path === '/test') return <TestExperience />;
  return <App />;
}

const container = document.getElementById('root');
if (!container) throw new Error('missing #root');
createRoot(container).render(
  <StrictMode>
    <Root />
  </StrictMode>,
);
