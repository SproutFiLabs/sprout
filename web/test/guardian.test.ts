import { describe, expect, test } from "bun:test";
import {
  amountUnits,
  guardiansInput,
  matchesGuardianRuntime,
  ZERO,
  countdown,
} from "../src/guardian/model";
import { parseDerSignature } from "../src/guardian/passkey";
import type { Address, Hex } from "viem";
import { readFileSync } from "node:fs";
import artifact from "../src/guardian/contract.json";
const a = (n: number) => ("0x" + n.toString(16).padStart(40, "0")) as Address;
describe("Guardian inputs and contract identity", () => {
  test("never silently rounds an amount or accepts scientific notation", () => {
    expect(amountUnits("1.000001", 6)).toBe(1000001n);
    for (const s of [
      "0",
      "-1",
      "1e6",
      "1.0000001",
      "NaN",
      "Infinity",
      "01",
      " 10",
      "1.",
    ])
      expect(() => amountUnits(s, 6)).toThrow();
  });
  test("requires independent, nonzero guardian addresses", () => {
    expect(guardiansInput(a(1), [a(2), a(3), a(4)])).toHaveLength(3);
    for (const gs of [
      [a(1), a(3), a(4)],
      [a(2), a(2), a(4)],
      [ZERO, a(3), a(4)],
    ])
      expect(() => guardiansInput(a(1), gs)).toThrow();
  });
  test("runtime identity rejects arbitrary and modified contracts", () => {
    const source = JSON.parse(
      readFileSync(
        new URL(
          "../../contracts/out/SproutGuardian.sol/SproutGuardian.json",
          import.meta.url,
        ),
        "utf8",
      ),
    );
    const code = source.deployedBytecode.object as Hex;
    expect(matchesGuardianRuntime(code)).toBe(true);
    expect(matchesGuardianRuntime("0x")).toBe(false);
    expect(matchesGuardianRuntime(("0x00" + code.slice(4)) as Hex)).toBe(false);
    expect(artifact.bytecode).toBe(source.bytecode.object);
  });
  test("countdown does not imply execution before the delay", () => {
    expect(countdown(172800, 0)).toBe("48h 00m");
    expect(countdown(100, 100)).toBe("Ready to execute");
  });
});
describe("P-256 signature conversion", () => {
  test("parses minimal positive DER integers", () => {
    const sig = parseDerSignature(Uint8Array.from([0x30, 6, 2, 1, 1, 2, 1, 2]));
    expect(BigInt(sig.r)).toBe(1n);
    expect(BigInt(sig.s)).toBe(2n);
  });
  test("rejects malformed, negative, zero and padded signatures", () => {
    for (const b of [
      [0x30, 6, 2, 1, 0, 2, 1, 2],
      [0x30, 6, 2, 1, 128, 2, 1, 2],
      [0x30, 7, 2, 2, 0, 1, 2, 1, 2],
      [0x30, 9, 2, 1, 1, 2, 1, 2],
    ])
      expect(() => parseDerSignature(Uint8Array.from(b))).toThrow();
  });
});
