import { chromium, type Page, type Locator } from "playwright";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
const d = JSON.parse(readFileSync("tmp/v3/deployment.json", "utf8")),
  origin = process.env.V3_WEB_ORIGIN ?? "http://127.0.0.1:5198",
  root = "output/v3";
mkdirSync(`${root}/capture`, { recursive: true });
const browser = await chromium.launch({
  headless: true,
  executablePath:
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
});
const manifest: Record<string, unknown> = process.env.V3_CAPTURE_ONLY
    ? JSON.parse(readFileSync(`${root}/capture/manifest.json`, "utf8"))
    : {},
  errors: string[] = [];
async function scroll(p: Page, y: number) {
  await p.evaluate((y) => scrollTo({ top: y, behavior: "smooth" }), y);
  await p.waitForTimeout(700);
}
async function click(p: Page, l: Locator) {
  await l.scrollIntoViewIfNeeded();
  const box = await l.boundingBox();
  if (box)
    await p.evaluate(
      ({ x, y }) => {
        const el = document.getElementById("v3-film-cursor")!;
        el.style.left = `${x}px`;
        el.style.top = `${y}px`;
      },
      { x: box.x + box.width / 2, y: box.y + box.height / 2 },
    );
  await p.waitForTimeout(350);
  await l.click();
}
async function saved(p: Page, text: string) {
  await p
    .getByRole("status")
    .filter({ hasText: text })
    .waitFor({ timeout: 20000 });
  await p.waitForTimeout(600);
}
async function record(
  name: string,
  setup: (p: Page) => Promise<void>,
  actions: (p: Page) => Promise<void>,
) {
  if (process.env.V3_CAPTURE_ONLY && process.env.V3_CAPTURE_ONLY !== name)
    return;
  const ctx = await browser.newContext({
    viewport: { width: 1600, height: 900 },
    deviceScaleFactor: 1,
    recordVideo: { dir: `${root}/capture`, size: { width: 1600, height: 900 } },
    permissions: ["clipboard-write", "clipboard-read"],
  });
  await ctx.addInitScript(
    (address) => sessionStorage.setItem("sprout-v3-local", address),
    d.parent,
  );
  const began = Date.now(),
    p = await ctx.newPage();
  p.on("pageerror", (e) => errors.push(`${name}: ${e.message}`));
  await p.goto(`${origin}/grow/${name}?vault=${d.vault}`);
  await p.locator(".gx-workspace").waitFor();
  await p.waitForFunction(() => !document.querySelector("fieldset[disabled]"));
  await p.evaluate(() => document.fonts.ready);
  await setup(p);
  await scroll(p, 0);
  await p.evaluate(() => {
    const c = document.createElement("div");
    c.id = "v3-film-cursor";
    c.style.cssText =
      "position:fixed;left:1480px;top:825px;width:20px;height:26px;z-index:9999;pointer-events:none;transition:left .32s ease,top .32s ease;filter:drop-shadow(0 2px 2px #0003)";
    c.innerHTML =
      '<svg viewBox="0 0 24 30"><path d="M2 2L21 18L13 19L9 28Z" fill="#284e36" stroke="#fffef8" stroke-width="2"/></svg>';
    document.body.append(c);
  });
  await p.waitForTimeout(500);
  const start = (Date.now() - began) / 1000,
    at = Date.now();
  await p.screenshot({ path: `${root}/capture/${name}-opening.png` });
  await actions(p);
  if (await p.getByRole("alert").count())
    throw Error(`${name}: ${await p.getByRole("alert").innerText()}`);
  const elapsed = (Date.now() - at) / 1000;
  if (elapsed > 30)
    throw Error(`${name} actions exceeded 30 seconds (${elapsed})`);
  await p.waitForTimeout((31 - elapsed) * 1000);
  await p.screenshot({ path: `${root}/capture/${name}-ending.png` });
  const video = p.video()!;
  await ctx.close();
  manifest[name] = {
    path: await video.path(),
    start,
    duration: 30,
    recorded: true,
    viewport: { width: 1600, height: 900 },
  };
  writeFileSync(
    `${root}/capture/manifest.json`,
    JSON.stringify(manifest, null, 2),
  );
  console.log(`${name}: actual workflow recorded, 30 seconds, no voice.`);
}
await record(
  "events",
  async (p) => {
    await p
      .getByRole("button", { name: "Maya’s birthday garden", exact: true })
      .click();
  },
  async (p) => {
    await p.waitForTimeout(2200);
    await scroll(p, 280);
    await click(p, p.getByRole("button", { name: "Copy invite", exact: true }));
    await p.waitForTimeout(1500);
    await scroll(p, 640);
    await p.getByLabel("Your contribution").fill("25");
    await click(p, p.getByRole("button", { name: "Contribute", exact: true }));
    await saved(p, "Contribution confirmed");
    await scroll(p, 0);
    await p.waitForTimeout(1800);
    await click(
      p,
      p.getByRole("button", { name: "Create event", exact: true }),
    );
    await scroll(p, 430);
    await p.getByLabel("Give the moment a name").fill("Moments that grow");
    await p.getByLabel("Shared goal").fill("2000");
    await p.waitForTimeout(1300);
    await click(
      p,
      p.getByRole("button", { name: "Create celebration", exact: true }),
    );
    await saved(p, "celebration is ready");
    await scroll(p, 320);
  },
);
await record(
  "roundups",
  async () => {},
  async (p) => {
    await p.waitForTimeout(2300);
    await scroll(p, 320);
    await click(p, p.getByRole("button", { name: "$5", exact: true }));
    await click(p, p.getByRole("button", { name: "3×", exact: true }));
    await p.getByLabel("Example wallet transfer").fill("8.10");
    await p.waitForTimeout(1600);
    await p.getByLabel("Maximum per week").fill("25");
    await click(
      p,
      p.getByRole("button", { name: "Update round-ups", exact: true }),
    );
    await saved(p, "Round-ups are linked");
    await scroll(p, 720);
    await click(
      p,
      p.getByRole("button", { name: "Sync transfers", exact: true }),
    );
    await saved(p, "Transfer journal updated");
    await p.waitForTimeout(2000);
    await scroll(p, 0);
    await p.waitForTimeout(1500);
    await scroll(p, 280);
  },
);
await record(
  "cash",
  async () => {},
  async (p) => {
    await p.waitForTimeout(2300);
    await scroll(p, 250);
    await p.getByLabel("Amount to park").fill("150");
    await click(p, p.getByRole("button", { name: "Park cash", exact: true }));
    await saved(p, "Cash parked");
    await scroll(p, 0);
    await p.waitForTimeout(1900);
    await scroll(p, 580);
    await p.getByLabel("Amount to redeem").fill("50");
    await click(
      p,
      p.getByRole("button", { name: "Return to cash", exact: true }),
    );
    await saved(p, "Treasury assets returned");
    await scroll(p, 0);
    await p.waitForTimeout(2000);
    await scroll(p, 310);
  },
);
await record(
  "arena",
  async () => {},
  async (p) => {
    await p.waitForTimeout(2000);
    await scroll(p, 360);
    await p.getByLabel("Choose an asset").selectOption("AAA");
    await p.getByLabel("Practice shares").fill("0.5");
    await click(
      p,
      p.getByRole("button", { name: "Place practice buy", exact: true }),
    );
    await saved(p, "Practice trade recorded");
    await scroll(p, 720);
    await p.locator("input[type=range]").fill("1");
    await click(p, p.getByRole("button", { name: "Replay", exact: true }));
    await saved(p, "Replay rebuilt");
    await scroll(p, 1040);
    await click(
      p,
      p.getByRole("button", { name: /Open next lesson|Review a lesson/ }),
    );
    await p.waitForTimeout(500);
    const correct = p.getByRole("button", {
      name: "Review your goals and the reason you hold it",
      exact: true,
    });
    if (await correct.count()) await click(p, correct);
    else await click(p, p.locator(".gx-lesson button").first());
    await saved(p, "Lesson reviewed");
    await p.waitForTimeout(1800);
    await scroll(p, 700);
  },
);
await record(
  "continuity",
  async () => {},
  async (p) => {
    await p.waitForTimeout(2100);
    await scroll(p, 260);
    await click(p, p.getByRole("button", { name: "Edit plan", exact: true }));
    await p.getByLabel("Check in every (days)").fill("90");
    await p.getByLabel("Review window (days)").fill("14");
    await p.waitForTimeout(1600);
    await click(
      p,
      p.getByRole("button", { name: "Save my continuity plan", exact: true }),
    );
    await saved(p, "continuity plan is recorded");
    await scroll(p, 680);
    await click(
      p,
      p.getByRole("button", { name: "I’m here · check in", exact: true }),
    );
    await saved(p, "checked in");
    await p.getByLabel("Add to the reserve").fill("100");
    await click(
      p,
      p.getByRole("button", { name: "Set care aside", exact: true }),
    );
    await saved(p, "reserve is funded");
    await scroll(p, 0);
    await p.waitForTimeout(1200);
    await scroll(p, 320);
  },
);
await browser.close();
if (errors.length) throw Error(errors.join("\n"));
console.log("All five local workflow recordings complete.");
