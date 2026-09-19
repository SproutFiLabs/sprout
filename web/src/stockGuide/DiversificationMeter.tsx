import { t } from '../i18n';
import { SPREAD_LABELS, spreadReading, spreadText, type MixPick } from './diversification';
import './meter.css';

/**
 * How spread out a mix is, from Concentrated to Spread out, with the reason in
 * one sentence. Used in the stock picker (planting and editing a mix) and on
 * every basket in the stock guide. Shows nothing for a mix it can't describe.
 */
export function DiversificationMeter({ picks, note = true, testId = 'spread-meter' }: { picks: readonly MixPick[]; note?: boolean; testId?: string }) {
  const reading = spreadReading(picks);
  if (!reading) return null;
  const { label, sentence } = spreadText(reading);
  return (
    <div className="spread-meter" data-testid={testId} data-level={reading.level}>
      <div className="spread-meter-head">
        <span className="spread-meter-title">{t('How spread out')}</span>
        <b className="spread-meter-label">{label}</b>
      </div>
      <div
        className="spread-meter-track"
        role="meter"
        aria-label={t('How spread out')}
        aria-valuemin={0}
        aria-valuemax={SPREAD_LABELS.length - 1}
        aria-valuenow={reading.level}
        aria-valuetext={`${label}. ${sentence}`}
      >
        {SPREAD_LABELS.map((_, i) => (
          <i key={i} className={i <= reading.level ? 'is-on' : undefined} aria-hidden="true" />
        ))}
      </div>
      <div className="spread-meter-ends" aria-hidden="true">
        <span>{t(SPREAD_LABELS[0]!)}</span>
        <span>{t(SPREAD_LABELS[SPREAD_LABELS.length - 1]!)}</span>
      </div>
      <p className="spread-meter-why">{sentence}</p>
      {note ? <p className="spread-meter-note">{t('Counts holdings, broad index funds and themes. A description, not advice.')}</p> : null}
    </div>
  );
}
