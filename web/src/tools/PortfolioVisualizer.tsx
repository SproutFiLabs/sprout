import { useMemo, useState } from "react";
import { allocationReport } from "../../../shared/src/toolReports";
import "./planning-extras.css";

type Holding = { symbol: string; valueUsd: string };
export type PortfolioMix = Holding[];
const initial: Holding[] = [
  { symbol: "CASH", valueUsd: "1000" },
  { symbol: "CBBTC", valueUsd: "500" },
  { symbol: "WETH", valueUsd: "500" },
];
const palette = ["#285732", "#dd7027", "#8eac73", "#c98a43", "#6d805b", "#a7502a", "#4e7655", "#d6a05b"];

export function normalizeHoldings(rows: PortfolioMix) {
  if (rows.length > 20) return { error: "Use 20 rows or fewer." as string };
  if (
    rows.some(
      (row) =>
        !/^[A-Z0-9.-]{1,16}$/.test(row.symbol.trim()) ||
        row.valueUsd.trim() === "" ||
        !Number.isFinite(Number(row.valueUsd)) ||
        Number(row.valueUsd) < 0 ||
        Number(row.valueUsd) > 100_000_000,
    )
  )
    return { error: "Use symbols with A–Z, numbers, dots or dashes, and values from $0 to $100,000,000." as string };
  try {
    return { report: allocationReport(rows.map((row) => ({ symbol: row.symbol.trim(), valueUsd: Number(row.valueUsd) }))) };
  } catch (error) {
    return { error: error instanceof Error ? error.message : ("Enter at least one positive holding." as string) };
  }
}

function MixEditor({ label, rows, setRows }: { label: string; rows: Holding[]; setRows: (rows: Holding[]) => void }) {
  const update = (index: number, key: keyof Holding, value: string) =>
    setRows(rows.map((row, i) => (i === index ? { ...row, [key]: value } : row)));
  return (
    <div className="portfolio-mix">
      <h3>{label}</h3>
      <div className="portfolio-fields">
        <span>Symbol</span>
        <span>Value (USD)</span>
        <span />
      </div>
      {rows.map((row, index) => (
        <div className="portfolio-row" key={index}>
          <input
            aria-label={`${label} symbol ${index + 1}`}
            value={row.symbol}
            onChange={(event) => update(index, "symbol", event.target.value.toUpperCase())}
          />
          <input
            aria-label={`${label} value ${index + 1}`}
            inputMode="decimal"
            value={row.valueUsd}
            onChange={(event) => update(index, "valueUsd", event.target.value)}
          />
          <button type="button" onClick={() => setRows(rows.filter((_, i) => i !== index))} aria-label={`Remove ${label} row ${index + 1}`}>
            ×
          </button>
        </div>
      ))}
      <button
        type="button"
        className="portfolio-add"
        onClick={() => setRows([...rows, { symbol: "", valueUsd: "" }])}
        disabled={rows.length >= 20}
      >
        + Add holding
      </button>
    </div>
  );
}

function AllocationChart({ report, colors }: { report: ReturnType<typeof allocationReport>; colors: Map<string, string> }) {
  const gradient = report.holdings.reduce((text, holding, index) => {
    const start = report.holdings.slice(0, index).reduce((sum, item) => sum + item.valueUsd, 0);
    return `${text}${index ? ", " : ""}${colors.get(holding.symbol)} ${(start / report.totalUsd) * 100}% ${((start + holding.valueUsd) / report.totalUsd) * 100}%`;
  }, "");
  return (
    <div
      className="portfolio-donut"
      style={{ background: `conic-gradient(${gradient})` }}
      aria-label={`Allocation chart totaling ${money(report.totalUsd)}`}
    />
  );
}
const money = (value: number) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 2 }).format(value);

export function PortfolioVisualizer() {
  const [current, setCurrent] = useState(initial);
  const [proposed, setProposed] = useState(initial.map((row) => ({ ...row })));
  const currentState = useMemo(() => normalizeHoldings(current), [current]);
  const proposedState = useMemo(() => normalizeHoldings(proposed), [proposed]);
  const symbols = [...new Set([...current, ...proposed].map((row) => row.symbol.trim()).filter(Boolean))].sort();
  const colors = new Map<string, string>(symbols.map((symbol, index) => [symbol, palette[index % palette.length]!]));
  const reports = currentState.report && proposedState.report ? [currentState.report, proposedState.report] : null;
  return (
    <section id="portfolio-visualizer" className="planning-extra portfolio-preview" aria-labelledby="portfolio-title">
      <div className="planning-extra-heading">
        <span className="planning-eyebrow">A SIMPLE SIDE-BY-SIDE</span>
        <h2 id="portfolio-title">Portfolio visualizer</h2>
        <p>Compare your current mix with a hypothetical alternative. Example values are editable.</p>
      </div>
      <div className="portfolio-editors">
        <MixEditor label="Current" rows={current} setRows={setCurrent} />
        <MixEditor label="Proposed" rows={proposed} setRows={setProposed} />
      </div>
      <div className="portfolio-disclaimer">Manual values. Hypothetical comparison; no trades are placed.</div>
      {reports ? (
        <div className="portfolio-comparison">
          {reports.map((report, index) => (
            <article key={index}>
              <div className="portfolio-donut-wrap">
                <AllocationChart report={report} colors={colors} />
                <div>
                  <h3>{index ? "Proposed" : "Current"}</h3>
                  <strong>{money(report.totalUsd)}</strong>
                </div>
              </div>
              <table>
                <thead>
                  <tr>
                    <th>Holding</th>
                    <th>Share</th>
                    <th>Value (USD)</th>
                  </tr>
                </thead>
                <tbody>
                  {report.holdings.map((holding) => (
                    <tr key={holding.symbol}>
                      <td>
                        <i style={{ background: colors.get(holding.symbol) }} />
                        {holding.symbol}
                      </td>
                      <td>{holding.percent.toFixed(1)}%</td>
                      <td>{money(holding.valueUsd)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </article>
          ))}
        </div>
      ) : (
        <p className="planning-error" role="alert">
          {"error" in currentState ? currentState.error : proposedState.error}
        </p>
      )}
    </section>
  );
}
