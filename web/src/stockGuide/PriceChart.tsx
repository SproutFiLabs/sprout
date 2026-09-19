import { useState, type PointerEvent } from 'react';
import { t } from '../i18n';
import type { ClosePoint } from './bumpiness';
import { day } from './format';

/**
 * A line of daily closes. The plot stretches to its box (so it fits a phone);
 * the text around it is ordinary HTML, so it never stretches. Pointing at the
 * plot reads out that day's value; otherwise the readout shows the last day.
 */
export function PriceChart({
  points,
  format,
  label,
  baseline,
  testId = 'price-chart',
}: {
  points: readonly ClosePoint[];
  format: (value: number) => string;
  /** What the chart shows, for screen readers. */
  label: string;
  /** A reference level drawn as a dashed line (100 for a basket index). */
  baseline?: number;
  testId?: string;
}) {
  const [hover, setHover] = useState<number | null>(null);
  if (points.length < 2) return null;
  const values = points.map((p) => p.value);
  const hi = Math.max(...values, baseline ?? -Infinity);
  const lo = Math.min(...values, baseline ?? Infinity);
  const pad = (hi - lo) * 0.08 || hi * 0.02 || 1;
  const top = hi + pad;
  const bottom = lo - pad;
  const W = 1000;
  const H = 300;
  const x = (i: number) => (i / (points.length - 1)) * W;
  const y = (v: number) => ((top - v) / (top - bottom)) * H;
  const line = points.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(p.value).toFixed(1)}`).join(' ');
  const area = `${line} L${W},${H} L0,${H} Z`;
  const shown = hover ?? points.length - 1;
  const point = points[shown]!;
  const highIndex = values.indexOf(Math.max(...values));
  const lowIndex = values.indexOf(Math.min(...values));

  const onMove = (event: PointerEvent<HTMLDivElement>) => {
    const box = event.currentTarget.getBoundingClientRect();
    if (box.width <= 0) return;
    const f = Math.min(1, Math.max(0, (event.clientX - box.left) / box.width));
    setHover(Math.round(f * (points.length - 1)));
  };

  return (
    <figure className="sg-chart" data-testid={testId}>
      <div className="sg-chart-readout" aria-hidden="true">
        <span>{day(point.date, true)}</span>
        <b>{format(point.value)}</b>
      </div>
      <div className="sg-chart-plot" role="img" aria-label={label} onPointerMove={onMove} onPointerLeave={() => setHover(null)}>
        <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" aria-hidden="true" focusable="false">
          <path className="sg-chart-area" d={area} />
          {baseline !== undefined ? (
            <line className="sg-chart-baseline" x1={0} x2={W} y1={y(baseline)} y2={y(baseline)} vectorEffect="non-scaling-stroke" />
          ) : null}
          <path className="sg-chart-line" d={line} vectorEffect="non-scaling-stroke" />
          {hover !== null ? <line className="sg-chart-cursor" x1={x(shown)} x2={x(shown)} y1={0} y2={H} vectorEffect="non-scaling-stroke" /> : null}
        </svg>
        <span className="sg-chart-dot" style={{ left: `${(x(shown) / W) * 100}%`, top: `${(y(point.value) / H) * 100}%` }} aria-hidden="true" />
        <span className="sg-chart-y sg-chart-y--high" aria-hidden="true">{t('High {value}', { value: format(values[highIndex]!) })}</span>
        <span className="sg-chart-y sg-chart-y--low" aria-hidden="true">{t('Low {value}', { value: format(values[lowIndex]!) })}</span>
      </div>
      <figcaption className="sg-chart-x" aria-hidden="true">
        <span>{day(points[0]!.date, true)}</span>
        <span>{day(points[points.length - 1]!.date, true)}</span>
      </figcaption>
    </figure>
  );
}
