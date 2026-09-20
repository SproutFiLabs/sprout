import { z } from "zod";
import { zeroAddress } from "viem";
import { EXPANSION_PAGES, type V3PublicConfig } from "@sprout/shared";
const addr = z.string().regex(/^0x[0-9a-fA-F]{40}$/);
export function expansionConfig(
  env: Record<string, string | undefined>,
  chainId: number,
  local: boolean,
): V3PublicConfig {
  const address = (key: string) =>
    addr.safeParse(env[key]).success ? env[key]! : zeroAddress;
  const enabled = env.SPROUT_V3_ENABLED === "true";
  const flags = Object.fromEntries(
    EXPANSION_PAGES.map((p) => [
      p,
      enabled && env[`SPROUT_V3_${p.toUpperCase()}`] !== "false",
    ]),
  ) as V3PublicConfig["flags"];
  const factory = address("SPROUT_V3_FACTORY"),
    matching = address("SPROUT_V3_MATCHING"),
    roundups = address("SPROUT_V3_ROUNDUP_MODULE"),
    eventBook = address("SPROUT_V3_EVENT_BOOK"),
    executor = address("SPROUT_V3_EXECUTOR");
  return {
    enabled:
      enabled &&
      [factory, matching, roundups, eventBook, executor].every(
        (x) => x !== zeroAddress,
      ),
    flags,
    local: local && chainId === 31337,
    chainId,
    factory,
    matching,
    roundups,
    eventBook,
    executor,
    treasuryAvailable: env.SPROUT_V3_TREASURY_APPROVED === "true",
  };
}
