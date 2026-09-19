import { createRoot } from 'react-dom/client';
import { Eye, EyeOff, ScanEye } from 'lucide-react';
import { t, useLocale } from '../i18n';
import { setDiscreet, toggleDiscreet, useDiscreet } from './discreet';
import './privacy-pack.css';

/** Ask the app to open the privacy checkup (PrivacyPackHost listens). */
export function openPrivacyCheckup(): void {
  window.dispatchEvent(new Event('sprout-open-checkup'));
}

/** Alt+Shift+H, named the way this keyboard labels it. */
function shortcutLabel(): string {
  const mac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);
  return mac ? '⌥⇧H' : 'Alt+Shift+H';
}

const closeMenu = (el: HTMLElement) => el.closest('details')?.removeAttribute('open');

/** The discreet-mode switch, for a menu. */
export function DiscreetSwitch() {
  const on = useDiscreet();
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      className="pp-menu-switch"
      data-testid="discreet-toggle"
      onClick={() => toggleDiscreet()}
    >
      {on ? <EyeOff size={16} aria-hidden /> : <Eye size={16} aria-hidden />}
      <span className="pp-menu-switch-text">
        <span>{t('Hide amounts')}</span>
        <small>{t('For screensharing · {keys}', { keys: shortcutLabel() })}</small>
      </span>
      <span className="pp-switch" aria-hidden>
        <span />
      </span>
    </button>
  );
}

/** Rows for the dashboard's wallet menu: discreet mode and the privacy checkup. */
export function PrivacyMenuRows({ checkup = true }: { checkup?: boolean }) {
  return (
    <div className="pp-menu-rows">
      <DiscreetSwitch />
      {checkup ? (
        <button
          type="button"
          className="pp-menu-link"
          data-testid="checkup-open-menu"
          onClick={(e) => {
            closeMenu(e.currentTarget);
            openPrivacyCheckup();
          }}
        >
          <ScanEye size={16} aria-hidden />
          <span>{t('Privacy checkup')}</span>
        </button>
      ) : null}
    </div>
  );
}

/** A small mark beside the wallet button while amounts are hidden (the menu has the switch). */
export function DiscreetMark() {
  const on = useDiscreet();
  if (!on) return null;
  return (
    <span className="pp-discreet-mark" data-testid="discreet-mark" role="img" aria-label={t('Amounts hidden')} title={t('Amounts hidden')}>
      <EyeOff size={15} aria-hidden />
    </span>
  );
}

/** The entry in Family privacy. */
export function CheckupLaunch({ onOpen }: { onOpen: () => void }) {
  return (
    <button
      type="button"
      className="privacy-pill pp-checkup-launch"
      data-testid="checkup-open-privacy"
      onClick={() => {
        openPrivacyCheckup();
        onOpen();
      }}
    >
      <ScanEye size={15} aria-hidden /> {t('Privacy checkup · what’s public, what’s private')} ↗
    </button>
  );
}

/** Says amounts are hidden wherever the page is, and shows them again in one tap. */
function DiscreetPill() {
  useLocale();
  const on = useDiscreet();
  if (!on) return null;
  return (
    <div className="pp-discreet-pill" role="status" data-discreet-ignore data-testid="discreet-pill">
      <EyeOff size={15} aria-hidden />
      <span>{t('Amounts hidden')}</span>
      <button type="button" onClick={() => setDiscreet(false)} data-testid="discreet-pill-show">
        {t('Show')}
      </button>
    </div>
  );
}

let mounted = false;
/** The pill lives in its own root beside the page, so every route has it. */
export function mountDiscreetIndicator(): void {
  if (mounted || typeof document === 'undefined') return;
  mounted = true;
  const host = document.createElement('div');
  host.id = 'sprout-discreet-indicator';
  document.body.appendChild(host);
  createRoot(host).render(<DiscreetPill />);
}
