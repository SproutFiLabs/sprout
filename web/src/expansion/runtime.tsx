import { useEffect, useRef, useState } from "react";
import { encodeFunctionData, erc20Abi, type Address, type Hex } from "viem";
import type {
  ExpansionState,
  PreparedTransaction,
  V3PublicConfig,
} from "@sprout/shared";
import {
  api,
  authorizeFamily,
  clearFamilySession,
  familyHeaders,
  type LocalWalletInfo,
} from "../api";
import {
  connectLocalWallet,
  connectWallet,
  ensureChain,
  assertWalletReady,
  waitForSuccess,
  type WalletState,
} from "../wallet";
export async function request<T>(path: string, body?: unknown): Promise<T> {
  const r = await fetch(`/api/v3${path}`, {
    method: body === undefined ? "GET" : "POST",
    headers: { "content-type": "application/json", ...familyHeaders() },
    cache: "no-store",
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const data = await r.json();
  if (!r.ok)
    throw Error(
      data.error ?? "This action could not finish. Please try again.",
    );
  return data as T;
}
export const money = (cents: number) =>
  new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 2,
  }).format(cents / 100);
export const short = (a: string) =>
  a === "0x0000000000000000000000000000000000000000"
    ? "Not assigned"
    : `${a.slice(0, 6)}…${a.slice(-4)}`;
export const date = (n: number) =>
  n
    ? new Date(n).toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
        year: "numeric",
      })
    : "Not set";
export function useExpansion(publicPage = false) {
  const [config, setConfig] = useState<V3PublicConfig | null>(null),
    [wallet, setWallet] = useState<WalletState | null>(null),
    [local, setLocal] = useState<LocalWalletInfo | null>(null),
    [state, setState] = useState<ExpansionState | null>(null),
    [busy, setBusy] = useState(""),
    [notice, setNotice] = useState(""),
    [error, setError] = useState("");
  const version = useRef(0),
    lock = useRef(false),
    walletRef = useRef<WalletState | null>(null);
  const selected = useRef(
    new URLSearchParams(location.search).get("vault") ?? "",
  );
  async function refresh() {
    if (publicPage) return;
    const v = version.current;
    const next = await request<ExpansionState>(
      `/state${selected.current ? `?vault=${selected.current}` : ""}`,
    );
    if (v !== version.current) return;
    setState(next);
    if (next.chain) selected.current = next.chain.vault;
    return next;
  }
  function disconnect() {
    version.current++;
    walletRef.current = null;
    setWallet(null);
    setState(null);
    clearFamilySession();
    sessionStorage.removeItem("sprout-v3-local");
    setNotice("Family workspace locked.");
  }
  async function connect(address?: string) {
    version.current++;
    const v = version.current;
    clearFamilySession();
    setState(null);
    const conf = config ?? (await request<V3PublicConfig>("/config"));
    const chainInput = {
      chainId: conf.chainId,
      name: conf.local ? "Sprout local practice" : "Sprout",
    };
    const w =
      address && conf.local
        ? await connectLocalWallet({
            ...chainInput,
            address: address as Address,
          })
        : await connectWallet(chainInput);
    await ensureChain(w, chainInput);
    await authorizeFamily(w);
    if (v !== version.current) return;
    walletRef.current = w;
    setWallet(w);
    if (conf.local && address)
      sessionStorage.setItem("sprout-v3-local", address);
    await refresh();
  }
  async function run(
    label: string,
    action: () => Promise<unknown>,
    success = "Saved. Your family workspace is up to date.",
  ) {
    if (lock.current) return;
    lock.current = true;
    setBusy(label);
    setError("");
    setNotice("");
    const v = version.current;
    try {
      await action();
      if (v === version.current) {
        if (walletRef.current) await refresh();
        setNotice(success);
      }
    } catch (e) {
      if (v === version.current)
        setError(
          e instanceof Error
            ? e.message
            : "Something went wrong. Please try again.",
        );
    } finally {
      lock.current = false;
      setBusy("");
    }
  }
  async function send(
    vault: string,
    action: string,
    input: Record<string, unknown> = {},
  ) {
    const w = walletRef.current;
    if (!w) throw Error("Connect your wallet first.");
    const v = version.current;
    await assertWalletReady(w);
    const prepared = await request<PreparedTransaction>("/transaction", {
      vault,
      action,
      input,
    });
    const sendData = async (to: string, data: string) => {
      if (v !== version.current)
        throw Error("Your wallet changed. Reconnect to continue.");
      await assertWalletReady(w);
      // Timestamp-dependent vault writes can cost more in the mined block than the estimate.
      const estimate = await w.publicClient.estimateGas({
        account: w.address,
        to: to as Address,
        data: data as Hex,
      });
      const hash = await w.walletClient.sendTransaction({
        account: w.address,
        chain: w.chain,
        to: to as Address,
        data: data as Hex,
        gas: estimate + estimate / 5n + 15000n,
      });
      await waitForSuccess(w.publicClient, hash);
      if (!config?.local)
        await w.publicClient.waitForTransactionReceipt({
          hash,
          confirmations: 6,
        });
      return hash;
    };
    if (prepared.approval) {
      const a = prepared.approval;
      const allowance = await w.publicClient.readContract({
        address: a.token as Address,
        abi: erc20Abi,
        functionName: "allowance",
        args: [w.address, a.spender as Address],
      });
      if (allowance < BigInt(a.amount)) {
        if (allowance > 0n)
          await sendData(
            a.token,
            encodeFunctionData({
              abi: erc20Abi,
              functionName: "approve",
              args: [a.spender as Address, 0n],
            }),
          );
        await sendData(
          a.token,
          encodeFunctionData({
            abi: erc20Abi,
            functionName: "approve",
            args: [a.spender as Address, BigInt(a.amount)],
          }),
        );
      }
    }
    const hash = await sendData(prepared.to, prepared.data);
    if (action === "match")
      await request("/matches/receipt", { vault, txHash: hash });
    return hash;
  }
  useEffect(() => {
    let active = true;
    Promise.all([request<V3PublicConfig>("/config"), api.localWallet()])
      .then(([c, l]) => {
        if (!active) return;
        setConfig(c);
        setLocal(l);
        const remembered = sessionStorage.getItem("sprout-v3-local");
        if (c.local && remembered)
          void run(
            "Opening family workspace",
            () => connect(remembered),
            "Welcome back to your growing garden.",
          );
      })
      .catch((e) => active && setError(e.message));
    return () => {
      active = false;
      version.current++;
    };
  }, []);
  useEffect(() => {
    if (!wallet) return;
    const lock = () => disconnect();
    wallet.provider.on?.("accountsChanged", lock);
    wallet.provider.on?.("chainChanged", lock);
    window.addEventListener("sprout-family-session-ended", lock);
    return () => {
      wallet.provider.removeListener?.("accountsChanged", lock);
      wallet.provider.removeListener?.("chainChanged", lock);
      window.removeEventListener("sprout-family-session-ended", lock);
    };
  }, [wallet]);
  return {
    config,
    wallet,
    local,
    state,
    busy,
    notice,
    error,
    run,
    send,
    connect,
    disconnect,
    refresh,
    select: async (v: string) => {
      selected.current = v;
      await refresh();
    },
  };
}
export type ExpansionRuntime = ReturnType<typeof useExpansion>;
