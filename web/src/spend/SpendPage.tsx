import { rewardCents, type RewardOffer } from '@sprout/shared';
import { useEffect, useRef, useState } from "react";
import {
  createWalletClient,
  custom,
  erc20Abi,
  parseUnits,
  getAddress,
} from "viem";
import { base } from "viem/chains";
import {
  spendPurpose,
  SPEND_USDC,
  type SpendCatalog,
  type SpendOrder,
  type SpendProduct,
  type SpendRequest,
} from "@sprout/shared";
import {
  authorizeFamily,
  clearFamilySession,
  familyHeaders,
  signedPostJson,
  type Sprout,
} from "../api";
import {
  connectWallet,
  ensureChain,
  assertWalletReady,
  type WalletState,
} from "../wallet";
import { SpendView, type SpendScreen } from "./SpendView";
async function read<T>(url: string, method = "GET"): Promise<T> {
  const r = await fetch(url, {
    method,
    headers: familyHeaders(),
    cache: "no-store",
  });
  const data = await r.json();
  if (!r.ok) throw new Error(data.error ?? "Could not load this page.");
  return data as T;
}
export function SpendPage() {
  const [offer,setOffer]=useState<RewardOffer|null>(null);
  useEffect(()=>{const id=new URLSearchParams(location.search).get("offer");if(id)void fetch("/api/family-tools/public").then(r=>r.json()).then(d=>setOffer(d.offers?.find((o:RewardOffer)=>o.id===id)??null)).catch(()=>{});},[]);
  const [catalog, setCatalog] = useState<SpendCatalog | null>(null),
    [screen, setScreen] = useState<SpendScreen>("shop"),
    [selected, setSelected] = useState<SpendProduct | null>(null),
    [value, setValue] = useState(25),
    [search, setSearch] = useState(""),
    [category, setCategory] = useState("All"),
    [wallet, setWallet] = useState<WalletState | null>(null),
    [vaults, setVaults] = useState<Sprout[]>([]),
    [vault, setVault] = useState(""),
    [approved, setApproved] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [order, setOrder] = useState<SpendOrder | null>(null),
    [orders, setOrders] = useState<SpendOrder[]>([]),
    [revealed, setRevealed] = useState(false),
    [copied, setCopied] = useState(false),
    [sent, setSent] = useState(false);
  const version = useRef(0),
    lock = useRef(false),
    requestKey = useRef(crypto.randomUUID()),
    paymentStarted = useRef(new Set<string>()),
    chainSwitch = useRef(false);
  const perform = async (fn: () => Promise<void>) => {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setError("");
    try {
      await fn();
    } catch (e) {
      setError(
        e instanceof Error
          ? e.message
          : "This action could not finish. Please try again.",
      );
    } finally {
      lock.current = false;
      setBusy(false);
    }
  };
  const load = async () =>
    setCatalog(await read<SpendCatalog>("/api/spend/catalog"));
  useEffect(() => {
    void load().catch(() =>
      setError("The shop could not load. Please try again."),
    );
  }, []);
  const wipe = () => {
    version.current++;
    clearFamilySession();
    setWallet(null);
    setVaults([]);
    setVault("");
    setOrders([]);
    setOrder(null);
    setRevealed(false);
    setApproved(false);
    setScreen("shop");
  };
  useEffect(() => {
    if (!wallet) return;
    const change = () => wipe();
    const chain = () => {
      if (!chainSwitch.current) wipe();
    };
    wallet.provider.on?.("accountsChanged", change);
    wallet.provider.on?.("chainChanged", chain);
    wallet.provider.on?.("disconnect", change);
    window.addEventListener("sprout-family-session-ended", change);
    return () => {
      wallet.provider.removeListener?.("accountsChanged", change);
      wallet.provider.removeListener?.("chainChanged", chain);
      wallet.provider.removeListener?.("disconnect", change);
      window.removeEventListener("sprout-family-session-ended", change);
    };
  }, [wallet]);
  const connect = () =>
    perform(async () => {
      const v = version.current;
      const { chain } = await read<{
        chain: { chainId: number; name: string; walletRpcUrl?: string };
      }>("/api/config");
      const next = await connectWallet({
        chainId: chain.chainId,
        name: chain.name,
        rpcUrl: chain.walletRpcUrl,
      });
      await ensureChain(next, {
        chainId: chain.chainId,
        name: chain.name,
        rpcUrl: chain.walletRpcUrl,
      });
      await authorizeFamily(next);
      const family = await read<{ sprouts: Sprout[] }>(
        `/api/sprouts?parent=${next.address}`,
      );
      if (v !== version.current) return;
      setWallet(next);
      setVaults(family.sprouts);
      setVault(family.sprouts[0]?.id ?? "");
      const history = await read<{ orders: SpendOrder[] }>("/api/spend/orders");
      if (v === version.current) setOrders(history.orders);
    });
  const hasSent = (id: string) =>
    paymentStarted.current.has(id) ||
    sessionStorage.getItem(`sprout-spend-sent:${id}`) === "1";
  const showOrder = (next: SpendOrder) => {
    setOrder(next);
    setScreen(next.status === "delivered" ? "receipt" : "payment");
    setRevealed(false);
    setCopied(false);
    setSent(!!next.paymentStarted || hasSent(next.id));
  };
  const refreshOrder = async (id: string) => {
    const v = version.current;
    const data = await read<{ order: SpendOrder }>(`/api/spend/orders/${id}`);
    if (v === version.current) {
      setOrder(data.order);
      setSent(!!data.order.paymentStarted || hasSent(id));
      if (data.order.status === "delivered") setScreen("receipt");
    }
    return data.order;
  };
  useEffect(() => {
    if (
      !order ||
      screen !== "payment" ||
      !["unpaid", "confirming"].includes(order.status)
    )
      return;
    const timer = setInterval(() => {
      if (!lock.current)
        void refreshOrder(order.id).catch(() =>
          setError(
            "Order status could not be checked. Your order is saved; do not pay again.",
          ),
        );
    }, 15000);
    return () => clearInterval(timer);
  }, [order?.id, order?.status, screen]);
  const checkout = () =>
    perform(async () => {
      if (!wallet || !selected || !vault || !approved) return;
      chainSwitch.current = true;
      try {
        await ensureChain(wallet, {
          chainId: wallet.expectedChainId,
          name: wallet.chainName,
          rpcUrl: wallet.chain.rpcUrls.default.http[0],
        });
        await assertWalletReady(wallet);
      } finally {
        chainSwitch.current = false;
      }
      const v = version.current;
      const body: SpendRequest = {
        key: requestKey.current,
        vault,
        product: selected.id,
        value,
        country: "US",
        ...(offer?.product===selected.id?{rewardOfferId:offer.id}:{}),
      };
      const result = await signedPostJson<{ order: SpendOrder }>(
        wallet,
        "/api/spend/orders",
        spendPurpose(body),
        body,
      );
      if (v === version.current) showOrder(result.order);
    });
  const pay = () =>
    perform(async () => {
      if (!wallet || !order || order.paymentStarted || hasSent(order.id))
        return;
      const v = version.current;
      let fresh = (
        await read<{ order: SpendOrder }>(
          `/api/spend/orders/${order.id}?payment=1`,
        )
      ).order;
      if (
        fresh.status !== "unpaid" ||
        !fresh.payment ||
        fresh.payment.expiresAt <= Date.now()
      )
        throw new Error(
          "This payment window has ended. Check your order before trying again.",
        );
      chainSwitch.current = true;
      try {
        await wallet.provider.request({
          method: "wallet_switchEthereumChain",
          params: [{ chainId: "0x2105" }],
        });
        const accounts = (await wallet.provider.request({
          method: "eth_accounts",
        })) as string[];
        if (
          !accounts[0] ||
          getAddress(accounts[0]) !== wallet.address ||
          v !== version.current
        )
          throw new Error("Wallet account changed. Reconnect before paying.");
        if (
          Number(await wallet.provider.request({ method: "eth_chainId" })) !==
          8453
        )
          throw new Error("Choose Base in your wallet to pay.");
        fresh = (
          await read<{ order: SpendOrder }>(
            `/api/spend/orders/${order.id}?payment=1`,
          )
        ).order;
        if (
          fresh.status !== "unpaid" ||
          !fresh.payment ||
          fresh.payment.expiresAt <= Date.now() ||
          fresh.payment.chainId !== 8453 ||
          fresh.payment.token !== SPEND_USDC
        )
          throw new Error("The payment quote is no longer available.");
        await read(`/api/spend/orders/${order.id}/payment`, "POST");
        if (v !== version.current)
          throw new Error(
            "Wallet session changed before payment. Reconnect to check your order.",
          );
        const currentAccounts = (await wallet.provider.request({
          method: "eth_accounts",
        })) as string[];
        if (
          !currentAccounts[0] ||
          getAddress(currentAccounts[0]) !== wallet.address
        )
          throw new Error("Wallet account changed before payment.");
        // Mark before opening the wallet. Ambiguous RPC failures must not allow a second payment.
        paymentStarted.current.add(order.id);
        sessionStorage.setItem(`sprout-spend-sent:${order.id}`, "1");
        setSent(true);
        const client = createWalletClient({
          account: wallet.address,
          chain: base,
          transport: custom(wallet.provider),
        });
        await client.writeContract({
          address: SPEND_USDC,
          abi: erc20Abi,
          functionName: "transfer",
          args: [fresh.payment.address, parseUnits(fresh.payment.amount, 6)],
        });
        if (v === version.current) setOrder({ ...fresh, status: "confirming" });
      } catch (e) {
        const cause = e as { code?: number; cause?: { code?: number } };
        if (cause.code === 4001 || cause.cause?.code === 4001) {
          await read(`/api/spend/orders/${order.id}/payment`, "DELETE");
          paymentStarted.current.delete(order.id);
          sessionStorage.removeItem(`sprout-spend-sent:${order.id}`);
          setSent(false);
        }
        throw e;
      } finally {
        chainSwitch.current = false;
      }
    });
  const switchScreen = (next: SpendScreen) => {
    setError("");
    setRevealed(false);
    setScreen(next);
    if (next === "orders" && wallet)
      void perform(async () => {
        const v = version.current;
        const history = await read<{ orders: SpendOrder[] }>(
          "/api/spend/orders",
        );
        if (v === version.current) setOrders(history.orders);
      });
  };
  return (
    <SpendView
      reward={order?.reward??(offer&&selected?.id===offer.product?{offerId:offer.id,title:offer.title,cents:rewardCents(value,offer.rateBps),rateBps:offer.rateBps,terms:offer.terms}:undefined)}
      catalog={catalog}
      screen={screen}
      products={(catalog?.products ?? []).filter(
        (p) =>
          (category === "All" || p.category === category) &&
          p.name.toLowerCase().includes(search.toLowerCase()),
      )}
      selected={selected}
      value={value}
      search={search}
      category={category}
      wallet={wallet?.address ?? ""}
      vault={vault}
      vaults={vaults}
      approved={approved}
      busy={busy}
      error={error}
      order={order}
      orders={orders}
      revealed={revealed}
      copied={copied}
      sent={sent}
      onScreen={switchScreen}
      onSelect={(p) => {
        setSelected(p);
        setValue(p.values.includes(25) ? 25 : p.values[0]!);
        setOrder(null);
        setApproved(false);
        requestKey.current = crypto.randomUUID();
        switchScreen("review");
        window.scrollTo({ top: 0, behavior: "smooth" });
      }}
      onValue={(v) => {
        setValue(v);
        setApproved(false);
        requestKey.current = crypto.randomUUID();
      }}
      onSearch={setSearch}
      onCategory={setCategory}
      onConnect={() => void connect()}
      onVault={(v) => {
        setVault(v);
        setApproved(false);
        requestKey.current = crypto.randomUUID();
      }}
      onApprove={setApproved}
      onCheckout={() => void checkout()}
      onPay={() => void pay()}
      onRefresh={() =>
        void perform(async () => {
          if (order) await refreshOrder(order.id);
          else await load();
        })
      }
      onReveal={() => setRevealed(!revealed)}
      onCopy={() =>
        void perform(async () => {
          if (order?.redemption?.code) {
            await navigator.clipboard.writeText(order.redemption.code);
            setCopied(true);
          }
        })
      }
      onOrder={(o) => {
        showOrder(o);
        void perform(async () => {
          await refreshOrder(o.id);
        });
      }}
    />
  );
}
