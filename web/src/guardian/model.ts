import {
  getAddress,
  isAddress,
  keccak256,
  parseUnits,
  type Address,
  type Hex,
  type PublicClient,
} from "viem";
import artifact from "./contract.json";
export const guardianAbi = artifact.abi;
export const ZERO = "0x0000000000000000000000000000000000000000" as Address;
export const EMPTY = ("0x" + "0".repeat(64)) as Hex;
export const short = (s: string) => s.slice(0, 6) + "…" + s.slice(-4);
export function amountUnits(value: string, decimals: number): bigint {
  if (
    !/^(0|[1-9]\d*)(\.\d+)?$/.test(value) ||
    (value.split(".")[1]?.length ?? 0) > decimals
  )
    throw new Error("Enter an exact positive token amount.");
  const result = parseUnits(value, decimals);
  if (result <= 0n || result >= 2n ** 256n)
    throw new Error("Amount is outside the supported range.");
  return result;
}
export function walletAddress(s: string): Address {
  if (!isAddress(s) || s.toLowerCase() === ZERO)
    throw new Error("Enter a valid nonzero wallet address.");
  return getAddress(s);
}
export function guardiansInput(
  owner: Address,
  values: string[],
): [Address, Address, Address] {
  if (values.length !== 3) throw new Error("Choose three guardians.");
  const a = values.map(walletAddress);
  if (new Set([owner, ...a].map((x) => x.toLowerCase())).size !== 4)
    throw new Error("Owner and guardians must be four different wallets.");
  return a as [Address, Address, Address];
}
export function matchesGuardianRuntime(code: Hex): boolean {
  let raw = code.slice(2);
  for (const r of artifact.immutableReferences) {
    if ((r.start + r.length) * 2 > raw.length) return false;
    raw =
      raw.slice(0, r.start * 2) +
      "0".repeat(r.length * 2) +
      raw.slice((r.start + r.length) * 2);
  }
  return keccak256(("0x" + raw) as Hex) === artifact.runtimeHash;
}
export type GuardianDevice = {
  id: Hex;
  expiresAt: number;
  epoch: bigint;
  enabled: boolean;
};
export type GuardianTransfer = {
  id: bigint;
  token: Address;
  to: Address;
  amount: bigint;
  readyAt: number;
  epoch: bigint;
  closed: boolean;
};
export type GuardianSnapshot = {
  chainTime: number;
  address: Address;
  owner: Address;
  guardians: Address[];
  epoch: bigint;
  limit: bigint;
  remaining: bigint;
  resetAt: number;
  recoveryId: bigint;
  recovery: {
    newOwner: Address;
    readyAt: number;
    expiresAt: number;
    approvals: number;
    closed: boolean;
  };
  approved: boolean[];
  devices: GuardianDevice[];
  transfers: GuardianTransfer[];
  transferCount: bigint;
  policyHash: Hex;
  policyReadyAt: number;
  origin: string;
};
export async function readGuardian(
  client: PublicClient,
  address: Address,
  token: Address,
  queueEnd?: bigint,
): Promise<GuardianSnapshot> {
  const block = await client.getBlock();
  const code = await client.getCode({ address, blockNumber: block.number });
  if (!code || !matchesGuardianRuntime(code))
    throw new Error(
      "This address does not match the published Sprout Guardian contract.",
    );
  const read = (functionName: string, args: unknown[] = []) =>
    client.readContract({
      address,
      abi: guardianAbi,
      functionName,
      args,
      blockNumber: block.number,
    } as never) as Promise<any>;
  const [
    owner,
    guardians,
    epoch,
    budget,
    left,
    recoveryId,
    recovery,
    ids,
    count,
    policyHash,
    policyReadyAt,
    origin,
  ] = await Promise.all([
    read("owner"),
    Promise.all([0, 1, 2].map((i) => read("guardians", [BigInt(i)]))),
    read("epoch"),
    read("budgets", [token]),
    read("remaining", [token]),
    read("recoveryId"),
    read("recovery"),
    read("deviceIds"),
    read("transferCount"),
    read("pendingPolicy"),
    read("policyReadyAt"),
    read("origin"),
  ]);
  const end = queueEnd !== undefined && queueEnd < count ? queueEnd : count;
  const start = end > 20n ? end - 19n : 1n;
  const transferIds: bigint[] = [];
  for (let i = start; i <= end; i++) transferIds.push(i);
  const [devices, transfers, approved] = await Promise.all([
    Promise.all(
      (ids as Hex[]).map(async (id) => {
        const d = await read("devices", [id]);
        return {
          id,
          expiresAt: Number(d[2]),
          epoch: d[3] as bigint,
          enabled: d[4] as boolean,
        };
      }),
    ),
    Promise.all(
      transferIds.map(async (id) => {
        const t = await read("transfers", [id]);
        return {
          id,
          token: t[0],
          to: t[1],
          amount: t[2],
          readyAt: Number(t[3]),
          epoch: t[4],
          closed: t[5],
        } as GuardianTransfer;
      }),
    ),
    Promise.all(
      guardians.map((g: Address) => read("recoveryApproved", [recoveryId, g])),
    ),
  ]);
  return {
    chainTime: Number(block.timestamp),
    address,
    owner,
    guardians,
    epoch,
    limit: budget[0],
    remaining: left,
    resetAt: Number(budget[2]),
    recoveryId,
    recovery: {
      newOwner: recovery[0],
      readyAt: Number(recovery[1]),
      expiresAt: Number(recovery[2]),
      approvals: recovery[3],
      closed: recovery[4],
    },
    approved,
    devices,
    transfers,
    transferCount: count,
    policyHash,
    policyReadyAt: Number(policyReadyAt),
    origin,
  };
}
export function countdown(readyAt: number, now: number) {
  const seconds = Math.max(0, readyAt - now);
  if (seconds === 0) return "Ready to execute";
  const h = Math.floor(seconds / 3600),
    m = Math.floor((seconds % 3600) / 60);
  return `${h}h ${m.toString().padStart(2, "0")}m`;
}
