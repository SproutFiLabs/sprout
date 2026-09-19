import {
  useEffect,
  useRef,
  useState,
  type ReactNode,
  type FormEvent,
} from "react";
import {
  ArrowUpRight,
  ArrowRight,
  ArrowLeft,
  Check,
  Plus,
  Download,
  Upload,
  Search,
  Wallet,
  LockKeyhole,
  RefreshCw,
  ChevronRight,
  ChevronDown,
  Leaf,
  FileText,
  Gift,
  LayoutGrid,
  Copy,
  X,
  Sparkles,
  CheckCircle2,
  Clock3,
  CircleHelp,
} from "lucide-react";
import {
  ledgerSummary,
  isDisposal,
  dollarsToCents,
  type LedgerEntry,
  type FamilyPlan,
  type RewardClaim,
} from "@sprout/shared";
import type { ToolsViewProps, ToolPage } from "./ToolsView";

type P = ToolsViewProps;
const money = (c: number) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(
    c / 100,
  );
const nav = [
  { id: "home", name: "Overview", path: "/family-tools", Icon: LayoutGrid },
  { id: "tax", name: "Tax Garden", path: "/tax-garden", Icon: FileText },
  {
    id: "passports",
    name: "Asset Passports",
    path: "/asset-passports",
    Icon: Leaf,
  },
  { id: "rewards", name: "Rewards", path: "/rewards", Icon: Gift },
  {
    id: "investing",
    name: "Family plan",
    path: "/family-investing",
    Icon: CheckCircle2,
  },
] as const;
const titles: Record<ToolPage, [string, string]> = {
  home: [
    "Your family toolkit",
    "Your records, your questions, your next little step.",
  ],
  tax: ["Tax Garden", "Keep the details together. Leave the guesswork out."],
  passports: ["Asset Passports", "Get to know what’s behind each token."],
  rewards: [
    "Your rewards",
    "Purchase offers and a clear trail of what happens next.",
  ],
  investing: [
    "Your family plan",
    "Give a future goal a thoughtful place to start.",
  ],
};
const image = (p: P, path: string) => p.assetUrl?.(path) ?? path;
const short = (s: string) => `${s.slice(0, 6)}…${s.slice(-4)}`;
const explain = (kind: string, id: string, q: string) =>
  `/intelligence?context=${kind}&id=${encodeURIComponent(id)}&q=${encodeURIComponent(q)}`;
function Status({
  children,
  tone = "quiet",
}: {
  children: ReactNode;
  tone?: string;
}) {
  return (
    <span className={`fw-status fw-status-${tone}`}>
      <i />
      {children}
    </span>
  );
}
function Empty({
  title,
  body,
  children,
  Icon = FileText,
}: {
  title: string;
  body: string;
  children?: ReactNode;
  Icon?: typeof FileText;
}) {
  return (
    <div className="fw-empty">
      <span className="fw-empty-icon">
        <Icon size={25} />
      </span>
      <h3>{title}</h3>
      <p>{body}</p>
      {children}
    </div>
  );
}
function Connect({ p, what = "records" }: { p: P; what?: string }) {
  return (
    <Empty
      Icon={LockKeyhole}
      title={`Your ${what}. Just for you.`}
      body="Connect your wallet to open your family’s workspace. Signing in does not move funds."
    >
      <button className="fw-primary" disabled={p.busy} onClick={p.onConnect}>
        <Wallet size={15} /> Connect wallet
      </button>
    </Empty>
  );
}
function Subhead({ title, aside }: { title: string; aside?: ReactNode }) {
  return (
    <div className="fw-panel-head">
      <h2>{title}</h2>
      {aside}
    </div>
  );
}
function Art({
  p,
  tone = "orange",
  children,
}: {
  p: P;
  tone?: string;
  children?: ReactNode;
}) {
  return (
    <div className={`fw-art fw-art-${tone}`}>
      <img
        src={image(
          p,
          `/art/${tone === "orange" ? "card-orange.png" : tone === "lavender" ? "card-lavender.png" : "hero-botanical-white.png"}`,
        )}
        alt=""
      />
      {children}
    </div>
  );
}
export function ToolsWorkspace(p: P) {
  const current = nav.find((n) => n.id === p.page)!;
  const navigation = useRef<HTMLElement>(null);
  useEffect(() => {
    const menu = navigation.current;
    const active = menu?.querySelector<HTMLElement>('[aria-current="page"]');
    if (menu && active && menu.scrollWidth > menu.clientWidth) {
      menu.scrollLeft =
        active.offsetLeft -
        menu.offsetLeft -
        (menu.clientWidth - active.offsetWidth) / 2;
    }
  }, [p.page]);
  return (
    <div className={`ft-root fw-app fw-page-${p.page}`}>
      <a className="ft-skip" href="#workspace-content">
        Skip to workspace
      </a>
      <header className="fw-header">
        <a className="fw-brand" href="/" aria-label="SPROUT home">
          <img src={image(p, "/brand/sprout-logo.png")} alt="" />
          SPROUT
        </a>
        <span className="fw-header-divider" />
        <span className="fw-header-name">Family toolkit</span>
        <nav aria-label="SPROUT">
          <a href="/dashboard">Your garden</a>
          <a href="/spend">Spend</a>
          <a href="/intelligence">
            Intelligence <ArrowUpRight size={13} />
          </a>
        </nav>
        <button
          className={p.wallet ? "fw-wallet" : "fw-primary"}
          disabled={p.busy}
          onClick={p.wallet ? p.onLock : p.onConnect}
        >
          <Wallet size={14} />
          {p.wallet ? short(p.wallet) : "Connect wallet"}
          {p.wallet && <span>· Lock</span>}
        </button>
      </header>
      <div className="fw-shell">
        <nav className="fw-nav" aria-label="Family tools" ref={navigation}>
          {nav.map(({ id, name, path, Icon }) => (
            <a
              href={path}
              key={id}
              aria-current={p.page === id ? "page" : undefined}
            >
              <Icon size={17} />
              {name}
              {id === "tax" &&
                p.wallet &&
                ledgerSummary(p.data.entries).missing > 0 && (
                  <span className="fw-nav-count">
                    {ledgerSummary(p.data.entries).missing}
                  </span>
                )}
            </a>
          ))}
          <a className="fw-help" href="/docs">
            <CircleHelp size={16} />
            <span>Help & sources</span>
          </a>
        </nav>
        <main id="workspace-content" className="fw-main">
          <div className="fw-page-heading">
            <div>
              <span className="fw-breadcrumb">
                Your toolkit <ChevronRight size={12} /> {current.name}
              </span>
              <h1>{titles[p.page][0]}</h1>
              <p>{titles[p.page][1]}</p>
            </div>
            <div className="fw-heading-actions">
              {p.page === "tax" ? (
                <>
                  <button disabled={!p.wallet || p.busy} onClick={p.onImport}>
                    <Upload size={15} /> Import
                  </button>
                  <button
                    className="fw-primary"
                    disabled={!p.wallet || p.busy}
                    onClick={p.onAdd}
                  >
                    <Plus size={16} /> Add a record
                  </button>
                </>
              ) : p.page === "home" ? (
                <a className="fw-primary" href="/intelligence">
                  <Sparkles size={15} /> Ask Intelligence
                </a>
              ) : p.page === "rewards" ? (
                <a className="fw-button" href="/spend">
                  Open Spend <ArrowUpRight size={15} />
                </a>
              ) : (
                <Status tone={p.page === "passports" ? "green" : "quiet"}>
                  {p.page === "passports" ? "Read & learn" : "Planning only"}
                </Status>
              )}
            </div>
          </div>
          {p.error && (
            <div className="fw-message fw-message-error" role="alert">
              <span>{p.error}</span>
              <button onClick={p.onRefresh}>Try again</button>
            </div>
          )}
          {p.notice && (
            <div className="fw-message" role="status">
              <CheckCircle2 size={17} />
              {p.notice}
            </div>
          )}
          {p.busy && (
            <div className="fw-loading" role="status">
              <span />
              Updating your workspace…
            </div>
          )}
          {p.page === "home" && <Overview p={p} />}
          {p.page === "tax" && <Ledger p={p} />}
          {p.page === "passports" && <Passports p={p} />}
          {p.page === "rewards" && <Rewards p={p} />}
          {p.page === "investing" && (
            <Planner key={p.data.plan?.savedAt ?? 0} p={p} />
          )}
          <footer className="fw-footer">
            <span>
              <Leaf size={13} /> Little by little. Together.
            </span>
            <span>For education and information. Not financial advice.</span>
            <a href="/faq">
              Questions? <ArrowUpRight size={12} />
            </a>
          </footer>
        </main>
      </div>
    </div>
  );
}
function Overview({ p }: { p: P }) {
  const s = ledgerSummary(p.data.entries),
    missing = p.data.entries.filter(
      (e) => isDisposal(e) && (e.basisCents === null || e.usdCents === null),
    );
  return (
    <>
      <div className="fw-overview-top">
        <section className="fw-home-welcome">
          <div>
            <span className="fw-kicker">YOUR NEXT LITTLE STEP</span>
            <h2>
              {!p.wallet
                ? "Make yourself at home."
                : s.missing
                  ? "A few details need your eye."
                  : p.data.plan
                    ? "A little more organized."
                    : "What are you growing toward?"}
            </h2>
            <p>
              {!p.wallet
                ? "Your wallet opens your private records and saved plan. You can explore asset information whenever you like."
                : s.missing
                  ? `${s.missing} ${s.missing === 1 ? "record is" : "records are"} missing a value or cost basis. Review them before exporting.`
                  : p.data.plan
                    ? "Your records and family plan have a home here. Pick up wherever you left off."
                    : "Start with a goal. Think about a time horizon and who will own the account."}
            </p>
            {!p.wallet ? (
              <button
                className="fw-primary"
                disabled={p.busy}
                onClick={p.onConnect}
              >
                Open your workspace <ArrowRight size={15} />
              </button>
            ) : (
              <a
                className="fw-primary"
                href={s.missing ? "/tax-garden" : "/family-investing"}
              >
                {s.missing
                  ? "Review your records"
                  : p.data.plan
                    ? "View family plan"
                    : "Make a family plan"}
                <ArrowRight size={15} />
              </a>
            )}
          </div>
          <img src={image(p, "/art/dashboard/hero-bouquet.png")} alt="" />
        </section>
        <section className="fw-access-card">
          <div>
            <Leaf size={20} />
            <Status tone={p.data.premium ? "green" : "quiet"}>
              {p.data.premium ? "Holder access active" : "Holder benefits"}
            </Status>
          </div>
          <h3>
            A little more
            <br />
            from your SPROUT.
          </h3>
          <p>
            Verified holders of 1 million SPROUT can access Intelligence,
            accountant exports and eligible purchase offers.
          </p>
          <a href="/perks">
            See your holder benefits <ArrowUpRight size={16} />
          </a>
        </section>
      </div>
      <div className="fw-overview-grid">
        <section className="fw-panel fw-overview-activity">
          <Subhead
            title="Your recent records"
            aside={
              <a href="/tax-garden">
                Open Tax Garden <ArrowUpRight size={14} />
              </a>
            }
          />
          {!p.wallet ? (
            <Connect p={p} />
          ) : !p.data.entries.length ? (
            <Empty
              title="A fresh page."
              body="Add your first record or sync your SPROUT activity."
            >
              <a className="fw-button" href="/tax-garden">
                Start your records <ArrowRight size={15} />
              </a>
            </Empty>
          ) : (
            <>
              <div className="fw-mini-ledger">
                {p.data.entries.slice(0, 4).map((e) => (
                  <button key={e.id} onClick={() => p.onEdit(e)}>
                    <span className={`fw-activity-icon fw-kind-${e.kind}`}>
                      <FileText size={17} />
                    </span>
                    <span>
                      <b>
                        {e.asset} · {e.kind}
                      </b>
                      <small>
                        {new Date(e.date).toLocaleDateString("en-US", {
                          month: "short",
                          day: "numeric",
                          timeZone: "UTC",
                        })}
                      </small>
                    </span>
                    <strong>
                      {e.usdCents === null ? "Value needed" : money(e.usdCents)}
                    </strong>
                    <ChevronRight size={16} />
                  </button>
                ))}
              </div>
              <div className="fw-panel-foot">
                {s.count} records · {missing.length} need review
              </div>
            </>
          )}
        </section>
        <div className="fw-quick-tools">
          <a href="/asset-passports">
            <Art p={p} tone="lavender">
              <Leaf size={24} />
            </Art>
            <div>
              <h3>Understand an asset</h3>
              <p>Issuer, rights and availability.</p>
            </div>
            <ArrowUpRight size={20} />
          </a>
          <a href="/rewards">
            <Art p={p}>
              <Gift size={24} />
            </Art>
            <div>
              <h3>Follow your rewards</h3>
              <p>
                {p.wallet
                  ? `${p.data.claims.length} purchase rewards in your trail.`
                  : "Offers, delivery and payment receipts."}
              </p>
            </div>
            <ArrowUpRight size={20} />
          </a>
          <a href="/family-investing">
            <Art p={p} tone="green">
              <CheckCircle2 size={24} />
            </Art>
            <div>
              <h3>{p.data.plan?.goal ?? "Make a family plan"}</h3>
              <p>
                {p.data.plan
                  ? `${money(p.data.plan.targetCents)} · ${p.data.plan.horizon} years`
                  : "A goal, a time horizon, a starting point."}
              </p>
            </div>
            <ArrowUpRight size={20} />
          </a>
        </div>
      </div>
    </>
  );
}
function Ledger({ p }: { p: P }) {
  const summary = ledgerSummary(p.data.entries);
  const [exportOpen, setExportOpen] = useState(false);
  const entries = p.data.entries.filter(
    (e) =>
      (p.year === "all" || e.date.startsWith(p.year)) &&
      `${e.asset} ${e.note}`.toLowerCase().includes(p.search.toLowerCase()) &&
      (p.ledgerFilter === "all" ||
        (p.ledgerFilter === "missing"
          ? isDisposal(e) && (e.basisCents === null || e.usdCents === null)
          : e.kind === p.ledgerFilter)),
  );
  const missing = p.data.entries.filter(
    (e) => isDisposal(e) && (e.basisCents === null || e.usdCents === null),
  );
  return (
    <>
      <div className="fw-ledger-metrics">
        <div>
          <span>Your records</span>
          <strong>{p.wallet ? summary.count : "—"}</strong>
          <small>
            {p.wallet ? "In your family ledger" : "Connect to view"}
          </small>
        </div>
        <div>
          <span>Needs your attention</span>
          <strong>
            {p.wallet ? summary.missing : "—"}
            <i className="fw-dot-amber" />
          </strong>
          <small>Missing a value or cost basis</small>
        </div>
        <div>
          <span>Estimated net gain</span>
          <strong>
            {p.wallet && summary.completeDisposals
              ? money(summary.knownGainCents)
              : "—"}
          </strong>
          <small>
            {summary.completeDisposals} complete disposals · entered values only
          </small>
        </div>
        <button
          className="fw-sync"
          disabled={!p.wallet || p.busy}
          onClick={p.onSync}
        >
          <RefreshCw size={18} />
          <span>
            Sync SPROUT<small>Delivered orders & verified payouts</small>
          </span>
        </button>
      </div>
      <div className="fw-ledger-layout">
        <section className="fw-panel fw-ledger-panel">
          <div
            className="fw-filter-tabs"
            role="group"
            aria-label="Record categories"
          >
            {[
              ["all", "All activity"],
              ["missing", "Needs review"],
              ["gift", "Gifts"],
              ["reward", "Rewards"],
            ].map(([key, title]) => (
              <button
                key={key}
                aria-pressed={p.ledgerFilter === key}
                onClick={() => p.onFilter(key!)}
              >
                {title}
                {key === "missing" && summary.missing > 0 && (
                  <span>{summary.missing}</span>
                )}
              </button>
            ))}
          </div>
          <div className="fw-table-tools">
            <label className="fw-search">
              <Search size={16} />
              <input
                aria-label="Search records"
                placeholder="Find an asset or a note"
                value={p.search}
                onChange={(e) => p.onSearch(e.target.value)}
              />
              {p.search && (
                <button
                  aria-label="Clear search"
                  onClick={() => p.onSearch("")}
                >
                  <X size={14} />
                </button>
              )}
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
          </div>
          {!p.wallet ? (
            <Connect p={p} />
          ) : !p.data.entries.length ? (
            <Empty
              title="Every detail starts somewhere."
              body="Add a record, import your file, or sync delivered orders and verified payouts."
            >
              <button className="fw-primary" onClick={p.onAdd}>
                <Plus size={15} /> Add a record
              </button>
              <button className="fw-text" onClick={p.onTemplate}>
                Download import template <Download size={14} />
              </button>
            </Empty>
          ) : !entries.length ? (
            <Empty
              Icon={Search}
              title="No records match."
              body="Try a different search or clear your filters."
            >
              <button
                onClick={() => {
                  p.onSearch("");
                  p.onYear("all");
                  p.onFilter("all");
                }}
              >
                Clear filters
              </button>
            </Empty>
          ) : (
            <div className="fw-table-scroll">
              <table className="fw-table">
                <thead>
                  <tr>
                    <th>Activity</th>
                    <th>Value</th>
                    <th>Cost basis</th>
                    <th>Status</th>
                    <th>
                      <span className="fw-sr-only">Actions</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {entries.map((e) => (
                    <tr key={e.id}>
                      <td>
                        <div className="fw-activity">
                          <span
                            className={`fw-activity-icon fw-kind-${e.kind}`}
                          >
                            {e.asset.slice(0, 2)}
                          </span>
                          <div>
                            <b>
                              {e.asset}
                              <span>{e.kind}</span>
                            </b>
                            <small>
                              {new Date(e.date).toLocaleDateString("en-US", {
                                month: "short",
                                day: "numeric",
                                year: "numeric",
                                timeZone: "UTC",
                              })}{" "}
                              · {e.quantity} {e.asset}
                            </small>
                          </div>
                        </div>
                      </td>
                      <td>
                        {e.usdCents === null ? (
                          <span className="fw-unknown">Add value</span>
                        ) : (
                          money(e.usdCents)
                        )}
                      </td>
                      <td>
                        {e.basisCents === null ? (
                          <span className="fw-unknown">Unknown</span>
                        ) : (
                          money(e.basisCents)
                        )}
                      </td>
                      <td>
                        <Status
                          tone={
                            isDisposal(e) &&
                            (e.basisCents === null || e.usdCents === null)
                              ? "amber"
                              : "green"
                          }
                        >
                          {isDisposal(e) &&
                          (e.basisCents === null || e.usdCents === null)
                            ? "Needs review"
                            : "Recorded"}
                        </Status>
                      </td>
                      <td>
                        <button
                          className="fw-row-button"
                          onClick={() => p.onEdit(e)}
                          aria-label={`Review ${e.asset} record`}
                        >
                          Review <ChevronRight size={14} />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <div className="fw-panel-foot">
            <span>
              {p.wallet
                ? `${entries.length} of ${summary.count} records`
                : "Private to your connected wallet"}
            </span>
            <button className="fw-text" onClick={p.onTemplate}>
              <Download size={13} /> Import template
            </button>
          </div>
        </section>
        <aside className="fw-ledger-side">
          <section className="fw-review-card">
            <Art p={p} tone="lavender">
              <FileText size={23} />
            </Art>
            <span className="fw-kicker">A SECOND LOOK</span>
            <h3>
              {missing.length ? "Fill in the gaps." : "The details matter."}
            </h3>
            <p>
              {missing.length
                ? "Start here before you prepare your export. Unknown amounts are never treated as zero."
                : "Your original purchase cost helps make sense of a sale. Leave it blank until you know it."}
            </p>
            {missing.slice(0, 2).map((e) => (
              <button key={e.id} onClick={() => p.onEdit(e)}>
                <span>
                  <b>
                    {e.asset} · {e.kind}
                  </b>
                  <small>
                    {e.basisCents === null
                      ? "Cost basis needed"
                      : "Transaction value needed"}
                  </small>
                </span>
                <ArrowRight size={15} />
              </button>
            ))}
            <a
              href={
                missing[0]
                  ? explain(
                      "ledger",
                      missing[0].id,
                      "Explain what information is missing from this record",
                    )
                  : "/intelligence"
              }
            >
              <Sparkles size={14} /> Ask Intelligence <ArrowUpRight size={14} />
            </a>
          </section>
          <section className="fw-export-card">
            <div>
              <Download size={20} />
              <span>TAKE IT WITH YOU</span>
            </div>
            <h3>
              Ready for your
              <br />
              accountant.
            </h3>
            <p>
              A clean CSV of your records. Holder access adds estimated gains
              and review flags.
            </p>
            <button
              className="fw-primary"
              disabled={!p.wallet || p.busy}
              onClick={() => setExportOpen(!exportOpen)}
              aria-expanded={exportOpen}
            >
              Export records <ChevronDown size={15} />
            </button>
            {exportOpen && p.wallet && (
              <div className="fw-export-options">
                <button disabled={p.busy} onClick={() => p.onExport(false)}>
                  Basic CSV <Download size={14} />
                </button>
                <button
                  disabled={!p.data.premium || p.busy}
                  onClick={() => p.onExport(true)}
                >
                  Accountant CSV{" "}
                  {p.data.premium ? (
                    <Download size={14} />
                  ) : (
                    <LockKeyhole size={14} />
                  )}
                </button>
                {!p.data.premium && (
                  <small>
                    Accountant export requires verified holder access.
                  </small>
                )}
              </div>
            )}
          </section>
        </aside>
      </div>
      <p className="fw-footnote">
        A record organizer, not a filed tax return. Estimates use entered values
        and basis; no automatic tax-lot matching. Review synced timestamps and
        historical values. Gifts and rewards need individual tax review.
      </p>
    </>
  );
}
const names: Record<string, string> = {
  AAPL: "Apple",
  NVDA: "NVIDIA",
  MSFT: "Microsoft",
  SPY: "S&P 500 ETF",
  TSLA: "Tesla",
  AMZN: "Amazon",
  GOOGL: "Alphabet",
  META: "Meta",
  PLTR: "Palantir",
  AMD: "AMD",
  TSM: "TSMC",
  MU: "Micron",
  ASML: "ASML",
  INTC: "Intel",
  BABA: "Alibaba",
  QQQ: "Nasdaq-100 ETF",
  GME: "GameStop",
};
function Passports({ p }: { p: P }) {
  const selected =
    p.passports.find((a) => a.symbol === p.selectedAsset) ?? p.passports[0];
  const [copied, setCopied] = useState("");
  const matches = p.passports.filter((a) =>
    `${a.symbol} ${names[a.symbol] ?? ""}`
      .toLowerCase()
      .includes(p.search.toLowerCase()),
  );
  return (
    <div className="fw-asset-workspace">
      <aside className="fw-asset-browser">
        <label className="fw-search">
          <Search size={17} />
          <input
            aria-label="Search assets"
            placeholder="Find a company or token"
            value={p.search}
            onChange={(e) => p.onSearch(e.target.value)}
          />
        </label>
        <div className="fw-list-caption">
          <span>ASSETS</span>
          <span>{matches.length}</span>
        </div>
        <div className="fw-asset-list">
          {matches.map((a, i) => (
            <button
              key={a.address}
              onClick={() => {
                p.onAsset(a.symbol);
                setCopied("");
              }}
              aria-pressed={selected?.address === a.address}
            >
              <span className={`fw-ticker fw-ticker-${i % 4}`}>
                {a.symbol.slice(0, 2)}
              </span>
              <span>
                <b>{a.symbol}</b>
                <small>{names[a.symbol] ?? "Stock token"}</small>
              </span>
              <ChevronRight size={14} />
            </button>
          ))}
          {!matches.length && (
            <p className="fw-no-assets">No assets match your search.</p>
          )}
        </div>
        <p className="fw-browser-note">
          <Leaf size={15} /> A token name is only the beginning.
        </p>
      </aside>
      {selected ? (
        <article className="fw-asset-detail">
          <div className="fw-asset-heading">
            <div>
              <span className="fw-kicker">ASSET PASSPORT</span>
              <h2>
                {selected.symbol}
                <small>{names[selected.symbol] ?? "Configured token"}</small>
              </h2>
              <Status>{selected.structure}</Status>
            </div>
            <a
              className="fw-primary"
              href={explain(
                "asset",
                selected.symbol,
                "Explain this Asset Passport and its ownership rights",
              )}
            >
              <Sparkles size={15} /> Explain this asset
            </a>
          </div>
          <section className="fw-ownership">
            <span className="fw-kicker">WHAT YOU OWN</span>
            <p>{selected.ownership}</p>
            <div>
              <span>Issued by</span>
              <b>{selected.issuer}</b>
            </div>
            <img
              src={image(p, "/art/dashboard/motion/leaf-purple.png")}
              alt=""
            />
          </section>
          <div className="fw-fact-grid">
            <section>
              <span className="fw-fact-number">01</span>
              <h3>Dividends</h3>
              <p>{selected.dividends}</p>
            </section>
            <section>
              <span className="fw-fact-number">02</span>
              <h3>Selling & redemption</h3>
              <p>{selected.redemption}</p>
            </section>
            <section>
              <span className="fw-fact-number">03</span>
              <h3>Trading windows</h3>
              <p>{selected.trading}</p>
            </section>
          </div>
          <div className="fw-availability">
            <LockKeyhole size={18} />
            <div>
              <h3>Unavailable to US persons</h3>
              <p>
                {selected.verifiedIssuer
                  ? "Issuer restrictions apply to offers, sales and delivery. This passport is educational and cannot be used to purchase."
                  : "Issuer and eligibility are not verified on this network. Purchase access is unavailable."}
              </p>
              <a href="/family-investing">
                Explore the family planning path <ArrowRight size={14} />
              </a>
            </div>
          </div>
          <div className="fw-asset-evidence">
            <section>
              <span className="fw-kicker">CHECK THE ORIGINAL</span>
              <div className="fw-source-links">
                {selected.sources
                  .filter((s) => s.id !== "irs")
                  .map((s) => (
                    <a key={s.id} href={s.url} target="_blank" rel="noreferrer">
                      <FileText size={15} />
                      <span>{s.title}</span>
                      <ArrowUpRight size={14} />
                    </a>
                  ))}
              </div>
              <small>Reviewed {selected.reviewedAt} · terms can change</small>
            </section>
            <section className="fw-contract">
              <span className="fw-kicker">CONFIGURED CONTRACT</span>
              <span>Chain {selected.chainId}</span>
              <code>{selected.address}</code>
              <button
                className="fw-text"
                onClick={async () => {
                  try {
                    await navigator.clipboard.writeText(selected.address);
                    setCopied("Address copied");
                  } catch {
                    setCopied("Copy unavailable. Select the address above.");
                  }
                }}
              >
                <Copy size={13} /> Copy address
              </button>
              <small role="status">{copied}</small>
            </section>
          </div>
        </article>
      ) : (
        <section className="fw-panel">
          <Empty
            title="Asset details are loading."
            body="The configured assets will appear when the server is available."
          >
            <button onClick={p.onRefresh}>Try again</button>
          </Empty>
        </section>
      )}
    </div>
  );
}
function Rewards({ p }: { p: P }) {
  const [view, setView] = useState<"offers" | "activity">("offers");
  const active = p.data.rewardReady
    ? p.data.offers.filter(
        (o) => o.endsAt > Date.now() && o.budgetCents > o.reservedCents,
      )
    : [];
  const total = (status: string) =>
    p.data.claims
      .filter((c) => c.status === status)
      .reduce((n, c) => n + c.cents, 0);
  return (
    <div className="fw-rewards-layout">
      <section>
        <div className="fw-reward-wallet">
          <div>
            <span className="fw-kicker">YOUR PURCHASE REWARDS</span>
            <strong>{p.wallet ? money(total("paid")) : "—"}</strong>
            <span>Paid · verified USDC on Base</span>
          </div>
          <div>
            <span>
              Awaiting delivery<b>{p.wallet ? money(total("pending")) : "—"}</b>
            </span>
            <span>
              Ready for manual payout
              <b>{p.wallet ? money(total("confirmed")) : "—"}</b>
            </span>
          </div>
          <img src={image(p, "/art/dashboard/motion/leaf-green.png")} alt="" />
        </div>
        <section className="fw-panel">
          <div
            className="fw-filter-tabs"
            role="group"
            aria-label="Reward views"
          >
            <button
              aria-pressed={view === "offers"}
              onClick={() => setView("offers")}
            >
              Available offers <span>{active.length}</span>
            </button>
            <button
              aria-pressed={view === "activity"}
              onClick={() => setView("activity")}
            >
              Your reward trail{" "}
              <span>{p.wallet ? p.data.claims.length : "—"}</span>
            </button>
            <button
              className="fw-refresh-icon"
              aria-label="Refresh rewards"
              disabled={p.busy}
              onClick={p.onRefresh}
            >
              <RefreshCw size={16} />
            </button>
          </div>
          {view === "offers" ? (
            active.length ? (
              <div className="fw-offer-grid">
                {active.map((o) => (
                  <article className="fw-offer" key={o.id}>
                    <div className="fw-offer-top">
                      <Gift size={22} />
                      <Status tone="green">Funded offer</Status>
                    </div>
                    <h3>{o.title}</h3>
                    <strong>
                      {o.rateBps / 100}%<span> purchase reward</span>
                    </strong>
                    <p>{o.terms}</p>
                    <small>
                      Ends {new Date(o.endsAt).toLocaleDateString("en-US")} ·
                      while budget lasts
                    </small>
                    <a className="fw-primary" href={`/spend?offer=${o.id}`}>
                      Review offer in Spend <ArrowUpRight size={15} />
                    </a>
                  </article>
                ))}
              </div>
            ) : (
              <div className="fw-no-offers">
                <Art p={p}>
                  <Gift size={39} />
                </Art>
                <div>
                  <span className="fw-kicker">NOTHING TO CLAIM JUST YET</span>
                  <h3>
                    A little patience.
                    <br />
                    Clear terms, when it’s time.
                  </h3>
                  <p>
                    There are no funded offers available right now. Offers
                    appear here with their reward, eligibility and terms before
                    you buy.
                  </p>
                  <a className="fw-button" href="/spend">
                    Browse Spend <ArrowUpRight size={15} />
                  </a>
                </div>
              </div>
            )
          ) : !p.wallet ? (
            <Connect p={p} what="rewards" />
          ) : !p.data.claims.length ? (
            <Empty
              Icon={Gift}
              title="Your first little win starts here."
              body="An eligible delivered purchase starts your reward trail. Come back here to confirm it and see its receipt."
            />
          ) : (
            <div className="fw-reward-trail">
              {p.data.claims.map((c) => (
                <RewardRow key={c.id} p={p} claim={c} />
              ))}
            </div>
          )}
        </section>
      </section>
      <aside className="fw-reward-guide">
        <span className="fw-kicker">FROM PURCHASE TO PAYOUT</span>
        <h2>
          A trail you
          <br />
          can follow.
        </h2>
        <ol>
          <li>
            <span>01</span>
            <div>
              <b>Review an offer</b>
              <p>
                Eligible holders see the exact reward and terms at checkout.
              </p>
            </div>
          </li>
          <li>
            <span>02</span>
            <div>
              <b>Confirm delivery</b>
              <p>
                After the shop marks your order delivered, confirm your reward
                here.
              </p>
            </div>
          </li>
          <li>
            <span>03</span>
            <div>
              <b>Keep your receipt</b>
              <p>
                The team sends USDC manually on Base. A matching finalized
                transfer marks it paid.
              </p>
            </div>
          </li>
        </ol>
        <div className="fw-holder-note">
          <Leaf size={20} />
          <b>1 million SPROUT</b>
          <p>
            Verified holder access is required for eligible offers. Holding
            alone does not earn a reward.
          </p>
          <a href="/perks">
            Check holder benefits <ArrowUpRight size={14} />
          </a>
        </div>
        <p className="fw-footnote">
          Treasury funds are not escrowed. Purchase terms and eligibility apply.
        </p>
      </aside>
    </div>
  );
}
function RewardRow({ p, claim: c }: { p: P; claim: RewardClaim }) {
  const [open, setOpen] = useState(false);
  return (
    <article className="fw-reward-item">
      <button
        className="fw-reward-item-head"
        onClick={() => setOpen(!open)}
        aria-expanded={open}
      >
        <span className="fw-activity-icon fw-kind-reward">
          <Gift size={20} />
        </span>
        <span>
          <b>
            {p.data.offers.find((o) => o.id === c.offerId)?.title ??
              "Purchase reward"}
          </b>
          <small>Order {c.orderId.slice(0, 8)}</small>
        </span>
        <strong>{money(c.cents)}</strong>
        <Status tone={c.status === "paid" ? "green" : "amber"}>
          {c.status === "pending"
            ? "Awaiting delivery"
            : c.status === "confirmed"
              ? "Ready for payout"
              : c.status}
        </Status>
        <ChevronDown size={15} />
      </button>
      {open && (
        <div className="fw-reward-expanded">
          <div className="fw-reward-progress">
            {[
              "Purchase recorded",
              "Delivery confirmed",
              "Payment verified",
            ].map((name, i) => {
              const done =
                i === 0 ||
                (i === 1 &&
                  (c.status === "confirmed" || c.status === "paid")) ||
                (i === 2 && c.status === "paid");
              return (
                <span key={name} className={done ? "is-done" : ""}>
                  {done ? <CheckCircle2 size={17} /> : <Clock3 size={17} />}
                  {name}
                </span>
              );
            })}
          </div>
          <div className="fw-inline-actions">
            {c.status === "pending" && (
              <button
                className="fw-primary"
                disabled={p.busy}
                onClick={() => p.onConfirm(c.id)}
              >
                Confirm delivery <Check size={15} />
              </button>
            )}
            {c.status === "confirmed" && (
              <p>Confirmed. Awaiting the team’s manual payout.</p>
            )}
            {c.txHash && (
              <a
                className="fw-button"
                href={`https://basescan.org/tx/${c.txHash}`}
                target="_blank"
                rel="noreferrer"
              >
                View payment receipt <ArrowUpRight size={15} />
              </a>
            )}
            <a href={explain("reward", c.id, "Explain this purchase reward")}>
              Explain this reward <Sparkles size={14} />
            </a>
          </div>
        </div>
      )}
    </article>
  );
}
const states =
  "AL AK AZ AR CA CO CT DE FL GA HI ID IL IN IA KS KY LA ME MD MA MI MN MS MO MT NE NV NH NJ NM NY NC ND OH OK OR PA RI SC SD TN TX UT VT VA WA WV WI WY DC".split(
    " ",
  );
function Planner({ p }: { p: P }) {
  const saved = p.data.plan;
  const [step, setStep] = useState(saved ? 2 : 0),
    [goal, setGoal] = useState(saved?.goal ?? ""),
    [amount, setAmount] = useState(
      saved ? String(saved.targetCents / 100) : "",
    ),
    [horizon, setHorizon] = useState(saved?.horizon ?? 10),
    [state, setState] = useState(saved?.state ?? ""),
    [account, setAccount] = useState<FamilyPlan["account"]>(
      saved?.account ?? "parent",
    ),
    [adult, setAdult] = useState(false),
    [deleting, setDeleting] = useState(false);
  const previousWallet = useRef(p.wallet);
  useEffect(() => {
    if (previousWallet.current && previousWallet.current !== p.wallet) {
      setGoal("");
      setAmount("");
      setHorizon(10);
      setState("");
      setAccount("parent");
      setAdult(false);
      setStep(0);
      setDeleting(false);
    }
    previousWallet.current = p.wallet;
  }, [p.wallet]);
  const parsed = (() => {
    try {
      return dollarsToCents(amount);
    } catch {
      return null;
    }
  })();
  const validGoal = goal.trim().length >= 2 && parsed !== null && parsed >= 100;
  const next = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (step < 2) {
      setStep(step + 1);
      return;
    }
    if (validGoal && state && adult)
      p.onPlan({
        goal: goal.trim(),
        targetCents: parsed!,
        horizon,
        state,
        account,
        adult,
      });
  };
  return (
    <div className="fw-plan-layout">
      <section className="fw-panel fw-plan-builder">
        <nav className="fw-plan-steps" aria-label="Plan steps">
          {["Your goal", "Ownership", "Review & save"].map((title, i) => (
            <button
              key={title}
              onClick={() => setStep(i)}
              aria-current={step === i ? "step" : undefined}
              disabled={(i > 0 && !validGoal) || (i === 2 && !state)}
            >
              <span>{i < step ? <Check size={14} /> : i + 1}</span>
              {title}
            </button>
          ))}
        </nav>
        <form className="fw-plan-form" onSubmit={next}>
          {step === 0 && (
            <>
              <span className="fw-kicker">01 / YOUR GOAL</span>
              <h2>
                What does their
                <br />
                someday look like?
              </h2>
              <p>
                A starting point you can come back to. Make it something that
                means something to your family.
              </p>
              <label>
                Give your goal a name
                <input
                  aria-label="Give your goal a name"
                  value={goal}
                  onChange={(e) => setGoal(e.target.value)}
                  minLength={2}
                  maxLength={80}
                  placeholder="A first apartment, perhaps."
                  required
                />
              </label>
              <div className="fw-goal-suggestions">
                {["Education", "A first apartment", "A head start"].map((s) => (
                  <button key={s} type="button" onClick={() => setGoal(s)}>
                    {s} <Plus size={12} />
                  </button>
                ))}
              </div>
              <div className="fw-two-fields">
                <label>
                  Target amount · USD
                  <div className="fw-money-input">
                    <span>$</span>
                    <input
                      aria-label="Target amount · USD"
                      type="number"
                      min="1"
                      max="999999999"
                      step="0.01"
                      required
                      value={amount}
                      onChange={(e) => setAmount(e.target.value)}
                      placeholder="25,000"
                    />
                  </div>
                </label>
                <label>
                  Time to grow
                  <select
                    aria-label="Time to grow"
                    value={horizon}
                    onChange={(e) => setHorizon(Number(e.target.value))}
                  >
                    {[1, 3, 5, 10, 15, 18, 20, 25, 30].map((y) => (
                      <option value={y} key={y}>
                        {y} {y === 1 ? "year" : "years"}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
              <div className="fw-plan-hint">
                <Leaf size={17} />
                <p>
                  Your target is an intention. No investment return is assumed.
                </p>
              </div>
            </>
          )}
          {step === 1 && (
            <>
              <span className="fw-kicker">02 / OWNERSHIP</span>
              <h2>
                A little thought
                <br />
                about whose future.
              </h2>
              <p>
                Choose the account structure you’d like to discuss with a
                provider. This choice does not open an account.
              </p>
              <label>
                Your US state
                <select
                  aria-label="Your US state"
                  required
                  value={state}
                  onChange={(e) => setState(e.target.value)}
                >
                  <option value="">Choose a state</option>
                  {states.map((s) => (
                    <option key={s}>{s}</option>
                  ))}
                </select>
              </label>
              <fieldset>
                <legend>Account ownership</legend>
                {[
                  [
                    "parent",
                    "Parent-owned account",
                    "You own the assets. A family goal is not a legal transfer to a child.",
                  ],
                  [
                    "custodial",
                    "Custodial account",
                    "Discuss irrevocable gifts, state rules and handover ages with your provider.",
                  ],
                ].map(([key, title, body]) => (
                  <label className="fw-ownership-choice" key={key}>
                    <input
                      type="radio"
                      name="ownership"
                      checked={account === key}
                      onChange={() => setAccount(key as FamilyPlan["account"])}
                    />
                    <span>
                      <b>{title}</b>
                      <small>{body}</small>
                    </span>
                    <CheckCircle2 size={20} />
                  </label>
                ))}
              </fieldset>
            </>
          )}
          {step === 2 && (
            <>
              <span className="fw-kicker">03 / REVIEW & SAVE</span>
              <h2>
                A plan to
                <br />
                come back to.
              </h2>
              <p>
                Check the details, then keep a copy in your private family
                workspace.
              </p>
              <dl className="fw-plan-review">
                <div>
                  <dt>Your goal</dt>
                  <dd>{goal}</dd>
                </div>
                <div>
                  <dt>Target</dt>
                  <dd>{parsed === null ? "Not entered" : money(parsed)}</dd>
                </div>
                <div>
                  <dt>Time horizon</dt>
                  <dd>{horizon} years</dd>
                </div>
                <div>
                  <dt>Account preference</dt>
                  <dd>{account === "parent" ? "Parent-owned" : "Custodial"}</dd>
                </div>
                <div>
                  <dt>US state</dt>
                  <dd>{state}</dd>
                </div>
              </dl>
              <label className="fw-adult-check">
                <input
                  type="checkbox"
                  checked={adult}
                  onChange={(e) => setAdult(e.target.checked)}
                  required
                />
                <span>
                  I am an adult planning for my family. Saving this plan does
                  not open an account or place an order.
                </span>
              </label>
              {saved && (
                <div className="fw-plan-saved">
                  <CheckCircle2 size={18} />
                  <span>Saved in your family workspace.</span>
                </div>
              )}
            </>
          )}
          <div className="fw-builder-actions">
            {step > 0 && (
              <button type="button" onClick={() => setStep(step - 1)}>
                <ArrowLeft size={15} /> Back
              </button>
            )}
            {step < 2 ? (
              <button
                className="fw-primary"
                disabled={step === 0 ? !validGoal : !state}
                type="submit"
              >
                {step === 0 ? "Choose ownership" : "Review your plan"}
                <ArrowRight size={16} />
              </button>
            ) : (
              <button
                className="fw-primary"
                disabled={p.busy || !validGoal || !state}
                type={p.wallet ? "submit" : "button"}
                onClick={p.wallet ? undefined : p.onConnect}
              >
                {p.wallet ? "Save my family plan" : "Connect to save a plan"}
                <Check size={16} />
              </button>
            )}
          </div>
        </form>
      </section>
      <aside className="fw-plan-preview">
        <div className="fw-plan-paper">
          <div className="fw-plan-paper-top">
            <Leaf size={19} />
            <span>YOUR FAMILY’S SOMEDAY</span>
          </div>
          <h3>{goal || "Room for a big little dream."}</h3>
          <strong>
            {parsed !== null ? money(parsed) : "Your target"}
            <small>
              {parsed !== null ? "Target amount" : "Add a goal to begin"}
            </small>
          </strong>
          <div className="fw-timeline">
            <span />
            <i />
            <i />
            <i />
            <Leaf size={19} />
          </div>
          <div className="fw-timeline-labels">
            <span>Today</span>
            <span>{horizon} years from now</span>
          </div>
          <div className="fw-preview-details">
            <span>
              {account === "parent"
                ? "Parent-owned account"
                : "Custodial account"}
            </span>
            <span>{state || "State not selected"}</span>
          </div>
          <img src={image(p, "/art/hero-botanical-white.png")} alt="" />
        </div>
        {saved && (
          <div className="fw-saved-actions">
            <button onClick={p.onDownloadPlan}>
              <Download size={15} /> Download saved plan
            </button>
            <button
              className="fw-text"
              disabled={p.busy}
              onClick={() => {
                if (deleting) p.onDeletePlan();
                else setDeleting(true);
              }}
            >
              {deleting ? "Confirm delete saved plan" : "Delete saved plan"}
            </button>
          </div>
        )}
        <section className="fw-provider-note">
          <span>
            <LockKeyhole size={16} />
            {p.provider
              ? "Provider website available"
              : "Trading is not connected"}
          </span>
          <p>
            {p.provider
              ? `Review ${p.provider.name} and its terms. Visiting the provider does not open or link an account.`
              : "You can save your plan today. US account opening, deposits and trading remain unavailable until a provider is connected."}
          </p>
          {p.provider && (
            <a href={p.provider.disclosureUrl} target="_blank" rel="noreferrer">
              Provider disclosures ↗
            </a>
          )}
          <button
            disabled={
              !saved ||
              !p.provider ||
              !p.provider.states.includes(saved.state) ||
              p.busy
            }
            onClick={p.onProvider}
          >
            Review provider website <ArrowUpRight size={14} />
          </button>
        </section>
      </aside>
    </div>
  );
}
