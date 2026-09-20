import type { ArenaAccount, ArenaAsset, ArenaFill } from "@sprout/shared";
import { createHash, randomUUID } from "node:crypto";
export const LESSONS = [
  {
    id: "needs",
    title: "Needs before wants",
    question: "Which belongs in a needs budget?",
    choices: ["Rent and groceries", "A new game", "A weekend upgrade"],
    answer: 0,
    explanation:
      "A needs budget starts with essentials. Wants can have their own plan.",
  },
  {
    id: "diversify",
    title: "Give your garden variety",
    question: "What does diversification do?",
    choices: [
      "Guarantees a profit",
      "Spreads exposure across different assets",
      "Removes every risk",
    ],
    answer: 1,
    explanation:
      "A mix can reduce concentration. It cannot guarantee returns or prevent losses.",
  },
  {
    id: "patience",
    title: "Practice the pause",
    question: "A price drops. What is a useful first step?",
    choices: [
      "Sell everything immediately",
      "Borrow to buy more",
      "Review your goals and the reason you hold it",
    ],
    answer: 2,
    explanation:
      "Pause and review the plan. A price move by itself is not a complete decision.",
  },
  {
    id: "risk",
    title: "Know what can change",
    question: "Which statement is true?",
    choices: [
      "Prices can rise or fall",
      "Past gains guarantee future gains",
      "Practice profits become real cash",
    ],
    answer: 0,
    explanation:
      "Practice trades use pretend money. Real investments can lose value.",
  },
];
export function mirrorAccount(
  vault: string,
  market: ArenaAsset[],
  cashCents: number,
  block: string,
  now: number,
): ArenaAccount {
  const holdings = Object.fromEntries(
    market.map((a) => [a.symbol, a.quantityMicros]),
  );
  return {
    id: randomUUID(),
    vault,
    cashCents,
    startingCents:
      cashCents +
      market.reduce(
        (n, a) => n + Math.floor((a.quantityMicros * a.priceCents) / 1e6),
        0,
      ),
    holdings,
    fills: [],
    practiceDays: [],
    lessons: [],
    createdAt: now,
    snapshotBlock: block,
    mirror: market.map((a) => ({
      symbol: a.symbol,
      quantityMicros: a.quantityMicros,
    })),
    unlockDays: 30,
  };
}
export function fillOrder(
  a: ArenaAccount,
  asset: ArenaAsset,
  side: "buy" | "sell",
  quantityMicros: number,
  id: string,
  now: number,
  block: string,
): ArenaAccount {
  if (a.fills.some((f) => f.id === id)) return a;
  if (asset.status !== "open" || asset.priceCents <= 0)
    throw Error("This market is not available for practice trades right now.");
  if (
    !Number.isSafeInteger(quantityMicros) ||
    quantityMicros < 1 ||
    quantityMicros > 1e12
  )
    throw Error("Enter a valid practice quantity.");
  if (a.fills.length >= 2000)
    throw Error(
      "This practice ledger is full. Export it and start a new practice season.",
    );
  const priceCents =
    side === "buy"
      ? Math.ceil((asset.priceCents * 10010) / 10000)
      : Math.floor((asset.priceCents * 9990) / 10000);
  const product = BigInt(quantityMicros) * BigInt(priceCents);
  const costCents = Number(
    (product + (side === "buy" ? 999999n : 0n)) / 1000000n,
  );
  if (!Number.isSafeInteger(costCents) || costCents < 1)
    throw Error("The practice order is too small or too large.");
  if (side === "buy" && costCents > a.cashCents)
    throw Error("Not enough practice cash.");
  if (side === "sell" && quantityMicros > (a.holdings[asset.symbol] ?? 0))
    throw Error("You cannot sell more practice shares than you hold.");
  const fill: ArenaFill = {
    id,
    symbol: asset.symbol,
    side,
    quantityMicros,
    priceCents,
    costCents,
    at: now,
    quoteId: createHash("sha256")
      .update(`${asset.address}:${block}:${priceCents}`)
      .digest("hex"),
  };
  return {
    ...a,
    cashCents: a.cashCents + (side === "buy" ? -costCents : costCents),
    holdings: {
      ...a.holdings,
      [asset.symbol]:
        (a.holdings[asset.symbol] ?? 0) +
        (side === "buy" ? quantityMicros : -quantityMicros),
    },
    fills: [...a.fills, fill],
    practiceDays: [...new Set([...a.practiceDays, Math.floor(now / 86400000)])],
  };
}
export function replay(a: ArenaAccount, steps: number) {
  const quantity: Record<string, number> = Object.fromEntries(
    a.mirror.map((x) => [x.symbol, x.quantityMicros]),
  );
  // Reconstruct cash from the immutable opening balance and historical fills.
  let cash = a.cashCents;
  for (const f of a.fills)
    cash += f.side === "buy" ? f.costCents : -f.costCents;
  for (const f of a.fills.slice(0, steps)) {
    quantity[f.symbol] =
      (quantity[f.symbol] ?? 0) +
      (f.side === "buy" ? f.quantityMicros : -f.quantityMicros);
    cash += f.side === "buy" ? -f.costCents : f.costCents;
  }
  return {
    cashCents: cash,
    holdings: quantity,
    fills: a.fills.slice(0, steps),
  };
}
