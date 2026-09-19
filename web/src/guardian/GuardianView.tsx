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
import { t, tj } from "../i18n";
import { LanguageToggle } from "../i18n/LanguageToggle";
import { countdown, short, type GuardianSnapshot } from "./model";
import "./guardian.css";
import "./guardian-language.css";
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
            {t("Your garden")} <ArrowUpRight size={15} />
          </a>
          <LanguageToggle />
          <button
            className="guardian-button secondary"
            onClick={onConnect}
            disabled={busy}
          >
            {connected ? short(connected) : t("Connect wallet")}{" "}
            <Wallet size={16} />
          </button>
        </div>
      </header>
      <section className="guardian-hero">
        <GuardianBotanical />
        <div className="guardian-intro">
          <span className="guardian-eyebrow guardian-hero-label">
            <ShieldCheck size={14} /> {t("MEET SPROUT GUARDIAN")}
          </span>
          <h1>
            {tj("A little backup.{br}For their {bigFuture}", {
              br: <br />,
              bigFuture: <em>{t("big future.")}</em>,
            })}
          </h1>
          <p>
            {tj(
              "A wallet with people in its corner.{br}Passkey approvals. A trusted circle. Time to act.",
              { br: <br /> },
            )}
          </p>
          <div className="guardian-hero-actions">
            <a className="guardian-button" href="#guardian-controls">
              {snapshot
                ? t("Open your safety controls")
                : t("Build your safety circle")}{" "}
              <ArrowUpRight size={17} />
            </a>
            <a className="guardian-hero-link" href="#guardian-features">
              {t("Explore the protection")} <ArrowDown size={15} />
            </a>
          </div>
          <div className="guardian-status">
            <span className={snapshot ? "active" : ""} />
            {snapshot
              ? recovering
                ? t("Recovery requested · review your circle")
                : t("Published wallet code verified")
              : t("Optional protection for newly planted sprouts")}
          </div>
        </div>
        <span className="guardian-hero-caption">
          {t("GOOD THINGS DESERVE A LITTLE BACKUP.")}
        </span>
      </section>
      <div className="guardian-facts" id="guardian-features">
        <article className="guardian-feature feature-orange">
          <div className="guardian-feature-top">
            <Fingerprint size={25} />
            <span>{t("01 / APPROVE")}</span>
          </div>
          <h2>{tj("Your touch.{br}Your say.", { br: <br /> })}</h2>
          <p>
            {t(
              "Passkey approvals with your biometrics or device PIN. Revoke a credential when it’s time.",
            )}
          </p>
          <span className="guardian-feature-foot">
            {t("P-256 PASSKEY VERIFICATION")} <ArrowUpRight size={18} />
          </span>
        </article>
        <article className="guardian-feature feature-lilac">
          <div className="guardian-feature-top">
            <Clock3 size={25} />
            <span>{t("02 / TAKE A BREATH")}</span>
          </div>
          <h2>{tj("A little time.{br}A lot of control.", { br: <br /> })}</h2>
          <p>
            {t(
              "New destinations and over-budget transfers wait 24 hours. Time to review. Room to cancel.",
            )}
          </p>
          <span className="guardian-feature-foot">
            {t("ON-CHAIN TRANSFER DELAYS")} <ArrowUpRight size={18} />
          </span>
        </article>
        <article className="guardian-feature feature-green">
          <div className="guardian-feature-top">
            <Users size={25} />
            <span>{t("03 / FIND A WAY BACK")}</span>
          </div>
          <h2>{tj("Good people.{br}A way back.", { br: <br /> })}</h2>
          <p>
            {t(
              "Two of three guardians can approve recovery, followed by a 48-hour cancellation window.",
            )}
          </p>
          <span className="guardian-feature-foot">
            {t("QUORUM + TIMELOCK RECOVERY")} <ArrowUpRight size={18} />
          </span>
        </article>
      </div>
      {!snapshot ? (
        <section className="guardian-circle-story">
          <div className="guardian-circle-copy">
            <span className="guardian-eyebrow">
              {t("PEOPLE, NOT A PASSWORD RESET")}
            </span>
            <h2>{t("It takes a circle.")}</h2>
            <p>
              {t(
                "Choose three people with independent wallets. If access is lost, two can help restore it. One person can’t recover the wallet alone.",
              )}
            </p>
            <a href="#guardian-controls" className="guardian-text-button">
              {t("Choose your circle")} <ArrowUpRight size={17} />
            </a>
          </div>
          <div
            className="guardian-orbit"
            aria-label={t("Choose three independent recovery guardians")}
          >
            <svg viewBox="0 0 480 380" aria-hidden="true">
              <circle cx="240" cy="194" r="130" />
              <circle cx="240" cy="194" r="100" />
              <path d="M240 64V170M127 260L221 205M353 260L259 205" />
            </svg>
            <div className="guardian-core">
              <ShieldCheck size={40} />
              <b>{t("2 of 3")}</b>
              <span>{t("GUARDIAN RECOVERY")}</span>
            </div>
            {[0, 1, 2].map((i) => (
              <div key={i} className={`guardian-person person-${i}`}>
                <span>
                  <Users size={22} />
                </span>
                <b>{t("Guardian {n}", { n: i + 1 })}</b>
                <small>{t("Someone you trust")}</small>
              </div>
            ))}
          </div>
        </section>
      ) : null}
      <section className="guardian-workspace" id="guardian-controls">
        <div className="guardian-workspace-head">
          <div>
            <span className="guardian-eyebrow">{t("YOUR SAFETY CONTROLS")}</span>
            <h2>
              {snapshot
                ? t("Your Guardian wallet")
                : t("Build your safety circle")}
            </h2>
          </div>
          {snapshot ? (
            <a
              className="guardian-button"
              href={`/dashboard?new=1&beneficiary=${snapshot.address}`}
            >
              {t("Plant with this wallet")} <ArrowUpRight size={15} />
            </a>
          ) : null}
        </div>
        {snapshot ? (
          <div className="guardian-account-line">
            <span>
              {tj("Wallet {address}", {
                address: <code>{snapshot.address}</code>,
              })}
            </span>
            <span>
              {tj("Owner {address}", {
                address: <code>{short(snapshot.owner)}</code>,
              })}
            </span>
          </div>
        ) : null}
        {snapshot ? (
          <nav className="guardian-tabs" aria-label={t("Guardian sections")}>
            {(
              [
                "Protection",
                "Recovery",
                "Passkeys",
                "Transfers",
                "Settings",
              ] as GuardianTab[]
            ).map((name) => (
              <button
                key={name}
                aria-current={name === tab ? "page" : undefined}
                onClick={() => onTab(name)}
              >
                {t(name)}
              </button>
            ))}
          </nav>
        ) : null}
        {busy ? (
          <p className="guardian-notice" role="status">
            {t("Waiting for your approval or network confirmation…")}
          </p>
        ) : null}
        {error ? (
          <p className="guardian-error" role="alert">
            {t(error)}
          </p>
        ) : null}
        {message ? (
          <p className="guardian-notice" role="status">
            {t(message)}
          </p>
        ) : null}
        {snapshot && tab === "Protection" ? (
          <div className="guardian-overview">
            <div className="guardian-budget">
              <span className="guardian-eyebrow">
                {t("INSTANT TRANSFER BUDGET")}
              </span>
              <strong>
                {formatUnits(snapshot.remaining, decimals)}{" "}
                <small>{tokenSymbol}</small>
              </strong>
              <p>
                {t(
                  "Remaining of {limit} {symbol}. Only trusted destinations qualify.",
                  {
                    limit: formatUnits(snapshot.limit, decimals),
                    symbol: tokenSymbol,
                  },
                )}
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
                  ? t("Resets in {time}", {
                      time: countdown(snapshot.resetAt, now),
                    })
                  : t("Window starts with your next instant transfer")}
              </span>
            </div>
            <div className="guardian-promise">
              <ShieldCheck size={30} />
              <h3>{t("Every route follows the rules.")}</h3>
              <p>
                {t(
                  "Passkeys and the owner wallet share the same limits. Recovery replaces the owner and invalidates old passkeys, trusted destinations and pending transfers.",
                )}
              </p>
              <button
                className="guardian-text-button"
                onClick={() => onTab("Recovery")}
              >
                {t("Review your recovery circle")} <ArrowUpRight size={15} />
              </button>
            </div>
          </div>
        ) : null}
        {children}
      </section>
      <footer className="guardian-footer">
        <span>{t("Built for family control. Enforced by the wallet.")}</span>
        <p>
          {t(
            "Guardian is optional for new sprouts. Existing beneficiaries cannot be changed. On-chain addresses and activity remain public. This new wallet code has not been independently audited.",
          )}
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
            {t("RECOVERY WITHOUT A SINGLE POINT OF CONTROL")}
          </span>
          <h3>
            {active
              ? t("Your circle is coming together.")
              : snapshot.epoch > 1n
                ? t("Access restored. A fresh start.")
                : t("A way back, when you need it.")}
          </h3>
        </div>
        <span className="guardian-chip">{t("2 OF 3 + 48 HOURS")}</span>
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
                <b>{t("Guardian {n}", { n: i + 1 })}</b>
                <code>{short(g)}</code>
              </div>
              <strong>
                {active
                  ? snapshot.approved[i]
                    ? t("Approved")
                    : t("Awaiting approval")
                  : t("In your circle")}
              </strong>
            </div>
          ))}
        </div>
        <div className="guardian-recovery-clock">
          <Clock3 size={30} />
          <span>
            {active
              ? r.approvals >= 2
                ? t("RECOVERY WINDOW")
                : t("GUARDIAN APPROVALS")
              : snapshot.epoch > 1n
                ? t("OWNER ROTATED")
                : t("NO ACTIVE REQUEST")}
          </span>
          <strong>
            {active
              ? r.approvals >= 2
                ? countdown(r.readyAt, now)
                : t("{count} of 2", { count: r.approvals })
              : snapshot.epoch > 1n
                ? t("Restored")
                : t("Ready if needed")}
          </strong>
          <p>
            {active
              ? t("Replacement owner: {address}", {
                  address: short(r.newOwner),
                })
              : snapshot.epoch > 1n
                ? t(
                    "Old passkeys and pending transfers were invalidated. Register a new passkey.",
                  )
                : t(
                    "Two guardians approve the replacement owner. The current owner has time to cancel.",
                  )}
          </p>
          {active && r.approvals >= 2 ? (
            <small>
              {t("Outgoing transfers pause while this recovery is active.")}
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
              {t("Approve recovery")} <Check size={17} />
            </button>
          ) : null}
          <button
            className="guardian-button"
            disabled={busy || !ready}
            onClick={onExecute}
          >
            {ready ? t("Complete recovery") : t("Recovery is time-locked")}{" "}
            <ShieldCheck size={17} />
          </button>
          {isOwner ? (
            <button
              className="guardian-button secondary"
              disabled={busy}
              onClick={onCancel}
            >
              {t("Cancel recovery")}
            </button>
          ) : null}
        </div>
      ) : (
        children
      )}
      <p className="guardian-tiny">
        {t(
          "Guardians are public on-chain. Choose people with independent wallets. Two colluding guardians can recover control after the delay; keep your circle current.",
        )}
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
          <span className="guardian-eyebrow">{t("KEYS YOU CAN TURN OFF")}</span>
          <h3>{t("One touch. Your approval.")}</h3>
          <p>
            {t(
              "Use a passkey to approve transfers and claims. A connected wallet submits the transaction and pays gas.",
            )}
          </p>
        </div>
        <button
          className="guardian-button"
          disabled={busy || !isOwner}
          onClick={onAdd}
        >
          <Fingerprint size={18} /> {t("Add passkey")}
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
                  {live ? t("ACTIVE") : t("REVOKED / EXPIRED")}
                </span>
                <h4>{t("Passkey {n}", { n: i + 1 })}</h4>
                <code>{short(d.id)}</code>
                <p>
                  {live
                    ? t("User verification required for every approval.")
                    : t("This credential cannot authorize transactions.")}
                </p>
                <button
                  className="guardian-button secondary"
                  disabled={busy || !canManage || !live}
                  onClick={() => onRevoke(d.id)}
                >
                  <X size={15} /> {t("Revoke credential")}
                </button>
              </article>
            );
          })
        ) : (
          <div className="guardian-empty">
            <Fingerprint size={35} />
            <h4>
              {snapshot.epoch > 1n
                ? t("Old access cleared.")
                : t("Your next approval can be a touch.")}
            </h4>
            <p>
              {t(
                "Add a passkey from the owner wallet. Recovery clears all previously enrolled credentials.",
              )}
            </p>
          </div>
        )}
      </div>
      <p className="guardian-tiny">
        {t(
          "A synced passkey can exist on several devices. Revoking it disables every copy of that credential. Losing the Sprout domain does not remove owner-wallet or guardian recovery access.",
        )}
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
