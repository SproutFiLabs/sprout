import { readFileSync, writeFileSync } from "node:fs";
import { keccak256, type Hex } from "viem";
import { createHash } from "node:crypto";
import { join } from "node:path";
const root = join(import.meta.dir, "..");
const a = JSON.parse(
  readFileSync(
    join(root, "contracts/out/SproutGuardian.sol/SproutGuardian.json"),
    "utf8",
  ),
);
const refs = Object.values(
  a.deployedBytecode.immutableReferences,
).flat() as Array<{ start: number; length: number }>;
let code = a.deployedBytecode.object.slice(2);
for (const r of refs)
  code =
    code.slice(0, r.start * 2) +
    "0".repeat(r.length * 2) +
    code.slice((r.start + r.length) * 2);
const files = [
  "contracts/src/SproutGuardian.sol",
  "contracts/src/GuardianWebAuthn.sol",
];
writeFileSync(
  join(root, "web/src/guardian/contract.json"),
  JSON.stringify(
    {
      abi: a.abi,
      bytecode: a.bytecode.object,
      runtimeHash: keccak256(("0x" + code) as Hex),
      immutableReferences: refs,
      sourceHashes: Object.fromEntries(
        files.map((f) => [
          f,
          createHash("sha256")
            .update(readFileSync(join(root, f)))
            .digest("hex"),
        ]),
      ),
    },
    null,
    2,
  ) + "\n",
);
console.log("Generated Guardian deployment artifact and runtime fingerprint");
