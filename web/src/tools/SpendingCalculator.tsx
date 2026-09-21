import { useMemo, useState } from "react";
import { calculateSpending, type SpendingFrequency } from "./spendingMath";
import "./planning-extras.css";

export interface SpendingCalculatorProps {
  onCompare: (monthly: number) => void;
}

const money = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 2 });

export function SpendingCalculator({ onCompare }: SpendingCalculatorProps) {
  const [name, setName] = useState("Coffee");
  const [cost, setCost] = useState("5");
  const [occurrences, setOccurrences] = useState("4");
  const [frequency, setFrequency] = useState<SpendingFrequency>("week");
  const result = useMemo(() => calculateSpending({ cost, occurrences, frequency }), [cost, occurrences, frequency]);
  const invalid = result === null;
  return (
    <section id="spending-calculator" className="planning-extra spending-preview" aria-labelledby="spending-title">
      <div className="planning-extra-heading">
        <span className="planning-eyebrow">SMALL CHOICES, CLEAR NUMBERS</span>
        <h2 id="spending-title">Recurring spending</h2>
        <p>See what a repeated expense adds up to over a year. Averages use 52 weeks and 12 months per year.</p>
      </div>
      <div className="planning-form-grid">
        <label>
          Expense name
          <input value={name} onChange={(event) => setName(event.target.value)} placeholder="Coffee" />
        </label>
        <label>
          Cost per occurrence
          <input inputMode="decimal" value={cost} onChange={(event) => setCost(event.target.value)} placeholder="5" />
        </label>
        <label>
          Occurrences
          <input inputMode="decimal" value={occurrences} onChange={(event) => setOccurrences(event.target.value)} placeholder="4" />
        </label>
        <label>
          Frequency
          <select value={frequency} onChange={(event) => setFrequency(event.target.value as SpendingFrequency)}>
            <option value="week">per week</option>
            <option value="month">per month</option>
            <option value="year">per year</option>
          </select>
        </label>
      </div>
      {invalid ? (
        <p className="planning-error" role="alert">
          Enter a finite cost from $0 to $1,000,000 and occurrences from 0 to 366.
        </p>
      ) : (
        <div className="planning-result-grid">
          <div>
            <span>Monthly average</span>
            <strong>{money.format(result.monthly)}</strong>
          </div>
          <div>
            <span>Yearly total</span>
            <strong>{money.format(result.yearly)}</strong>
          </div>
        </div>
      )}
      <div className="planning-extra-actions">
        <button
          type="button"
          onClick={() => result && onCompare(result.monthly)}
          disabled={invalid || (result?.monthly ?? 0) > 100_000_000}
        >
          Compare this monthly amount
        </button>
        <small>{name.trim() || "This expense"} is a manual estimate. No returns are guaranteed.</small>
      </div>
    </section>
  );
}
