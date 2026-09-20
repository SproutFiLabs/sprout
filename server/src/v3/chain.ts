import {
  encodeFunctionData,
  parseAbi,
  erc20Abi,
  erc4626Abi,
  keccak256,
  encodeAbiParameters,
  parseAbiParameters,
  zeroAddress,
  type Address,
  type Hex,
  type Abi,
} from "viem";
import {
  sproutFactoryAbi,
  sproutVaultAbi,
  type PreparedTransaction,
  type V3ChainState,
  type V3PublicConfig,
} from "@sprout/shared";
import { cachedHoldings, type ChainContext } from "../chain";
import { investQuote } from "../invest";

export const v3Abi = parseAbi([
  "function matchVault() view returns(address)",
  "function treasury() view returns(address)",
  "function treasuryPolicy() view returns(address)",
  "function cashEnabled() view returns(bool)",
  "function successor() view returns(address)",
  "function coGuardian() view returns(address)",
  "function planHash() view returns(bytes32)",
  "function heartbeatAt() view returns(uint64)",
  "function cadence() view returns(uint64)",
  "function grace() view returns(uint64)",
  "function claimAt() view returns(uint64)",
  "function earlyGraduation() view returns(uint64)",
  "function continuityActive() view returns(bool)",
  "function continuityReserve() view returns(uint256)",
  "function reserveInstallment() view returns(uint256)",
  "function planEpoch() view returns(uint256)",
  "function setCashEnabled(bool enabled)",
  "function parkCash(uint256 assets,uint256 minShares)",
  "function unparkCash(uint256 assets)",
  "function writePlan(address successor,address coGuardian,uint64 cadence,uint64 grace,uint64 early,bytes32 hash,uint256 installment,uint64 period)",
  "function checkIn()",
  "function armContinuity()",
  "function activateContinuity(uint256 epoch)",
  "function cancelClaim()",
  "function revokePlan()",
  "function fundReserve(uint256 amount)",
  "function refundReserve(uint256 amount)",
]);
export const matchingAbi = parseAbi([
  "function activeIds(address vault) view returns(uint256[])",
  "function commitments(uint256) view returns(address sponsor,address vault,address token,uint256 cap,uint256 remaining,uint256 matched,uint64 starts,uint64 expires,uint64 window,uint256 windowSpent,bool cancelled)",
  "function commit(address vault,uint256 budget,uint256 cap,uint8 periods) returns(uint256)",
  "function cancel(uint256 id)",
]);
export const roundupsAbi = parseAbi([
  "function rules(bytes32) view returns(address wallet,address vault,address executor,address token,uint256 cap,uint64 starts,uint64 expires,uint64 nextSweep,uint256 total,bool active)",
  "function link(address vault,address executor,uint256 cap,uint64 expires) returns(bytes32)",
  "function unlink(bytes32 id)",
  "function sweep(bytes32 id,uint256 amount,bytes32 ledgerHash)",
]);
export const policyAbi = parseAbi([
  "function permitted(address) view returns(bool)",
  "function updatedAt() view returns(uint64)",
  "function maxAge() view returns(uint64)",
]);
export const giftLog = parseAbi([
  "event GiftReceived(address indexed gifter,address indexed token,uint256 amount,bytes32 indexed giftRef)",
]);
export const transferLog = parseAbi([
  "event Transfer(address indexed from,address indexed to,uint256 value)",
]);
export const eventBookAbi = parseAbi([
  "function create(bytes32 id,address vault,bytes32 detailsHash,uint64 expires)",
  "function close(bytes32 id)",
]);
const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();
export function cents(raw: bigint, decimals: number) {
  const n = (raw * 100n) / 10n ** BigInt(decimals);
  if (n > BigInt(Number.MAX_SAFE_INTEGER) || n < 0n)
    throw Error("Amount is outside the supported display range.");
  return Number(n);
}
export function rawCents(value: number, decimals: number) {
  if (!Number.isSafeInteger(value) || value < 0) throw Error("Invalid amount.");
  return (BigInt(value) * 10n ** BigInt(decimals)) / 100n;
}
export function ruleId(wallet: string, vault: string) {
  return keccak256(
    encodeAbiParameters(parseAbiParameters("address,address"), [
      wallet as Address,
      vault as Address,
    ]),
  );
}
export function equityOpen(now: number) {
  const p = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(now));
  const get = (type: string) => p.find((x) => x.type === type)?.value ?? "";
  const day = `${get("year")}-${get("month")}-${get("day")}`;
  const holidays = [
    "2026-01-01",
    "2026-01-19",
    "2026-02-16",
    "2026-04-03",
    "2026-05-25",
    "2026-06-19",
    "2026-07-03",
    "2026-09-07",
    "2026-11-26",
    "2026-12-25",
  ];
  const early = ["2026-11-27", "2026-12-24"];
  const minute = Number(get("hour")) * 60 + Number(get("minute"));
  return (
    get("year") === "2026" &&
    !["Sat", "Sun"].includes(get("weekday")) &&
    !holidays.includes(day) &&
    minute >= 570 &&
    minute < (early.includes(day) ? 780 : 960)
  );
}
export class ExpansionChain {
  constructor(
    readonly ctx: ChainContext,
    readonly config: V3PublicConfig,
  ) {}
  private client() {
    if (!this.ctx.publicClient)
      throw Error("Connect a configured chain to continue.");
    return this.ctx.publicClient;
  }
  async read<T>(
    address: string,
    abi: Abi,
    name: string,
    args: readonly unknown[] = [],
    blockNumber?: bigint,
  ): Promise<T> {
    return (await this.client().readContract({
      address: address as Address,
      abi,
      functionName: name,
      args,
      ...(blockNumber !== undefined ? { blockNumber } : {}),
    } as never)) as T;
  }
  async vaults(owner: string) {
    if (!this.config.enabled) return [];
    return this.read<Address[]>(
      this.config.factory,
      sproutFactoryAbi,
      "sproutsOf",
      [owner],
    );
  }
  async validate(vault: string) {
    const f = await this.read<Address>(vault, sproutVaultAbi, "factory");
    if (!same(f, this.config.factory))
      throw Error("This vault does not support the expansion.");
    const m = await this.read<Address>(vault, v3Abi, "matchVault");
    if (!same(m, this.config.matching))
      throw Error("This vault uses a different matching deployment.");
  }
  async state(vault: string, wallet: string): Promise<V3ChainState> {
    await this.validate(vault);
    const block = await this.client().getBlock();
    const at = block.number;
    const read = <T>(abi: Abi, name: string, args: readonly unknown[] = []) =>
      this.read<T>(vault, abi, name, args, at);
    const [
      parent,
      beneficiary,
      settlement,
      graduation,
      available,
      balance,
      market,
      matching,
      treasury,
      policy,
      cashEnabled,
      successor,
      coGuardian,
      hash,
      heartbeat,
      cadence,
      grace,
      claimAt,
      early,
      active,
      reserve,
      installment,
      epoch,
    ] = await Promise.all([
      read<Address>(sproutVaultAbi, "parent"),
      read<Address>(sproutVaultAbi, "beneficiary"),
      read<Address>(sproutVaultAbi, "settlementToken"),
      read<bigint>(sproutVaultAbi, "graduationTimestamp"),
      read<bigint>(sproutVaultAbi, "availableSettlement"),
      this.read<bigint>(
        this.ctx.config.chain.contracts.settlementToken!,
        erc20Abi,
        "balanceOf",
        [vault],
        at,
      ),
      cachedHoldings(this.ctx, vault as Address),
      this.read<bigint[]>(
        this.config.matching,
        matchingAbi,
        "activeIds",
        [vault],
        at,
      ),
      read<Address>(v3Abi, "treasury"),
      read<Address>(v3Abi, "treasuryPolicy"),
      read<boolean>(v3Abi, "cashEnabled"),
      read<Address>(v3Abi, "successor"),
      read<Address>(v3Abi, "coGuardian"),
      read<Hex>(v3Abi, "planHash"),
      read<bigint>(v3Abi, "heartbeatAt"),
      read<bigint>(v3Abi, "cadence"),
      read<bigint>(v3Abi, "grace"),
      read<bigint>(v3Abi, "claimAt"),
      read<bigint>(v3Abi, "earlyGraduation"),
      read<boolean>(v3Abi, "continuityActive"),
      read<bigint>(v3Abi, "continuityReserve"),
      read<bigint>(v3Abi, "reserveInstallment"),
      read<bigint>(v3Abi, "planEpoch"),
    ]);
    const decimals = await this.read<number>(
      settlement,
      erc20Abi,
      "decimals",
      [],
      at,
    );
    const matches = await Promise.all(
      matching.map(async (id) => {
        const c = await this.read<
          readonly [
            Address,
            Address,
            Address,
            bigint,
            bigint,
            bigint,
            bigint,
            bigint,
            bigint,
            bigint,
            boolean,
          ]
        >(this.config.matching, matchingAbi, "commitments", [id], at);
        return {
          id: id.toString(),
          sponsor: c[0],
          capCents: cents(c[3], decimals),
          remainingCents: cents(c[4], decimals),
          matchedCents: cents(c[5], decimals),
          expires: Number(c[7]) * 1000,
          cancelled: c[10],
        };
      }),
    );
    const rid = ruleId(wallet, vault);
    const r = await this.read<
      readonly [
        Address,
        Address,
        Address,
        Address,
        bigint,
        bigint,
        bigint,
        bigint,
        bigint,
        boolean,
      ]
    >(this.config.roundups, roundupsAbi, "rules", [rid], at);
    let shares = 0n,
      value = 0n,
      permitted = false,
      navAt = 0,
      fresh = false;
    if (treasury !== zeroAddress) {
      const [s, p, n, age] = await Promise.all([
        this.read<bigint>(treasury, erc20Abi, "balanceOf", [vault], at),
        this.read<boolean>(policy, policyAbi, "permitted", [vault], at),
        this.read<bigint>(policy, policyAbi, "updatedAt", [], at),
        this.read<bigint>(policy, policyAbi, "maxAge", [], at),
      ]);
      shares = s;
      permitted = p;
      navAt = Number(n) * 1000;
      fresh = n <= block.timestamp && block.timestamp - n <= age;
      value = await this.read<bigint>(
        treasury,
        erc4626Abi,
        "convertToAssets",
        [s],
        at,
      );
    }
    return {
      vault,
      parent,
      beneficiary,
      chainId: this.config.chainId,
      now: Number(block.timestamp) * 1000,
      block: at.toString(),
      settlement,
      settlementDecimals: decimals,
      balanceCents: cents(balance, decimals),
      availableCents: cents(available, decimals),
      matches,
      roundup: {
        id: rid,
        active: r[9] && r[6] > block.timestamp,
        capCents: cents(r[4], decimals),
        nextSweep: Number(r[7]) * 1000,
        totalCents: cents(r[8], decimals),
        executor: r[2],
      },
      cash: {
        available: treasury !== zeroAddress,
        enabled: cashEnabled,
        shares: shares.toString(),
        valueCents: cents(value, decimals),
        policyFresh: fresh,
        permitted,
        navAt,
        treasury,
      },
      continuity: {
        successor,
        coGuardian,
        hash,
        heartbeatAt: Number(heartbeat) * 1000,
        cadence: Number(cadence),
        grace: Number(grace),
        claimAt: Number(claimAt) * 1000,
        active,
        reserveCents: cents(reserve, decimals),
        installmentCents: cents(installment, decimals),
        earlyGraduation: Number(early) * 1000,
        graduation: Number(graduation) * 1000,
        epoch: Number(epoch),
      },
      market: market.holdings
        .filter((a) => a.kind === "stock")
        .map((a) => ({
          address: a.address,
          symbol: a.symbol,
          name:
            this.ctx.config.chain.contracts.stockTokens.find((t) =>
              same(t.address, a.address),
            )?.name ?? a.symbol,
          priceCents: a.price ? cents(BigInt(a.price), a.feedDecimals) : 0,
          quantityMicros: Number(
            (BigInt(a.shareEquivalent ?? a.rawBalance) * 1000000n) /
              10n ** BigInt(a.decimals),
          ),
          status:
            a.status !== "ok"
              ? "unavailable"
              : this.config.local ||
                  ["BTC", "ETH", "CBBTC", "WETH", "WBTC"].includes(
                    a.symbol.toUpperCase(),
                  ) ||
                  equityOpen(Number(block.timestamp) * 1000)
                ? "open"
                : "closed",
        })),
    };
  }
  async prepare(
    wallet: string,
    vault: string,
    action: string,
    input: Record<string, unknown>,
  ): Promise<PreparedTransaction> {
    const s = await this.state(vault, wallet);
    const raw = (key: string) =>
      rawCents(Number(input[key]), s.settlementDecimals);
    const tx = (
      to: string,
      abi: Abi,
      name: string,
      args: readonly unknown[],
      description: string,
      approval?: PreparedTransaction["approval"],
    ): PreparedTransaction => ({
      to,
      data: encodeFunctionData({ abi, functionName: name, args } as never),
      description,
      ...(approval ? { approval } : {}),
    });
    const approve = (spender: string, amount: bigint) => ({
      token: s.settlement,
      spender,
      amount: amount.toString(),
    });
    const manager =
      s.parent.toLowerCase() === wallet.toLowerCase() ||
      (s.continuity.active && same(s.continuity.successor, wallet));
    const parent = same(s.parent, wallet);
    if (action === "match") {
      const budget = raw("budgetCents");
      return tx(
        this.config.matching,
        matchingAbi,
        "commit",
        [vault, budget, raw("capCents"), Number(input.periods)],
        "Fund a matching commitment",
        approve(this.config.matching, budget),
      );
    }
    if (action === "cancel-match") {
      const id = BigInt(String(input.id));
      const c = await this.read<readonly [Address, Address]>(
        this.config.matching,
        matchingAbi,
        "commitments",
        [id],
      );
      if (!same(c[0], wallet) || !same(c[1], vault))
        throw Error("Only the sponsor can cancel this commitment.");
      return tx(
        this.config.matching,
        matchingAbi,
        "cancel",
        [id],
        "Cancel matching and refund the unused balance",
      );
    }
    if (action === "fund") {
      const amount = raw("amountCents");
      return tx(
        vault,
        sproutVaultAbi,
        "fund",
        [s.settlement, amount],
        "Contribute to the sprout",
        approve(vault, amount),
      );
    }
    if (action === "gift") {
      const amount = raw("amountCents");
      return tx(
        vault,
        sproutVaultAbi,
        "payGift",
        [s.settlement, amount, input.giftRef],
        "Send a gift to this event",
        approve(vault, amount),
      );
    }
    if (
      ["cash-toggle", "park", "unpark", "invest"].includes(action) &&
      !manager
    )
      throw Error("Only the current family manager can do this.");
    if (
      [
        "roundup-link",
        "roundup-unlink",
        "plan",
        "check-in",
        "revoke",
        "reserve",
        "refund-reserve",
      ].includes(action) &&
      !parent
    )
      throw Error("Only the original parent can do this.");
    if (action === "roundup-link")
      return tx(
        this.config.roundups,
        roundupsAbi,
        "link",
        [
          vault,
          this.config.executor,
          raw("capCents"),
          BigInt(Math.floor(Number(input.expiresAt) / 1000)),
        ],
        "Approve the weekly round-up limit",
        approve(this.config.roundups, raw("allowanceCents")),
      );
    if (action === "roundup-unlink")
      return tx(
        this.config.roundups,
        roundupsAbi,
        "unlink",
        [s.roundup.id],
        "Stop future round-up pulls",
      );
    if (action === "cash-toggle")
      return tx(
        vault,
        v3Abi,
        "setCashEnabled",
        [input.enabled === true],
        "Update cash parking",
      );
    if (action === "park") {
      const amount = raw("amountCents");
      if (!s.cash.available || !s.cash.permitted || !s.cash.policyFresh)
        throw Error("A current eligible treasury integration is required.");
      const shares = await this.read<bigint>(
        s.cash.treasury,
        erc4626Abi,
        "previewDeposit",
        [amount],
      );
      return tx(
        vault,
        v3Abi,
        "parkCash",
        [amount, (shares * 9990n) / 10000n],
        "Park idle cash in the approved treasury",
      );
    }
    if (action === "unpark")
      return tx(
        vault,
        v3Abi,
        "unparkCash",
        [raw("amountCents")],
        "Return parked assets to cash",
      );
    if (action === "plan")
      return tx(
        vault,
        v3Abi,
        "writePlan",
        [
          input.successor,
          input.coGuardian,
          BigInt(Number(input.cadenceDays) * 86400),
          BigInt(Number(input.graceDays) * 86400),
          BigInt(Math.floor(Number(input.earlyGraduation ?? 0) / 1000)),
          input.hash,
          raw("installmentCents"),
          BigInt(Number(input.periodDays) * 86400),
        ],
        "Write the continuity plan",
      );
    if (action === "check-in")
      return tx(
        vault,
        v3Abi,
        "checkIn",
        [],
        "Check in and reset the activity clock",
      );
    if (action === "revoke")
      return tx(vault, v3Abi, "revokePlan", [], "Revoke the continuity plan");
    if (action === "cancel-claim") {
      if (!parent && !same(wallet, s.continuity.coGuardian))
        throw Error("Only the parent or co-guardian can cancel.");
      return tx(vault, v3Abi, "cancelClaim", [], "Cancel the successor claim");
    }
    if (action === "arm" || action === "activate") {
      if (!same(wallet, s.continuity.successor))
        throw Error("Only the named successor can claim.");
      return tx(
        vault,
        v3Abi,
        action === "arm" ? "armContinuity" : "activateContinuity",
        action === "arm" ? [] : [BigInt(s.continuity.epoch)],
        action === "arm"
          ? "Start the review window"
          : "Activate the continuity plan",
      );
    }
    if (action === "reserve") {
      const amount = raw("amountCents");
      return tx(
        vault,
        v3Abi,
        "fundReserve",
        [amount],
        "Fund future continuity contributions",
        approve(vault, amount),
      );
    }
    if (action === "refund-reserve")
      return tx(
        vault,
        v3Abi,
        "refundReserve",
        [raw("amountCents")],
        "Return unused continuity reserve",
      );
    if (action === "invest") {
      const q = await investQuote(
        this.ctx,
        vault as Address,
        raw("amountCents"),
      );
      if (!q.due || !q.minOuts || !q.venue)
        throw Error(q.blocker?.message ?? "Schedule a due investment first.");
      return tx(
        vault,
        sproutVaultAbi,
        "executeInvestment",
        [q.venue, q.minOuts.map(BigInt)],
        "Execute the scheduled investment",
      );
    }
    throw Error("Unknown expansion action.");
  }
}
