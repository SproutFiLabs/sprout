import { useState, type ReactNode } from "react";
import {
  ArrowUpRight,
  ArrowRight,
  Download,
  Plus,
  X,
  Check,
  ArrowLeft,
  Search,
  Wallet,
  FileText,
  ChevronRight,
  RefreshCw,
  ExternalLink,
} from "lucide-react";
import {
  ledgerSummary,
  isDisposal,
  type AssetPassport,
  type FamilyPlan,
  type InvestmentProvider,
  type LedgerEntry,
  type ToolsData,
} from "@sprout/shared";
import "./tools.css";
export type ToolPage = "home" | "rewards" | "tax" | "passports" | "investing";
export const TOOL_PATHS: Record<ToolPage, string> = {
  home: "/family-tools",
  rewards: "/rewards",
  tax: "/tax-garden",
  passports: "/asset-passports",
  investing: "/family-investing",
};
export const money = (c: number) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(
    c / 100,
  );
const links: [ToolPage, string][] = [
  ["home", "Your toolkit"],
  ["passports", "Asset Passports"],
  ["rewards", "Rewards"],
  ["tax", "Tax Garden"],
  ["investing", "Family Investing"],
];
export interface ToolsViewProps {
  page: ToolPage;
  wallet: string | null;
  busy: boolean;
  error: string;
  notice: string;
  data: ToolsData;
  passports: AssetPassport[];
  provider: InvestmentProvider | null;
  selectedAsset: string;
  search: string;
  year: string;
  ledgerFilter: string;
  onConnect: () => void;
  onLock: () => void;
  onRefresh: () => void;
  onSearch: (s: string) => void;
  onAsset: (s: string) => void;
  onYear: (s: string) => void;
  onFilter: (s: string) => void;
  onAdd: () => void;
  onImport: () => void;
  onTemplate: () => void;
  onExport: (advanced: boolean) => void;
  onEdit: (e: LedgerEntry) => void;
  onDelete: (e: LedgerEntry) => void;
  onSync: () => void;
  onConfirm: (id: string) => void;
  onPlan: (p: FamilyPlan) => void;
  onDeletePlan: () => void;
  onDownloadPlan: () => void;
  onProvider: () => void;
  assetUrl?: (s: string) => string;
}
const intro: Record<
  ToolPage,
  { label: string; title: ReactNode; body: string }
> = {
  home: {
    label: "THE SPROUT TOOLKIT",
    title: (
      <>
        A little clarity.
        <br />
        <em>A lot more possibility.</em>
      </>
    ),
    body: "Useful things for everyday family life. Understand what you own, keep your records together, and make room for what comes next.",
  },
  rewards: {
    label: "SPROUT REWARDS",
    title: (
      <>
        Everyday choices.
        <br />
        <em>A little more back.</em>
      </>
    ),
    body: "Discover funded purchase offers for eligible holders. See the terms, follow your reward, and keep the receipt.",
  },
  tax: {
    label: "SPROUT TAX GARDEN",
    title: (
      <>
        All the little details.
        <br />
        <em>Beautifully together.</em>
      </>
    ),
    body: "Your family’s activity, in one clear place. Fill in the gaps and take an organized record to your accountant.",
  },
  passports: {
    label: "SPROUT ASSET PASSPORTS",
    title: (
      <>
        Know exactly
        <br />
        <em>what you’re planting.</em>
      </>
    ),
    body: "The rights, issuer and small print behind each token. A clearer view before you make a decision.",
  },
  investing: {
    label: "SPROUT FAMILY INVESTING",
    title: (
      <>
        Their big tomorrow.
        <br />
        <em>Your first little plan.</em>
      </>
    ),
    body: "Give a family goal a place to begin. Save your plan, understand account ownership, and review the provider path.",
  },
};
export function ToolsView(p: ToolsViewProps) {
  const asset = p.assetUrl ?? ((s) => s),
    hero = intro[p.page];
  const summary = ledgerSummary(p.data.entries);
  return (
    <div className="ft-root">
      <a className="ft-skip" href="#tool-content">
        Skip to content
      </a>
      <header className="ft-header">
        <a className="ft-brand" href="/">
          <img src={asset("/brand/sprout-logo.png")} alt="" />
          SPROUT
        </a>
        <nav aria-label="Main navigation">
          <a href="/dashboard">Your garden</a>
          <a href="/spend">Spend</a>
          <a href="/intelligence">Intelligence</a>
        </nav>
        <button
          className="ft-connect"
          disabled={p.busy}
          onClick={p.wallet ? p.onLock : p.onConnect}
        >
          <Wallet size={15} />
          {p.wallet
            ? `${p.wallet.slice(0, 6)}…${p.wallet.slice(-4)} · Lock`
            : "Connect wallet"}
        </button>
      </header>
      <main id="tool-content" className="ft-main">
        <section
          className={`ft-hero ${p.page === "home" ? "ft-hero-home" : ""}`}
        >
          <div>
            <div className="ft-eyebrow">
              <i />
              {hero.label}
            </div>
            <h1>{hero.title}</h1>
            <p>{hero.body}</p>
            {p.page === "home" && (
              <a className="ft-primary" href="/asset-passports">
                Take a look around <ArrowUpRight size={18} />
              </a>
            )}
          </div>
          <div className="ft-hero-art">
            <img src={asset("/art/harvest-bouquet.png")} alt="" />
            <span className="ft-art-caption">Good things take root.</span>
          </div>
        </section>
        <nav className="ft-tabs" aria-label="Family tools">
          {links.map(([key, label]) => (
            <a
              href={TOOL_PATHS[key]}
              aria-current={p.page === key ? "page" : undefined}
              key={key}
            >
              {label}
            </a>
          ))}
        </nav>
        {p.error && (
          <div className="ft-message ft-error" role="alert">
            {p.error}
            <button onClick={p.onRefresh}>Try again</button>
          </div>
        )}
        {p.notice && (
          <div className="ft-message" role="status">
            <Check size={16} />
            {p.notice}
          </div>
        )}
        {p.busy && (
          <div className="ft-loading" role="status">
            Working on that…
          </div>
        )}
        {p.page === "home" && (
          <div className="ft-home-grid">
            <section className="ft-feature ft-feature-green">
              <span className="ft-eyebrow">01 / UNDERSTAND</span>
              <h2>
                A clearer picture
                <br />
                of what you own.
              </h2>
              <p>
                Every asset has a story. Start with its rights, its issuer, and
                where it is available.
              </p>
              <a href="/asset-passports">
                Open Asset Passports <ArrowUpRight size={22} />
              </a>
              <div className="ft-passport-mini">
                <span>THE DETAILS MATTER</span>
                <strong>
                  Economic exposure ≠<br />
                  share ownership.
                </strong>
                <small>Issuer terms, explained.</small>
              </div>
            </section>
            <div className="ft-home-list">
              {[
                [
                  "02",
                  "Rewards",
                  "Everyday offers. Clear terms. A receipt for each reward.",
                  "/rewards",
                ],
                [
                  "03",
                  "Tax Garden",
                  "Put scattered records in their place.",
                  "/tax-garden",
                ],
                [
                  "04",
                  "Family Investing",
                  "A thoughtful start for a future goal.",
                  "/family-investing",
                ],
                [
                  "05",
                  "Intelligence",
                  "Ask a question about the record in front of you.",
                  "/intelligence",
                ],
              ].map(([n, title, body, url]) => (
                <a href={url} key={n}>
                  <span>{n}</span>
                  <div>
                    <h3>{title}</h3>
                    <p>{body}</p>
                  </div>
                  <ArrowUpRight size={24} />
                </a>
              ))}
            </div>
          </div>
        )}
        {p.page === "rewards" && (
          <>
            <div className="ft-section-head">
              <div>
                <span className="ft-eyebrow">A BENEFIT YOU CAN FOLLOW</span>
                <h2>Little wins, clearly recorded.</h2>
              </div>
              <a href="/perks">
                Holder access <ArrowUpRight size={15} />
              </a>
            </div>
            <div className="ft-reward-summary">
              <div>
                <span>Waiting for delivery</span>
                <strong>
                  {money(
                    p.data.claims
                      .filter((c) => c.status === "pending")
                      .reduce((n, c) => n + c.cents, 0),
                  )}
                </strong>
              </div>
              <div>
                <span>Confirmed for manual payout</span>
                <strong>
                  {money(
                    p.data.claims
                      .filter((c) => c.status === "confirmed")
                      .reduce((n, c) => n + c.cents, 0),
                  )}
                </strong>
              </div>
              <div>
                <span>Paid · verified on Base</span>
                <strong>
                  {money(
                    p.data.claims
                      .filter((c) => c.status === "paid")
                      .reduce((n, c) => n + c.cents, 0),
                  )}
                </strong>
              </div>
            </div>
            <div className="ft-split">
              <section className="ft-panel">
                <h3>Available offers</h3>
                {!p.data.rewardReady || !p.data.offers.length ? (
                  <div className="ft-empty">
                    <span className="ft-empty-mark">✳</span>
                    <h3>Good things are being prepared.</h3>
                    <p>
                      There are no funded offers available right now. When one
                      opens, the reward and its terms will appear here before
                      you buy.
                    </p>
                    <a href="/spend" className="ft-text-link">
                      Explore Spend <ArrowRight size={16} />
                    </a>
                  </div>
                ) : (
                  p.data.offers
                    .filter(
                      (o) =>
                        o.endsAt > Date.now() &&
                        o.budgetCents > o.reservedCents,
                    )
                    .map((o) => (
                      <article className="ft-offer" key={o.id}>
                        <span className="ft-eyebrow">PURCHASE OFFER</span>
                        <h3>{o.title}</h3>
                        <strong>{o.rateBps / 100}% back</strong>
                        <p>{o.terms}</p>
                        <small>
                          Ends {new Date(o.endsAt).toLocaleDateString("en-US")}{" "}
                          · While the offer budget lasts
                        </small>
                        <a className="ft-primary" href={`/spend?offer=${o.id}`}>
                          Review in Spend <ArrowUpRight size={17} />
                        </a>
                      </article>
                    ))
                )}
              </section>
              <aside className="ft-paper">
                <span className="ft-eyebrow">HOW IT WORKS</span>
                <ol className="ft-steps">
                  <li>
                    <b>Choose an offer.</b>
                    <p>
                      Verify holder access. Review the exact reward at checkout.
                    </p>
                  </li>
                  <li>
                    <b>Enjoy your purchase.</b>
                    <p>Once delivery is confirmed, confirm your reward here.</p>
                  </li>
                  <li>
                    <b>Keep the receipt.</b>
                    <p>
                      The team pays manually in USDC on Base. A finalized
                      matching transfer marks it paid.
                    </p>
                  </li>
                </ol>
                <p className="ft-fine">
                  Treasury funds are not escrowed. No reward is earned merely by
                  holding or locking SPROUT. Terms and eligibility apply.
                </p>
              </aside>
            </div>
            <section className="ft-panel ft-history">
              <div className="ft-section-head">
                <h3>Your reward trail</h3>
                <button onClick={p.onRefresh} disabled={p.busy}>
                  <RefreshCw size={16} /> Refresh
                </button>
              </div>
              {!p.wallet ? (
                <ConnectNotice onConnect={p.onConnect} />
              ) : !p.data.claims.length ? (
                <p className="ft-muted">
                  Your first eligible purchase will start your trail.
                </p>
              ) : (
                p.data.claims.map((c) => (
                  <div className="ft-trail" key={c.id}>
                    <div className="ft-receipt-icon">
                      <FileText size={20} />
                    </div>
                    <div>
                      <b>
                        {p.data.offers.find((o) => o.id === c.offerId)?.title ??
                          "Purchase reward"}
                      </b>
                      <small>Order {c.orderId.slice(0, 8)}</small>
                    </div>
                    <strong>{money(c.cents)}</strong>
                    <span className={`ft-status ${c.status}`}>{c.status}</span>
                    {c.status === "pending" && (
                      <button
                        disabled={p.busy}
                        onClick={() => p.onConfirm(c.id)}
                      >
                        Confirm delivery
                      </button>
                    )}
                    {c.txHash && (
                      <a
                        href={`https://basescan.org/tx/${c.txHash}`}
                        target="_blank"
                        rel="noreferrer"
                      >
                        Receipt ↗
                      </a>
                    )}
                    <a
                      href={`/intelligence?context=reward&id=${c.id}&q=Explain%20this%20purchase%20reward`}
                    >
                      Explain ↗
                    </a>
                  </div>
                ))
              )}
            </section>
          </>
        )}
        {p.page === "tax" && (
          <>
            <div className="ft-section-head">
              <div>
                <span className="ft-eyebrow">YOUR FAMILY RECORDS</span>
                <h2>A place for every detail.</h2>
              </div>
              <div className="ft-actions">
                <button disabled={!p.wallet || p.busy} onClick={p.onImport}>
                  Import JSON
                </button>
                <button
                  className="ft-primary"
                  disabled={!p.wallet || p.busy}
                  onClick={p.onAdd}
                >
                  <Plus size={17} /> Add a record
                </button>
              </div>
            </div>
            <div className="ft-reward-summary">
              <div>
                <span>Records in your garden</span>
                <strong>{summary.count.toString().padStart(2, "0")}</strong>
              </div>
              <div>
                <span>Disposals needing a value or basis</span>
                <strong className={summary.missing ? "ft-orange" : ""}>
                  {summary.missing.toString().padStart(2, "0")}
                </strong>
              </div>
              <div>
                <span>Estimated gain · complete records only</span>
                <strong>
                  {summary.completeDisposals
                    ? money(summary.knownGainCents)
                    : "—"}
                </strong>
              </div>
            </div>
            <div className="ft-toolbar">
              <label className="ft-search">
                <Search size={17} />
                <input
                  aria-label="Search records"
                  placeholder="Find an asset or a note…"
                  value={p.search}
                  onChange={(e) => p.onSearch(e.target.value)}
                />
              </label>
              <select
                aria-label="Tax year"
                value={p.year}
                onChange={(e) => p.onYear(e.target.value)}
              >
                <option value="all">All years</option>
                {Array.from(
                  new Set(p.data.entries.map((e) => e.date.slice(0, 4))),
                )
                  .sort()
                  .reverse()
                  .map((y) => (
                    <option key={y}>{y}</option>
                  ))}
              </select>
              <select
                aria-label="Record filter"
                value={p.ledgerFilter}
                onChange={(e) => p.onFilter(e.target.value)}
              >
                <option value="all">All records</option>
                <option value="missing">Needs review</option>
                <option value="sale">Sales</option>
                <option value="spend">Purchases with crypto</option>
                <option value="reward">Rewards</option>
              </select>
              <button disabled={!p.wallet || p.busy} onClick={p.onSync}>
                <RefreshCw size={15} /> Sync SPROUT
              </button>
            </div>
            <section className="ft-ledger">
              {!p.wallet ? (
                <ConnectNotice onConnect={p.onConnect} />
              ) : !p.data.entries.length ? (
                <div className="ft-empty">
                  <span className="ft-empty-mark">✳</span>
                  <h3>A fresh page for your records.</h3>
                  <p>
                    Add a record, import our JSON template, or sync delivered
                    Spend orders and verified payouts.
                  </p>
                  <button onClick={p.onTemplate}>
                    Download import template <Download size={16} />
                  </button>
                </div>
              ) : (
                <div className="ft-table-scroll">
                  <table>
                    <thead>
                      <tr>
                        <th>Date / activity</th>
                        <th>Asset</th>
                        <th>USD value</th>
                        <th>Cost basis</th>
                        <th>Record</th>
                      </tr>
                    </thead>
                    <tbody>
                      {p.data.entries
                        .filter(
                          (e) =>
                            (p.year === "all" || e.date.startsWith(p.year)) &&
                            `${e.asset} ${e.note}`
                              .toLowerCase()
                              .includes(p.search.toLowerCase()) &&
                            (p.ledgerFilter === "all" ||
                              (p.ledgerFilter === "missing"
                                ? isDisposal(e) &&
                                  (e.basisCents === null || e.usdCents === null)
                                : e.kind === p.ledgerFilter)),
                        )
                        .map((e) => (
                          <tr key={e.id}>
                            <td>
                              <b>
                                {e.kind[0]!.toUpperCase() + e.kind.slice(1)}
                              </b>
                              <small>
                                {new Date(e.date).toLocaleDateString("en-US", {
                                  month: "short",
                                  day: "numeric",
                                  year: "numeric",
                                  timeZone: "UTC",
                                })}{" "}
                                · {e.source}
                              </small>
                            </td>
                            <td>
                              <b>{e.asset}</b>
                              <small>{e.quantity}</small>
                            </td>
                            <td>
                              {e.usdCents === null ? (
                                <span className="ft-status pending">
                                  Add value
                                </span>
                              ) : (
                                money(e.usdCents)
                              )}
                            </td>
                            <td>
                              {e.basisCents === null ? (
                                <span className="ft-status pending">
                                  Unknown
                                </span>
                              ) : (
                                money(e.basisCents)
                              )}
                            </td>
                            <td>
                              <div className="ft-actions">
                                <button onClick={() => p.onEdit(e)}>
                                  Review <ChevronRight size={15} />
                                </button>
                                <a
                                  aria-label={`Explain ${e.asset} record`}
                                  href={`/intelligence?context=ledger&id=${encodeURIComponent(e.id)}&q=Explain%20this%20record%20and%20what%20information%20is%20missing`}
                                >
                                  Explain ↗
                                </a>
                              </div>
                            </td>
                          </tr>
                        ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
            <div className="ft-export">
              <div>
                <FileText size={26} />
                <div>
                  <h3>Ready for a second pair of eyes.</h3>
                  <p>
                    Download all records. Holder access adds estimated gains and
                    review flags.
                  </p>
                </div>
              </div>
              <div className="ft-actions">
                <button
                  disabled={!p.wallet || p.busy}
                  onClick={() => p.onExport(false)}
                >
                  <Download size={16} /> Basic CSV
                </button>
                <button
                  className="ft-primary"
                  disabled={!p.wallet || !p.data.premium || p.busy}
                  onClick={() => p.onExport(true)}
                >
                  Accountant CSV <ArrowUpRight size={16} />
                </button>
              </div>
            </div>
            <p className="ft-fine">
              A record organizer, not a filed tax return. Estimates use the
              values and basis you enter, not automatic tax-lot matching. Gifts
              and rewards need individual tax review. Unknown amounts stay
              unknown. Dates from synced Spend orders are order dates until you
              review the wallet receipt.
            </p>
          </>
        )}
        {p.page === "passports" && <Passports p={p} />}
        {p.page === "investing" && (
          <Investing
            key={`${p.wallet ?? "locked"}:${p.data.plan?.savedAt ?? 0}`}
            p={p}
          />
        )}
        <footer className="ft-footer">
          <span>
            <img src={asset("/brand/sprout-logo.png")} alt="" /> Little by
            little. Together.
          </span>
          <div>
            <a href="/docs">Documentation</a>
            <a href="/perks">Holder benefits</a>
            <a href="/faq">Questions?</a>
          </div>
          <small>For education and information. Not financial advice.</small>
        </footer>
      </main>
    </div>
  );
}
function ConnectNotice({ onConnect }: { onConnect: () => void }) {
  return (
    <div className="ft-empty">
      <Wallet size={28} />
      <h3>Your family’s space.</h3>
      <p>
        Connect your wallet and sign in to open your private records. The
        signature does not move funds.
      </p>
      <button className="ft-primary" onClick={onConnect}>
        Connect wallet <ArrowRight size={16} />
      </button>
    </div>
  );
}
function Passports({ p }: { p: ToolsViewProps }) {
  const selected =
    p.passports.find((a) => a.symbol === p.selectedAsset) ?? p.passports[0];
  return (
    <div className="ft-passports">
      <aside>
        <label className="ft-search">
          <Search size={17} />
          <input
            aria-label="Search assets"
            placeholder="Find an asset…"
            value={p.search}
            onChange={(e) => p.onSearch(e.target.value)}
          />
        </label>
        <div className="ft-asset-list">
          {p.passports
            .filter((a) =>
              a.symbol.toLowerCase().includes(p.search.toLowerCase()),
            )
            .map((a) => (
              <button
                key={a.address}
                aria-pressed={selected?.address === a.address}
                onClick={() => p.onAsset(a.symbol)}
              >
                <span className="ft-asset-monogram">
                  {a.symbol.slice(0, 2)}
                </span>
                <span>
                  <b>{a.symbol}</b>
                  <small>Asset Passport</small>
                </span>
                <ChevronRight size={17} />
              </button>
            ))}
        </div>
      </aside>
      {selected ? (
        <article className="ft-passport">
          <div className="ft-passport-top">
            <span className="ft-eyebrow">
              ASSET PASSPORT / {selected.chainId}
            </span>
            <span>Reviewed {selected.reviewedAt}</span>
          </div>
          <h2>
            {selected.symbol}
            <span>{selected.structure}</span>
          </h2>
          <div className="ft-eligibility">
            <span className="ft-status pending">Unavailable to US persons</span>
            <p>
              {selected.verifiedIssuer
                ? "The issuer restricts offers, sales and delivery to US persons. This page is educational; it does not enable a purchase."
                : "The issuer and eligibility for this network have not been verified. Purchase access is unavailable."}
            </p>
            <a href="/family-investing">
              Explore the US family planning path <ArrowUpRight size={16} />
            </a>
          </div>
          <dl>
            {[
              ["Issuer", selected.issuer],
              ["What you own", selected.ownership],
              ["Dividends", selected.dividends],
              ["Selling & redemption", selected.redemption],
              ["Trading windows", selected.trading],
            ].map(([label, value]) => (
              <div key={label}>
                <dt>{label}</dt>
                <dd>{value}</dd>
              </div>
            ))}
          </dl>
          <div className="ft-contract">
            <span>Configured token contract · chain {selected.chainId}</span>
            <code>{selected.address}</code>
          </div>
          <div className="ft-source-row">
            <span>Read the source</span>
            {selected.sources
              .filter((s) => s.id !== "irs")
              .map((s) => (
                <a href={s.url} target="_blank" rel="noreferrer" key={s.id}>
                  {s.title} <ExternalLink size={13} />
                </a>
              ))}
          </div>
          <a
            className="ft-primary"
            href={`/intelligence?context=asset&id=${encodeURIComponent(selected.symbol)}&q=Explain%20this%20asset%20passport%20in%20plain%20language`}
          >
            Ask Intelligence about this asset <ArrowUpRight size={16} />
          </a>
        </article>
      ) : (
        <section className="ft-panel">
          <h3>Asset facts are not available yet.</h3>
          <p>Configured assets appear here once the server is connected.</p>
          <button onClick={p.onRefresh}>Try again</button>
        </section>
      )}
    </div>
  );
}
const states =
  "AL AK AZ AR CA CO CT DE FL GA HI ID IL IN IA KS KY LA ME MD MA MI MN MS MO MT NE NV NH NJ NM NY NC ND OH OK OR PA RI SC SD TN TX UT VT VA WA WV WI WY DC".split(
    " ",
  );
function Investing({ p }: { p: ToolsViewProps }) {
  const saved = p.data.plan;
  const [goal, setGoal] = useState(saved?.goal ?? ""),
    [amount, setAmount] = useState(
      saved ? String(saved.targetCents / 100) : "",
    ),
    [horizon, setHorizon] = useState(saved?.horizon ?? 10),
    [state, setState] = useState(saved?.state ?? ""),
    [account, setAccount] = useState<FamilyPlan["account"]>(
      saved?.account ?? "parent",
    ),
    [adult, setAdult] = useState(false);
  return (
    <div className="ft-split">
      <section className="ft-panel">
        <span className="ft-eyebrow">A GOAL, NOT AN INVESTMENT ORDER</span>
        <h2>What are you growing toward?</h2>
        {saved && (
          <div className="ft-saved">
            <Check size={18} />
            <div>
              <b>{saved.goal}</b>
              <span>
                {money(saved.targetCents)} over {saved.horizon} years ·{" "}
                {saved.state}
              </span>
            </div>
            <button onClick={p.onDownloadPlan}>
              <Download size={16} /> Plan
            </button>
          </div>
        )}
        <form
          className="ft-form"
          onSubmit={(e) => {
            e.preventDefault();
            p.onPlan({
              goal,
              targetCents: Math.round(Number(amount) * 100),
              horizon,
              state,
              account,
              adult,
            });
          }}
        >
          <label>
            Give your goal a name
            <input
              maxLength={80}
              required
              value={goal}
              placeholder="A first apartment, perhaps."
              onChange={(e) => setGoal(e.target.value)}
            />
          </label>
          <div className="ft-form-row">
            <label>
              Target amount · USD
              <input
                type="number"
                min="1"
                max="999999999"
                step="0.01"
                required
                value={amount}
                placeholder="25000"
                onChange={(e) => setAmount(e.target.value)}
              />
            </label>
            <label>
              Time to grow
              <select
                value={horizon}
                onChange={(e) => setHorizon(Number(e.target.value))}
              >
                {[1, 3, 5, 10, 15, 18, 20, 25, 30].map((y) => (
                  <option value={y} key={y}>
                    {y} years
                  </option>
                ))}
              </select>
            </label>
          </div>
          <label>
            Your US state
            <select
              value={state}
              onChange={(e) => setState(e.target.value)}
              required
            >
              <option value="">Choose a state</option>
              {states.map((s) => (
                <option key={s}>{s}</option>
              ))}
            </select>
          </label>
          <fieldset>
            <legend>Account ownership to discuss with a provider</legend>
            <label className="ft-choice">
              <input
                type="radio"
                checked={account === "parent"}
                onChange={() => setAccount("parent")}
              />
              <span>
                <b>Parent-owned account</b>
                <small>
                  You own the assets. A family goal is not a legal transfer to a
                  child.
                </small>
              </span>
            </label>
            <label className="ft-choice">
              <input
                type="radio"
                checked={account === "custodial"}
                onChange={() => setAccount("custodial")}
              />
              <span>
                <b>Custodial account</b>
                <small>
                  Ask the provider about irrevocable gifts, state rules and
                  handover ages.
                </small>
              </span>
            </label>
          </fieldset>
          <label className="ft-choice">
            <input
              type="checkbox"
              checked={adult}
              onChange={(e) => setAdult(e.target.checked)}
              required
            />
            <span>
              I am an adult planning for my family. Saving this plan does not
              open an investment account or place an order.
            </span>
          </label>
          <button
            className="ft-primary"
            disabled={p.busy}
            type={p.wallet ? "submit" : "button"}
            onClick={p.wallet ? undefined : p.onConnect}
          >
            {p.wallet ? "Save my family plan" : "Connect to save a plan"}{" "}
            <ArrowRight size={17} />
          </button>
          {saved && (
            <button type="button" onClick={p.onDeletePlan}>
              Delete saved plan
            </button>
          )}
        </form>
      </section>
      <aside className="ft-paper">
        <span className="ft-eyebrow">THE NEXT STEP</span>
        <h2>A thoughtful beginning.</h2>
        <ol className="ft-steps">
          <li>
            <b>Save the intention.</b>
            <p>
              Start with a goal, a time horizon and who would own the account.
            </p>
          </li>
          <li>
            <b>Review the provider.</b>
            <p>
              Account opening, identity checks, custody and execution belong
              with an appropriately authorized provider.
            </p>
          </li>
          <li>
            <b>Decide when you’re ready.</b>
            <p>
              You review the actual terms before opening an account or
              investing.
            </p>
          </li>
        </ol>
        <div className="ft-provider">
          <span className="ft-status">
            {p.provider
              ? "Provider handoff configured"
              : "Provider connection pending"}
          </span>
          <h3>{p.provider?.name ?? "Your plan can begin today."}</h3>
          <p>
            {p.provider
              ? "SPROUT can open the reviewed provider website. No family data is sent and an account is not connected automatically."
              : "US investment execution is not enabled. There is no brokerage account connection, deposit or trade available here yet."}
          </p>
          {p.provider && (
            <a href={p.provider.disclosureUrl} target="_blank" rel="noreferrer">
              Provider disclosures ↗
            </a>
          )}
          <button
            className="ft-primary"
            disabled={
              !saved ||
              !p.provider ||
              !p.provider.states.includes(saved.state) ||
              p.busy
            }
            onClick={p.onProvider}
          >
            Review provider website <ArrowUpRight size={16} />
          </button>
        </div>
      </aside>
    </div>
  );
}
