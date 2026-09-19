import { useEffect, useRef, useState } from 'react';
import { ArrowUpRight, Check, Copy, Download, Fingerprint, LockKeyhole, ShieldCheck, Sparkles, X } from 'lucide-react';
import { ZK_THRESHOLDS, milestoneLabel, type ZkEnvelope, type ZkCertificateStatus } from '@sprout/shared/zk';
import { api } from '../api';
import type { WalletState } from '../wallet';
import { checkCertificate, downloadProof, proofLink, proofTask, proofError, type ProofStage } from './zk-client';
import './zk.css';

const stages: Record<ProofStage, string> = {
  certifying: 'Certifying the balance snapshot',
  loading: 'Checking the proof engine',
  proving: 'Building your zero-knowledge proof',
  verifying: 'Verifying the mathematics',
  checking: 'Checking certificate status',
};
export function ProofStudio({
  wallet,
  vault,
  sprouts,
  onVaultChange,
}: {
  wallet: WalletState | null;
  vault: string;
  sprouts: Array<{ id: string }>;
  onVaultChange: (vault: string) => void;
}) {
  const [threshold, setThreshold] = useState('50000');
  const [stage, setStage] = useState<ProofStage | null>(null);
  const [proof, setProof] = useState<ZkEnvelope | null>(null);
  const [certificates, setCertificates] = useState<ZkCertificateStatus[]>([]);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [revoking, setRevoking] = useState('');
  const [now, setNow] = useState(Date.now());
  const operation = useRef<AbortController | null>(null);
  const generation = useRef(0);
  const alive = useRef(true);
  const busy = stage !== null;
  const current = proof && proof.certificate.expiresAt > now ? proof : null;
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      generation.current++;
      operation.current?.abort();
    };
  }, []);
  useEffect(() => {
    let live = true;
    const refresh = async () => {
      if (!wallet || !vault) return;
      try {
        const result = await api.zkCertificates(vault);
        if (live) {
          setCertificates(result.certificates);
          setProof((old) =>
            old && result.certificates.some((c) => c.id === old.certificate.id && !c.revoked) ? old : null,
          );
        }
      } catch {
        /* A parent can retry explicitly; never retain a proof after session teardown. */
      }
    };
    void refresh();
    const timer = setInterval(() => {
      setNow(Date.now());
      void refresh();
    }, 15_000);
    return () => {
      live = false;
      clearInterval(timer);
    };
  }, [wallet, vault]);
  const create = async () => {
    if (!wallet || !vault || busy) return;
    operation.current?.abort();
    const controller = new AbortController();
    operation.current = controller;
    const run = ++generation.current;
    const valid = () => alive.current && run === generation.current && !controller.signal.aborted;
    setProof(null);
    setError('');
    setNotice('');
    setStage('certifying');
    try {
      const issuance = await api.issueZk(wallet, vault, threshold);
      if (!valid()) return;
      const result = await proofTask({ kind: 'prove', issuance }, controller.signal, (value) => {
        if (valid()) setStage(value);
      });
      if (!valid()) return;
      setStage('checking');
      await checkCertificate(result.certificate, controller.signal);
      if (!valid()) return;
      setCertificates((list) => [{ ...result.certificate, revoked: false }, ...list]);
      setNow(Date.now());
      setProof(result);
    } catch (e) {
      if (valid()) setError(proofError(e));
    } finally {
      if (valid()) setStage(null);
    }
  };
  const cancel = () => {
    generation.current++;
    operation.current?.abort();
    setStage(null);
    setNotice('Proof creation cancelled.');
  };
  const revoke = async (id: string) => {
    if (!wallet || revoking) return;
    setRevoking(id);
    setError('');
    try {
      await api.revokeZk(wallet, id);
      if (!alive.current) return;
      setCertificates((list) => list.map((c) => (c.id === id ? { ...c, revoked: true } : c)));
      setProof((old) => (old?.certificate.id === id ? null : old));
      setNotice('Proof revoked. It will no longer pass the certificate check.');
    } catch (e) {
      if (alive.current) setError(proofError(e, 'Could not revoke proof.'));
    } finally {
      if (alive.current) setRevoking('');
    }
  };
  return (
    <section className={`zk-studio ${busy ? 'is-proving' : ''} ${current ? 'is-proven' : ''}`} data-testid="zk-studio">
      <div className="zk-intro">
        <span className="zk-eyebrow">
          <Sparkles size={15} /> ZERO-KNOWLEDGE MILESTONES
        </span>
        <h2>
          Show the milestone.
          <br />
          <em>Keep the rest yours.</em>
        </h2>
        <p>
          Prove how far a sprout has grown. Share a milestone with no exact balance, wallet address or child’s identity
          in the proof.
        </p>
        <label className="zk-vault-label">
          Choose a sprout
          <select value={vault} disabled={!wallet || busy} onChange={(e) => onVaultChange(e.target.value)}>
            {!sprouts.length ? (
              <option value="">No parent sprouts yet</option>
            ) : (
              sprouts.map((s, i) => (
                <option key={s.id} value={s.id}>
                  Family sprout {i + 1}
                </option>
              ))
            )}
          </select>
        </label>
        <label className="zk-label" htmlFor="zk-threshold">
          Choose what you reveal
        </label>
        <div className="zk-thresholds" role="group" aria-label="Milestone amount">
          {ZK_THRESHOLDS.map((amount) => (
            <button
              key={amount}
              type="button"
              aria-pressed={threshold === amount}
              disabled={busy}
              onClick={() => {
                setThreshold(amount);
                setProof(null);
                setNotice('');
              }}
            >
              {milestoneLabel(amount)}
            </button>
          ))}
        </div>
        <select
          id="zk-threshold"
          className="zk-mobile-select"
          value={threshold}
          disabled={busy}
          onChange={(e) => {
            setThreshold(e.target.value);
            setProof(null);
          }}
        >
          {ZK_THRESHOLDS.map((amount) => (
            <option key={amount} value={amount}>
              {milestoneLabel(amount)}
            </option>
          ))}
        </select>
        <div className="zk-primary-actions">
          <button className="zk-create" onClick={() => void create()} disabled={!wallet || !vault || busy}>
            <Fingerprint size={19} /> {busy ? 'Creating proof…' : 'Create private proof'} <ArrowUpRight size={17} />
          </button>
          {busy ? (
            <button className="zk-cancel" onClick={cancel} aria-label="Cancel proof creation">
              <X size={18} />
            </button>
          ) : null}
        </div>
        <p className="zk-trust">
          Sprout certifies a balance snapshot. Your browser proves the milestone. Certificates expire after 30 minutes.
        </p>
        <a className="zk-verify-link" href="/verify">
          Have a proof? Verify it independently <ArrowUpRight size={14} />
        </a>
      </div>
      <div className="zk-proof-pane">
        <div className="zk-receipt">
          <div className="zk-receipt-top">
            <span>SPROUT / PRIVATE PROOF</span>
            <ShieldCheck size={22} />
          </div>
          <div className="zk-seal" aria-hidden="true">
            {current ? <Check size={32} /> : <Fingerprint size={32} />}
          </div>
          <span className="zk-milestone-label">{current ? 'MILESTONE VERIFIED' : 'YOUR SELECTED MILESTONE'}</span>
          <strong className="zk-amount">≥ {milestoneLabel(current?.certificate.thresholdCents ?? threshold)}</strong>
          <div className="zk-hidden-fields">
            <span>
              Exact balance{' '}
              <b>
                <LockKeyhole size={12} /> Not included
              </b>
            </span>
            <span>
              Wallet address{' '}
              <b>
                <LockKeyhole size={12} /> Not included
              </b>
            </span>
            <span>
              Child’s identity{' '}
              <b>
                <LockKeyhole size={12} /> Not included
              </b>
            </span>
          </div>
          <div className="zk-live-status" role="status" aria-live="polite">
            <span className={`zk-status-dot ${busy ? 'is-working' : ''}`} />
            {stage
              ? stages[stage]
              : current
                ? 'PLONK proof + active Sprout certificate'
                : 'Your milestone. The rest stays out.'}
          </div>
          {current ? (
            <code className="zk-fingerprint">
              {current.certificate.commitment.slice(0, 16)}…{current.certificate.commitment.slice(-12)}
            </code>
          ) : null}
          {current ? (
            <div className="zk-share-actions">
              <button
                onClick={() =>
                  void navigator.clipboard
                    .writeText(proofLink(current))
                    .then(() => {
                      if (alive.current)
                        setNotice('Proof link copied. It shares only the selected milestone and certificate.');
                    })
                    .catch(() => {
                      if (alive.current) setError('Could not copy. Download the proof instead.');
                    })
                }
              >
                <Copy size={15} /> Copy proof link
              </button>
              <button onClick={() => downloadProof(current)}>
                <Download size={15} /> Download proof
              </button>
              <a href={proofLink(current)} target="_blank" rel="noreferrer">
                <ShieldCheck size={15} /> Verify this proof
              </a>
            </div>
          ) : null}
          <p className="zk-disclosure">
            A shared proof reveals the milestone amount and certificate timing. It does not hide activity already
            visible on the blockchain.
          </p>
        </div>
      </div>
      {error ? (
        <p className="zk-error" role="alert">
          {error}
        </p>
      ) : null}
      {notice ? (
        <p className="zk-notice" role="status">
          {notice}
        </p>
      ) : null}
      {certificates.some((c) => c.expiresAt > now) ? (
        <div className="zk-certificates">
          <div className="zk-certificates-heading">
            <h3>Your proof certificates</h3>
            <span>You control when they close.</span>
          </div>
          {certificates
            .filter((c) => c.expiresAt > now)
            .map((c) => (
              <div className="zk-certificate-row" key={c.id}>
                <ShieldCheck size={18} />
                <div>
                  <b>{milestoneLabel(c.thresholdCents)} milestone</b>
                  <span>
                    {c.revoked
                      ? 'Revoked'
                      : `Expires ${new Date(c.expiresAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`}{' '}
                    · {c.id.slice(0, 8)}
                  </span>
                </div>
                <button disabled={c.revoked || Boolean(revoking)} onClick={() => void revoke(c.id)}>
                  {c.revoked ? 'Revoked' : revoking === c.id ? 'Revoking…' : 'Revoke proof'}
                </button>
              </div>
            ))}
        </div>
      ) : null}
    </section>
  );
}
