import {
  createPublicClient,
  http,
  encodeDeployData,
  sha256,
  stringToHex,
  bytesToHex,
  concatHex,
} from "viem";
import { generateKeyPairSync, sign } from "node:crypto";
import { parseDerSignature } from "../web/src/guardian/passkey";
import { matchesGuardianRuntime } from "../web/src/guardian/model";
import artifact from "../web/src/guardian/contract.json";
const client = createPublicClient({
  transport: http("https://rpc.mainnet.chain.robinhood.com"),
});
if ((await client.getChainId()) !== 4663) throw new Error("Wrong chain");
const { privateKey, publicKey } = generateKeyPairSync("ec", {
  namedCurve: "prime256v1",
});
const jwk = publicKey.export({ format: "jwk" });
const data = stringToHex("Sprout Guardian P256 compatibility check");
const h = sha256(data);
const { r, s } = parseDerSignature(
  sign("sha256", Buffer.from(data.slice(2), "hex"), privateKey),
);
const x = bytesToHex(Buffer.from(jwk.x!, "base64url")),
  y = bytesToHex(Buffer.from(jwk.y!, "base64url"));
const native = await client.call({
  to: "0x0000000000000000000000000000000000000100",
  data: concatHex([h, r, s, x, y]),
});
const invalid = await client.call({
  to: "0x0000000000000000000000000000000000000100",
  data: concatHex([sha256(stringToHex("wrong")), r, s, x, y]),
});
console.log(
  "P256 native valid:",
  native.data ?? "0x",
  "invalid:",
  invalid.data ?? "0x",
);
if (native.data && BigInt(native.data) !== 1n)
  throw new Error("Native verifier failed valid vector");
if (invalid.data && BigInt(invalid.data) !== 0n)
  throw new Error("Native verifier accepted invalid signature");
const owner = "0x0000000000000000000000000000000000000011";
const deployed = await client.call({
  account: owner,
  data: encodeDeployData({
    abi: artifact.abi,
    bytecode: artifact.bytecode as `0x${string}`,
    args: [
      owner,
      [
        "0x0000000000000000000000000000000000000021",
        "0x0000000000000000000000000000000000000022",
        "0x0000000000000000000000000000000000000023",
      ],
      "0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168",
      100000000n,
      sha256(stringToHex("www.sproutfy.tech")),
      "https://www.sproutfy.tech",
    ],
  }),
  gas: 10000000n,
});
if (!deployed.data || !matchesGuardianRuntime(deployed.data))
  throw new Error("Mainnet creation simulation differs from tested runtime");
console.log(
  "Mainnet eth_call creation simulation matches tested runtime. No transaction sent.",
);
