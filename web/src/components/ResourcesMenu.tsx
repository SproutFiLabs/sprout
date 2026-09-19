import { useRef } from 'react';
import { BookOpen, ChevronUp, FileText, Moon, Compass, HelpCircle } from 'lucide-react';
import { t } from '../i18n';

export function ResourcesMenu() {
  const ref = useRef<HTMLDetailsElement>(null);
  return <details ref={ref} className="garden-resources" onKeyDown={event => {
    if (event.key === 'Escape') { event.preventDefault(); ref.current?.removeAttribute('open'); ref.current?.querySelector('summary')?.focus(); }
  }}>
    <summary className="garden-side-link" data-testid="resources-menu"><BookOpen size={22} /><span>{t('Guide & docs')}</span><ChevronUp size={14} /></summary>
    <nav className="garden-resources-panel" aria-label={t('Sprout resources')}>
      <a href="/intelligence"><Compass size={17} /><span>Intelligence<small>Thoughtful AI for parents</small></span></a>
      <a href="/faq"><HelpCircle size={17} /><span>{t('Questions')}<small>{t('Money, withdrawals, costs, beta')}</small></span></a>
      <a href="/guide"><Compass size={17} /><span>{t('Getting started')}<small>{t('A practical family guide')}</small></span></a>
      <a href="/docs"><BookOpen size={17} /><span>{t('Documentation')}<small>{t('Features and how they work')}</small></span></a>
      <a href="/whitepaper"><FileText size={17} /><span>{t('Whitepaper')}<small>{t('Technical design')}</small></span></a>
      <a href="/settings"><Moon size={17} /><span>{t('Appearance')}<small>{t('Light, dark, or your device')}</small></span></a>
    </nav>
  </details>;
}
