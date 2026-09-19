import { useEffect, useRef, type RefObject } from 'react';

/** Open privacy-pack dialogs, innermost last: only the top one answers keys. */
const stack: symbol[] = [];
const FOCUSABLE =
  'button:not(:disabled), [href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])';

/**
 * Modal keyboard behaviour, matching the app's own dialogs: focus moves inside
 * on open, Tab and Shift+Tab stay inside, Escape closes, and focus returns to
 * whatever opened it: the menu's button when it was an item of a menu that has
 * closed, or `fallback` when it is gone.
 */
export function useDialog(
  ref: RefObject<HTMLElement | null>,
  onClose: () => void,
  opts: { initial?: string; fallback?: string } = {},
): void {
  const close = useRef(onClose);
  close.current = onClose;
  const options = useRef(opts);
  // Read the opener while rendering, before the dialog takes focus: in React's
  // development double mount the effect would otherwise record the dialog itself.
  const openerRef = useRef<HTMLElement | null>(
    typeof document !== 'undefined' && document.activeElement instanceof HTMLElement ? document.activeElement : null,
  );
  useEffect(() => {
    const id = Symbol('dialog');
    stack.push(id);
    const opener = openerRef.current;
    const el = ref.current;
    const initial = options.current.initial ? el?.querySelector<HTMLElement>(options.current.initial) : null;
    (initial ?? el)?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (stack[stack.length - 1] !== id || !el) return;
      if (event.key === 'Escape') {
        event.preventDefault();
        // Other dialogs listening on window (behind this one) must not also close.
        event.stopImmediatePropagation();
        close.current();
        return;
      }
      if (event.key !== 'Tab') return;
      const nodes = [...el.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((node) => node.offsetParent !== null);
      if (!nodes.length) return;
      const first = nodes[0]!;
      const last = nodes[nodes.length - 1]!;
      const active = document.activeElement;
      if (!el.contains(active)) {
        event.preventDefault();
        first.focus();
      } else if (event.shiftKey && (active === first || active === el)) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && active === last) {
        event.preventDefault();
        first.focus();
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => {
      window.removeEventListener('keydown', onKey, true);
      stack.splice(stack.indexOf(id), 1);
      // An opener inside a menu that has since closed hands focus to that menu's
      // button. (A closed <details> keeps its content laid out, so offsetParent
      // alone cannot tell that the opener is hidden.)
      const closedMenu = opener?.closest('details:not([open])');
      const menu = closedMenu?.querySelector<HTMLElement>(':scope > summary') ?? null;
      const shown = (node: HTMLElement | null): node is HTMLElement =>
        !!node && node.isConnected && node.offsetParent !== null && (typeof node.checkVisibility !== 'function' || node.checkVisibility());
      const fallback = options.current.fallback ? document.querySelector<HTMLElement>(options.current.fallback) : null;
      for (const candidate of [closedMenu ? null : opener, menu, fallback]) {
        if (!shown(candidate)) continue;
        candidate.focus();
        if (document.activeElement === candidate) break;
      }
    };
  }, [ref]);
}
