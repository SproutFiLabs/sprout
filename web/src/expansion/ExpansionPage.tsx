import { useState, useEffect, type ReactNode } from "react";
import {
  ArrowUpRight,
  ArrowRight,
  ArrowDownLeft,
  Plus,
  Gift,
  Coins,
  Leaf,
  ShieldCheck,
  GraduationCap,
  Check,
  Lock,
  Wallet,
  ChevronRight,
  RefreshCw,
  Copy,
  Download,
  Play,
  Pause,
  X,
  CalendarDays,
  Users,
  CheckCircle2,
  ArrowLeft,
} from "lucide-react";
import { keccak256, toBytes } from "viem";
import {
  arenaReadiness,
  arenaValue,
  roundupDelta,
  ZERO_ADDRESS,
  type ExpansionPage as Page,
  type GrowthEvent,
  type MatchView,
} from "@sprout/shared";
import { encodeQr, qrToSvg } from "../qr";
function GiftQr({ url, size }: { url: string; size: number }) {
  const svg = qrToSvg(encodeQr(url, "Q"), {
    title: "Scan to open the celebration",
  });
  return (
    <a
      href={`data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`}
      download="sprout-celebration-qr.svg"
      aria-label="Download celebration QR code"
    >
      <img
        width={size}
        height={size}
        src={`data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`}
        alt="Celebration QR code"
      />
    </a>
  );
}
import {
  useExpansion,
  request,
  money,
  short,
  date,
  type ExpansionRuntime,
} from "./runtime";
import "./expansion.css";
const pages = [
  {
    id: "events",
    label: "Events & Match",
    icon: Gift,
    kicker: "GROW TOGETHER",
    title: (
      <>
        Every celebration.
        <br />
        <em>A bigger tomorrow.</em>
      </>
    ),
    body: "Bring your people together around the future you’re growing.",
  },
  {
    id: "roundups",
    label: "Round-ups",
    icon: Coins,
    kicker: "SMALL CHANGE, STEADY HABITS",
    title: (
      <>
        A little here.
        <br />
        <em>A little further.</em>
      </>
    ),
    body: "Turn the spare change from wallet transfers into a family saving habit.",
  },
  {
    id: "cash",
    label: "Cash Garden",
    icon: Leaf,
    kicker: "GIVE IDLE CASH A PURPOSE",
    title: (
      <>
        Between investments,
        <br />
        <em>keep growing.</em>
      </>
    ),
    body: "An optional home for eligible cash while your next investment gets ready.",
  },
  {
    id: "arena",
    label: "Teen Arena",
    icon: GraduationCap,
    kicker: "CONFIDENCE COMES WITH PRACTICE",
    title: (
      <>
        Big ideas.
        <br />
        <em>A safe place to try.</em>
      </>
    ),
    body: "A practice version of your family portfolio. Real lessons, pretend money.",
  },
  {
    id: "continuity",
    label: "Continuity",
    icon: ShieldCheck,
    kicker: "CARE THAT CARRIES ON",
    title: (
      <>
        Your plan.
        <br />
        <em>Still looking after them.</em>
      </>
    ),
    body: "Choose who can keep your child’s plan moving if you become unavailable.",
  },
] as const;
export function Panel({
  title,
  eyebrow,
  children,
  className = "",
  action,
}: {
  title: string;
  eyebrow?: string;
  children: ReactNode;
  className?: string;
  action?: ReactNode;
}) {
  return (
    <section className={`gx-panel ${className}`}>
      <div className="gx-panel-head">
        <div>
          {eyebrow && <span className="gx-eyebrow">{eyebrow}</span>}
          <h2>{title}</h2>
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}
export function Field({
  label,
  children,
  hint,
}: {
  label: string;
  children: ReactNode;
  hint?: string;
}) {
  return (
    <label className="gx-field">
      <span>{label}</span>
      {children}
      {hint && <small>{hint}</small>}
    </label>
  );
}
export function Amount({
  label,
  value,
  set,
  min = 1,
}: {
  label: string;
  value: string;
  set: (v: string) => void;
  min?: number;
}) {
  return (
    <Field label={label}>
      <span className="gx-input-money">
        <span>$</span>
        <input
          type="number"
          min={min}
          step="0.01"
          required
          value={value}
          onChange={(e) => set(e.target.value)}
        />
      </span>
    </Field>
  );
}
function Metric({
  label,
  value,
  note,
}: {
  label: string;
  value: ReactNode;
  note: string;
}) {
  return (
    <div className="gx-metric">
      <span>{label}</span>
      <strong>{value}</strong>
      <small>{note}</small>
    </div>
  );
}
function Empty({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="gx-empty">
      <Leaf size={30} />
      <h3>{title}</h3>
      <p>{children}</p>
    </div>
  );
}
function Progress({ value, label }: { value: number; label: string }) {
  return (
    <div
      className="gx-progress"
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(Math.min(100, Math.max(0, value)))}
    >
      <span style={{ width: `${Math.min(100, Math.max(0, value))}%` }} />
    </div>
  );
}
function Button({
  children,
  onClick,
  secondary = false,
  disabled = false,
  type = "button",
}: {
  children: ReactNode;
  onClick?: () => void;
  secondary?: boolean;
  disabled?: boolean;
  type?: "button" | "submit";
}) {
  return (
    <button
      type={type}
      className={`gx-button ${secondary ? "secondary" : ""}`}
      disabled={disabled}
      onClick={onClick}
    >
      {children}
    </button>
  );
}
function Botanical({ page }: { page: Page }) {
  return (
    <div className={`gx-botanical ${page}`} aria-hidden="true">
      <div className="gx-orbit" />
      <img src={"/art/dashboard/hero-bouquet.png"} alt="" />
      <span className="gx-float">
        <Leaf size={17} />
        {page === "continuity"
          ? "Rooted in care"
          : page === "arena"
            ? "Room to learn"
            : "Made for tomorrow"}
      </span>
      <span className="gx-spark">✳</span>
    </div>
  );
}
export function ExpansionPage({ page = "events" }: { page?: Page }) {
  const r = useExpansion();
  const p = pages.find((x) => x.id === page)!;
  return (
    <div className={`gx-app gx-${page}`}>
      <header className="gx-header">
        <a href="/" className="gx-brand" aria-label="Sprout home">
          <Leaf size={30} strokeWidth={1.4} />
          <strong>sprout</strong>
        </a>
        <nav aria-label="Main">
          <a href="/app">My garden</a>
          <a href="/grow/events" aria-current="page">
            Grow together
          </a>
          <a href="/guide">
            Field notes <ArrowUpRight size={13} />
          </a>
        </nav>
        <div className="gx-header-right">
          {r.wallet ? (
            <>
              <span className="gx-wallet">
                <span />
                {short(r.wallet.address)}
              </span>
              <button
                className="gx-icon"
                aria-label="Lock family workspace"
                onClick={r.disconnect}
              >
                <Lock size={17} />
              </button>
            </>
          ) : (
            <Button
              disabled={!!r.busy}
              onClick={() =>
                void r.run(
                  "Connecting",
                  () => r.connect(),
                  "Your family workspace is open.",
                )
              }
            >
              <Wallet size={16} /> Connect wallet
            </Button>
          )}
        </div>
      </header>
      <div className="gx-frame">
        <aside className="gx-sidebar">
          <span className="gx-eyebrow">YOUR GROWING WORLD</span>
          <nav aria-label="Growth features">
            {pages.filter((x) => ["events", "roundups", "cash", "arena"].includes(x.id)).map((x) => (
              <a
                key={x.id}
                href={`/grow/${x.id}${r.state?.chain ? `?vault=${r.state.chain.vault}` : ""}`}
                aria-current={x.id === page ? "page" : undefined}
              >
                <x.icon size={19} />
                {x.label}
                {x.id === page && <ChevronRight size={15} />}
              </a>
            ))}
          </nav>
          <div className="gx-sidebar-note">
            <img src="/art/dashboard/sidebar-branch.png" alt="" />
            <h3>
              Good things
              <br />
              take a little care.
            </h3>
            <p>
              Small habits. Shared moments.
              <br />A future that feels like yours.
            </p>
            <a href="/guide">
              The Sprout way <ArrowUpRight size={14} />
            </a>
          </div>
          <div className="gx-private">
            <Lock size={14} />
            <span>
              Family records are private.
              <br />
              Chain transactions are public.
            </span>
          </div>
        </aside>
        <main className="gx-main">
          <div className="gx-topline">
            <div>
              My garden <ChevronRight size={12} /> <b>{p.label}</b>
            </div>
            <div>
              {r.config?.local && (
                <span className="gx-tag local">
                  Local practice · test funds
                </span>
              )}
              {r.state?.chain && (
                <button
                  className="gx-icon"
                  aria-label="Refresh workspace"
                  disabled={!!r.busy}
                  onClick={() =>
                    void r.run(
                      "Refreshing",
                      r.refresh,
                      "Updated from the chain.",
                    )
                  }
                >
                  <RefreshCw size={15} />
                </button>
              )}
            </div>
          </div>
          <section className="gx-hero">
            <div>
              <span className="gx-eyebrow">{p.kicker}</span>
              <h1>{p.title}</h1>
              <p>{p.body}</p>
            </div>
            <Botanical page={page} />
          </section>
          {r.local?.enabled && (
            <div className="gx-local-controls">
              <span>Practice family</span>
              {r.local.accounts.slice(0, 3).map((a) => (
                <button
                  key={a.address}
                  disabled={!!r.busy}
                  aria-pressed={
                    r.wallet?.address.toLowerCase() === a.address.toLowerCase()
                  }
                  onClick={() =>
                    void r.run(
                      "Opening practice wallet",
                      () => r.connect(a.address),
                      `${a.label} wallet connected.`,
                    )
                  }
                >
                  {a.role === "parent"
                    ? "Parent"
                    : a.role === "beneficiary"
                      ? "Teen"
                      : "Family sponsor"}
                </button>
              ))}
            </div>
          )}
          {r.error && (
            <div className="gx-notice error" role="alert">
              <X size={17} />
              {r.error.slice(0, 350)}
            </div>
          )}
          {r.busy ? (
            <div className="gx-notice" role="status">
              <span className="gx-spinner" />
              {r.busy}…
            </div>
          ) : (
            r.notice && (
              <div className="gx-notice" role="status">
                <CheckCircle2 size={17} />
                {r.notice}
              </div>
            )
          )}
          {!r.config ? (
            <div className="gx-skeleton" aria-label="Loading workspace" />
          ) : !r.config.enabled ? (
            <Empty title="A new chapter is taking root">
              This deployment has not enabled the new vault features yet. Your
              existing garden is available from My garden.
            </Empty>
          ) : !r.wallet ? (
            <Panel
              title="Your family’s next chapter starts here"
              eyebrow="WELCOME TO GROW"
            >
              <div className="gx-welcome">
                <p>
                  Connect your wallet to bring celebrations, saving habits and a
                  thoughtful backup plan together.
                </p>
                <Button
                  onClick={() => void r.run("Connecting", () => r.connect())}
                >
                  Open family workspace <ArrowRight size={17} />
                </Button>
              </div>
            </Panel>
          ) : !r.state?.chain ? (
            <Empty
              title={
                r.busy ? "Opening your garden…" : "Plant a new sprout to begin"
              }
            >
              These features use a new, opt-in vault.{" "}
              <a href="/app">Open My garden</a> to create one on the configured
              expansion factory.
            </Empty>
          ) : !r.config.flags[page] ? (
            <Empty title="This feature is resting">
              It is not enabled for this deployment.
            </Empty>
          ) : (
            <fieldset className="gx-workspace" disabled={!!r.busy}>
              {page === "events" ? <Events r={r} /> : page === "roundups" ? <Roundups r={r} /> : page === "cash" ? <Cash r={r} /> : <Arena r={r} />}
            </fieldset>
          )}
          <footer className="gx-footer">
            <span>Small beginnings. Meaningful futures.</span>
            <span>
              SPROUT <Leaf size={13} />
            </span>
          </footer>
        </main>
      </div>
    </div>
  );
}
function Events({ r }: { r: ExpansionRuntime }) {
  const s = r.state!.chain!,
    events = r.state!.events;
  const [creating, setCreating] = useState(false),
    [title, setTitle] = useState("A birthday, a bigger future"),
    [goal, setGoal] = useState("1000"),
    [kind, setKind] = useState<GrowthEvent["kind"]>("birthday"),
    [days, setDays] = useState("30"),
    [wall, setWall] = useState(false),
    [selected, setSelected] = useState<string | null>(null),
    [budget, setBudget] = useState("300"),
    [cap, setCap] = useState("50"),
    [periods, setPeriods] = useState("6"),
    [contribution, setContribution] = useState("25");
  const parent = r.wallet!.address.toLowerCase() === s.parent.toLowerCase();
  const total = events.reduce((a, e) => a + e.raisedCents, 0),
    matched = s.matches.reduce((a, m) => a + m.matchedCents, 0);
  const event = events.find((e) => e.id === selected) ?? events[0];
  return (
    <>
      <div className="gx-metrics">
        <Metric
          label="Gifts for their future"
          value={money(total)}
          note={`${events.length} family celebration${events.length === 1 ? "" : "s"}`}
        />
        <Metric
          label="A little extra love"
          value={money(matched)}
          note="Confirmed sponsor matching"
        />
        <Metric
          label="Ready to match"
          value={money(
            s.matches
              .filter((m) => !m.cancelled && m.expires > s.now)
              .reduce((n, m) => n + m.remainingCents, 0),
          )}
          note="Already funded by your circle"
        />
      </div>
      <div className="gx-columns">
        <div className="gx-stack">
          <Panel
            title="Moments worth growing"
            eyebrow="YOUR CELEBRATIONS"
            action={
              parent && (
                <Button secondary onClick={() => setCreating(!creating)}>
                  {creating ? <X size={15} /> : <Plus size={15} />}{" "}
                  {creating ? "Close" : "Create event"}
                </Button>
              )
            }
          >
            {creating && (
              <form
                className="gx-form gx-inset"
                onSubmit={(e) => {
                  e.preventDefault();
                  void r.run(
                    "Creating your celebration",
                    async () => {
                      const next = await request<GrowthEvent>("/events", {
                        vault: s.vault,
                        title,
                        kind,
                        goalCents: Math.round(Number(goal) * 100),
                        endsAt: Date.now() + Number(days) * 86400000,
                        publicWall: wall,
                      });
                      setSelected(next.id);
                      setCreating(false);
                    },
                    "Your celebration is ready to share.",
                  );
                }}
              >
                <Field label="Give the moment a name">
                  <input
                    required
                    maxLength={70}
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                  />
                </Field>
                <div className="gx-form-row">
                  <Field label="Occasion">
                    <select
                      value={kind}
                      onChange={(e) =>
                        setKind(e.target.value as GrowthEvent["kind"])
                      }
                    >
                      <option value="birthday">Birthday</option>
                      <option value="baby-shower">Baby shower</option>
                      <option value="graduation">Graduation</option>
                      <option value="milestone">Milestone</option>
                    </select>
                  </Field>
                  <Amount label="Shared goal" value={goal} set={setGoal} />
                  <Field label="Days to celebrate">
                    <input
                      type="number"
                      min="1"
                      max="365"
                      required
                      value={days}
                      onChange={(e) => setDays(e.target.value)}
                    />
                  </Field>
                </div>
                <label className="gx-check">
                  <input
                    type="checkbox"
                    checked={wall}
                    onChange={(e) => setWall(e.target.checked)}
                  />{" "}
                  Let guests opt into a public wish wall
                </label>
                <small>
                  Anyone with the link can see the event title, goal and vault
                  address.
                </small>
                <Button type="submit">
                  Create celebration <ArrowRight size={16} />
                </Button>
              </form>
            )}
            {!events.length ? (
              <Empty title="Make a moment mean more">
                Create your first celebration and invite loved ones to gift
                toward a shared goal.
              </Empty>
            ) : (
              <>
                <div className="gx-event-tabs">
                  {events.map((e) => (
                    <button
                      key={e.id}
                      aria-pressed={e.id === event?.id}
                      onClick={() => setSelected(e.id)}
                    >
                      {e.title}
                    </button>
                  ))}
                </div>
                {event && (
                  <div className="gx-celebration">
                    <div className="gx-event-art">
                      <img src="/art/card-orange.png" alt="" />
                      <span className="gx-tag">
                        {event.closed ? "Closed" : date(event.endsAt)}
                      </span>
                    </div>
                    <div className="gx-event-info">
                      <span className="gx-eyebrow">
                        {event.kind.replace("-", " ")}
                      </span>
                      <h3>{event.title}</h3>
                      <div className="gx-goal">
                        <strong>{money(event.raisedCents)}</strong>
                        <span>of {money(event.goalCents)} together</span>
                      </div>
                      <Progress
                        value={(event.raisedCents / event.goalCents) * 100}
                        label="Celebration funding"
                      />
                      <div className="gx-between">
                        <span>{event.guests.length} shared wishes</span>
                        <span>
                          {Math.min(
                            100,
                            Math.round(
                              (event.raisedCents / event.goalCents) * 100,
                            ),
                          )}
                          % of goal
                        </span>
                      </div>
                      <div className="gx-actions">
                        <Button
                          secondary
                          onClick={() =>
                            void r.run(
                              "Copying invitation",
                              () =>
                                navigator.clipboard.writeText(
                                  `${location.origin}/celebrate/${event.id}`,
                                ),
                              "Invitation copied. Share it with your circle.",
                            )
                          }
                        >
                          <Copy size={14} /> Copy invite
                        </Button>
                        <a
                          className="gx-text-link"
                          href={`/celebrate/${event.id}`}
                        >
                          Open gift page <ArrowUpRight size={15} />
                        </a>
                        {parent && !event.closed && (
                          <button
                            className="gx-text-link"
                            onClick={() =>
                              void r.run(
                                "Closing event",
                                () => request(`/events/${event.id}/close`, {}),
                                "This event is closed to new gifts.",
                              )
                            }
                          >
                            Close event
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                )}
                {event && (
                  <div className="gx-wishes">
                    <div>
                      <h3>A wish for the years ahead</h3>
                      <p>
                        {event.publicWall
                          ? "Messages guests chose to share with everyone who has the link."
                          : "Your wish wall is private. Guests can send their gift without a public message."}
                      </p>
                      {event.guests.slice(-3).map((g, i) => (
                        <blockquote key={i}>
                          “{g.message}”<cite>With love, {g.alias}</cite>
                        </blockquote>
                      ))}
                    </div>
                    <GiftQr
                      url={`${location.origin}/celebrate/${event.id}`}
                      size={94}
                    />
                  </div>
                )}
              </>
            )}
          </Panel>
          <Panel title="Grow it together" eyebrow="PARENT CONTRIBUTIONS">
            <form
              className="gx-inline-form"
              onSubmit={(e) => {
                e.preventDefault();
                void r.run(
                  "Contributing and applying eligible matches",
                  () =>
                    r.send(s.vault, "fund", {
                      amountCents: Math.round(Number(contribution) * 100),
                    }),
                  "Contribution confirmed. Eligible sponsor matches were applied automatically.",
                );
              }}
            >
              <div>
                <h3>One contribution. A little more possibility.</h3>
                <p>
                  Active sponsors match parent deposits, up to their individual
                  monthly caps.
                </p>
              </div>
              <Amount
                label="Your contribution"
                value={contribution}
                set={setContribution}
              />
              <Button type="submit" disabled={!parent}>
                Contribute <ArrowRight size={16} />
              </Button>
            </form>
          </Panel>
        </div>
        <div className="gx-stack">
          <Panel
            title="Make their kindness go further"
            eyebrow="SPONSOR A MATCH"
            className="gx-mint"
          >
            <div className="gx-match-symbol">
              <span>$1</span>
              <Plus size={20} />
              <span>$1</span>
              <ArrowRight size={20} />
              <b>$2</b>
            </div>
            <p>
              A funded commitment matches the parent’s contributions. Unused
              funds stay yours to cancel and reclaim.
            </p>
            <form
              className="gx-form"
              onSubmit={(e) => {
                e.preventDefault();
                void r.run(
                  "Funding the match",
                  () =>
                    r.send(s.vault, "match", {
                      budgetCents: Math.round(Number(budget) * 100),
                      capCents: Math.round(Number(cap) * 100),
                      periods: Number(periods),
                    }),
                  "Matching is live. The next parent contribution can receive a match.",
                );
              }}
            >
              <Amount
                label="Total matching budget"
                value={budget}
                set={setBudget}
              />
              <div className="gx-form-row">
                <Amount label="Cap per 30 days" value={cap} set={setCap} />
                <Field label="Periods">
                  <input
                    type="number"
                    required
                    min="1"
                    max="24"
                    value={periods}
                    onChange={(e) => setPeriods(e.target.value)}
                  />
                </Field>
              </div>
              <Button type="submit">
                Fund the match <ArrowUpRight size={16} />
              </Button>
            </form>
          </Panel>
          <Panel title="Your matching circle" eyebrow="COMMITTED, NOT PROMISED">
            {s.matches.length ? (
              s.matches.map((m) => (
                <div className="gx-match-row" key={m.id}>
                  <span className="gx-avatar">
                    <Users size={19} />
                  </span>
                  <div>
                    <b>{short(m.sponsor)}</b>
                    <small>
                      {money(m.capCents)} per 30 days · ends {date(m.expires)}
                    </small>
                    <small>
                      {m.cancelled
                        ? "Cancelled"
                        : `${money(m.remainingCents)} remaining`}
                    </small>
                  </div>
                  {!m.cancelled &&
                    m.sponsor.toLowerCase() ===
                      r.wallet?.address.toLowerCase() && (
                      <button
                        className="gx-text-link"
                        onClick={() =>
                          void r.run(
                            "Returning unused matching funds",
                            () => r.send(s.vault, "cancel-match", { id: m.id }),
                            "Unused matching funds returned to your wallet.",
                          )
                        }
                      >
                        Cancel
                      </button>
                    )}
                </div>
              ))
            ) : (
              <p>Your first sponsor can start a new family tradition.</p>
            )}
          </Panel>
        </div>
      </div>
    </>
  );
}
function Roundups({ r }: { r: ExpansionRuntime }) {
  const s = r.state!.chain!,
    rules = r.state!.roundup;
  const [step, setStep] = useState<1 | 5 | 10>(rules?.step ?? 1),
    [mult, setMult] = useState<1 | 2 | 3>(rules?.multiplier ?? 1),
    [cap, setCap] = useState(String((rules?.capCents ?? 2500) / 100)),
    [allowance, setAllowance] = useState("100"),
    [sample, setSample] = useState("4.35");
  const pending = r
      .state!.ledger.filter((x) => !x.sweepHash)
      .reduce((n, x) => n + x.roundupCents - (x.sweptCents ?? 0), 0),
    parent = r.wallet!.address.toLowerCase() === s.parent.toLowerCase();
  const settings = {
    vault: s.vault,
    step,
    multiplier: mult,
    capCents: Math.round(Number(cap) * 100),
    enabled: true,
  };
  return (
    <>
      <div className="gx-metrics">
        <Metric
          label="Saved in spare change"
          value={money(s.roundup.totalCents)}
          note="Confirmed weekly contributions"
        />
        <Metric
          label="Waiting to grow"
          value={money(
            Math.min(pending, s.roundup.capCents || settings.capCents),
          )}
          note="Queued for the next weekly sweep"
        />
        <Metric
          label="Your weekly limit"
          value={money(s.roundup.capCents || settings.capCents)}
          note={
            s.roundup.active
              ? `Next sweep ${date(s.roundup.nextSweep)}`
              : "Choose a cap that feels comfortable"
          }
        />
      </div>
      <div className="gx-columns">
        <div className="gx-stack">
          <Panel
            title="A saving habit in the background"
            eyebrow="YOUR ROUND-UP RECIPE"
            action={
              <span className={`gx-tag ${s.roundup.active ? "green" : ""}`}>
                {s.roundup.active ? "Linked" : "Not linked"}
              </span>
            }
          >
            <form
              className="gx-form"
              onSubmit={(e) => {
                e.preventDefault();
                void r.run(
                  "Saving your round-up rule",
                  async () => {
                    await r.send(s.vault, "roundup-link", {
                      capCents: settings.capCents,
                      allowanceCents: Math.round(Number(allowance) * 100),
                      expiresAt: Date.now() + 180 * 86400000,
                    });
                    await request("/roundups/settings", settings);
                  },
                  "Round-ups are linked with your chosen weekly cap.",
                );
              }}
            >
              <div className="gx-recipe">
                <div className="gx-step">
                  <span>01</span>
                  <h3>Round to the next</h3>
                  <div className="gx-segments">
                    {([1, 5, 10] as const).map((n) => (
                      <button
                        type="button"
                        key={n}
                        aria-pressed={step === n}
                        onClick={() => setStep(n)}
                      >
                        ${n}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="gx-step">
                  <span>02</span>
                  <h3>Give it a little boost</h3>
                  <div className="gx-segments">
                    {([1, 2, 3] as const).map((n) => (
                      <button
                        type="button"
                        key={n}
                        aria-pressed={mult === n}
                        onClick={() => setMult(n)}
                      >
                        {n}×
                      </button>
                    ))}
                  </div>
                </div>
              </div>
              <div className="gx-form-row">
                <Amount label="Maximum per week" value={cap} set={setCap} />
                <Amount
                  label="Total wallet allowance"
                  value={allowance}
                  set={setAllowance}
                />
              </div>
              <div className="gx-rule-summary">
                <ShieldCheck size={21} />
                <p>
                  At most <b>{money(settings.capCents)} every 7 days</b>. This
                  link expires in 180 days. The total allowance also bounds what
                  the executor can pull.
                </p>
              </div>
              <div className="gx-actions">
                <Button type="submit" disabled={!parent}>
                  {s.roundup.active ? "Update round-ups" : "Link round-ups"}{" "}
                  <ArrowRight size={16} />
                </Button>
                {s.roundup.active && (
                  <Button
                    secondary
                    disabled={!parent}
                    onClick={() =>
                      void r.run(
                        "Stopping future round-ups",
                        async () => {
                          await r.send(s.vault, "roundup-unlink");
                          await request("/roundups/settings", {
                            ...settings,
                            enabled: false,
                          });
                        },
                        "Round-ups stopped. Future pulls are blocked onchain.",
                      )
                    }
                  >
                    <Pause size={14} /> Stop round-ups
                  </Button>
                )}
              </div>
              <small>
                Tracks outgoing settlement-token transfers from this wallet.
                Bank cards and exchange accounts are not connected.
              </small>
            </form>
          </Panel>
          <Panel
            title="The little things add up"
            eyebrow="TRANSFER JOURNAL"
            action={
              <Button
                secondary
                disabled={!s.roundup.active || !parent}
                onClick={() =>
                  void r.run(
                    "Checking confirmed wallet transfers",
                    () => request("/roundups/sync", { vault: s.vault }),
                    "Transfer journal updated.",
                  )
                }
              >
                <RefreshCw size={14} /> Sync transfers
              </Button>
            }
          >
            <div className="gx-table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Wallet transfer</th>
                    <th>Amount</th>
                    <th>Round-up</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {r.state!.ledger.slice(0, 8).map((x) => (
                    <tr key={x.id}>
                      <td>
                        <span className="gx-table-icon">
                          <ArrowUpRight size={15} />
                        </span>
                        <b>{short(x.txHash)}</b>
                        <small>{date(x.at)}</small>
                      </td>
                      <td>{money(x.amountCents)}</td>
                      <td className="gx-positive">+{money(x.roundupCents)}</td>
                      <td>
                        <span className="gx-tag">
                          {x.sweepHash ? "Contributed" : "Queued"}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {!r.state!.ledger.length && (
              <Empty title="Your first little contribution is ahead">
                Once linked, confirmed wallet transfers will appear here. Exact
                multiples have no round-up.
              </Empty>
            )}
          </Panel>
        </div>
        <div className="gx-stack">
          <Panel
            title="Try a little change"
            eyebrow="THE EVERYDAY MATH"
            className="gx-lavender"
          >
            <div className="gx-coin-art" aria-hidden="true">
              <Coins size={82} strokeWidth={1} />
              <span>+</span>
            </div>
            <Amount
              label="Example wallet transfer"
              value={sample}
              set={setSample}
              min={0}
            />
            <div className="gx-calculation">
              <div>
                <span>Transfer</span>
                <b>
                  {money(Math.max(0, Math.round(Number(sample) * 100)) || 0)}
                </b>
              </div>
              <div>
                <span>Round-up × {mult}</span>
                <b>
                  {money(
                    roundupDelta(
                      Math.max(0, Math.round(Number(sample) * 100)) || 0,
                      step,
                      mult,
                    ),
                  )}
                </b>
              </div>
              <div>
                <span>Added to the weekly queue</span>
                <strong>
                  {money(
                    roundupDelta(
                      Math.max(0, Math.round(Number(sample) * 100)) || 0,
                      step,
                      mult,
                    ),
                  )}
                </strong>
              </div>
            </div>
            <small>
              Interactive example. Only confirmed transfers contribute to your
              actual journal.
            </small>
          </Panel>
          <Panel title="You set the pace" eyebrow="ALWAYS YOUR CALL">
            <div className="gx-timeline">
              <div>
                <Check size={16} />
                <span>
                  <b>A clear weekly limit</b>
                  <small>Set directly in the round-up contract.</small>
                </span>
              </div>
              <div>
                <Check size={16} />
                <span>
                  <b>Stop with one transaction</b>
                  <small>Unlinking blocks any future pull.</small>
                </span>
              </div>
              <div>
                <Check size={16} />
                <span>
                  <b>No rounding twice</b>
                  <small>Each transfer is recorded once.</small>
                </span>
              </div>
            </div>
          </Panel>
        </div>
      </div>
    </>
  );
}
function Cash({ r }: { r: ExpansionRuntime }) {
  const s = r.state!.chain!,
    [amount, setAmount] = useState("100"),
    [redeem, setRedeem] = useState("25");
  const eligible = s.cash.available && s.cash.permitted && s.cash.policyFresh;
  const parent =
    r.wallet!.address.toLowerCase() === s.parent.toLowerCase() ||
    (s.continuity.active &&
      r.wallet!.address.toLowerCase() === s.continuity.successor.toLowerCase());
  return (
    <>
      <div className="gx-metrics">
        <Metric
          label="Ready for the next step"
          value={money(s.availableCents)}
          note="Available settlement cash"
        />
        <Metric
          label="Cash in the garden"
          value={money(s.cash.valueCents)}
          note={
            r.config!.local
              ? "Test treasury · current asset value"
              : "Current redeemable share value"
          }
        />
        <Metric
          label="Treasury connection"
          value={
            <span className="gx-status-value">
              {eligible ? "Ready" : "Cash fallback"}
            </span>
          }
          note={
            s.cash.navAt
              ? `NAV checked ${date(s.cash.navAt)}`
              : "Cash remains in the settlement token"
          }
        />
      </div>
      <div className="gx-columns">
        <div className="gx-stack">
          <Panel
            title="A thoughtful place between purchases"
            eyebrow="HOW YOUR CASH MOVES"
          >
            <div className="gx-cash-journey">
              <div>
                <Wallet size={30} />
                <h3>Cash arrives</h3>
                <p>
                  Gifts and contributions
                  <br />
                  land in the vault.
                </p>
              </div>
              <ArrowRight />
              <div className="active">
                <Leaf size={34} />
                <h3>Park what’s idle</h3>
                <p>
                  Eligible cash receives
                  <br />
                  treasury shares.
                </p>
              </div>
              <ArrowRight />
              <div>
                <ArrowUpRight size={32} />
                <h3>Ready to invest</h3>
                <p>
                  Redeem back to cash
                  <br />
                  when the plan needs it.
                </p>
              </div>
            </div>
            <div className="gx-rule-summary">
              <ShieldCheck size={23} />
              <p>
                New parking requires an eligible vault and a current treasury
                check. If those checks fail, new cash stays in the settlement
                token.
              </p>
            </div>
          </Panel>
          <Panel
            title="Your cash, with a clear view"
            eyebrow="TREASURY DETAILS"
          >
            <div className="gx-detail-row">
              <span>Integration</span>
              <b>
                {s.cash.available
                  ? r.config!.local
                    ? "Local practice treasury"
                    : "Approved treasury"
                  : "No approved treasury connected"}
              </b>
            </div>
            <div className="gx-detail-row">
              <span>Vault eligibility</span>
              <b>{s.cash.permitted ? "Permitted" : "Not confirmed"}</b>
            </div>
            <div className="gx-detail-row">
              <span>Price freshness</span>
              <b>
                {s.cash.policyFresh ? "Within policy window" : "Parking paused"}
              </b>
            </div>
            <div className="gx-detail-row">
              <span>Cash parking permission</span>
              <b>{s.cash.enabled ? "Enabled" : "Off"}</b>
            </div>
            <div className="gx-detail-row">
              <span>Investment reserve</span>
              <b>Scheduled purchases are funded before parking</b>
            </div>
            <p className="gx-footnote">
              {r.config!.local
                ? "This local treasury uses test tokens. Its value changes only when test assets are added or removed."
                : "Treasury values and redemption availability depend on the provider. Returns are variable and losses are possible."}{" "}
              No projected APY is shown.
            </p>
          </Panel>
        </div>
        <div className="gx-stack">
          <Panel
            title="Give idle cash a place"
            eyebrow="CASH PARKING"
            className="gx-mint"
          >
            <div className="gx-leaf-art">
              <img src="/art/dashboard/sidebar-branch.png" alt="" />
            </div>
            <p>
              Choose how much available cash to park. Milestone commitments and
              your continuity reserve stay protected.
            </p>
            <form
              className="gx-form"
              onSubmit={(e) => {
                e.preventDefault();
                void r.run(
                  "Parking eligible cash",
                  async () => {
                    if (!s.cash.enabled)
                      await r.send(s.vault, "cash-toggle", { enabled: true });
                    await r.send(s.vault, "park", {
                      amountCents: Math.round(Number(amount) * 100),
                    });
                  },
                  "Cash parked. Treasury shares are held in your family vault.",
                );
              }}
            >
              <Amount label="Amount to park" value={amount} set={setAmount} />
              <Button disabled={!eligible || !parent} type="submit">
                Park cash <Leaf size={17} />
              </Button>
            </form>
            {!eligible && (
              <p className="gx-footnote">
                Your cash is available in the settlement token until an eligible
                treasury is connected.
              </p>
            )}
            {s.cash.enabled && (
              <button
                className="gx-text-link"
                disabled={!parent}
                onClick={() =>
                  void r.run(
                    "Pausing new cash parking",
                    () => r.send(s.vault, "cash-toggle", { enabled: false }),
                    "New parking is off. Existing shares can still be redeemed.",
                  )
                }
              >
                Pause new parking
              </button>
            )}
          </Panel>
          <Panel title="Bring it back to cash" eyebrow="REDEEM TO YOUR VAULT">
            <form
              className="gx-form"
              onSubmit={(e) => {
                e.preventDefault();
                void r.run(
                  "Redeeming treasury shares",
                  () =>
                    r.send(s.vault, "unpark", {
                      amountCents: Math.round(Number(redeem) * 100),
                    }),
                  "Treasury assets returned to your vault as settlement cash.",
                );
              }}
            >
              <Amount label="Amount to redeem" value={redeem} set={setRedeem} />
              <Button
                secondary
                type="submit"
                disabled={!parent || s.cash.valueCents === 0}
              >
                Return to cash <ArrowDownLeft size={16} />
              </Button>
            </form>
            <small>Assets return directly to this vault.</small>
          </Panel>
        </div>
      </div>
    </>
  );
}
function Arena({ r }: { r: ExpansionRuntime }) {
  const s = r.state!.chain!,
    a = r.state!.arena;
  const [symbol, setSymbol] = useState(s.market[0]?.symbol ?? ""),
    [side, setSide] = useState<"buy" | "sell">("buy"),
    [quantity, setQuantity] = useState("1"),
    [lesson, setLesson] = useState<{
      id: string;
      title: string;
      question: string;
      choices: string[];
    } | null>(null),
    [lessonResult, setLessonResult] = useState(""),
    [replay, setReplay] = useState<{
      cashCents: number;
      holdings: Record<string, number>;
      fills: unknown[];
    } | null>(null),
    [steps, setSteps] = useState("0"),
    [leagueTitle, setLeagueTitle] = useState("The Sunday Club"),
    [alias, setAlias] = useState("Garden explorer"),
    [invite, setInvite] = useState(""),
    [days, setDays] = useState(String(a?.unlockDays ?? 30));
  const readiness = a ? arenaReadiness(a) : 0,
    parent = r.wallet!.address.toLowerCase() === s.parent.toLowerCase();
  async function openLesson() {
    const ls = await request<
      Array<{
        id: string;
        title: string;
        question: string;
        choices: string[];
      }>
    >("/arena/lessons");
    setLesson(ls.find((x) => !a?.lessons.includes(x.id)) ?? ls[0] ?? null);
    setLessonResult("");
  }
  return (
    <>
      <div className="gx-metrics">
        <Metric
          label="Practice portfolio"
          value={money(
            a
              ? arenaValue(a, s.market)
              : s.balanceCents +
                  s.market.reduce(
                    (n, m) =>
                      n + Math.floor((m.priceCents * m.quantityMicros) / 1e6),
                    0,
                  ),
          )}
          note={
            a
              ? `Mirrored at block ${a.snapshotBlock}`
              : "Ready to mirror your family garden"
          }
        />
        <Metric
          label="Practice cash"
          value={money(a?.cashCents ?? s.balanceCents)}
          note="Pretend money · no real trades"
        />
        <Metric
          label="Learning readiness"
          value={`${readiness}%`}
          note={`${a?.practiceDays.length ?? 0} practice days · ${a?.lessons.length ?? 0}/4 lessons`}
        />
      </div>
      {!a ? (
        <Panel
          title="A familiar portfolio. A fresh place to learn."
          eyebrow="YOUR FIRST PRACTICE SEASON"
        >
          <div className="gx-welcome">
            <p>
              Start with a snapshot of your family’s holdings and cash. Explore
              buy and sell decisions without changing the real vault.
            </p>
            <Button
              onClick={() =>
                void r.run(
                  "Mirroring the family portfolio",
                  () => request("/arena/start", { vault: s.vault }),
                  "Your practice season is open. Your real savings are unchanged.",
                )
              }
            >
              <Play size={16} /> Start practice season
            </Button>
          </div>
        </Panel>
      ) : (
        <div className="gx-columns">
          <div className="gx-stack">
            <Panel
              title="Your practice garden"
              eyebrow="EXPLORE, TRY, LEARN"
              action={<span className="gx-tag lavender">Practice mode</span>}
            >
              <div className="gx-table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>In your garden</th>
                      <th>Reference price</th>
                      <th>Practice shares</th>
                      <th>Value</th>
                    </tr>
                  </thead>
                  <tbody>
                    {s.market.map((m, i) => (
                      <tr key={m.address}>
                        <td>
                          <span className={`gx-asset-icon a${i}`}>
                            {m.symbol.slice(0, 1)}
                          </span>
                          <b>{m.symbol}</b>
                          <small>{m.name}</small>
                        </td>
                        <td>
                          {money(m.priceCents)}
                          <small>
                            {m.status === "open"
                              ? "Practice trading open"
                              : m.status === "closed"
                                ? "Market closed"
                                : "Price unavailable"}
                          </small>
                        </td>
                        <td>
                          {((a.holdings[m.symbol] ?? 0) / 1e6).toLocaleString(
                            undefined,
                            { maximumFractionDigits: 4 },
                          )}
                        </td>
                        <td>
                          {money(
                            Math.floor(
                              ((a.holdings[m.symbol] ?? 0) * m.priceCents) /
                                1e6,
                            ),
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="gx-practice-note">
                <Leaf size={19} />
                <span>
                  The best return here is understanding what you’re doing.
                </span>
              </div>
            </Panel>
            <Panel
              title="Look back. Learn forward."
              eyebrow="YOUR DECISION JOURNAL"
              action={
                <button
                  className="gx-text-link"
                  onClick={() =>
                    void r.run(
                      "Exporting practice history",
                      async () => {
                        const ledger = await request(
                          `/arena/export?vault=${s.vault}`,
                        );
                        const url = URL.createObjectURL(
                          new Blob([JSON.stringify(ledger, null, 2)], {
                            type: "application/json",
                          }),
                        );
                        const link = document.createElement("a");
                        link.href = url;
                        link.download = "sprout-practice-ledger.json";
                        link.click();
                        setTimeout(() => URL.revokeObjectURL(url), 1000);
                      },
                      "Practice ledger downloaded.",
                    )
                  }
                >
                  <Download size={14} /> Export
                </button>
              }
            >
              {a.fills.length ? (
                <>
                  <div className="gx-fills">
                    {a.fills
                      .slice(-4)
                      .reverse()
                      .map((f) => (
                        <div key={f.id}>
                          <span className="gx-table-icon">
                            {f.side === "buy" ? (
                              <Plus size={15} />
                            ) : (
                              <ArrowUpRight size={15} />
                            )}
                          </span>
                          <span>
                            <b>
                              {f.side === "buy" ? "Bought" : "Sold"}{" "}
                              {f.quantityMicros / 1e6} {f.symbol}
                            </b>
                            <small>
                              {date(f.at)} · {money(f.priceCents)} per share
                            </small>
                          </span>
                          <strong>
                            {f.side === "buy" ? "−" : "+"}
                            {money(f.costCents)}
                          </strong>
                        </div>
                      ))}
                  </div>
                  <form
                    className="gx-replay"
                    onSubmit={(e) => {
                      e.preventDefault();
                      void r.run(
                        "Replaying your decisions",
                        async () =>
                          setReplay(
                            await request(
                              `/arena/replay?vault=${s.vault}&steps=${steps}`,
                            ),
                          ),
                        "Replay rebuilt from the original snapshot and recorded fills.",
                      );
                    }}
                  >
                    <Field
                      label={`Replay the first ${steps} of ${a.fills.length} decisions`}
                    >
                      <input
                        type="range"
                        min="0"
                        max={a.fills.length}
                        value={steps}
                        onChange={(e) => setSteps(e.target.value)}
                      />
                    </Field>
                    <Button secondary type="submit">
                      <Play size={14} /> Replay
                    </Button>
                  </form>
                  {replay && (
                    <div className="gx-rule-summary">
                      <span>
                        At decision {replay.fills.length}:{" "}
                        <b>{money(replay.cashCents)} cash</b>
                        {Object.entries(replay.holdings).map(
                          ([sym, q]) => ` · ${q / 1e6} ${sym}`,
                        )}
                      </span>
                    </div>
                  )}
                </>
              ) : (
                <Empty title="Your decisions belong here">
                  Try your first practice trade, then replay it to see exactly
                  what changed.
                </Empty>
              )}
            </Panel>
            <Panel
              title="A small circle. A shared habit."
              eyebrow="PRIVATE LEAGUES"
            >
              <div className="gx-leagues">
                {r.state!.leagues.map((l) => (
                  <div key={l.id}>
                    <h3>
                      <Users size={18} /> {l.title}
                    </h3>
                    {l.members.map((m, i) => (
                      <div className="gx-detail-row" key={i}>
                        <span>{m.alias}</span>
                        <b>{m.score}% readiness</b>
                      </div>
                    ))}
                    {l.invite && (
                      <button
                        className="gx-text-link"
                        onClick={() =>
                          void r.run(
                            "Copying league invitation",
                            () => navigator.clipboard.writeText(l.invite!),
                            "Private invite code copied.",
                          )
                        }
                      >
                        <Copy size={13} /> Copy invite code
                      </button>
                    )}
                  </div>
                ))}
              </div>
              <form
                className="gx-form"
                onSubmit={(e) => {
                  e.preventDefault();
                  void r.run(
                    "Starting a private league",
                    () =>
                      request("/leagues", {
                        title: leagueTitle,
                        alias,
                        vault: s.vault,
                      }),
                    "Your private league is ready. Invite a small circle to learn together.",
                  );
                }}
              >
                <div className="gx-form-row">
                  <Field label="League name">
                    <input
                      required
                      maxLength={50}
                      value={leagueTitle}
                      onChange={(e) => setLeagueTitle(e.target.value)}
                    />
                  </Field>
                  <Field label="Your display name">
                    <input
                      required
                      maxLength={24}
                      value={alias}
                      onChange={(e) => setAlias(e.target.value)}
                    />
                  </Field>
                </div>
                <Button secondary type="submit">
                  <Plus size={15} /> Create private league
                </Button>
              </form>
              <form
                className="gx-join"
                onSubmit={(e) => {
                  e.preventDefault();
                  void r.run(
                    "Joining the league",
                    () =>
                      request("/leagues/join", {
                        invite,
                        alias,
                        vault: s.vault,
                      }),
                    "You joined the private league.",
                  );
                }}
              >
                <Field label="Have an invite code?">
                  <input
                    required
                    value={invite}
                    onChange={(e) => setInvite(e.target.value)}
                    placeholder="Paste your private code"
                  />
                </Field>
                <Button secondary type="submit">
                  Join <ArrowRight size={15} />
                </Button>
              </form>
            </Panel>
          </div>
          <div className="gx-stack">
            <Panel
              title="Make a practice move"
              eyebrow="YOUR NEXT DECISION"
              className="gx-lavender"
            >
              <form
                className="gx-form"
                onSubmit={(e) => {
                  e.preventDefault();
                  void r.run(
                    "Recording your practice trade",
                    () =>
                      request("/arena/order", {
                        vault: s.vault,
                        id: crypto.randomUUID(),
                        symbol,
                        side,
                        quantityMicros: Math.round(Number(quantity) * 1e6),
                      }),
                    "Practice trade recorded. Replay it in your decision journal.",
                  );
                }}
              >
                <div className="gx-segments">
                  {(["buy", "sell"] as const).map((x) => (
                    <button
                      key={x}
                      type="button"
                      aria-pressed={side === x}
                      onClick={() => setSide(x)}
                    >
                      {x === "buy" ? "Buy" : "Sell"}
                    </button>
                  ))}
                </div>
                <Field label="Choose an asset">
                  <select
                    value={symbol}
                    onChange={(e) => setSymbol(e.target.value)}
                  >
                    {s.market.map((m) => (
                      <option key={m.address} value={m.symbol}>
                        {m.symbol} · {m.name}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label="Practice shares">
                  <input
                    required
                    type="number"
                    min="0.000001"
                    max="1000000"
                    step="0.000001"
                    value={quantity}
                    onChange={(e) => setQuantity(e.target.value)}
                  />
                </Field>
                <div className="gx-detail-row">
                  <span>Reference value</span>
                  <b>
                    {money(
                      Math.round(
                        (s.market.find((m) => m.symbol === symbol)
                          ?.priceCents ?? 0) * Number(quantity),
                      ),
                    )}
                  </b>
                </div>
                <Button type="submit">
                  Place practice {side} <ArrowUpRight size={16} />
                </Button>
                <small>
                  Fills use the latest available reference price with a modeled
                  0.10% spread. Rounding can add a cent.
                </small>
              </form>
            </Panel>
            <Panel
              title="A little wiser, every time"
              eyebrow="YOUR LEARNING PATH"
            >
              <div className="gx-readiness">
                <strong>
                  {readiness}
                  <span>%</span>
                </strong>
                <div>
                  <b>Building confidence</b>
                  <small>{a.lessons.length} of 4 lessons complete</small>
                </div>
              </div>
              <Progress value={readiness} label="Learning readiness" />
              <div className="gx-timeline">
                <div>
                  <Check size={16} />
                  <span>
                    <b>Understand the essentials</b>
                    <small>Needs, variety, patience and risk.</small>
                  </span>
                </div>
                <div>
                  <CalendarDays size={16} />
                  <span>
                    <b>Build a repeatable habit</b>
                    <small>
                      {a.practiceDays.length} of {a.unlockDays} practice days.
                    </small>
                  </span>
                </div>
              </div>
              <Button
                secondary
                onClick={() =>
                  void r.run(
                    "Opening a field note",
                    openLesson,
                    "Your next lesson is ready.",
                  )
                }
              >
                <GraduationCap size={16} />{" "}
                {a.lessons.length === 4
                  ? "Review a lesson"
                  : "Open next lesson"}
              </Button>
              {lesson && (
                <div className="gx-lesson">
                  <span className="gx-eyebrow">{lesson.title}</span>
                  <h3>{lesson.question}</h3>
                  {lesson.choices.map((c, i) => (
                    <button
                      key={c}
                      onClick={() =>
                        void r.run(
                          "Checking your answer",
                          async () => {
                            const result = await request<{
                              correct: boolean;
                              explanation: string;
                            }>("/arena/lesson", {
                              vault: s.vault,
                              lesson: lesson.id,
                              answer: i,
                            });
                            setLessonResult(
                              `${result.correct ? "That’s right." : "Let’s think again."} ${result.explanation}`,
                            );
                          },
                          "Lesson reviewed.",
                        )
                      }
                    >
                      {c}
                    </button>
                  ))}
                  {lessonResult && <p role="status">{lessonResult}</p>}
                </div>
              )}
              {parent && (
                <form
                  className="gx-permission"
                  onSubmit={(e) => {
                    e.preventDefault();
                    void r.run(
                      "Saving the learning goal",
                      () =>
                        request("/arena/permissions", {
                          vault: s.vault,
                          days: Number(days),
                        }),
                      "Learning goal saved. Real-money permissions remain with the parent.",
                    );
                  }}
                >
                  <Field label="Parent’s practice-day goal">
                    <input
                      type="number"
                      required
                      min="7"
                      max="180"
                      value={days}
                      onChange={(e) => setDays(e.target.value)}
                    />
                  </Field>
                  <button className="gx-text-link" type="submit">
                    Save goal <ArrowRight size={14} />
                  </button>
                </form>
              )}
              <small>
                Readiness celebrates learning. It does not grant access to real
                savings.
              </small>
            </Panel>
          </div>
        </div>
      )}
    </>
  );
}
export function CelebrationPage({ id }: { id: string }) {
  const r = useExpansion(true),
    [event, setEvent] = useState<GrowthEvent | null>(null),
    [loaded, setLoaded] = useState(false),
    [amount, setAmount] = useState("25"),
    [alias, setAlias] = useState(""),
    [message, setMessage] = useState(""),
    [share, setShare] = useState(false);
  useEffect(() => {
    let alive = true;
    void request<GrowthEvent>(`/events/${id}`)
      .then((e) => {
        if (alive) {
          setEvent(e);
          setLoaded(true);
        }
      })
      .catch(() => {
        if (alive) setLoaded(true);
      });
    return () => {
      alive = false;
    };
  }, [id]);
  return (
    <div className="gx-app gx-gift-page">
      <header className="gx-header">
        <a href="/" className="gx-brand">
          <Leaf size={30} strokeWidth={1.4} />
          <strong>sprout</strong>
        </a>
        <a className="gx-text-link" href="/grow/events">
          <ArrowLeft size={16} /> Back to the garden
        </a>
      </header>
      <main>
        <div className="gx-gift-intro">
          <span className="gx-eyebrow">A LITTLE GIFT. A LONG WAY TO GROW.</span>
          <h1>{event?.title ?? "A gift for the future"}</h1>
          <p>Celebrate today with something for all their tomorrows.</p>
        </div>
        <div className="gx-gift-layout">
          <div className="gx-gift-visual">
            <img
              src="/art/dashboard/hero-bouquet.png"
              alt="A colourful botanical garden"
            />
            <h2>
              With a little love,
              <br />
              <em>watch what grows.</em>
            </h2>
            {event && (
              <>
                <div className="gx-goal">
                  <strong>{money(event.raisedCents)}</strong>
                  <span>of {money(event.goalCents)} together</span>
                </div>
                <Progress
                  value={(event.raisedCents / event.goalCents) * 100}
                  label="Celebration goal"
                />
                {event.guests.slice(-4).map((g, i) => (
                  <blockquote key={i}>
                    “{g.message}”<cite>With love, {g.alias}</cite>
                  </blockquote>
                ))}
              </>
            )}
          </div>
          <Panel
            title="Give a little future"
            eyebrow={
              r.config?.local ? "LOCAL PRACTICE · TEST FUNDS" : "YOUR GIFT"
            }
          >
            {event ? (
              <>
                <p>
                  Gifts go directly into the family’s vault. The family’s
                  existing beneficiary and withdrawal rules apply.
                </p>
                {!r.wallet ? (
                  <>
                    <Button
                      onClick={() =>
                        void r.run("Connecting wallet", () => r.connect())
                      }
                    >
                      Connect to give <Wallet size={16} />
                    </Button>
                    {r.local?.enabled &&
                      r.local.accounts.slice(0, 3).map((a) => (
                        <button
                          className="gx-text-link"
                          key={a.address}
                          onClick={() =>
                            void r.run("Connecting practice wallet", () =>
                              r.connect(a.address),
                            )
                          }
                        >
                          Use {a.label}
                        </button>
                      ))}
                  </>
                ) : (
                  <form
                    className="gx-form"
                    onSubmit={(e) => {
                      e.preventDefault();
                      void r.run(
                        "Sending your gift",
                        async () => {
                          const txHash = await r.send(event.vault, "gift", {
                            amountCents: Math.round(Number(amount) * 100),
                            giftRef: event.giftRef,
                            eventId: event.id,
                          });
                          await request(`/events/${id}/receipt`, {
                            txHash,
                            share,
                            ...(alias ? { alias } : {}),
                            ...(message ? { message } : {}),
                          });
                          setEvent(await request(`/events/${id}`));
                        },
                        "Your gift is confirmed. A little more future, with love.",
                      );
                    }}
                  >
                    <div className="gx-segments">
                      {["25", "50", "100"].map((n) => (
                        <button
                          key={n}
                          type="button"
                          aria-pressed={amount === n}
                          onClick={() => setAmount(n)}
                        >
                          ${n}
                        </button>
                      ))}
                    </div>
                    <Amount label="Your gift" value={amount} set={setAmount} />
                    {event.publicWall && (
                      <>
                        <Field label="Your name on the wish wall">
                          <input
                            maxLength={24}
                            value={alias}
                            onChange={(e) => setAlias(e.target.value)}
                          />
                        </Field>
                        <Field label="A wish for the years ahead">
                          <textarea
                            maxLength={140}
                            value={message}
                            onChange={(e) => setMessage(e.target.value)}
                          />
                        </Field>
                        <label className="gx-check">
                          <input
                            type="checkbox"
                            checked={share}
                            onChange={(e) => setShare(e.target.checked)}
                          />{" "}
                          Share my name and wish publicly on this link
                        </label>
                      </>
                    )}
                    <Button
                      type="submit"
                      disabled={
                        !!r.busy || event.closed || event.endsAt < Date.now()
                      }
                    >
                      {event.closed ? "Celebration closed" : "Send a gift"}{" "}
                      <Gift size={16} />
                    </Button>
                    <small>Connected as {short(r.wallet.address)}.</small>
                  </form>
                )}
                {r.wallet && <PublicMatching r={r} vault={event.vault} />}
                {r.busy && <p role="status">{r.busy}…</p>}
                {r.error && <p role="alert">{r.error.slice(0, 250)}</p>}
                {r.notice && <p role="status">{r.notice}</p>}
              </>
            ) : (
              <p>
                {loaded
                  ? "This invitation is unavailable. Ask the family for a current link."
                  : "Opening the invitation…"}
              </p>
            )}
          </Panel>
        </div>
      </main>
    </div>
  );
}

function PublicMatching({ r, vault }: { r: ExpansionRuntime; vault: string }) {
  const [budget, setBudget] = useState("100"),
    [cap, setCap] = useState("25"),
    [months, setMonths] = useState("4"),
    [matches, setMatches] = useState<MatchView[]>([]),
    [lookup, setLookup] = useState("");
  useEffect(() => {
    let active = true;
    void request<MatchView[]>(`/matches?vault=${vault}`)
      .then((m) => {
        if (active) setMatches(m);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [vault, r.wallet?.address, r.notice]);
  return (
    <div className="gx-public-match">
      <span className="gx-eyebrow">A MATCHING TRADITION</span>
      <h3>Keep a little kindness coming.</h3>
      <p>
        Fund a budget that matches the parent’s future contributions. Choose a
        cap for each 30-day period and reclaim unused funds whenever you choose.
      </p>
      <form
        className="gx-form"
        onSubmit={(e) => {
          e.preventDefault();
          void r.run(
            "Funding your matching commitment",
            () =>
              r.send(vault, "match", {
                budgetCents: Math.round(Number(budget) * 100),
                capCents: Math.round(Number(cap) * 100),
                periods: Number(months),
              }),
            "Your matching budget is funded and ready for the next parent contribution.",
          );
        }}
      >
        <Amount label="Sponsor budget" value={budget} set={setBudget} />
        <div className="gx-form-row">
          <Amount label="Sponsor cap per 30 days" value={cap} set={setCap} />
          <Field label="Matching periods">
            <input
              type="number"
              required
              min="1"
              max="24"
              value={months}
              onChange={(e) => setMonths(e.target.value)}
            />
          </Field>
        </div>
        <Button disabled={!!r.busy} type="submit">
          Start a matching tradition <Users size={16} />
        </Button>
      </form>
      {matches.map((m) => (
        <div className="gx-match-row" key={m.id}>
          <div>
            <b>Commitment #{m.id}</b>
            <small>
              {money(m.remainingCents)} remaining · {money(m.matchedCents)}{" "}
              matched
            </small>
          </div>
          {!m.cancelled && (
            <button
              className="gx-text-link"
              disabled={!!r.busy}
              onClick={() =>
                void r.run(
                  "Returning unused matching funds",
                  () => r.send(vault, "cancel-match", { id: m.id }),
                  "Unused matching funds returned to your wallet.",
                )
              }
            >
              Cancel & refund
            </button>
          )}
        </div>
      ))}
      <details>
        <summary>Recover another commitment</summary>
        <form
          className="gx-join"
          onSubmit={(e) => {
            e.preventDefault();
            void r.run(
              "Recovering unused sponsor funds",
              () => r.send(vault, "cancel-match", { id: lookup }),
              "Unused sponsor funds returned.",
            );
          }}
        >
          <Field label="Commitment ID from your transaction receipt">
            <input
              pattern="[0-9]+"
              required
              value={lookup}
              onChange={(e) => setLookup(e.target.value)}
            />
          </Field>
          <Button secondary disabled={!!r.busy} type="submit">
            Refund
          </Button>
        </form>
      </details>
    </div>
  );
}
