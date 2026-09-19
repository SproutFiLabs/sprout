import { Languages } from 'lucide-react';
import { setLocale, useLocale } from './index';

/** EN / 中文 switch. Sits beside the appearance toggle and looks like it. */
export function LanguageToggle({ className = '' }: { className?: string }) {
  const locale = useLocale();
  const next = locale === 'zh' ? 'en' : 'zh';
  const label = locale === 'zh' ? 'Switch to English' : '切换到中文';
  return (
    <button
      type="button"
      className={`theme-toggle language-toggle${className ? ` ${className}` : ''}`}
      onClick={() => setLocale(next)}
      aria-label={label}
      title={label}
      lang={next === 'zh' ? 'zh-CN' : 'en'}
      data-testid="language-toggle"
    >
      <Languages size={16} aria-hidden />
      <span className="theme-toggle-label">{locale === 'zh' ? 'EN' : '中文'}</span>
    </button>
  );
}
