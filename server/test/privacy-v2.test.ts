import { expect, test } from "bun:test";
import { Hono } from "hono";
import { registerPrivacyV2Routes } from "../src/privacy-v2";

test("disabled privacy endpoints cannot fall through to SPA or report fabricated success", async () => {
  const app = new Hono();
  registerPrivacyV2Routes(app);
  app.get("*", (c) => c.html("<html>SPA</html>"));
  for (const path of [
    "/v2",
    "/v2/vault/1/shield",
    "/v2/swap/order",
    "/v2/swap/window",
    "/v2/tag/register",
    "/v2/tag/resolve/a",
    "/v2/tag/pay",
    "/v2/proofs/solvency",
    "/v2/attest/provision",
    "/v2/disclose/grant",
    "/api/v2",
    "/api/v2/swap/order",
  ]) {
    for (const method of ["GET", "POST"])
      expect((await app.request(path, { method })).status).toBe(404);
  }
  const response = await app.request("/api/privacy/capabilities");
  expect(response.headers.get("cache-control")).toBe("no-store");
  const result = await response.json();
  expect(result.mode).toBe("preparation");
  expect(
    Object.values(result.features).every(
      (f: any) => f.preparation === true && f.settlement === false,
    ),
  ).toBe(true);
});
