export type SpendingFrequency = "week" | "month" | "year";

export interface SpendingInput {
  cost: number | string;
  occurrences: number | string;
  frequency: SpendingFrequency;
}

export interface SpendingResult {
  perOccurrence: number;
  occurrencesPerYear: number;
  yearly: number;
  monthly: number;
}

const frequencyMultiplier: Record<SpendingFrequency, number> = { week: 52, month: 12, year: 1 };

function numberValue(value: number | string): number | null {
  if (value === "" || (typeof value === "string" && value.trim() === "")) return null;
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export function calculateSpending(input: SpendingInput): SpendingResult | null {
  if (!(input.frequency in frequencyMultiplier)) return null;
  const cost = numberValue(input.cost);
  const occurrences = numberValue(input.occurrences);
  if (cost === null || occurrences === null || cost < 0 || cost > 1_000_000 || occurrences < 0 || occurrences > 366) return null;
  const occurrencesPerYear = occurrences * frequencyMultiplier[input.frequency];
  const yearly = cost * occurrencesPerYear;
  return { perOccurrence: cost, occurrencesPerYear, yearly, monthly: yearly / 12 };
}
