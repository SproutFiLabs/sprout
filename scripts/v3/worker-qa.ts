import { readFileSync, writeFileSync } from "node:fs";
import {
  rpcClients,
  accountClient,
  parentAccount,
  signedPost,
  artifact,
} from "../lib";
import { roundupsAbi } from "../../server/src/v3/chain";
const d = JSON.parse(readFileSync("tmp/v3/deployment.json", "utf8")),
  { publicClient: pc, walletClient: wc } = rpcClients(d.rpcUrl),
  base = "http://127.0.0.1:4338";
const auth = await signedPost<{ token: string }>(
  base,
  "/api/family/session",
  parentAccount,
  "family-session",
  {},
);
const get = async () => {
  const r = await fetch(`${base}/api/v3/state?vault=${d.vault}`, {
    headers: { authorization: `Bearer ${auth.token}` },
  });
  return (await r.json()) as any;
};
let before = await get();
if (before.chain.roundup.totalCents === 0) {
  const now = Number((await pc.getBlock()).timestamp);
  const seconds = Math.max(
    0,
    Math.ceil(before.chain.roundup.nextSweep / 1000) - now + 2,
  );
  await pc.request({
    method: "evm_increaseTime" as never,
    params: [seconds] as never,
  });
  await pc.request({ method: "evm_mine" as never });
}
for (const [address, file, fn, args] of [
  [d.feedA, "MockPriceFeed.sol", "setAnswer", [10000000000n]],
  [d.feedB, "MockPriceFeed.sol", "setAnswer", [5000000000n]],
  [d.policy, "TreasuryPolicy.sol", "publishHeartbeat", []],
] as const) {
  const name = file.replace(".sol", "");
  const h = await wc.writeContract({
    address,
    abi: artifact(file, name).abi,
    functionName: fn,
    args,
  } as never);
  await pc.waitForTransactionReceipt({ hash: h });
}
let done: any;
for (let i = 0; i < 40; i++) {
  done = await get();
  if (
    done.chain.roundup.totalCents > 0 &&
    done.ledger.every((e: any) => e.sweepHash)
  )
    break;
  await new Promise((r) => setTimeout(r, 1500));
}
if (
  !done.chain.roundup.totalCents ||
  !done.ledger.every((e: any) => e.sweepHash)
)
  throw Error("Round-up worker did not confirm all journal entries.");
const total = done.ledger.reduce((n: number, e: any) => n + e.roundupCents, 0);
if (total !== done.chain.roundup.totalCents)
  throw Error("Round-up total does not match ledger.");
const rule = await pc.readContract({
  address: d.roundups,
  abi: roundupsAbi,
  functionName: "rules",
  args: [done.chain.roundup.id],
});
if (Number(rule[8]) / 10000 !== total) throw Error("Onchain total mismatch");
writeFileSync(
  "output/v3/qa/worker-report.json",
  JSON.stringify(
    {
      confirmedCents: total,
      entries: done.ledger.length,
      nextSweep: done.chain.roundup.nextSweep,
      allReceipts: true,
    },
    null,
    2,
  ),
);
console.log(
  `Worker verified: ${total} cents contributed exactly once across ${done.ledger.length} real transfers.`,
);
