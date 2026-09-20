// Resume only the API for the already-running isolated Anvil deployment.
import { readFileSync } from "node:fs";
import { ROOT, parentAccount, rpcClients } from "../lib";
const dir = `${ROOT}/tmp/v3`,
  d = JSON.parse(readFileSync(`${dir}/deployment.json`, "utf8"));
const { factory, matching, roundups, eventBook } = d,
  rpc = d.rpcUrl,
  keyPath = `${dir}/data-key`;
const { publicClient } = rpcClients(rpc);
if (
  (await publicClient.getChainId()) !== 31337 ||
  !(await publicClient.getCode({ address: factory }))
)
  throw Error("The original local deployment is unavailable.");
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
  SPROUT_DB_PATH: d.db,
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
console.log("Expansion API resumed on port 4338 with current source.");
process.on("SIGINT", () => void server.stop().then(() => process.exit(0)));
process.on("SIGTERM", () => void server.stop().then(() => process.exit(0)));
