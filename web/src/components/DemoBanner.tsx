import { t } from '../i18n';

export function DemoBanner({ localDemo }: { localDemo: boolean }) {
  if (!localDemo) return null;
  return (
    <div className="demo-banner" role="status">
      <strong>{t('LOCAL DEMO')}</strong>
      <span>{t('Anvil chain with mock assets and development accounts. No real value.')}</span>
    </div>
  );
}
