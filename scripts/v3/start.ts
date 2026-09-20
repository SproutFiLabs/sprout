/** Reproducible, isolated Anvil stack. Public development keys only; refuses any other chain. */
import { mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { spawn } from "node:child_process";
import {
  erc20Abi,
  parseAbi,
  keccak256,
  toBytes,
  zeroAddress,
  type Address,
} from "viem";
import { deployLocal } from "../deploy-local";
import {
  ROOT,
  deploy,
  rpcClients,
  waitForRpc,
  parentAccount,
  beneficiaryAccount,
  gifterAccount,
  artifact,
  accountClient,
} from "../lib";
import { mockErc20Abi, sproutFactoryAbi, sproutVaultAbi } from "@sprout/shared";
const dir = `${ROOT}/tmp/v3`,
  rpc = "http://127.0.0.1:28557";
mkdirSync(dir, { recursive: true });
const anvil = spawn(
  "/Users/kusko/.foundry/bin/anvil",
  ["--host", "127.0.0.1", "--port", "28557", "--silent"],
  { stdio: ["ignore", "ignore", "inherit"] },
);
await waitForRpc(rpc);
const { publicClient: pc, walletClient: wc } = rpcClients(rpc);
if ((await pc.getChainId()) !== 31337) throw Error("Local chain required");
const d = await deployLocal(pc, wc, rpc);
const matching = await deploy(pc, wc, "MatchVault.sol", "MatchVault"),
  roundups = await deploy(pc, wc, "RoundupModule.sol", "RoundupModule"),
  eventBook = await deploy(pc, wc, "EventBook.sol", "EventBook"),
  treasury = await deploy(pc, wc, "LocalTreasury.sol", "LocalTreasury", [
    d.settlement,
  ]),
  policy = await deploy(pc, wc, "TreasuryPolicy.sol", "TreasuryPolicy", [
    parentAccount.address,
    86400n,
  ]),
  implementation = await deploy(pc, wc, "SproutV3Vault.sol", "SproutV3Vault", [
    matching,
    treasury,
    policy,
  ]),
  factory = await deploy(pc, wc, "SproutFactory.sol", "SproutFactory", [
    implementation,
    d.settlement,
    [d.stockA, d.stockB],
    [d.venue],
  ]);
async function tx(
  address: Address,
  abi: any,
  functionName: string,
  args: any[] = [],
  wallet = wc,
) {
  const h = await wallet.writeContract({
    address,
    abi,
    functionName,
    args,
  } as never);
  const r = await pc.waitForTransactionReceipt({ hash: h });
  if (r.status !== "success") throw Error(`${functionName} reverted`);
  return h;
}
const now = (await pc.getBlock()).timestamp;
await tx(factory, sproutFactoryAbi, "createSprout", [
  beneficiaryAccount.address,
  d.settlement,
  [d.stockA, d.stockB],
  [6000, 4000],
  now + 5n * 365n * 86400n,
  [d.venue],
]);
const vault = (
  await pc.readContract({
    address: factory,
    abi: sproutFactoryAbi,
    functionName: "sproutsOf",
    args: [parentAccount.address],
  })
)[0]!;
await tx(d.settlement, erc20Abi, "approve", [vault, 5000_000000n]);
await tx(vault, sproutVaultAbi, "fund", [d.settlement, 2850_000000n]);
await tx(d.stockA, mockErc20Abi, "mint", [vault, 8n * 10n ** 18n]);
await tx(d.stockB, mockErc20Abi, "mint", [vault, 12n * 10n ** 18n]);
await tx(
  policy,
  artifact("TreasuryPolicy.sol", "TreasuryPolicy").abi,
  "setPermitted",
  [vault, true],
);
await tx(
  policy,
  artifact("TreasuryPolicy.sol", "TreasuryPolicy").abi,
  "publishHeartbeat",
);
const giver = accountClient(rpc, gifterAccount);
await tx(d.settlement, erc20Abi, "approve", [matching, 600_000000n], giver);
await tx(
  matching,
  artifact("MatchVault.sol", "MatchVault").abi,
  "commit",
  [vault, 600_000000n, 100_000000n, 6],
  giver,
);
await tx(vault, sproutVaultAbi, "fund", [d.settlement, 50_000000n]);
const v3 = artifact("SproutV3Vault.sol", "SproutV3Vault").abi;
await tx(vault, v3, "writePlan", [
  gifterAccount.address,
  zeroAddress,
  90n * 86400n,
  14n * 86400n,
  0n,
  keccak256(toBytes("Local practice continuity plan")),
  50_000000n,
  30n * 86400n,
]);
await tx(vault, v3, "fundReserve", [600_000000n]);
await tx(vault, v3, "setCashEnabled", [true]);
await tx(vault, v3, "parkCash", [500_000000n, 500_000000n]);
await tx(d.settlement, mockErc20Abi, "mint", [treasury, 5_000000n]);
const keyPath = `${dir}/data-key`;
if (!existsSync(keyPath))
  writeFileSync(keyPath, randomBytes(32).toString("hex"), { mode: 0o600 });
Object.assign(process.env, {
  SPROUT_CHAIN_ID: "31337",
  SPROUT_RPC_URL: rpc,
  SPROUT_FACTORY_ADDRESS: factory,
  SPROUT_SETTLEMENT_TOKEN: d.settlement,
  SPROUT_VENUE_ADDRESS: d.venue,
  SPROUT_STOCK_TOKENS: `AAA:${d.stockA}:18:1000000000000000000:${d.feedA}:86400,BBB:${d.stockB}:18:1000000000000000000:${d.feedB}:86400`,
  SPROUT_SETTLEMENT_DECIMALS: "6",
  SPROUT_LOCAL_DEMO: "1",
  SPROUT_USE_LOCAL_KEYS: "1",
  SPROUT_KEEPER_PRIVATE_KEY:
    "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80",
  SPROUT_KEEPER_MAX_FEE_PER_GAS_WEI: "5000000000",
  SPROUT_KEEPER_MAX_PRIORITY_FEE_PER_GAS_WEI: "2000000000",
  SPROUT_KEEPER_GAS_LIMIT_CAP: "6000000",
  SPROUT_KEEPER_DAILY_FEE_BUDGET_WEI: "100000000000000000",
  SPROUT_DB_PATH: `${dir}/sprout-${Date.now()}.sqlite`,
  SPROUT_PORT: "4338",
  SPROUT_V3_ENABLED: "true",
  SPROUT_V3_FACTORY: factory,
  SPROUT_V3_MATCHING: matching,
  SPROUT_V3_ROUNDUP_MODULE: roundups,
  SPROUT_V3_EVENT_BOOK: eventBook,
  SPROUT_V3_EXECUTOR: parentAccount.address,
  SPROUT_V3_TREASURY_APPROVED: "true",
  SPROUT_V3_DATA_KEY: readFileSync(keyPath, "utf8"),
  SPROUT_V3_AUTO_PARK: "false",
  SPROUT_PUBLIC_WALLET_RPC_URL: rpc,
});
const { createServer } = await import("../../server/src/index");
const server = createServer();
await server.runMaintenance();
writeFileSync(
  `${dir}/deployment.json`,
  JSON.stringify(
    {
      ...d,
      factory,
      vault,
      matching,
      roundups,
      eventBook,
      treasury,
      policy,
      implementation,
      parent: parentAccount.address,
      child: beneficiaryAccount.address,
      sponsor: gifterAccount.address,
      db: process.env.SPROUT_DB_PATH,
    },
    null,
    2,
  ),
);
const vite = spawn(
  "/opt/homebrew/bin/bun",
  [
    "node_modules/vite/bin/vite.js",
    "--host",
    "127.0.0.1",
    "--port",
    "5198",
    "--strictPort",
  ],
  {
    cwd: `${ROOT}/web`,
    env: { ...process.env, SPROUT_API_PROXY: "http://127.0.0.1:4338" },
    stdio: ["ignore", "inherit", "inherit"],
  },
);
console.log(`V3_LOCAL_READY http://127.0.0.1:5198/grow/events?vault=${vault}`);
async function stop() {
  vite.kill();
  await server.stop();
  anvil.kill();
  process.exit(0);
}
process.on("SIGINT", () => void stop());
process.on("SIGTERM", () => void stop());
