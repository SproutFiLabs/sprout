import { ArrowLeft, BookOpen, Moon } from 'lucide-react';
import { ThemeSettings, ThemeToggle } from './theme/ThemeSettings';
import { LanguageToggle } from './i18n/LanguageToggle';

export function AppearancePage() {
  return <main className="appearance-page knowledge-root">
    <header className="appearance-header"><a className="appearance-brand" href="/"><img src="/brand/sprout-logo.png" alt="" /><span>SPROUT</span></a><nav aria-label="Settings navigation"><a href="/guide">Guide</a><a href="/docs">Docs</a><ThemeToggle /><LanguageToggle /></nav></header>
    <div className="appearance-content"><a className="appearance-back" href="/dashboard"><ArrowLeft size={16} />Back to the garden</a>
      <span className="appearance-eyebrow">Make yourself at home</span><h1>A garden for every hour.</h1><p className="appearance-intro">Daylight, moonlight, or a little of both. Choose what feels comfortable for you.</p>
      <ThemeSettings />
      <div className="appearance-notes"><div><Moon size={20} /><h2>The evening garden</h2><p>Deep forest tones, moonlit leaves, and quiet points of light. The same garden, with a different atmosphere.</p></div><div><BookOpen size={20} /><h2>Your family stays yours</h2><p>Appearance is saved on this device. For names and family details, open Family settings in your dashboard.</p><a href="/dashboard">Open your dashboard →</a></div></div>
    </div>
  </main>;
}
