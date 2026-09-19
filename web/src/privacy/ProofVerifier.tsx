import { useEffect, useRef, useState } from 'react';
import { ArrowUpRight, Check, Fingerprint, ShieldCheck, Upload } from 'lucide-react';
import { milestoneLabel, type ZkEnvelope } from '@sprout/shared/zk';
import { checkCertificate, MAX_PROOF_BYTES, parseProof, proofFromHash, proofTask } from './zk-client';
import { dateLocale, t, useLocale } from '../i18n';
import { LanguageToggle } from '../i18n/LanguageToggle';
import './zk.css';

// A fragment never reaches HTTP logs. Remove it before any verification request.
const incomingHash = location.pathname.replace(/\/+$/, '') === '/verify' ? location.hash : '';
if (incomingHash) history.replaceState(null, '', '/verify');
export function ProofVerifier() {
  const locale = useLocale();
  const [verified, setVerified] = useState<ZkEnvelope | null>(null);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState('Choose a proof or open a private proof link.');
  const [error, setError] = useState('');
  const controller = useRef<AbortController | null>(null);
  const mounted = useRef(true);
  const uploadGeneration = useRef(0);
  const verify = async (envelope: ZkEnvelope) => {
    controller.current?.abort();
    const task = new AbortController();
    controller.current = task;
    const live = () => mounted.current && !task.signal.aborted;
    setVerified(null);
    setError('');
    setBusy(true);
    setStatus('Verifying the zero-knowledge proof…');
    try {
      const result = await proofTask({ kind: 'verify', envelope }, task.signal, () => {});
      if (!live()) return;
      setStatus('Checking the issuer certificate…');
      await checkCertificate(result.certificate, task.signal);
      if (live()) {
        setVerified(result);
        setStatus('Proof verified. Certificate active.');
      }
    } catch (e) {
      if (live()) {
        setStatus('Verification did not pass.');
        setError(e instanceof Error ? e.message : 'Invalid proof.');
      }
    } finally {
      if (live()) setBusy(false);
    }
  };
  useEffect(() => {
    mounted.current = true;
    if (incomingHash) {
      try {
        void verify(proofFromHash(incomingHash));
      } catch {
        setError('This proof link is invalid. Ask for a new one.');
      }
    }
    return () => {
      mounted.current = false;
      uploadGeneration.current++;
      controller.current?.abort();
    };
  }, []);
  useEffect(() => {
    document.title = `${t('Verify a private milestone')} · Sprout`;
  }, [locale]);
  useEffect(() => {
    if (!verified) return;
    const task = new AbortController();
    const refresh = () =>
      void checkCertificate(verified.certificate, task.signal).catch((e) => {
        if (!task.signal.aborted) {
          setVerified(null);
          setStatus('Certificate no longer verified.');
          setError(e instanceof Error ? e.message : 'Certificate unavailable.');
        }
      });
    const timer = setInterval(refresh, 15_000);
    const focus = () => {
      if (!document.hidden) refresh();
    };
    document.addEventListener('visibilitychange', focus);
    return () => {
      task.abort();
      clearInterval(timer);
      document.removeEventListener('visibilitychange', focus);
    };
  }, [verified]);
  return (
    <main className="zk-verifier" data-testid="zk-verifier">
      <header className="zk-verifier-nav">
        <a href="/">
          <img src="/brand/sprout-logo.png" alt="" /> sprout
        </a>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <LanguageToggle />
          <a href="/dashboard">
            {t('Open your garden')} <ArrowUpRight size={16} />
          </a>
        </div>
      </header>
      <section className="zk-verifier-hero">
        <span className="zk-eyebrow">
          <Fingerprint size={16} /> {t('INDEPENDENT PROOF CHECK')}
        </span>
        <h1>
          {t('The proof is public.')}
          <br />
          <em>{t('The details stay private.')}</em>
        </h1>
        <p>{t('Verify a milestone without asking for a wallet address, child’s name or exact balance.')}</p>
      </section>
      <section className={`zk-verification-card ${verified ? 'is-verified' : ''}`}>
        <div className="zk-verification-icon">{verified ? <Check size={34} /> : <ShieldCheck size={34} />}</div>
        <h2>
          {verified
            ? t('{amount} milestone verified', { amount: milestoneLabel(verified.certificate.thresholdCents) })
            : t('Verify a private milestone')}
        </h2>
        <p role="status" aria-live="polite">
          {t(status)}
        </p>
        {verified ? (
          <div className="zk-verification-facts">
            <span>
              <Check size={16} /> {t('PLONK proof verified in this browser')}
            </span>
            <span>
              <Check size={16} /> {t('Sprout certificate active')}
            </span>
            <span>{t('Snapshot certified {time}', { time: new Date(verified.certificate.issuedAt).toLocaleTimeString(dateLocale()) })}</span>
            <span>{t('Certificate expires {time}', { time: new Date(verified.certificate.expiresAt).toLocaleTimeString(dateLocale()) })}</span>
          </div>
        ) : null}
        <label className="zk-upload">
          <Upload size={17} /> {busy ? t('Checking proof…') : t('Choose a proof file')}
          <input
            type="file"
            accept=".json,application/json"
            disabled={busy}
            aria-label={t('Upload milestone proof')}
            onChange={(e) => {
              const file = e.target.files?.[0];
              e.target.value = '';
              if (!file) return;
              const upload = ++uploadGeneration.current;
              controller.current?.abort();
              setVerified(null);
              setError('');
              setBusy(false);
              if (file.size > MAX_PROOF_BYTES) {
                setError('This proof file is too large.');
                return;
              }
              void file
                .text()
                .then((text) => {
                  if (mounted.current && upload === uploadGeneration.current) return verify(parseProof(text));
                })
                .catch(() => {
                  if (mounted.current && upload === uploadGeneration.current)
                    setError('This is not a valid Sprout proof file.');
                });
            }}
          />
        </label>
        {error ? (
          <p className="zk-error" role="alert">
            {t(error)}
          </p>
        ) : null}
      </section>
      <footer className="zk-verifier-boundary">
        <b>{t('What this proves')}</b>
        <p>
          {t('A Sprout-certified balance snapshot met the selected threshold. The ZK proof is checked locally; Sprout attests the source balance and checks expiry and revocation. This is not a trustless proof of on-chain funds, an identity check or permission to move money. Existing blockchain activity remains public.')}
        </p>
      </footer>
    </main>
  );
}
