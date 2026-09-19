import type { ReactNode } from "react";
import {
  ArrowUpRight,
  ArrowDown,
  Check,
  Clock3,
  Fingerprint,
  Leaf,
  ShieldCheck,
  Smartphone,
  Users,
  Wallet,
  X,
} from "lucide-react";
import { formatUnits } from "viem";
import { countdown, short, type GuardianSnapshot } from "./model";
import "./guardian.css";
export type GuardianTab =
  "Protection" | "Recovery" | "Passkeys" | "Transfers" | "Settings";
export function GuardianView({
  snapshot,
  tab,
  onTab,
  onConnect,
  connected,
  children,
  busy,
  error,
  message,
  now,
  tokenSymbol = "USDG",
  decimals = 6,
}: {
  snapshot: GuardianSnapshot | null;
  tab: GuardianTab;
  onTab: (v: GuardianTab) => void;
  onConnect: () => void;
  connected: string;
  children: ReactNode;
  busy: boolean;
  error: string;
  message: string;
  now: number;
  tokenSymbol?: string;
  decimals?: number;
}) {
  const recovering =
    !!snapshot &&
    !snapshot.recovery.closed &&
    snapshot.recovery.expiresAt > now;
  return (
    <main className={"guardian-page " + (snapshot ? "has-wallet" : "is-setup")}>
      <header className="guardian-nav">
        <a className="guardian-brand" href="/">
          <img src="/brand/sprout-logo.png" alt="" />
          SPROUT<span>GUARDIAN</span>
        </a>
        <div>
          <a href="/dashboard">
            Your garden <ArrowUpRight size={15} />
          </a>
          <button
            className="guardian-button secondary"
            onClick={onConnect}
            disabled={busy}
          >
            {connected ? short(connected) : "Connect wallet"}{" "}
            <Wallet size={16} />
          </button>
        </div>
      </header>
      <section className="guardian-hero">
        <GuardianBotanical />
        <div className="guardian-intro">
          <span className="guardian-eyebrow guardian-hero-label">
            <ShieldCheck size={14} /> MEET SPROUT GUARDIAN
          </span>
          <h1>
            A little backup.
            <br />
            For their <em>big future.</em>
          </h1>
          <p>
            A wallet with people in its corner.
            <br />
            Passkey approvals. A trusted circle. Time to act.
          </p>
          <div className="guardian-hero-actions">
            <a className="guardian-button" href="#guardian-controls">
              {snapshot
                ? "Open your safety controls"
                : "Build your safety circle"}{" "}
              <ArrowUpRight size={17} />
            </a>
            <a className="guardian-hero-link" href="#guardian-features">
              Explore the protection <ArrowDown size={15} />
            </a>
          </div>
          <div className="guardian-status">
            <span className={snapshot ? "active" : ""} />
            {snapshot
              ? recovering
                ? "Recovery requested · review your circle"
                : "Published wallet code verified"
              : "Optional protection for newly planted sprouts"}
          </div>
        </div>
        <span className="guardian-hero-caption">
          GOOD THINGS DESERVE A LITTLE BACKUP.
        </span>
      </section>
      <div className="guardian-facts" id="guardian-features">
        <article className="guardian-feature feature-orange">
          <div className="guardian-feature-top">
            <Fingerprint size={25} />
            <span>01 / APPROVE</span>
          </div>
          <h2>
            Your touch.
            <br />
            Your say.
          </h2>
          <p>
            Passkey approvals with your biometrics or device PIN. Revoke a
            credential when it’s time.
          </p>
          <span className="guardian-feature-foot">
            P-256 PASSKEY VERIFICATION <ArrowUpRight size={18} />
          </span>
        </article>
        <article className="guardian-feature feature-lilac">
          <div className="guardian-feature-top">
            <Clock3 size={25} />
            <span>02 / TAKE A BREATH</span>
          </div>
          <h2>
            A little time.
            <br />A lot of control.
          </h2>
          <p>
            New destinations and over-budget transfers wait 24 hours. Time to
            review. Room to cancel.
          </p>
          <span className="guardian-feature-foot">
            ON-CHAIN TRANSFER DELAYS <ArrowUpRight size={18} />
          </span>
        </article>
        <article className="guardian-feature feature-green">
          <div className="guardian-feature-top">
            <Users size={25} />
            <span>03 / FIND A WAY BACK</span>
          </div>
          <h2>
            Good people.
            <br />A way back.
          </h2>
          <p>
            Two of three guardians can approve recovery, followed by a 48-hour
            cancellation window.
          </p>
          <span className="guardian-feature-foot">
            QUORUM + TIMELOCK RECOVERY <ArrowUpRight size={18} />
          </span>
        </article>
      </div>
      {!snapshot ? (
        <section className="guardian-circle-story">
          <div className="guardian-circle-copy">
            <span className="guardian-eyebrow">
              PEOPLE, NOT A PASSWORD RESET
            </span>
            <h2>It takes a circle.</h2>
            <p>
              Choose three people with independent wallets. If access is lost,
              two can help restore it. One person can’t recover the wallet
              alone.
            </p>
            <a href="#guardian-controls" className="guardian-text-button">
              Choose your circle <ArrowUpRight size={17} />
            </a>
          </div>
          <div
            className="guardian-orbit"
            aria-label="Choose three independent recovery guardians"
          >
            <svg viewBox="0 0 480 380" aria-hidden="true">
              <circle cx="240" cy="194" r="130" />
              <circle cx="240" cy="194" r="100" />
              <path d="M240 64V170M127 260L221 205M353 260L259 205" />
            </svg>
            <div className="guardian-core">
              <ShieldCheck size={40} />
              <b>2 of 3</b>
              <span>GUARDIAN RECOVERY</span>
            </div>
            {[0, 1, 2].map((i) => (
              <div key={i} className={`guardian-person person-${i}`}>
                <span>
                  <Users size={22} />
                </span>
                <b>Guardian {i + 1}</b>
                <small>Someone you trust</small>
              </div>
            ))}
          </div>
        </section>
      ) : null}
      <section className="guardian-workspace" id="guardian-controls">
        <div className="guardian-workspace-head">
          <div>
            <span className="guardian-eyebrow">YOUR SAFETY CONTROLS</span>
            <h2>
              {snapshot ? "Your Guardian wallet" : "Build your safety circle"}
            </h2>
          </div>
          {snapshot ? (
            <a
              className="guardian-button"
              href={`/dashboard?new=1&beneficiary=${snapshot.address}`}
            >
              Plant with this wallet <ArrowUpRight size={15} />
            </a>
          ) : null}
        </div>
        {snapshot ? (
          <div className="guardian-account-line">
            <span>
              Wallet <code>{snapshot.address}</code>
            </span>
            <span>
              Owner <code>{short(snapshot.owner)}</code>
            </span>
          </div>
        ) : null}
        {snapshot ? (
          <nav className="guardian-tabs" aria-label="Guardian sections">
            {(
              [
                "Protection",
                "Recovery",
                "Passkeys",
                "Transfers",
                "Settings",
              ] as GuardianTab[]
            ).map((t) => (
              <button
                key={t}
                aria-current={t === tab ? "page" : undefined}
                onClick={() => onTab(t)}
              >
                {t}
              </button>
            ))}
          </nav>
        ) : null}
        {busy ? (
          <p className="guardian-notice" role="status">
            Waiting for your approval or network confirmation…
          </p>
        ) : null}
        {error ? (
          <p className="guardian-error" role="alert">
            {error}
          </p>
        ) : null}
        {message ? (
          <p className="guardian-notice" role="status">
            {message}
          </p>
        ) : null}
        {snapshot && tab === "Protection" ? (
          <div className="guardian-overview">
            <div className="guardian-budget">
              <span className="guardian-eyebrow">INSTANT TRANSFER BUDGET</span>
              <strong>
                {formatUnits(snapshot.remaining, decimals)}{" "}
                <small>{tokenSymbol}</small>
              </strong>
              <p>
                Remaining of {formatUnits(snapshot.limit, decimals)}{" "}
                {tokenSymbol}. Only trusted destinations qualify.
              </p>
              <div className="guardian-budget-track">
                <i
                  style={{
                    width: `${snapshot.limit === 0n ? 0 : Math.min(100, Number((snapshot.remaining * 100n) / snapshot.limit))}%`,
                  }}
                />
              </div>
              <span className="guardian-tiny">
                {snapshot.resetAt > now
                  ? `Resets in ${countdown(snapshot.resetAt, now)}`
                  : "Window starts with your next instant transfer"}
              </span>
            </div>
            <div className="guardian-promise">
              <ShieldCheck size={30} />
              <h3>Every route follows the rules.</h3>
              <p>
                Passkeys and the owner wallet share the same limits. Recovery
                replaces the owner and invalidates old passkeys, trusted
                destinations and pending transfers.
              </p>
              <button
                className="guardian-text-button"
                onClick={() => onTab("Recovery")}
              >
                Review your recovery circle <ArrowUpRight size={15} />
              </button>
            </div>
          </div>
        ) : null}
        {children}
      </section>
      <footer className="guardian-footer">
        <span>Built for family control. Enforced by the wallet.</span>
        <p>
          Guardian is optional for new sprouts. Existing beneficiaries cannot be
          changed. On-chain addresses and activity remain public. This new
          wallet code has not been independently audited.
        </p>
      </footer>
    </main>
  );
}
export function RecoveryPanel({
  snapshot,
  now,
  busy,
  canApprove,
  isOwner,
  onApprove,
  onExecute,
  onCancel,
  children,
}: {
  snapshot: GuardianSnapshot;
  now: number;
  busy: boolean;
  canApprove: boolean;
  isOwner: boolean;
  onApprove: () => void;
  onExecute: () => void;
  onCancel: () => void;
  children?: ReactNode;
}) {
  const r = snapshot.recovery;
  const active = !r.closed && r.expiresAt > now;
  const ready = active && r.approvals >= 2 && now >= r.readyAt;
  return (
    <div className="guardian-recovery">
      <div className="guardian-section-heading">
        <div>
          <span className="guardian-eyebrow">
            RECOVERY WITHOUT A SINGLE POINT OF CONTROL
          </span>
          <h3>
            {active
              ? "Your circle is coming together."
              : snapshot.epoch > 1n
                ? "Access restored. A fresh start."
                : "A way back, when you need it."}
          </h3>
        </div>
        <span className="guardian-chip">2 OF 3 + 48 HOURS</span>
      </div>
      <div className="guardian-recovery-layout">
        <div className="guardian-approvals">
          {snapshot.guardians.map((g, i) => (
            <div
              className={
                "guardian-approval " +
                (active && snapshot.approved[i] ? "approved" : "")
              }
              key={g}
            >
              <span>
                {active && snapshot.approved[i] ? (
                  <Check size={21} />
                ) : (
                  <Users size={21} />
                )}
              </span>
              <div>
                <b>Guardian {i + 1}</b>
                <code>{short(g)}</code>
              </div>
              <strong>
                {active
                  ? snapshot.approved[i]
                    ? "Approved"
                    : "Awaiting approval"
                  : "In your circle"}
              </strong>
            </div>
          ))}
        </div>
        <div className="guardian-recovery-clock">
          <Clock3 size={30} />
          <span>
            {active
              ? r.approvals >= 2
                ? "RECOVERY WINDOW"
                : "GUARDIAN APPROVALS"
              : snapshot.epoch > 1n
                ? "OWNER ROTATED"
                : "NO ACTIVE REQUEST"}
          </span>
          <strong>
            {active
              ? r.approvals >= 2
                ? countdown(r.readyAt, now)
                : `${r.approvals} of 2`
              : snapshot.epoch > 1n
                ? "Restored"
                : "Ready if needed"}
          </strong>
          <p>
            {active
              ? `Replacement owner: ${short(r.newOwner)}`
              : snapshot.epoch > 1n
                ? "Old passkeys and pending transfers were invalidated. Register a new passkey."
                : "Two guardians approve the replacement owner. The current owner has time to cancel."}
          </p>
          {active && r.approvals >= 2 ? (
            <small>
              Outgoing transfers pause while this recovery is active.
            </small>
          ) : null}
        </div>
      </div>
      {active ? (
        <div className="guardian-actions">
          {canApprove ? (
            <button
              className="guardian-button"
              disabled={busy}
              onClick={onApprove}
            >
              Approve recovery <Check size={17} />
            </button>
          ) : null}
          <button
            className="guardian-button"
            disabled={busy || !ready}
            onClick={onExecute}
          >
            {ready ? "Complete recovery" : "Recovery is time-locked"}{" "}
            <ShieldCheck size={17} />
          </button>
          {isOwner ? (
            <button
              className="guardian-button secondary"
              disabled={busy}
              onClick={onCancel}
            >
              Cancel recovery
            </button>
          ) : null}
        </div>
      ) : (
        children
      )}
      <p className="guardian-tiny">
        Guardians are public on-chain. Choose people with independent wallets.
        Two colluding guardians can recover control after the delay; keep your
        circle current.
      </p>
    </div>
  );
}
export function DevicePanel({
  snapshot,
  now,
  busy,
  canManage,
  isOwner,
  onAdd,
  onRevoke,
}: {
  snapshot: GuardianSnapshot;
  now: number;
  busy: boolean;
  canManage: boolean;
  isOwner: boolean;
  onAdd: () => void;
  onRevoke: (id: `0x${string}`) => void;
}) {
  return (
    <div className="guardian-devices">
      <div className="guardian-section-heading">
        <div>
          <span className="guardian-eyebrow">KEYS YOU CAN TURN OFF</span>
          <h3>One touch. Your approval.</h3>
          <p>
            Use a passkey to approve transfers and claims. A connected wallet
            submits the transaction and pays gas.
          </p>
        </div>
        <button
          className="guardian-button"
          disabled={busy || !isOwner}
          onClick={onAdd}
        >
          <Fingerprint size={18} /> Add passkey
        </button>
      </div>
      <div className="guardian-device-grid">
        {snapshot.devices.length ? (
          snapshot.devices.map((d, i) => {
            const live =
              d.enabled && d.epoch === snapshot.epoch && d.expiresAt > now;
            return (
              <article
                className={"guardian-device " + (!live ? "revoked" : "")}
                key={d.id}
              >
                <Smartphone size={30} />
                <span className="guardian-chip">
                  {live ? "ACTIVE" : "REVOKED / EXPIRED"}
                </span>
                <h4>Passkey {i + 1}</h4>
                <code>{short(d.id)}</code>
                <p>
                  {live
                    ? "User verification required for every approval."
                    : "This credential cannot authorize transactions."}
                </p>
                <button
                  className="guardian-button secondary"
                  disabled={busy || !canManage || !live}
                  onClick={() => onRevoke(d.id)}
                >
                  <X size={15} /> Revoke credential
                </button>
              </article>
            );
          })
        ) : (
          <div className="guardian-empty">
            <Fingerprint size={35} />
            <h4>
              {snapshot.epoch > 1n
                ? "Old access cleared."
                : "Your next approval can be a touch."}
            </h4>
            <p>
              Add a passkey from the owner wallet. Recovery clears all
              previously enrolled credentials.
            </p>
          </div>
        )}
      </div>
      <p className="guardian-tiny">
        A synced passkey can exist on several devices. Revoking it disables
        every copy of that credential. Losing the Sprout domain does not remove
        owner-wallet or guardian recovery access.
      </p>
    </div>
  );
}

export function GuardianBotanical() {
  const root = "/art/dashboard/motion/";
  return (
    <div className="guardian-botanical" aria-hidden="true">
      <div className="guardian-plant plant-left">
        <img
          className="guardian-cut-leaf leaf-one"
          src={root + "leaf-green.png"}
          alt=""
        />
        <img
          className="guardian-cut-leaf leaf-two"
          src={root + "leaf-purple.png"}
          alt=""
        />
        <div className="guardian-cut-flower flower-orange">
          {Array.from({ length: 8 }, (_, i) => (
            <img
              key={i}
              className="flower-petal"
              style={{ transform: `rotate(${i * 45}deg)` }}
              src={root + "petal-orange.png"}
              alt=""
            />
          ))}
          <img className="flower-centre" src={root + "centre.png"} alt="" />
        </div>
      </div>
      <div className="guardian-plant plant-right">
        <img
          className="guardian-cut-leaf leaf-three"
          src={root + "leaf-green.png"}
          alt=""
        />
        <img
          className="guardian-cut-leaf leaf-four"
          src={root + "leaf-purple.png"}
          alt=""
        />
        <div className="guardian-cut-flower flower-blue">
          {Array.from({ length: 8 }, (_, i) => (
            <img
              key={i}
              className="flower-petal"
              style={{ transform: `rotate(${i * 45}deg)` }}
              src={root + "petal-blue.png"}
              alt=""
            />
          ))}
          <img className="flower-centre" src={root + "centre.png"} alt="" />
        </div>
        <div className="guardian-cut-flower flower-yellow">
          {Array.from({ length: 8 }, (_, i) => (
            <img
              key={i}
              className="flower-petal"
              style={{ transform: `rotate(${i * 45}deg)` }}
              src={root + "petal-yellow.png"}
              alt=""
            />
          ))}
          <img className="flower-centre" src={root + "centre.png"} alt="" />
        </div>
      </div>
    </div>
  );
}
