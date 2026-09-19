import type { Hono } from "hono";
import {
  CLOSED_PRIVACY,
  featureIds,
  featureReady,
} from "@sprout/shared/privacy-v2";
import { publicVenue } from "./privacy-venue";

/** No environment variable can claim a missing verifier/settlement integration is verified. */
export function registerPrivacyV2Routes(app: Hono) {
  app.get("/api/privacy/venue", async (c) => {
    c.header("Cache-Control", "no-store");
    try {
      return c.json(await publicVenue());
    } catch {
      return c.json(
        {
          error:
            "Public venue checks are unavailable. Settlement remains disabled.",
        },
        503,
      );
    }
  });
  app.get("/api/privacy/capabilities", (c) => {
    c.header("Cache-Control", "no-store");
    return c.json({
      version: 2,
      mode: "preparation",
      features: Object.fromEntries(
        featureIds.map((f) => [
          f,
          { preparation: true, settlement: featureReady(f, CLOSED_PRIVACY) },
        ]),
      ),
      requirements: [
        "verified-pool",
        "family-policy-circuit",
        "settlement-integration",
        "holdings-and-solvency-verifiers",
        "graduation-verification",
        "backup-restore-verification",
      ],
    });
  });
  // Explicitly block the SPA fallback too. There is no stub returning a fabricated transaction or proof.
  app.all("/v2", (c) => c.json({ error: "not found" }, 404));
  app.all("/v2/*", (c) => c.json({ error: "not found" }, 404));
  app.all("/api/v2", (c) => c.json({ error: "not found" }, 404));
  app.all("/api/v2/*", (c) => c.json({ error: "not found" }, 404));
}
