import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { chromium } from "playwright";
import { erc20Abi, parseAbi, type Address, type Hex } from "viem";
import {
  accountClient,
  parentAccount,
  gifterAccount,
  beneficiaryAccount,
  rpcClients,
  signedPost,
  artifact,
} from "../lib";
import type {
  GrowthEvent,
  ExpansionState,
  PreparedTransaction,
} from "@sprout/shared";
const d = JSON.parse(readFileSync("tmp/v3/deployment.json", "utf8")),
  base = "http://127.0.0.1:4338",
  origin = "http://127.0.0.1:5198";
const { publicClient: pc } = rpcClients(d.rpcUrl);
const session = await signedPost<{ token: string }>(
    base,
    "/api/family/session",
    parentAccount,
    "family-session",
    {},
  ),
  sponsorSession = await signedPost<{ token: string }>(
    base,
    "/api/family/session",
    gifterAccount,
    "family-session",
    {},
  );
async function req<T>(path: string, body?: unknown, token = session.token) {
  const response = await fetch(`${base}/api/v3${path}`, {
    method: body === undefined ? "GET" : "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const result = await response.json();
  if (!response.ok) throw Error(`${path}: ${JSON.stringify(result)}`);
  return result as T;
}
async function send(
  action: string,
  input: Record<string, unknown>,
  sponsor = false,
) {
  const signer = sponsor ? gifterAccount : parentAccount,
    w = accountClient(d.rpcUrl, signer),
    tx = await req<PreparedTransaction>(
      "/transaction",
      { vault: d.vault, action, input },
      sponsor ? sponsorSession.token : session.token,
    );
  if (tx.approval) {
    const h = await w.writeContract({
      address: tx.approval.token as Address,
      abi: erc20Abi,
      functionName: "approve",
      args: [tx.approval.spender as Address, BigInt(tx.approval.amount)],
    } as never);
    await pc.waitForTransactionReceipt({ hash: h });
  }
  const h = await w.sendTransaction({
    to: tx.to as Address,
    data: tx.data as Hex,
  } as never);
  const r = await pc.waitForTransactionReceipt({ hash: h });
  if (r.status !== "success") throw Error(`${action} reverted`);
  return h;
}
let state = await req<ExpansionState>(`/state?vault=${d.vault}`);
let event = state.events.find((e) => e.title === "Maya’s birthday garden");
if (!event) {
  event = await req<GrowthEvent>("/events", {
    vault: d.vault,
    kind: "birthday",
    title: "Maya’s birthday garden",
    goalCents: 150000,
    endsAt: Date.now() + 30 * 86400000,
    publicWall: true,
  });
  const txHash = await send(
    "gift",
    { amountCents: 42500, giftRef: event.giftRef, eventId: event.id },
    true,
  );
  await req(
    `/events/${event.id}/receipt`,
    {
      txHash,
      alias: "The family circle",
      message: "For all the wonderful things you’ll grow into.",
      share: true,
    },
    sponsorSession.token,
  );
}
if (!state.events.find((e) => e.title === "A first big adventure"))
  await req("/events", {
    vault: d.vault,
    kind: "milestone",
    title: "A first big adventure",
    goalCents: 200000,
    endsAt: Date.now() + 60 * 86400000,
    publicWall: false,
  });
if (!state.roundup) {
  await send("roundup-link", {
    capCents: 2500,
    allowanceCents: 10000,
    expiresAt: Date.now() + 180 * 86400000,
  });
  await req("/roundups/settings", {
    vault: d.vault,
    step: 1,
    multiplier: 2,
    capCents: 2500,
    enabled: true,
  });
  const wallet = accountClient(d.rpcUrl, parentAccount);
  for (const amount of [4350000n, 12800000n, 28400000n, 19950000n, 6240000n]) {
    const hash = await wallet.writeContract({
      address: d.settlement,
      abi: erc20Abi,
      functionName: "transfer",
      args: ["0x000000000000000000000000000000000000bEEF", amount],
    } as never);
    await pc.waitForTransactionReceipt({ hash });
  }
  await req("/roundups/sync", { vault: d.vault });
}
if (!state.arena) {
  await req("/arena/start", { vault: d.vault });
  await req("/arena/order", {
    vault: d.vault,
    id: "qa-opening-buy-1",
    side: "buy",
    symbol: "AAA",
    quantityMicros: 1000000,
  });
  await req("/arena/order", {
    vault: d.vault,
    id: "qa-opening-buy-2",
    side: "buy",
    symbol: "BBB",
    quantityMicros: 2000000,
  });
  await req("/arena/lesson", { vault: d.vault, lesson: "needs", answer: 0 });
  await req("/arena/lesson", {
    vault: d.vault,
    lesson: "diversify",
    answer: 1,
  });
  await req("/leagues", {
    vault: d.vault,
    title: "The Sunday Club",
    alias: "Maya’s garden",
  });
}
state = await req<ExpansionState>(`/state?vault=${d.vault}`);
if (state.events.find((e) => e.id === event!.id)!.raisedCents !== 42500)
  throw Error("Gift accounting mismatch");
if (state.ledger.length !== 5) throw Error("Transfer journal mismatch");
if (state.arena!.fills.length < 2) throw Error("Arena records missing");
const outsider = await signedPost<{ token: string }>(
  base,
  "/api/family/session",
  gifterAccount,
  "family-session",
  {},
);
const secret = await fetch(`${base}/api/v3/arena/export?vault=${d.vault}`, {
  headers: { authorization: `Bearer ${outsider.token}` },
});
if (secret.status !== 403) throw Error("Outsider read escaped authorization");
mkdirSync("output/v3/qa", { recursive: true });
writeFileSync(
  "tmp/v3/seed.json",
  JSON.stringify({ eventId: event.id }, null, 2),
);
const browser = await chromium.launch({
  executablePath:
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  headless: true,
});
const errors: string[] = [],
  report: any[] = [];
for (const width of [1600, 390]) {
  const context = await browser.newContext({
    viewport: { width, height: width === 1600 ? 1000 : 844 },
  });
  await context.addInitScript(
    (address) => sessionStorage.setItem("sprout-v3-local", address),
    d.parent,
  );
  for (const feature of ["events", "roundups", "cash", "arena", "continuity"]) {
    const p = await context.newPage();
    p.on("pageerror", (e) => errors.push(`${feature}: ${e.message}`));
    await p.goto(`${origin}/grow/${feature}?vault=${d.vault}`);
    await p.getByRole("button", { name: "Lock family workspace" }).waitFor();
    await p.locator(".gx-workspace").waitFor();
    await p.waitForTimeout(300);
    const overflow = await p.evaluate(
      () => document.documentElement.scrollWidth > innerWidth + 1,
    );
    if (overflow) throw Error(`${feature} overflows at ${width}px`);
    if (await p.getByRole("alert").count())
      throw Error(`${feature}: ${await p.getByRole("alert").innerText()}`);
    const file = `output/v3/qa/${feature}-${width}.png`;
    await p.screenshot({ path: file, fullPage: true });
    report.push({ feature, width, overflow: false, file });
    await p.close();
  }
  await context.close();
}
const publicContext = await browser.newContext({
    viewport: { width: 1600, height: 1000 },
  }),
  p = await publicContext.newPage();
await p.goto(`${origin}/celebrate/${event.id}`);
await p.getByText("Maya’s birthday garden", { exact: true }).waitFor();
await p.screenshot({ path: "output/v3/qa/gift-desktop.png", fullPage: true });
await browser.close();
if (errors.length) throw Error(errors.join("\n"));
writeFileSync(
  "output/v3/qa/report.json",
  JSON.stringify(
    {
      checks: report,
      errors,
      apiChecks: [
        "confirmed gift counted once",
        "five actual outgoing transfers observed",
        "practice portfolio persists",
        "unrelated wallet export denied",
      ],
    },
    null,
    2,
  ),
);
console.log(
  "V3 QA passed: five features at desktop and mobile widths, public gift page, chain and permission checks.",
);
