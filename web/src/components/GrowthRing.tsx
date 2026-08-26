interface GrowthRingProps {
  progress: number;
  value: string;
  label: string;
  sublabel?: string;
  muted?: boolean;
}

export function GrowthRing({ progress, value, label, sublabel, muted = false }: GrowthRingProps) {
  const radius = 78;
  const circumference = 2 * Math.PI * radius;
  const clamped = Math.max(0, Math.min(1, Number.isFinite(progress) ? progress : 0));
  const dash = circumference * clamped;

  return (
    <div className="ring-wrap" role="img" aria-label={`${label}: ${value}${sublabel ? `, ${sublabel}` : ''}`}>
      <svg viewBox="0 0 200 200" className="ring" aria-hidden="true">
        <circle cx="100" cy="100" r={radius} className="ring-track" />
        <circle
          cx="100"
          cy="100"
          r={radius}
          className={muted ? 'ring-progress ring-progress--muted' : 'ring-progress'}
          strokeDasharray={`${dash} ${circumference - dash}`}
          strokeDashoffset={circumference * 0.25}
        />
      </svg>
      <div className="ring-center">
        <span className="ring-value" data-testid="portfolio-value">
          {value}
        </span>
        <span className="ring-label">{label}</span>
        {sublabel ? <span className="ring-sublabel">{sublabel}</span> : null}
      </div>
    </div>
  );
}
