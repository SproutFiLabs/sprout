import { Gem } from 'lucide-react';
import { t } from '../i18n';
import { tierLabel, useHolder } from './holder';

/** Wallet menu row: this wallet's SPROUT tier, linking to the perks page. Hidden when perks are off. */
export function HolderMenuRow({ address }: { address: string | null | undefined }) {
  const { perks, status } = useHolder(address);
  if (!perks?.enabled || !address) return null;
  return (
    <div className="garden-menu-row" data-testid="holder-tier-row">
      <span>{t('SPROUT tier')}</span>
      <b><a href="/perks">{status?.tier ? tierLabel(status.tier) : status ? t('See holder perks') : t('Checking…')}</a></b>
    </div>
  );
}

/** Sidebar link to the holder perks page. */
export function PerksSideLink() {
  return (
    <a className="garden-side-link" href="/perks" data-testid="perks-open">
      <Gem size={22} aria-hidden />
      {t('Holder perks')}
    </a>
  );
}
