import { useState } from "react";
import {
  allocationReport,
  comparisonReport,
  goalReport,
  PROJECTION_ASSUMPTIONS,
  type ProjectionRow,
} from "../../../shared/src/toolReports";
import "./tools.css";
import { SavingsCalendar } from "./SavingsCalendar";
import { SpendingCalculator } from "./SpendingCalculator";
import { PortfolioVisualizer } from "./PortfolioVisualizer";

export type ToolKind = "goal" | "comparison" | "portfolio";
type FormState = {
  initial: string;
  monthly: string;
  months: string;
  annualReturn: string;
  target: string;
  alternativeMonthly: string;
  inflationRate: string;
};
const initialForm: FormState = {
  initial: "1000",
  monthly: "250",
  months: "60",
  annualReturn: "0",
  target: "20000",
  alternativeMonthly: "350",
  inflationRate: "2",
};
const money = new Intl.NumberFormat("en-CA", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0,
});
const preciseMoney = new Intl.NumberFormat("en-CA", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 2,
});
const number = (value: string) => Number(value);

export function ToolComposer({
  onPrepare,
  busy,
  disabled = false,
}: {
  onPrepare: (kind: ToolKind, input: unknown) => void;
  busy: boolean;
  disabled?: boolean;
}) {
  const [kind, setKind] = useState<ToolKind>("goal");
  const [form, setForm] = useState<FormState>(initialForm);
  const [preset, setPreset] = useState("custom");
  const [inflationEnabled, setInflationEnabled] = useState(false);
  const [spendingError, setSpendingError] = useState("");
  const [holdings, setHoldings] = useState([
    { symbol: "CASH", value: "1000" },
    { symbol: "", value: "" },
  ]);
  const set = (key: keyof FormState) => (event: React.ChangeEvent<HTMLInputElement>) => {
    setPreset("custom");
    setForm((current) => ({ ...current, [key]: event.target.value }));
  };
  const prepare = () => {
    if (kind === "portfolio") {
      onPrepare(
        kind,
        holdings
          .filter((row) => row.symbol.trim() || row.value.trim())
          .map((row) => ({
            symbol: row.symbol.trim().toUpperCase(),
            valueUsd: number(row.value),
          })),
      );
      return;
    }
    const base = {
      initial: number(form.initial),
      monthly: number(form.monthly),
      months: number(form.months),
      annualReturn: number(form.annualReturn),
    };
    onPrepare(
      kind,
      kind === "goal"
        ? { ...base, target: number(form.target), inflationRate: inflationEnabled ? number(form.inflationRate) : 0 }
        : { ...base, alternativeMonthly: number(form.alternativeMonthly) },
    );
  };
  let goalPreview: ReturnType<typeof goalReport> | null = null;
  let comparisonPreview: ReturnType<typeof comparisonReport> | null = null;
  let previewError = "";
  if (kind !== "portfolio") {
    try {
      const fields = [
        "initial",
        "monthly",
        "months",
        "annualReturn",
        kind === "goal" ? "target" : "alternativeMonthly",
      ] as (keyof FormState)[];
      if (inflationEnabled && kind === "goal") fields.push("inflationRate");
      if (fields.some((key) => !form[key].trim())) throw new Error("Enter every amount to see a preview.");
      const base = {
        initial: number(form.initial),
        monthly: number(form.monthly),
        months: number(form.months),
        annualReturn: number(form.annualReturn),
      };
      if (kind === "goal")
        goalPreview = goalReport({
          ...base,
          target: number(form.target),
          inflationRate: inflationEnabled ? number(form.inflationRate) : 0,
        });
      else comparisonPreview = comparisonReport({ ...base, alternativeMonthly: number(form.alternativeMonthly) });
    } catch {
      previewError = "Enter valid values within the field limits to see your preview.";
    }
  }
  const presets = [
    { id: "education", label: "Education", target: "30000", months: "180", monthly: "150" },
    { id: "car", label: "First car", target: "15000", months: "60", monthly: "250" },
    { id: "home", label: "Home deposit", target: "50000", months: "120", monthly: "400" },
  ];
  return (
    <>
      <section className="tools-composer" aria-labelledby="tools-title">
        <div className="tools-intro">
          <p className="tools-eyebrow">Premium planning tools</p>
          <h2 id="tools-title">Make a clearer plan for your money.</h2>
          <p>Enter your own assumptions to prepare a private, readable report. Values are illustrations, not forecasts.</p>
        </div>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            prepare();
          }}
        >
          <div className="tools-tabs" role="tablist" aria-label="Choose a tool">
            {(
              [
                ["goal", "Savings goal planner", "See when a target may be reached"],
                ["comparison", "Contribution comparison", "Compare two monthly amounts"],
                ["portfolio", "Portfolio allocation", "Understand your current mix"],
              ] as const
            ).map(([value, label, description]) => (
              <button
                key={value}
                type="button"
                role="tab"
                aria-selected={kind === value}
                className={kind === value ? "is-selected" : ""}
                onClick={() => setKind(value)}
              >
                <strong>{label}</strong>
                <span>{description}</span>
              </button>
            ))}
          </div>
          {kind === "goal" && (
            <div className="goal-presets" id="goal-presets">
              <p className="tools-eyebrow">Start with a goal</p>
              <div className="preset-buttons" role="group" aria-label="Savings goal presets">
                {presets.map((item) => (
                  <button
                    type="button"
                    key={item.id}
                    aria-pressed={preset === item.id}
                    onClick={() => {
                      setPreset(item.id);
                      setForm((current) => ({
                        ...current,
                        initial: "0",
                        target: item.target,
                        months: item.months,
                        monthly: item.monthly,
                        annualReturn: "0",
                      }));
                      setInflationEnabled(false);
                    }}
                  >
                    {item.label}
                  </button>
                ))}
                <button type="button" aria-pressed={preset === "custom"} onClick={() => setPreset("custom")}>
                  Custom goal
                </button>
              </div>
              <p className="tools-field-note">
                Editable examples to help you start. Choose amounts and a timeframe that suit your own goal.
              </p>
            </div>
          )}
          {kind === "portfolio" ? (
            <div className="tools-fields">
              <p className="tools-field-note">
                Add holdings using symbols and the current value you enter manually. These values are entered manually, not imported from
                your wallet.
              </p>
              <div className="holding-list">
                {holdings.map((row, index) => (
                  <div className="holding-row" key={index}>
                    <label>
                      Symbol
                      <input
                        required={index === 0}
                        aria-label={`Holding ${index + 1} symbol`}
                        value={row.symbol}
                        onChange={(event) =>
                          setHoldings((current) => current.map((item, i) => (i === index ? { ...item, symbol: event.target.value } : item)))
                        }
                        placeholder="e.g. CASH"
                        maxLength={16}
                      />
                    </label>
                    <label>
                      Value (USD)
                      <input
                        required={index === 0}
                        aria-label={`Holding ${index + 1} value`}
                        type="number"
                        min="0"
                        max="100000000"
                        step="0.01"
                        value={row.value}
                        onChange={(event) =>
                          setHoldings((current) => current.map((item, i) => (i === index ? { ...item, value: event.target.value } : item)))
                        }
                        placeholder="0"
                      />
                    </label>
                  </div>
                ))}
              </div>
              <button
                type="button"
                className="tools-add"
                disabled={holdings.length >= 100}
                onClick={() => setHoldings((current) => [...current, { symbol: "", value: "" }])}
              >
                + Add another holding
              </button>
            </div>
          ) : (
            <div className="tools-fields">
              <Field label="Starting amount" value={form.initial} onChange={set("initial")} />
              <Field label="Monthly contribution" value={form.monthly} onChange={set("monthly")} />
              <Field label="Time horizon (months)" value={form.months} onChange={set("months")} min="1" max="600" step="1" />
              <Field
                label="Assumed annual return (%)"
                value={form.annualReturn}
                onChange={set("annualReturn")}
                min="-90"
                max="50"
                step="0.1"
              />
              {kind === "goal" ? (
                <Field label="Target amount" value={form.target} onChange={set("target")} min="0.01" />
              ) : (
                <Field label="Alternative monthly contribution" value={form.alternativeMonthly} onChange={set("alternativeMonthly")} />
              )}
            </div>
          )}
          {kind === "goal" && (
            <div className="inflation-option" id="inflation-planning">
              <label className="tools-toggle">
                <input type="checkbox" checked={inflationEnabled} onChange={(e) => setInflationEnabled(e.target.checked)} /> Adjust my
                target for inflation
              </label>
              <p className="tools-field-note">
                Treat the target as today's purchasing power. We increase it over your chosen timeframe; this does not increase investment
                returns.
              </p>
              {inflationEnabled && (
                <Field
                  label="Assumed annual inflation (%)"
                  value={form.inflationRate}
                  onChange={set("inflationRate")}
                  min="0"
                  max="20"
                  step="0.1"
                />
              )}
            </div>
          )}
          {kind === "comparison" && (
            <div className="contribution-slider" id="contribution-slider">
              <label htmlFor="extra-monthly">What if I saved a little more?</label>
              <p>Try an extra monthly contribution. You can also type any supported amount above.</p>
              <input
                id="extra-monthly"
                type="range"
                min="0"
                max="1000"
                step="0.01"
                disabled={
                  !form.monthly.trim() ||
                  !Number.isFinite(number(form.monthly)) ||
                  number(form.monthly) < 0 ||
                  number(form.monthly) > 99999000
                }
                value={Math.min(1000, Math.max(0, number(form.alternativeMonthly) - number(form.monthly))) || 0}
                aria-valuetext={`${preciseMoney.format(Math.min(1000, Math.max(0, number(form.alternativeMonthly) - number(form.monthly))) || 0)} extra per month`}
                onChange={(e) =>
                  setForm((current) => ({
                    ...current,
                    alternativeMonthly: String(Math.round((number(current.monthly) + number(e.target.value)) * 100) / 100),
                  }))
                }
              />
              <div className="slider-labels">
                <span>+$0 / month</span>
                <span>+$1,000 / month</span>
              </div>
            </div>
          )}
          {kind !== "portfolio" && (
            <div className="planning-preview" aria-live="polite">
              <p className="tools-eyebrow">Free planning preview</p>
              {previewError && <p>{previewError}</p>}
              {goalPreview && (
                <div className="tools-metrics">
                  <Metric
                    label={inflationEnabled ? "Target at your end date" : "Your target"}
                    value={preciseMoney.format(goalPreview.targetAtEnd)}
                  />
                  <Metric label="Projected balance at end" value={money.format(goalPreview.rows.at(-1)!.projected)} />
                  <Metric label="Monthly needed for target" value={preciseMoney.format(goalPreview.requiredMonthly)} />
                </div>
              )}
              {comparisonPreview && (
                <>
                  <div className="tools-metrics">
                    <Metric label="Monthly baseline" value={preciseMoney.format(number(form.monthly))} />
                    <Metric label="Monthly alternative" value={preciseMoney.format(number(form.alternativeMonthly))} />
                    <Metric label="Projected difference at end" value={preciseMoney.format(comparisonPreview.projectedDifference)} />
                  </div>
                  <ComparisonChart baseline={comparisonPreview.baseline} alternative={comparisonPreview.alternative} />
                  <p className="tools-field-note">
                    Difference in contributions over {form.months} months: {preciseMoney.format(comparisonPreview.extraContributed)}.
                    Illustrative values, not a forecast.
                  </p>
                </>
              )}
            </div>
          )}
          {kind !== "portfolio" && (
            <p className="tools-assumption">
              Assumes a constant effective annual return of the value entered, monthly compounding, and contributions at month end. Actual
              returns vary and may be negative.
            </p>
          )}
          <button className="tools-prepare" type="submit" disabled={busy || disabled || (kind !== "portfolio" && !!previewError)}>
            {busy ? "Preparing…" : disabled ? "Connect wallet to prepare" : "Prepare report"} <span aria-hidden="true">→</span>
          </button>
          <p className="tools-field-note">Previews are free. Preparing a saved report gives you a SPROUT quote to review before paying.</p>
        </form>
        {kind !== "portfolio" && !previewError && <SavingsCalendar monthly={number(form.monthly)} months={number(form.months)} />}
      </section>
      <SpendingCalculator
        onCompare={(monthly) => {
          const baseline = number(form.monthly);
          if (
            !form.monthly.trim() ||
            !Number.isFinite(baseline) ||
            baseline < 0 ||
            !Number.isFinite(monthly) ||
            monthly < 0 ||
            baseline + monthly > 100000000
          ) {
            setSpendingError("Use a valid baseline contribution and keep the combined monthly amount at or below $100,000,000.");
            return;
          }
          setSpendingError("");
          setKind("comparison");
          setForm((current) => ({ ...current, alternativeMonthly: String(Math.round((baseline + monthly) * 100) / 100) }));
          document.getElementById("tools-title")?.scrollIntoView({ behavior: "smooth", block: "start" });
        }}
      />
      {spendingError && (
        <p role="alert" className="tools-error">
          {spendingError}
        </p>
      )}
      <PortfolioVisualizer />
    </>
  );
}

function Field({
  label,
  value,
  onChange,
  min = "0",
  max = "100000000",
  step = "0.01",
}: {
  label: string;
  value: string;
  onChange: (event: React.ChangeEvent<HTMLInputElement>) => void;
  min?: string;
  max?: string;
  step?: string;
}) {
  return (
    <label className="tools-field">
      {label}
      <input required type="number" inputMode="decimal" value={value} onChange={onChange} min={min} max={max} step={step} />
    </label>
  );
}

export function ToolReportView({ kind, result }: { kind: ToolKind; result: unknown }) {
  if (!result) return null;
  if (kind === "portfolio") {
    const report = result as ReturnType<typeof allocationReport>;
    return (
      <div className="tools-report">
        <ReportHeading title="Your allocation snapshot" text="A descriptive view of the holdings and values you entered." />
        <div className="tools-metrics">
          <Metric label="Total entered" value={preciseMoney.format(report.totalUsd)} />
          <Metric label="Largest holding" value={`${report.largestHolding.symbol} · ${report.largestHolding.percent}%`} />
          <Metric label="Top three" value={`${report.topThreePercent}%`} />
        </div>
        <div className="allocation-chart" aria-label="Portfolio allocation chart">
          {report.holdings.map((holding, index) => (
            <div
              className="allocation-bar"
              key={holding.symbol}
              style={
                {
                  "--allocation": `${holding.percent}%`,
                  "--bar": chartColors[index % chartColors.length],
                } as React.CSSProperties
              }
            >
              <span>{holding.symbol}</span>
              <b>{holding.percent}%</b>
            </div>
          ))}
        </div>
        <table className="tools-table">
          <thead>
            <tr>
              <th>Holding</th>
              <th>Value</th>
              <th>Share</th>
            </tr>
          </thead>
          <tbody>
            {report.holdings.map((row) => (
              <tr key={row.symbol}>
                <td>{row.symbol}</td>
                <td>{preciseMoney.format(row.valueUsd)}</td>
                <td>{row.percent}%</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  }
  if (kind === "goal") {
    const report = result as ReturnType<typeof goalReport>;
    const last = report.rows[report.rows.length - 1]!;
    return (
      <div className="tools-report">
        <ReportHeading
          title="Savings goal projection"
          text="A month-by-month illustration based on your assumptions."
          inflationRate={report.inflationRate}
        />
        {!!report.inflationRate && (
          <p className="tools-assumption">
            Target in today's dollars: {preciseMoney.format(report.targetToday)}. At {report.inflationRate}% assumed annual inflation, the
            target at the end is {preciseMoney.format(report.targetAtEnd)}. Goal timing uses the inflation-adjusted target at each month.
          </p>
        )}
        <div className="tools-metrics">
          <Metric label="Projected at end" value={money.format(last.projected)} />
          <Metric label="First reaches goal" value={report.firstGoalMonth === null ? "Not reached" : `Month ${report.firstGoalMonth}`} />
          <Metric label="Monthly needed" value={preciseMoney.format(report.requiredMonthly)} />
        </div>
        <ProjectionChart rows={report.rows} />
        <p className="tools-report-note">
          {report.shortfall > 0
            ? `${preciseMoney.format(report.shortfall)} remains at the end of this horizon under the current contribution.`
            : "The projected balance meets the target at the end of this horizon under these assumptions."}
        </p>
      </div>
    );
  }
  const report = result as ReturnType<typeof comparisonReport>;
  const end = report.baseline[report.baseline.length - 1]!;
  const alt = report.alternative[report.alternative.length - 1]!;
  return (
    <div className="tools-report">
      <ReportHeading title="Contribution comparison" text="See how the two monthly contribution assumptions diverge over time." />
      <div className="tools-metrics">
        <Metric label="Baseline at end" value={money.format(end.projected)} />
        <Metric label="Alternative at end" value={money.format(alt.projected)} />
        <Metric label="Projected difference" value={preciseMoney.format(report.projectedDifference)} />
      </div>
      <ComparisonChart baseline={report.baseline} alternative={report.alternative} />
      <p className="tools-report-note">
        {report.extraContributed < 0
          ? `The alternative contributes ${preciseMoney.format(Math.abs(report.extraContributed))} less`
          : `The alternative contributes ${preciseMoney.format(report.extraContributed)} more`}{" "}
        over the selected horizon.
      </p>
    </div>
  );
}

const chartColors = ["#14532d", "#5f8f55", "#d89b42", "#8ba79a", "#b85c4b"];
function ReportHeading({ title, text, inflationRate = 0 }: { title: string; text: string; inflationRate?: number }) {
  return (
    <div className="tools-report-heading">
      <p className="tools-eyebrow">Prepared report</p>
      <h3>{title}</h3>
      <p>{text}</p>
      <p className="tools-report-note">
        {inflationRate > 0
          ? PROJECTION_ASSUMPTIONS.replace(
              "Excludes fees, taxes and inflation.",
              "Excludes fees and taxes. Inflation adjusts the target only.",
            )
          : PROJECTION_ASSUMPTIONS}
      </p>
    </div>
  );
}
function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="tools-metric">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}
function ProjectionChart({ rows }: { rows: ProjectionRow[] }) {
  const max = Math.max(...rows.map((row) => row.projected), 1);
  const final = rows[rows.length - 1]!;
  const points = rows
    .filter((_, index) => index % Math.max(1, Math.floor(rows.length / 40)) === 0 || index === rows.length - 1)
    .map((row) => `${(row.month / final.month) * 100},${100 - (row.projected / max) * 88}`)
    .join(" ");
  return (
    <div className="tools-chart-wrap">
      <svg viewBox="0 0 100 100" preserveAspectRatio="none" role="img" aria-label="Projected balance over time">
        <polyline points={points} fill="none" stroke="#14532d" strokeWidth="2.5" vectorEffect="non-scaling-stroke" />
      </svg>
      <div className="chart-labels">
        <span>Month 0</span>
        <span>Month {final.month}</span>
      </div>
    </div>
  );
}
function ComparisonChart({ baseline, alternative }: { baseline: ProjectionRow[]; alternative: ProjectionRow[] }) {
  const max = Math.max(...alternative.map((row) => row.projected), ...baseline.map((row) => row.projected), 1);
  const points = (rows: ProjectionRow[]) => {
    const final = rows[rows.length - 1]!;
    return rows
      .filter((_, index) => index % Math.max(1, Math.floor(rows.length / 40)) === 0 || index === rows.length - 1)
      .map((row) => `${(row.month / final.month) * 100},${100 - (row.projected / max) * 88}`)
      .join(" ");
  };
  return (
    <div className="tools-chart-wrap">
      <svg viewBox="0 0 100 100" preserveAspectRatio="none" role="img" aria-label="Baseline and alternative projections">
        <polyline points={points(baseline)} fill="none" stroke="#8ba79a" strokeWidth="2.5" vectorEffect="non-scaling-stroke" />
        <polyline points={points(alternative)} fill="none" stroke="#14532d" strokeWidth="2.5" vectorEffect="non-scaling-stroke" />
      </svg>
      <div className="chart-legend">
        <span>
          <i className="legend-baseline" />
          Baseline
        </span>
        <span>
          <i className="legend-alternative" />
          Alternative
        </span>
      </div>
    </div>
  );
}
