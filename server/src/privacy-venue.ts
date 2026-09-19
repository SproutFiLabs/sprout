import {
  createPublicClient,
  getAddress,
  http,
  keccak256,
  parseAbi,
  type Address,
} from "viem";
import { z } from "zod";

export const PUBLIC_POOL =
  "0xFCa786642cEeB58F4cC1543B5d7FC91cdD254B93" as const;
const abi = parseAbi([
  "function root() view returns (bytes32)",
  "function WINDOW() view returns (uint256)",
  "function depositsPaused() view returns (bool)",
  "function orderVerifier() view returns (address)",
  "function allowed(address) view returns (bool)",
  "function decimals() view returns (uint8)",
]);
const responseSchema = z.object({
  ok: z.literal(true),
  data: z.object({
    chainId: z.literal(4663),
    pool: z.string(),
    markets: z
      .array(
        z.object({
          symbol: z.string().regex(/^[A-Z]{1,8}$/),
          token: z.string().regex(/^0x[0-9a-fA-F]{40}$/),
          decimals: z.number().int().min(0).max(36),
        }),
      )
      .min(1)
      .max(21),
  }),
});
/** Public market discovery only. Contract existence is NOT an audit or a release approval. */
export async function inspectPublicVenue() {
  const response = await fetch("https://darkpoolfi.tech/api/pool", {
    signal: AbortSignal.timeout(8000),
  });
  if (!response.ok) throw new Error("Public venue unavailable.");
  const raw = await response.text();
  if (raw.length > 64000) throw new Error("Invalid venue response.");
  const { data } = responseSchema.parse(JSON.parse(raw));
  if (getAddress(data.pool) !== PUBLIC_POOL)
    throw new Error("Public pool address changed.");
  if (
    new Set(data.markets.map((m) => m.token.toLowerCase())).size !==
    data.markets.length
  )
    throw new Error("Duplicate venue assets.");
  const client = createPublicClient({
    transport: http("https://rpc.mainnet.chain.robinhood.com", {
      timeout: 8000,
      retryCount: 0,
    }),
  });
  const [chainId, blockNumber] = await Promise.all([
    client.getChainId(),
    client.getBlockNumber(),
  ]);
  if (chainId !== 4663) throw new Error("Unexpected public RPC chain.");
  const read = (
    functionName: "root" | "WINDOW" | "depositsPaused" | "orderVerifier",
  ) =>
    client.readContract({
      address: PUBLIC_POOL,
      abi,
      functionName,
      blockNumber,
    });
  const [code, root, window, paused, verifier] = await Promise.all([
    client.getCode({ address: PUBLIC_POOL, blockNumber }),
    read("root"),
    read("WINDOW"),
    read("depositsPaused"),
    read("orderVerifier"),
  ]);
  if (!code || code === "0x" || window !== 300n)
    throw new Error("Unexpected pool contract.");
  const verifierCode = await client.getCode({
    address: verifier as Address,
    blockNumber,
  });
  if (!verifierCode || verifierCode === "0x")
    throw new Error("Order verifier missing.");
  const markets = await Promise.all(
    data.markets.map(async (m) => {
      const token = getAddress(m.token);
      const [allowed, decimals] = await Promise.all([
        client.readContract({
          address: PUBLIC_POOL,
          abi,
          functionName: "allowed",
          args: [token],
          blockNumber,
        }),
        client.readContract({
          address: token,
          abi,
          functionName: "decimals",
          blockNumber,
        }),
      ]);
      if (!allowed || decimals !== m.decimals)
        throw new Error("Market metadata failed on-chain checks.");
      return { symbol: m.symbol, token, decimals };
    }),
  );
  return {
    provider: "Darkpool",
    source: "https://darkpoolfi.tech/api/pool",
    chainId,
    blockNumber: blockNumber.toString(),
    pool: PUBLIC_POOL,
    poolCodeHash: keccak256(code),
    orderVerifier: verifier,
    orderVerifierCodeHash: keccak256(verifierCode),
    root,
    windowSeconds: Number(window),
    depositsPaused: paused,
    markets,
    checkedAt: new Date().toISOString(),
    familyPolicySupported: false,
    sproutSettlementEnabled: false,
  };
}

let cached: Awaited<ReturnType<typeof inspectPublicVenue>> | undefined;
let until = 0;
let pending:
  | Promise<Awaited<ReturnType<typeof inspectPublicVenue>>>
  | undefined;
export async function publicVenue() {
  if (cached && Date.now() < until) return cached;
  if (!pending)
    pending = inspectPublicVenue()
      .then((result) => {
        cached = result;
        until = Date.now() + 60000;
        return result;
      })
      .finally(() => {
        pending = undefined;
      });
  return pending;
}
