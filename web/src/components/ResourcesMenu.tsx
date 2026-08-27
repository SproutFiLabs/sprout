import { useRef } from 'react';
import { BookOpen, ChevronUp, FileText, Moon, Compass } from 'lucide-react';

export function ResourcesMenu() {
  const ref = useRef<HTMLDetailsElement>(null);
  return <details ref={ref} className="garden-resources" onKeyDown={event => {
    if (event.key === 'Escape') { event.preventDefault(); ref.current?.removeAttribute('open'); ref.current?.querySelector('summary')?.focus(); }
  }}>
    <summary className="garden-side-link" data-testid="resources-menu"><BookOpen size={22} /><span>Guide &amp; docs</span><ChevronUp size={14} /></summary>
    <nav className="garden-resources-panel" aria-label="Sprout resources">
      <a href="/guide"><Compass size={17} /><span>Getting started<small>A practical family guide</small></span></a>
      <a href="/docs"><BookOpen size={17} /><span>Documentation<small>Features and how they work</small></span></a>
      <a href="/whitepaper"><FileText size={17} /><span>Whitepaper<small>Technical design</small></span></a>
      <a href="/settings"><Moon size={17} /><span>Appearance<small>Light, dark, or your device</small></span></a>
    </nav>
  </details>;
}
