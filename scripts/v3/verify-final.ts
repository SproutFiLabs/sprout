import { readFileSync, writeFileSync } from "node:fs";
import { chromium } from "playwright";
import { signedPost, parentAccount } from "../lib";
const d = JSON.parse(readFileSync("tmp/v3/deployment.json", "utf8")),
  seed = JSON.parse(readFileSync("tmp/v3/seed.json", "utf8")),
  base = "http://127.0.0.1:4338";
const session = await signedPost<{ token: string }>(
    base,
    "/api/family/session",
    parentAccount,
    "family-session",
    {},
  ),
  headers = {
    authorization: `Bearer ${session.token}`,
    "content-type": "application/json",
  };
const state = (await (
  await fetch(`${base}/api/v3/state?vault=${d.vault}`, { headers })
).json()) as any;
for (const league of state.leagues) {
  if (league.invite)
    await fetch(`${base}/api/v3/leagues/join`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        vault: d.vault,
        invite: league.invite,
        alias: league.members[0].alias,
      }),
    });
}
const b = await chromium.launch({
    headless: true,
    executablePath:
      "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  }),
  ctx = await b.newContext({ viewport: { width: 1600, height: 1000 } }),
  p = await ctx.newPage();
const errors: string[] = [];
p.on("pageerror", (e) => errors.push(e.message));
await p.goto(`http://127.0.0.1:5198/celebrate/${seed.eventId}`);
await p.getByRole("button", { name: "Use Anvil #2", exact: true }).click();
await p.getByLabel("Sponsor budget").waitFor();
await p.getByLabel("Sponsor budget").fill("10");
await p.getByLabel("Sponsor cap per 30 days").fill("5");
await p.getByLabel("Matching periods").fill("2");
await p
  .getByRole("button", { name: "Start a matching tradition", exact: true })
  .click();
await p
  .getByRole("status")
  .filter({ hasText: "budget is funded" })
  .waitFor({ timeout: 20000 });
const rows = p.locator(".gx-public-match .gx-match-row");
await rows
  .filter({ hasText: "$10.00 remaining" })
  .getByRole("button", { name: "Cancel & refund", exact: true })
  .click();
await p
  .getByRole("status")
  .filter({ hasText: "Unused matching funds returned" })
  .waitFor({ timeout: 20000 });
await p.screenshot({
  path: "output/v3/qa/sponsor-checkout.png",
  fullPage: true,
});
if (await p.getByRole("alert").count())
  throw Error(await p.getByRole("alert").innerText());
if (errors.length) throw Error(errors.join("\n"));
await b.close();
const refreshed = (await (
  await fetch(`${base}/api/v3/state?vault=${d.vault}`, { headers })
).json()) as any;
const expected = Math.min(
  100,
  Math.floor(
    Math.min(
      refreshed.arena.practiceDays.length / refreshed.arena.unlockDays,
      1,
    ) * 60,
  ) +
    refreshed.arena.lessons.length * 10,
);
if (refreshed.leagues[0].members[0].score !== expected)
  throw Error("League score is stale");
writeFileSync(
  "output/v3/qa/final-flow-report.json",
  JSON.stringify(
    {
      publicSponsorFunding: true,
      publicSponsorRefund: true,
      leagueScoreCurrent: true,
      errors,
    },
    null,
    2,
  ),
);
console.log(
  "Public sponsor flow and refund passed with real transactions. League scores reflect current practice progress.",
);
