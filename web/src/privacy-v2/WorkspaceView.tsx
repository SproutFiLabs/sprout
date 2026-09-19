import type { ReactNode } from "react";
import {
  privacyFeatures,
  type FeatureId,
  type WorkspaceFields,
  type PublicVenue,
} from "./catalog";
import "./workspace.css";

export function PrivacyWorkspaceView({
  active,
  fields,
  unlocked,
  busy,
  result,
  notice,
  venue,
  assetUrl = (path) => path,
  onSelect,
  onField,
  onAction,
  children,
}: {
  active: FeatureId;
  fields: WorkspaceFields;
  unlocked: boolean;
  busy: boolean;
  result: string;
  notice: string;
  onSelect: (id: FeatureId) => void;
  onField: (key: keyof WorkspaceFields, value: string) => void;
  onAction: () => void;
  children?: ReactNode;
  venue?: PublicVenue | null;
  assetUrl?: (path: string) => string;
}) {
  const feature = privacyFeatures.find((f) => f.id === active)!;
  const field = (
    name: keyof WorkspaceFields,
    label: string,
    placeholder = "",
    type = "text",
  ) => (
    <label className="pv-field">
      {label}
      {(name === "asset" || name === "secondAsset") && venue ? (
        <select
          value={fields[name]}
          onChange={(e) => onField(name, e.target.value)}
        >
          <option value="">Choose a stock token</option>
          {venue.markets.map((m) => (
            <option key={m.token} value={m.token}>
              {m.symbol}
            </option>
          ))}
        </select>
      ) : (
        <input
          type={type}
          value={fields[name]}
          placeholder={placeholder}
          onChange={(e) => onField(name, e.target.value)}
          autoComplete="off"
          spellCheck={false}
        />
      )}
    </label>
  );
  const mix = (
    <>
      {field("asset", venue ? "First stock" : "First asset contract", "0x…")}
      {field(
        "secondAsset",
        venue ? "Second stock" : "Second asset contract",
        "0x…",
      )}
      <label className="pv-field pv-span">
        Stock mix{" "}
        <strong>
          {fields.weight}% / {100 - Number(fields.weight)}%
        </strong>
        <input
          type="range"
          min="1"
          max="99"
          value={fields.weight}
          onChange={(e) => onField("weight", e.target.value)}
        />
      </label>
    </>
  );
  return (
    <main className="pv-workspace">
      <header className="pv-header">
        <a href="/" className="pv-brand">
          <span className="pv-brand-mark">
            <img src={assetUrl("/brand/sprout-logo.png")} alt="" />
          </span>
          SPROUT
        </a>
        <a href="/docs" className="pv-header-link">
          How Sprout works
        </a>
        <a href="/dashboard" className="pv-return">
          Your garden ↗
        </a>
      </header>
      <div className="pv-layout">
        <nav className="pv-tool-nav" aria-label="Privacy tools">
          {privacyFeatures.map((f) => (
            <button
              key={f.id}
              aria-current={active === f.id ? "page" : undefined}
              onClick={() => onSelect(f.id)}
            >
              {f.title}
            </button>
          ))}
        </nav>
        <section className="pv-main" aria-label={feature.title}>
          <div className="pv-feature-head">
            <div className="pv-feature-copy">
              <span className="pv-kicker">{feature.title}</span>
              <h1>{feature.phrase}</h1>
              <p className="pv-lede">{feature.description}</p>
              <span className="pv-device">
                <span className={unlocked ? "pv-dot open" : "pv-dot"} />
                {unlocked
                  ? "Workspace unlocked"
                  : "Protected with your passphrase"}
              </span>
            </div>
            <div className="pv-garden-art" aria-hidden="true">
              <img
                className="pv-art-purple"
                src={assetUrl("/art/dashboard/motion/leaf-purple.png")}
                alt=""
              />
              <img
                className="pv-art-green"
                src={assetUrl("/art/dashboard/motion/leaf-green.png")}
                alt=""
              />
              <img
                className="pv-art-branch"
                src={assetUrl("/art/dashboard/sidebar-branch.png")}
                alt=""
              />
            </div>
          </div>
          <div className="pv-work-area">
            <div className="pv-form-card">
              <div className="pv-card-heading">
                <h2>
                  {active === "tags"
                    ? "Your payment alias"
                    : active === "policy"
                      ? "Family rules"
                      : active === "attestations"
                        ? "Proof request"
                        : "Plan details"}
                </h2>
              </div>
              <div className="pv-fields">
                {active === "swaps" && (
                  <>
                    {field("asset", venue ? "Stock" : "Asset contract", "0x…")}
                    {field("amount", "Stock quantity", "100", "text")}
                    {field("limit", "Limit price (USD)", "250", "text")}
                    <div className="pv-explainer">
                      Limit order
                      <br />
                      <small>
                        Next five-minute window
                        <br />
                        Backstop off by default
                      </small>
                    </div>
                  </>
                )}
                {active === "tags" && (
                  <>
                    {field(
                      "tag",
                      "Payment alias",
                      "Choose an alias, not a child’s name",
                    )}
                    <div className="pv-explainer">
                      Separate keys
                      <br />
                      <small>
                        Spending + viewing
                        <br />
                        Fresh ephemeral key per destination
                      </small>
                    </div>
                  </>
                )}
                {active === "gifts" && (
                  <>
                    {field("amount", "Gift amount (USD)", "100", "text")}
                    {mix}
                  </>
                )}
                {active === "adult" && (
                  <>
                    {field("amount", "Amount to save (USD)", "100", "text")}
                    <label className="pv-field">
                      Schedule
                      <select
                        value={fields.cadence}
                        onChange={(e) => onField("cadence", e.target.value)}
                      >
                        <option value="1">Every day</option>
                        <option value="7">Every week</option>
                        <option value="30">Every 30 days</option>
                      </select>
                    </label>
                    {mix}
                    {field(
                      "spread",
                      "Maximum price spread (basis points)",
                      "50",
                      "number",
                    )}
                  </>
                )}
                {active === "policy" && (
                  <>
                    {field(
                      "asset",
                      venue ? "Allowed stock" : "Approved asset contract",
                      "0x…",
                    )}
                    {field("limit", "Maximum order (USD)", "250", "text")}
                    <label className="pv-field pv-span">
                      Maximum allocation <strong>{fields.weight}%</strong>
                      <input
                        type="range"
                        min="1"
                        max="100"
                        value={fields.weight}
                        onChange={(e) => onField("weight", e.target.value)}
                      />
                    </label>
                  </>
                )}
                {active === "attestations" && (
                  <>
                    <label className="pv-field">
                      Statement
                      <select
                        value={fields.claim}
                        onChange={(e) => onField("claim", e.target.value)}
                      >
                        <option value="holdings">
                          Holdings above a threshold
                        </option>
                        <option value="membership">Eligible membership</option>
                        <option value="solvency">Pool backing</option>
                      </select>
                    </label>
                    {field(
                      "amount",
                      "Minimum balance (base units)",
                      "100",
                      "text",
                    )}
                    {field("audience", "Audience URL", "https://…")}
                    {field("verifier", "Verifier contract", "0x…")}
                    {field("root", "State root", "0x…")}
                  </>
                )}
              </div>
              <div className="pv-action-row">
                <span>
                  {unlocked
                    ? "Your details stay on this device."
                    : "Unlock your workspace to continue."}
                </span>
                <button
                  className="pv-primary"
                  disabled={!unlocked || busy}
                  onClick={onAction}
                >
                  {busy ? "Encrypting…" : feature.action}
                  <span>↗</span>
                </button>
              </div>
            </div>
            <aside className={"pv-note-panel pv-note-" + active}>
              {result ? (
                <section
                  className="pv-result"
                  aria-label="Preparation result"
                  aria-live="polite"
                >
                  <div>
                    <span className="pv-result-icon">✓</span>
                    <h2>Saved on this device.</h2>
                  </div>
                  <pre>{result}</pre>
                </section>
              ) : (
                <div className="pv-how">
                  <h2>
                    {active === "tags" ? "Keep the backup" : "Before you save"}
                  </h2>
                  <p>
                    {active === "tags"
                      ? "The keys in your backup are the only way to recover these addresses."
                      : "These tools prepare and encrypt your details. They do not move money."}
                  </p>
                  <ol>
                    {feature.steps.map((s) => (
                      <li key={s}>{s}</li>
                    ))}
                  </ol>
                </div>
              )}
              <img
                className="pv-note-leaf"
                src={assetUrl("/art/dashboard/motion/leaf-green.png")}
                alt=""
              />
            </aside>
          </div>
          {notice && (
            <p className="pv-notice" role="alert">
              {notice}
            </p>
          )}
          <details className="pv-boundary">
            <summary>What is available now?</summary>
            <p>{feature.detail}</p>
            {venue && (
              <p>
                Public market data: {venue.provider}. {venue.markets.length}{" "}
                assets checked at block {venue.blockNumber}. Trading is not
                connected.
              </p>
            )}
          </details>
          {children}
        </section>
      </div>
    </main>
  );
}
