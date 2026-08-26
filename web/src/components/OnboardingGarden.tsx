import { useEffect, useRef } from 'react';
import { flower, PARTS, smooth, type Art } from '../garden/botanical';

let artPromise: Promise<Art> | undefined;
function loadArt() {
  return artPromise ??= Promise.all(PARTS.map(async name => {
    const image = new Image(); image.src = `/art/dashboard/motion/${name}.png`;
    await image.decode(); return [name, image] as const;
  })).then(Object.fromEntries);
}

/** The same articulated, image-generated petals as the dashboard bouquet. */
export function OnboardingGarden({ chapter = 0 }: { chapter?: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const chapterRef = useRef(chapter);
  chapterRef.current = chapter;
  useEffect(() => {
    const canvas = ref.current, ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;
    let frame = 0, disposed = false, art: Art | undefined, elapsed = 0, last = 0;
    const media = matchMedia('(prefers-reduced-motion: reduce)');
    const paint = (now: number) => {
      frame = 0;
      if (disposed || !art || document.hidden) return;
      if (last && now - last < 1000 / 30) { frame = requestAnimationFrame(paint); return; }
      elapsed += last ? Math.min(.06, (now - last) / 1000) : 0; last = now;
      const w = canvas.clientWidth, h = canvas.clientHeight, dpr = Math.min(devicePixelRatio || 1, 2);
      if (canvas.width !== Math.round(w*dpr) || canvas.height !== Math.round(h*dpr)) { canvas.width = Math.round(w*dpr); canvas.height = Math.round(h*dpr); }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, w, h);
      const mobile = w > h * 1.5;
      const sw = mobile ? 480 : 400, sh = mobile ? 160 : 480;
      const scale = Math.min(w/sw,h/sh);
      ctx.save(); ctx.translate((w-sw*scale)/2,h-sh*scale); ctx.scale(scale,scale);
      // Keep one continuous timeline across chapters. The second panel is
      // already open on its first frame, while the same elapsed sway carries on.
      const growth = media.matches || chapterRef.current > 0 ? 1 : .08 + .92*smooth(elapsed/2.2);
      for (const i of [1, 0, 2]) {
        const p = media.matches || chapterRef.current > 0 ? 1 : Math.max(.06, growth - i*.035 - (elapsed>2.2 ? (1-Math.cos((elapsed-2.2)*.85+i*.3))*.055 : 0));
        flower(ctx, art, mobile ? 100+i*140 : 97+i*103, sh+12, mobile ? [105,132,99][i]! : [235,335,215][i]!, p, media.matches ? 0 : elapsed, ['orange','blue','yellow'][i], i*1.7);
      }
      ctx.restore(); canvas.dataset.bloom = growth.toFixed(3);
      canvas.dataset.frame = String(Number(canvas.dataset.frame ?? 0)+1);
      if (!media.matches) frame = requestAnimationFrame(paint);
    };
    const request = () => { if (!frame && !disposed) { last=0; frame=requestAnimationFrame(paint); } };
    const resize = new ResizeObserver(request); resize.observe(canvas);
    media.addEventListener('change',request); document.addEventListener('visibilitychange',request);
    loadArt().then(result => { art=result; request(); }).catch(() => { canvas.dataset.unavailable='true'; });
    return () => { disposed=true; cancelAnimationFrame(frame); resize.disconnect(); media.removeEventListener('change',request); document.removeEventListener('visibilitychange',request); };
  }, []);
  return <div className="onboarding-living-art" aria-hidden="true"><canvas ref={ref} data-testid="onboarding-garden" /></div>;
}
