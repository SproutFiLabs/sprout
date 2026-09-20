import {
  encodeFunctionData,
  keccak256,
  toBytes,
  parseAbi,
  erc4626Abi,
  type Address,
} from "viem";
import {
  sproutVaultAbi,
  type RoundupSettings,
  type RoundupEntry,
} from "@sprout/shared";
import { ExpansionStore } from "./store";
import {
  ExpansionChain,
  cents,
  rawCents,
  transferLog,
  roundupsAbi,
  v3Abi,
} from "./chain";
import type { ChainContext } from "../chain";
import { keeperBudget } from "../config";
import {
  keeperSigner,
  keeperChain,
  runKeeperJob,
  withKeeperLock,
} from "../keeper";
import { listAllVaults } from "../indexer";
import { expansionConfig } from "./config";
import type { SproutDb } from "../db";
import { createMutex } from "../lock";
const serialize = createMutex();
const swept = parseAbi([
  "event Swept(bytes32 indexed id,uint256 amount,bytes32 ledgerHash)",
])[0];
interface Pending {
  id: string;
  hash: `0x${string}`;
  amount: number;
  block: string;
  entries: Array<{ id: string; amount: number }>;
}
/** Compute in token base units; only whole cents are pulled, never over-round a fractional-cent transfer. */
export function preciseRoundup(
  value: bigint,
  decimals: number,
  step: 1 | 5 | 10,
  multiplier: 1 | 2 | 3,
) {
  const unit = 10n ** BigInt(decimals),
    boundary = BigInt(step) * unit;
  return cents(
    ((boundary - (value % boundary)) % boundary) * BigInt(multiplier),
    decimals,
  );
}
export async function observe(
  chain: ExpansionChain,
  store: ExpansionStore,
  settings: RoundupSettings,
) {
  const s = await chain.state(settings.vault, settings.wallet);
  if (!s.roundup.active || !settings.enabled) return 0;
  const client = chain.ctx.publicClient!,
    latest = await client.getBlockNumber(),
    confirmed = latest - BigInt(chain.config.local ? 0 : 5),
    from = BigInt(settings.observedThrough) + 1n;
  if (confirmed < from) return 0;
  const to = confirmed > from + 1999n ? from + 1999n : confirmed;
  const internal = new Set(
    [
      settings.vault,
      chain.config.matching,
      chain.config.roundups,
      chain.config.factory,
      settings.wallet,
    ].map((x) => x.toLowerCase()),
  );
  const logs = await client.getLogs({
    address: s.settlement as Address,
    event: transferLog[0],
    args: { from: settings.wallet as Address },
    fromBlock: from,
    toBlock: to,
  });
  const entries: RoundupEntry[] = [];
  for (const l of logs) {
    if (
      l.removed ||
      !l.args.to ||
      l.args.value === undefined ||
      internal.has(l.args.to.toLowerCase())
    )
      continue;
    const amount = preciseRoundup(
      l.args.value,
      s.settlementDecimals,
      settings.step,
      settings.multiplier,
    );
    if (!amount) continue;
    const b = await client.getBlock({ blockNumber: l.blockNumber });
    entries.push({
      id: `${l.transactionHash}-${l.logIndex}`,
      vault: settings.vault,
      at: Number(b.timestamp) * 1000,
      amountCents: cents(l.args.value, s.settlementDecimals),
      roundupCents: amount,
      txHash: l.transactionHash,
      block: l.blockNumber.toString(),
    });
  }
  return store.transaction(() => {
    const fresh = store.get<RoundupSettings>(
      settings.wallet,
      "roundups",
      settings.vault,
    );
    if (!fresh || JSON.stringify(fresh) !== JSON.stringify(settings)) return 0;
    let added = 0;
    for (const e of entries)
      if (!store.get(settings.wallet, "roundup-entry", e.id)) {
        store.put(settings.wallet, "roundup-entry", e.id, e);
        added++;
      }
    fresh.observedThrough = to.toString();
    store.put(settings.wallet, "roundups", settings.vault, fresh);
    return added;
  });
}
export function createExpansionWorker(
  ctx: ChainContext,
  db: SproutDb,
  env: Record<string, string | undefined> = process.env,
) {
  const config = expansionConfig(
    env,
    ctx.config.chain.chainId,
    ctx.config.allowFixtures,
  );
  const key = env.SPROUT_V3_DATA_KEY;
  const store =
    config.enabled && key && /^[0-9a-fA-F]{64}$/.test(key)
      ? new ExpansionStore(db, Buffer.from(key, "hex"))
      : null;
  const chain = new ExpansionChain(ctx, config);
  return {
    tick: () =>
      serialize(async () => {
        if (!store || !ctx.publicClient) return;
        const signer = keeperSigner(ctx),
          budget = keeperBudget(ctx.config),
          client = ctx.publicClient;
        for (const vault of listAllVaults(db, config.chainId)) {
          try {
            await chain.validate(vault);
          } catch {
            continue;
          }
          try {
            const parent = await chain.read<Address>(
              vault,
              sproutVaultAbi,
              "parent",
            );
            const owner = parent.toLowerCase();
            const settings = store.get<RoundupSettings>(
              owner,
              "roundups",
              vault.toLowerCase(),
            );
            if (config.flags.roundups && settings?.enabled)
              await observe(chain, store, settings);
            const state = await chain.state(vault, parent),
              now = Math.floor(state.now / 1000);
            if (config.flags.roundups && settings) {
              let pending = store.get<Pending>(
                owner,
                "roundup-pending",
                vault.toLowerCase(),
              );
              if (pending) {
                // Reconcile by the committed ledger hash after crashes or uncertain sends.
                const tip = await client.getBlockNumber(),
                  from = BigInt(pending.block),
                  to = tip > from + 1999n ? from + 1999n : tip;
                const logs = await client.getLogs({
                  address: config.roundups as Address,
                  event: swept,
                  args: { id: settings.id as `0x${string}` },
                  fromBlock: from,
                  toBlock: to,
                });
                const receipt = logs.find(
                  (l) => !l.removed && l.args.ledgerHash === pending!.hash,
                );
                if (receipt) {
                  const tx = await client.getTransactionReceipt({
                    hash: receipt.transactionHash,
                  });
                  if (
                    tx.status === "success" &&
                    tip >= tx.blockNumber + BigInt(config.local ? 0 : 5)
                  ) {
                    store.transaction(() => {
                      for (const part of pending!.entries) {
                        const e = store.get<RoundupEntry>(
                          owner,
                          "roundup-entry",
                          part.id,
                        );
                        if (!e) continue;
                        e.sweptCents = (e.sweptCents ?? 0) + part.amount;
                        if (e.sweptCents >= e.roundupCents)
                          e.sweepHash = receipt.transactionHash;
                        store.put(owner, "roundup-entry", e.id, e);
                      }
                      store.delete(
                        owner,
                        "roundup-pending",
                        vault.toLowerCase(),
                      );
                    });
                    pending = null;
                  }
                } else if (to < tip) {
                  pending.block = (to + 1n).toString();
                  store.put(
                    owner,
                    "roundup-pending",
                    vault.toLowerCase(),
                    pending,
                  );
                  continue;
                }
              }
              if (
                !pending &&
                settings.enabled &&
                state.roundup.active &&
                state.now >= state.roundup.nextSweep
              ) {
                const entries = store
                  .list<RoundupEntry>(owner, "roundup-entry")
                  .filter(
                    (e) => e.vault === vault.toLowerCase() && !e.sweepHash,
                  )
                  .reverse();
                let left = state.roundup.capCents;
                const parts: Pending["entries"] = [];
                for (const e of entries) {
                  const n = Math.min(
                    left,
                    e.roundupCents - (e.sweptCents ?? 0),
                  );
                  if (n > 0) {
                    parts.push({ id: e.id, amount: n });
                    left -= n;
                  }
                }
                if (parts.length) {
                  const hash = keccak256(
                    toBytes(
                      JSON.stringify({
                        rule: settings.id,
                        week: state.roundup.nextSweep,
                        parts,
                      }),
                    ),
                  );
                  pending = {
                    id: `v3-roundup:${hash}`,
                    hash,
                    amount: state.roundup.capCents - left,
                    block: state.block,
                    entries: parts,
                  };
                  store.put(
                    owner,
                    "roundup-pending",
                    vault.toLowerCase(),
                    pending,
                  );
                }
              }
              if (
                pending &&
                settings.enabled &&
                state.roundup.active &&
                state.now >= state.roundup.nextSweep &&
                signer &&
                budget &&
                signer.address.toLowerCase() ===
                  state.roundup.executor.toLowerCase()
              )
                await withKeeperLock(() =>
                  runKeeperJob(keeperChain(ctx), signer, db, {
                    jobId: pending!.id,
                    vaultId: config.roundups,
                    chainId: config.chainId,
                    data: encodeFunctionData({
                      abi: roundupsAbi,
                      functionName: "sweep",
                      args: [
                        settings.id as `0x${string}`,
                        rawCents(pending!.amount, state.settlementDecimals),
                        pending!.hash,
                      ],
                    }),
                    budget,
                    nowSeconds: now,
                    sinceMs: Date.now() - 86400000,
                    maxReceiptAttempts: 1,
                    delayMs: 0,
                  }),
                );
            }
            if (
              config.flags.cash &&
              state.cash.enabled &&
              state.cash.permitted &&
              state.cash.policyFresh &&
              signer &&
              budget &&
              env.SPROUT_V3_AUTO_PARK === "true"
            ) {
              const schedule = await chain.read<
                readonly [boolean, bigint, bigint, bigint, bigint]
              >(vault, sproutVaultAbi, "schedule");
              // Keep one whole scheduled purchase liquid. Due investments run before this worker.
              const available = rawCents(
                state.availableCents,
                state.settlementDecimals,
              );
              const buffer = schedule[0] ? schedule[1] : 0n;
              const amount = available > buffer ? available - buffer : 0n;
              if (amount >= rawCents(100, state.settlementDecimals)) {
                const quoted = await chain.read<bigint>(
                  state.cash.treasury,
                  erc4626Abi,
                  "previewDeposit",
                  [amount],
                );
                await withKeeperLock(() =>
                  runKeeperJob(keeperChain(ctx), signer, db, {
                    jobId: `v3-cash:${vault}:${state.block}`,
                    vaultId: vault,
                    chainId: config.chainId,
                    data: encodeFunctionData({
                      abi: v3Abi,
                      functionName: "parkCash",
                      args: [amount, (quoted * 9990n) / 10000n],
                    }),
                    budget,
                    nowSeconds: now,
                    sinceMs: Date.now() - 86400000,
                    maxReceiptAttempts: 1,
                    delayMs: 0,
                  }),
                );
              }
            }
            store.put(owner, "worker", vault.toLowerCase(), {
              checkedAt: Date.now(),
              status: "checked",
              roundups: !!settings?.enabled,
              automation: !!signer && !!budget,
              autoParking: env.SPROUT_V3_AUTO_PARK === "true",
              checkInDue:
                state.continuity.hash !== `0x${"0".repeat(64)}` &&
                state.now >=
                  state.continuity.heartbeatAt +
                    state.continuity.cadence * 1000,
            });
          } catch {
            const owner = await chain
              .read<Address>(vault, sproutVaultAbi, "parent")
              .catch(() => null);
            if (owner)
              store.put(owner, "worker", vault.toLowerCase(), {
                checkedAt: Date.now(),
                status: "needs-attention",
              });
          }
        }
      }),
  };
}
