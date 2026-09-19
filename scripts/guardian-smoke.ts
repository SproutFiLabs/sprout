/** Real contract + P-256 integration on a disposable local Anvil only. */
import {
  createPublicClient,
  createWalletClient,
  http,
  sha256,
  stringToHex,
  bytesToHex,
  keccak256,
  type Address,
  type Hex,
} from "viem";
import { generateKeyPairSync, sign } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import artifact from "../web/src/guardian/contract.json";
import { parseDerSignature } from "../web/src/guardian/passkey";
import { readGuardian } from "../web/src/guardian/model";
import { mockErc20Abi } from "@sprout/shared";
const rpc = process.env.GUARDIAN_TEST_RPC ?? "http://127.0.0.1:28547";
if (!["127.0.0.1", "localhost"].includes(new URL(rpc).hostname))
  throw new Error("Local Anvil only");
const client = createPublicClient({ transport: http(rpc) });
if ((await client.getChainId()) !== 31337) throw new Error("Local Anvil only");
const accounts = (await client.request({
  method: "eth_accounts",
} as never)) as Address[];
const owner = accounts[0]!,
  guardians = accounts.slice(2, 5) as [Address, Address, Address],
  next = accounts[5]!;
const config = (await fetch(
  process.env.GUARDIAN_TEST_API ?? "http://127.0.0.1:4327/api/config",
).then((r) => r.json())) as any;
const token = config.chain.contracts.settlementToken as Address;
const wallet = (account: Address) =>
  createWalletClient({ account, transport: http(rpc) });
const confirmed = async (hash: Hex) => {
  const r = await client.waitForTransactionReceipt({ hash });
  if (r.status !== "success") throw new Error("Transaction reverted");
  return r;
};
const receipt = await confirmed(
  await wallet(owner).deployContract({
    abi: artifact.abi,
    bytecode: artifact.bytecode as Hex,
    args: [
      owner,
      guardians,
      token,
      100000000n,
      sha256(stringToHex("localhost")),
      "http://localhost:5187",
    ],
    chain: null,
  }),
);
const address = receipt.contractAddress!;
const write = async (from: Address, name: string, args: unknown[] = []) =>
  confirmed(
    await wallet(from).writeContract({
      address,
      abi: artifact.abi,
      functionName: name,
      args,
      chain: null,
    }),
  );
const read = (name: string, args: unknown[] = []) =>
  client.readContract({
    address,
    abi: artifact.abi,
    functionName: name,
    args,
  }) as Promise<any>;
const expectRejected = async (fn: () => Promise<unknown>, label: string) => {
  try {
    await fn();
  } catch {
    console.log("Rejected:", label);
    return;
  }
  throw new Error("Unexpected acceptance: " + label);
};
await confirmed(
  await wallet(owner).writeContract({
    address: token,
    abi: mockErc20Abi,
    functionName: "mint",
    args: [address, 1250000000n],
    chain: null,
  }),
);
const { privateKey, publicKey } = generateKeyPairSync("ec", {
  namedCurve: "prime256v1",
});
const jwk = publicKey.export({ format: "jwk" });
const deviceId = keccak256(stringToHex("isolated-test-passkey"));
const expiry = (await client.getBlock()).timestamp + 365n * 86400n;
await write(owner, "addDevice", [
  deviceId,
  bytesToHex(Buffer.from(jwk.x!, "base64url")),
  bytesToHex(Buffer.from(jwk.y!, "base64url")),
  expiry,
]);
const out = "tmp/guardian-smoke";
mkdirSync(out, { recursive: true });
const save = async (name: string) => {
  const s = await readGuardian(client as never, address, token);
  writeFileSync(
    `${out}/${name}.json`,
    JSON.stringify(
      {
        snapshot: s,
        chainTime: Number((await client.getBlock()).timestamp),
        token,
      },
      (_, v) => (typeof v === "bigint" ? v.toString() : v),
      2,
    ),
  );
};
await save("protected");
const deadline = (await client.getBlock()).timestamp + 300n;
const challenge = (await read("challenge", [
  0,
  owner,
  token,
  25000000n,
  deadline,
])) as Hex;
const clientDataJSON = JSON.stringify({
  type: "webauthn.get",
  challenge: Buffer.from(challenge.slice(2), "hex").toString("base64url"),
  origin: "http://localhost:5187",
  crossOrigin: false,
});
const auth = Buffer.concat([
  Buffer.from(sha256(stringToHex("localhost")).slice(2), "hex"),
  Buffer.from([5, 0, 0, 0, 0]),
]);
const signed = Buffer.concat([
  auth,
  Buffer.from(sha256(stringToHex(clientDataJSON)).slice(2), "hex"),
]);
const assertion = {
  authenticatorData: bytesToHex(auth),
  clientDataJSON,
  challengeIndex: BigInt(clientDataJSON.indexOf('"challenge":"')),
  typeIndex: BigInt(clientDataJSON.indexOf('"type":"')),
  originIndex: BigInt(clientDataJSON.indexOf('"origin":"')),
  ...parseDerSignature(sign("sha256", signed, privateKey)),
};
await write(accounts[1]!, "actWithPasskey", [
  0,
  owner,
  token,
  25000000n,
  deadline,
  deviceId,
  assertion,
]);
await expectRejected(
  () =>
    write(accounts[1]!, "actWithPasskey", [
      0,
      owner,
      token,
      25000000n,
      deadline,
      deviceId,
      assertion,
    ]),
  "replayed passkey assertion",
);
await expectRejected(
  () => write(owner, "act", [0, owner, token, 76000000n]),
  "over-budget owner transfer",
);
await write(owner, "act", [1, accounts[6]!, token, 250000000n]);
await expectRejected(
  () => write(owner, "executeTransfer", [1n]),
  "early queued transfer",
);
await save("queued");
await write(guardians[0], "startRecovery", [next]);
await save("one-approval");
await expectRejected(
  () => write(guardians[0], "approveRecovery", [1n]),
  "same guardian voting twice",
);
await write(guardians[1], "approveRecovery", [1n]);
await save("two-approvals");
await expectRejected(
  () => write(owner, "act", [0, owner, token, 1000000n]),
  "spend during recovery quorum hold",
);
await expectRejected(
  () => write(next, "executeRecovery", [1n]),
  "early recovery",
);
await client.request({ method: "evm_increaseTime", params: [172801] } as never);
await client.request({ method: "evm_mine", params: [] } as never);
await write(next, "executeRecovery", [1n]);
await save("recovered");
await expectRejected(
  () => write(owner, "act", [0, owner, token, 1n]),
  "former owner after recovery",
);
await expectRejected(
  () => write(next, "executeTransfer", [1n]),
  "old queued transfer after recovery",
);
if ((await read("owner")).toLowerCase() !== next.toLowerCase())
  throw new Error("Wrong replacement owner");
writeFileSync(
  `${out}/result.json`,
  JSON.stringify(
    {
      account: address,
      chainId: 31337,
      checks:
        "P256 transfer, replay rejection, budget enforcement, queue delay, guardian quorum, outgoing hold, recovery delay, owner rotation, old credential epoch invalidation, old queued transfer invalidation",
      gasUsedDeployment: receipt.gasUsed.toString(),
    },
    null,
    2,
  ),
);
console.log(
  "Guardian contract smoke passed",
  address,
  "deployment gas",
  receipt.gasUsed.toString(),
);
