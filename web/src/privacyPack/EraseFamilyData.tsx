import { useEffect, useRef, useState } from 'react';
import { Check, Globe, Trash2, X } from 'lucide-react';
import { clearFamilySession } from '../api';
import { lockLabels } from '../localStore';
import type { WalletState } from '../wallet';
import { t, tj } from '../i18n';
import { ERASE_CONFIRM, clearLocalFamilyData, errorMessage, packApi, type EraseCounts, type EraseResult, type FamilyFootprint } from './data';
import { useDialog } from './useDialog';

type Row = { key: string; label: string; count: number | null; note?: string };

function erasedRows(c: EraseCounts): Row[] {
  const rows: Row[] = [
    {key:"familyLedger",label:"Tax Garden records",count:c.familyLedger??0},
    {key:"familyPlans",label:"Saved family investing plans",count:c.familyPlans??0},
    {key:"expansionRecords",label:"Grow workspace records",count:c.expansionRecords??0,note:"Celebrations, round-up journals, practice seasons and league memberships."},
    { key: 'giftLinks', label: t('Gift links'), count: c.giftLinks, note: t('They stop working.') },
    { key: 'campaigns', label: t('Campaign titles, goals and end dates'), count: c.campaigns },
    { key: 'giftNotes', label: t('Gift messages, encrypted or not'), count: c.giftNotes },
    {
      key: 'giftPayments',
      label: t('Sprout’s records of gifts made through your links'),
      count: c.giftPayments,
      note: t('The gifts themselves stay on the blockchain.'),
    },
    { key: 'kidInvites', label: t('Kid links'), count: c.kidInvites, note: t('Any open kid view closes.') },
    { key: 'proofs', label: t('Milestone proofs'), count: c.proofs, note: t('Proofs you shared will no longer check as active.') },
  ];
  if (c.choreDescriptions > 0) rows.push({ key: 'choreDescriptions', label: t('Stored chore descriptions'), count: c.choreDescriptions });
  rows.push({ key: 'giftKey', label: t('Your registered gift encryption key'), count: c.giftKey });
  rows.push({ key: 'sessions', label: t('Every family sign-in for this wallet'), count: null, note: t('Every browser signed in to your family is signed out.') });
  return rows;
}

/**
 * "Delete my family's data": counts first, what stays, a typed confirmation,
 * then the wallet signature. Afterwards this browser's family data is cleared
 * and the family session ends.
 */
export function EraseFamilyData({ wallet, onClose, onDone }: { wallet: WalletState; onClose: () => void; onDone: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const [report, setReport] = useState<FamilyFootprint | null>(null);
  const [loadError, setLoadError] = useState('');
  const [typed, setTyped] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState<(EraseResult & { local: number }) | null>(null);
  const active = useRef(wallet);
  useDialog(ref, () => (busy ? undefined : result ? onDone() : onClose()), { initial: '[data-erase-initial]' });

  useEffect(() => {
    let live = true;
    packApi
      .report()
      .then((r) => live && setReport(r))
      .catch((e) => live && setLoadError(errorMessage(e)));
    return () => {
      live = false;
    };
  }, []);

  // Focus the result's button once the erase is done.
  useEffect(() => {
    if (result) ref.current?.querySelector<HTMLElement>('[data-erase-done]')?.focus();
  }, [result]);

  const confirmed = typed.trim() === ERASE_CONFIRM;
  const erase = async () => {
    if (!report || !confirmed || busy) return;
    setBusy(true);
    setError('');
    try {
      const vaults = report.sprouts.map((s) => s.id);
      const done = await packApi.erase(active.current, vaults);
      const local = clearLocalFamilyData(active.current.address, vaults, done.inviteIds);
      lockLabels();
      // The server ended every session for this wallet; end this tab's too.
      clearFamilySession();
      window.dispatchEvent(new Event('sprout-family-session-ended'));
      setResult({ ...done, local });
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const sprouts = report?.sprouts.length ?? 0;
  return (
    <div className="pp-dialog-backdrop">
      <div
        className="pp-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="pp-erase-title"
        aria-describedby="pp-erase-lead"
        tabIndex={-1}
        ref={ref}
        data-testid="erase-dialog"
      >
        <div className="pp-dialog-head">
          <span className="pp-dialog-icon pp-tone-danger" aria-hidden>
            {result ? <Check size={20} /> : <Trash2 size={20} />}
          </span>
          <h2 id="pp-erase-title">{result ? t('Your family’s data is deleted') : t('Delete my family’s data')}</h2>
          {result ? null : (
            <button type="button" className="privacy-icon" aria-label={t('Close')} onClick={onClose} disabled={busy} data-erase-initial>
              <X size={18} />
            </button>
          )}
        </div>

        {result ? (
          <>
            <p id="pp-erase-lead" className="pp-lead">
              {t('Sprout erased these from its server. This browser’s family data for this wallet is cleared too.')}
            </p>
            <ul className="pp-count-list" data-testid="erase-result">
              {erasedRows(result.erased).map((row) => (
                <li key={row.key}>
                  <span>{row.label}</span>
                  <b>{row.count === null ? <Check size={15} aria-label={t('Done')} /> : row.count}</b>
                </li>
              ))}
            </ul>
            <p className="pp-note">
              <Globe size={15} aria-hidden /> {t('Everything on the blockchain is unchanged and still public: your sprouts, balances, gifts and the wallets they came from.')}
            </p>
            <div className="pp-dialog-actions" key="done">
              <button type="button" className="privacy-button" onClick={onDone} data-erase-done data-testid="erase-done">
                {t('Back to the dashboard')}
              </button>
            </div>
          </>
        ) : (
          <>
            <p id="pp-erase-lead" className="pp-lead">
              {tj('This permanently erases what Sprout stores off the blockchain for the {count} you planted. It can’t be undone.', {
                count: <b>{sprouts === 1 ? t('1 sprout') : t('{n} sprouts', { n: sprouts })}</b>,
              })}
            </p>
            {loadError ? (
              <p className="privacy-error" role="alert">
                {loadError}
              </p>
            ) : !report ? (
              <p className="pp-muted" role="status">
                {t('Counting what Sprout stores…')}
              </p>
            ) : (
              <>
                <h3 className="pp-dialog-sub">{t('Erased from Sprout’s server')}</h3>
                <ul className="pp-count-list" data-testid="erase-preview">
                  {erasedRows(report.erase).map((row) => (
                    <li key={row.key} data-erase-row={row.key}>
                      <span>
                        {row.label}
                        {row.note ? <small>{row.note}</small> : null}
                      </span>
                      <b>{row.count === null ? <Check size={15} aria-label={t('Included')} /> : row.count}</b>
                    </li>
                  ))}
                </ul>
                <h3 className="pp-dialog-sub">{t('Cleared from this browser')}</h3>
                <p className="pp-small">
                  {t('This wallet’s encrypted Family privacy vault (names, chore titles, gift labels and your gift key), plus older labels and saved helpers for these sprouts. Your appearance, language and discreet settings stay. Other browsers and backups you downloaded aren’t touched.')}
                </p>
                <h3 className="pp-dialog-sub">{t('What stays')}</h3>
                <ul className="pp-stays">
                  <li>{t('Everything on the blockchain: your sprouts’ contracts, balances and holdings, and every deposit, gift and purchase with the wallets involved. Nothing can delete that.')}</li>
                  <li>
                    {t('Sprout’s copy of that public data, so your sprouts keep working: the list of your sprouts, their on-chain history, value history and chore records.')}
                  </li>
                  <li>{t('Automatic weekly buying keeps running until you cancel it.')}</li>
                  <li>{t('A count of these requests for this wallet, kept for up to two days to prevent abuse.')}</li>
                  <li>{t('Copies of Sprout’s database made before now, such as backups, are not changed.')}</li>
                </ul>
                <label className="privacy-field pp-confirm">
                  {tj('Type {word} to confirm', { word: <b>{ERASE_CONFIRM}</b> })}
                  <input
                    value={typed}
                    onChange={(e) => setTyped(e.target.value)}
                    autoComplete="off"
                    autoCapitalize="characters"
                    spellCheck={false}
                    disabled={busy}
                    data-testid="erase-confirm-input"
                  />
                </label>
              </>
            )}
            {error ? (
              <p className="privacy-error" role="alert" data-testid="erase-error">
                {error}
              </p>
            ) : null}
            <div className="pp-dialog-actions" key="confirm">
              <button type="button" className="privacy-secondary" onClick={onClose} disabled={busy}>
                {t('Cancel')}
              </button>
              <button
                type="button"
                className="privacy-button pp-danger"
                disabled={!report || !confirmed || busy}
                onClick={() => void erase()}
                data-testid="erase-submit"
              >
                <Trash2 size={15} aria-hidden />
                {busy ? t('Waiting for your wallet…') : t('Delete permanently')}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
