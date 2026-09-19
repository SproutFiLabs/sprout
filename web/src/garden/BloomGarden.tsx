import { useEffect, useRef } from 'react';
import { bouquet, meadow, clamp, PARTS, type Art } from './botanical';
import { sectionGarden, type GardenTheme } from './sectionBotanical';
import { loadBotanicalAtlas } from './botanicalAtlas';

/** Decorative only: native document scrolling, keyboard and touch remain intact. */
export function BloomGarden({ variant = 'dashboard', theme = 'overview', paused = false, scrollMarker = true, compact = false, fullyBloomed = false }: { variant?: 'dashboard' | 'landing'; theme?: GardenTheme; paused?: boolean; scrollMarker?: boolean; compact?: boolean; fullyBloomed?: boolean }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const marker = useRef<HTMLDivElement>(null);
  const fallback = useRef<HTMLImageElement>(null);
  const pausedRef = useRef(paused);
  pausedRef.current = paused;
  useEffect(() => {
    const el = canvas.current;
    if (!el) return;
    const context = el.getContext('2d');
    if (!context) return;
    let disposed = false, frame = 0, target = fullyBloomed ? 1 : .28, current = fullyBloomed ? 1 : .28, last = 0, paints = 0;
    let visible = true, ready = false, art: Art = {};
    const section = variant === 'dashboard' && theme !== 'overview';
    el.style.opacity = '0';
    if (fallback.current) fallback.current.hidden = false;
    const media = matchMedia('(prefers-reduced-motion: reduce)');
    const root = document.documentElement;
    if (scrollMarker) root.classList.add('sprout-floral-scroll');
    const paint = (now: number) => {
      frame = 0;
      if (disposed || !ready || !visible || document.hidden) return;
      const dt = Math.max(0, Math.min(.05, (now - last) / 1000 || .016)); last = now;
      const reduced = media.matches;
      current = reduced ? 1 : current + (target - current) * (1 - Math.exp(-dt * 13));
      const ratio = Math.min(devicePixelRatio || 1, 2), w = el.clientWidth, h = el.clientHeight;
      if (el.width !== Math.round(w * ratio) || el.height !== Math.round(h * ratio)) {
        el.width = Math.round(w * ratio); el.height = Math.round(h * ratio);
      }
      context.setTransform(ratio, 0, 0, ratio, 0, 0);
      // The pause control stops ambient movement while still allowing a scroll
      // gesture to finish unfolding or folding the flowers. Reduced motion
      // settles to a single, fully open frame and never schedules another one.
      if (section) {
        sectionGarden(context, art, w, h, current, reduced || pausedRef.current ? 0 : current * 3.5, theme);
      } else if (variant === 'landing') {
        meadow(context, art, w, h, current, reduced || pausedRef.current ? 0 : current * 3.5);
      } else {
        bouquet(context, art, w, h, current, reduced || pausedRef.current ? 0 : current * 3.5, root.dataset.appearance === 'dark' ? '#fff' : undefined, compact);
      }
      el.dataset.bloom = current.toFixed(3);
      el.dataset.paints = String(++paints);
      if (!reduced && Math.abs(target - current) > .0005) frame = requestAnimationFrame(paint);
    };
    const request = () => { if (!frame) frame = requestAnimationFrame(paint); };
    const update = () => {
      const max = Math.max(0, root.scrollHeight - innerHeight);
      const fraction = max ? clamp(scrollY / max) : 0;
      // The unfolding happens while the hero is still in view, even on a long page.
      // Let the dedicated art lane finish unfolding while the hero is still
      // comfortably in view; the section itself remains tied to native scroll.
      target = max ? .28 + .72 * clamp(scrollY / Math.min(76, max)) : 1;
      if (variant === 'landing') {
        const top = el.getBoundingClientRect().top + scrollY;
        const start = Math.max(0, top - innerHeight * .65);
        target = .28 + .72 * clamp((scrollY - start) / Math.max(120, el.clientHeight * .9));
      }
      if (fullyBloomed) target = 1;
      if (marker.current) {
        marker.current.hidden = max < 2;
        marker.current.style.top = `${75 + fraction * Math.max(0, innerHeight - 150)}px`;
        marker.current.style.setProperty('--flower-turn', `${fraction * 150}deg`);
      }
      request();
    };
    const observer = new IntersectionObserver(([entry]) => { visible = entry?.isIntersecting ?? false; if (visible) { last = 0; update(); } });
    observer.observe(el);
    const resize = new ResizeObserver(update); resize.observe(root); resize.observe(el);
    const visibility = () => { if (!document.hidden) { last = 0; update(); } };
    window.addEventListener('scroll', update, { passive: true });
    window.addEventListener('resize', update);
    media.addEventListener('change', update);
    document.addEventListener('visibilitychange', visibility);
    const appearanceObserver = new MutationObserver(records => {
      if (records.some(record => record.attributeName === 'data-appearance')) request();
    });
    appearanceObserver.observe(root, { attributes: true, attributeFilter: ['data-appearance'] });
    Promise.all(PARTS.map(async name => {
      const image = new Image();
      image.src = `/art/dashboard/motion/${name}.png`;
      if (typeof image.decode === 'function') await image.decode();
      else await new Promise<void>((resolve, reject) => { image.onload = () => resolve(); image.onerror = () => reject(new Error(`Unable to load ${name}`)); });
      return [name, image] as const;
    })).then(async entries => {
      const extra = section ? await loadBotanicalAtlas() : {};
      if (disposed) return;
      art = { ...Object.fromEntries(entries), ...extra }; ready = true;
      if (fallback.current) fallback.current.hidden = true;
      el.style.opacity = '1'; update();
    }).catch(() => { /* Keep the approved static bouquet if any artwork fails to load. */ });
    return () => {
      disposed = true; cancelAnimationFrame(frame); observer.disconnect(); resize.disconnect(); appearanceObserver.disconnect();
      if (scrollMarker) root.classList.remove('sprout-floral-scroll');
      window.removeEventListener('scroll', update); window.removeEventListener('resize', update);
      media.removeEventListener('change', update); document.removeEventListener('visibilitychange', visibility);
    };
  }, [variant, theme, scrollMarker, compact, fullyBloomed]);
  return <>
    <div className={`${variant === 'landing' ? 'landing-living-garden' : `garden-bouquet garden-bouquet--living garden-bouquet--scene-${theme}`}${compact ? ' garden-bouquet--compact' : ''}`} data-botanical-theme={theme} aria-hidden="true">
      <img ref={fallback} className="garden-bouquet-fallback" src={theme === 'overview' || variant === 'landing' ? '/art/dashboard/hero-bouquet.png' : '/art/dashboard/motion/leaf-green.png'} alt="" />
      <canvas ref={canvas} data-testid="bloom-garden" data-theme={variant === 'landing' ? 'landing' : theme} />
    </div>
    {scrollMarker && <div ref={marker} className="garden-scroll-flower" aria-hidden="true" hidden>
      <span className="garden-scroll-petals">{Array.from({ length: 7 }, (_, i) => <i key={i} style={{ rotate: `${i * 360 / 7}deg` }} />)}</span>
      <img src="/art/dashboard/motion/centre.png" alt="" />
    </div>}
  </>;
}
