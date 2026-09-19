import {
  ArrowUpRight,
  ArrowRight,
  ArrowLeft,
  Check,
  Copy,
  Search,
  ShoppingBag,
  LockKeyhole,
  Wallet,
  RefreshCw,
} from "lucide-react";
import type { SpendCatalog, SpendOrder, SpendProduct } from "@sprout/shared";
import "./spend.css";
export type SpendScreen = "shop" | "review" | "payment" | "receipt" | "orders";
export interface SpendViewProps {
  catalog: SpendCatalog | null;
  screen: SpendScreen;
  products: SpendProduct[];
  selected: SpendProduct | null;
  value: number;
  search: string;
  category: string;
  wallet: string;
  vault: string;
  vaults: Array<{ id: string }>;
  approved: boolean;
  busy: boolean;
  error: string;
  order: SpendOrder | null;
  orders: SpendOrder[];
  revealed: boolean;
  copied: boolean;
  sent: boolean;
  onScreen: (s: SpendScreen) => void;
  onSelect: (p: SpendProduct) => void;
  onValue: (v: number) => void;
  onSearch: (v: string) => void;
  onCategory: (v: string) => void;
  onConnect: () => void;
  onVault: (v: string) => void;
  onApprove: (v: boolean) => void;
  onCheckout: () => void;
  onPay: () => void;
  onRefresh: () => void;
  onReveal: () => void;
  onCopy: () => void;
  onOrder: (o: SpendOrder) => void;
  assetUrl?: (p: string) => string;
}
export const shortAddress = (s: string) => `${s.slice(0, 6)}…${s.slice(-4)}`;
const money = (n: number) =>
  new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 2,
  }).format(n);
export function SpendCard({
  name,
  value,
  tone = 0,
  large = false,
}: {
  name: string;
  value?: number;
  tone?: number;
  large?: boolean;
}) {
  return (
    <div className={`spend-card-art tone-${tone % 4} ${large ? "large" : ""}`}>
      <div className="spend-card-top">
        <span>
          SPROUT <i>spend</i>
        </span>
        <ShoppingBag size={large ? 25 : 18} />
      </div>
      <div className="spend-petals" aria-hidden="true">
        {Array.from({ length: 8 }, (_, i) => (
          <span
            key={i}
            style={{ transform: `rotate(${i * 45}deg) translateY(-35%)` }}
          />
        ))}
      </div>
      <div className="spend-card-bottom">
        <strong>{name}</strong>
        <span>
          {value ? money(value) : "Gift card"}{" "}
          <ArrowUpRight size={large ? 26 : 17} />
        </span>
      </div>
    </div>
  );
}
export function SpendView(p: SpendViewProps) {
  const asset = p.assetUrl ?? ((s: string) => s);
  const product = p.order?.product ?? p.selected;
  const order = p.order;
  const stateLabel = order
    ? {
        creating: "Checking your order",
        unpaid: "Ready for payment",
        confirming: "Payment is being confirmed",
        delivered: "Ready to use",
        expired: "Payment window ended",
        attention: "Order needs attention",
      }[order.status]
    : "";
  const categories = [
    "All",
    ...new Set((p.catalog?.products ?? []).map((x) => x.category)),
  ];
  return (
    <div className="spend-root">
      <a className="spend-skip" href="#spend-main">
        Skip to shop
      </a>
      <header className="spend-header">
        <a href="/" className="spend-brand">
          <img src={asset("/brand/sprout-logo.png")} alt="" />
          SPROUT
        </a>
        <nav aria-label="Spend navigation">
          <a href="/dashboard">Your garden</a>
          <button
            aria-current={p.screen === "orders" ? "page" : undefined}
            onClick={() => p.onScreen("orders")}
          >
            Your orders
          </button>
          <button
            className="spend-button"
            onClick={p.onConnect}
            disabled={p.busy}
          >
            <Wallet size={15} />
            {p.wallet ? shortAddress(p.wallet) : "Connect wallet"}
          </button>
        </nav>
      </header>
      <main id="spend-main" className="spend-main">
        {p.screen === "shop" ? (
          <>
            <section className="spend-hero">
              <div>
                <div className="spend-eyebrow">
                  <span /> SPROUT SPEND
                </div>
                <h1>
                  A little saved.
                  <br />
                  <em>A little enjoyed.</em>
                </h1>
                <p>
                  Everyday gift cards, bought right here.
                  <br />
                  Chosen together. Approved by you.
                </p>
                <a className="spend-button" href="#spend-shop">
                  Find something good <ArrowRight size={17} />
                </a>
                <div className="spend-hero-note">
                  <LockKeyhole size={14} /> A parent approves every checkout.
                </div>
              </div>
              <div className="spend-hero-art" aria-hidden="true">
                <img src={asset("/art/harvest-bouquet.png")} alt="" />
                <div className="spend-floating-card back">
                  <SpendCard name="Little adventures" tone={2} />
                </div>
                <div className="spend-floating-card front">
                  <SpendCard name="Good things, together." tone={0} />
                </div>
                <span className="spend-art-caption">
                  For the things that make their day.
                </span>
              </div>
            </section>
            <div className="spend-promise">
              <span>
                <Check size={15} /> Checkout through Sprout
              </span>
              <span>
                <Check size={15} /> Pay from your own wallet
              </span>
              <span>
                <Check size={15} /> Private order history
              </span>
            </div>
            <section id="spend-shop" className="spend-shop">
              <div className="spend-section-heading">
                <div>
                  <span className="spend-eyebrow">THE LITTLE THINGS</span>
                  <h2>What’s on their wish list?</h2>
                </div>
                <span className="spend-country">United States · USD</span>
              </div>
              <div className="spend-toolbar">
                <div role="group" aria-label="Product categories">
                  {categories.map((c) => (
                    <button
                      key={c}
                      aria-pressed={p.category === c}
                      onClick={() => p.onCategory(c)}
                    >
                      {c}
                    </button>
                  ))}
                </div>
                <label className="spend-search">
                  <Search size={17} />
                  <input
                    value={p.search}
                    onChange={(e) => p.onSearch(e.target.value)}
                    placeholder="Find a gift card"
                    aria-label="Find a gift card"
                  />
                </label>
              </div>
              {p.catalog === null ? (
                <div className="spend-empty">Opening the shop…</div>
              ) : !p.catalog.enabled ? (
                <div className="spend-empty">
                  <ShoppingBag size={32} />
                  <h3>A few good things are on their way.</h3>
                  <p>
                    Purchasing opens once our fulfillment connection is ready.
                  </p>
                  <button onClick={p.onRefresh} className="spend-text-button">
                    Check availability <RefreshCw size={15} />
                  </button>
                </div>
              ) : p.products.length === 0 ? (
                <div className="spend-empty">
                  <h3>No gift cards found.</h3>
                  <p>Try a different search or category.</p>
                  <button
                    className="spend-text-button"
                    onClick={() => {
                      p.onSearch("");
                      p.onCategory("All");
                    }}
                  >
                    Show all gift cards
                  </button>
                </div>
              ) : (
                <div className="spend-products">
                  {p.products.map((product, i) => (
                    <button
                      className="spend-product"
                      key={product.id}
                      onClick={() => p.onSelect(product)}
                    >
                      <SpendCard name={product.name} tone={i} />
                      <div className="spend-product-meta">
                        <span>
                          <strong>{product.name}</strong>
                          <small>{product.category} · US only</small>
                        </span>
                        <span>
                          {money(Math.min(...product.values))}–
                          {money(Math.max(...product.values))}
                          <ArrowUpRight size={18} />
                        </span>
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </section>
          </>
        ) : (
          <>
            <button className="spend-back" onClick={() => p.onScreen("shop")}>
              <ArrowLeft size={17} /> Back to the shop
            </button>
            <div className="spend-page-title">
              <span className="spend-eyebrow">SPROUT SPEND</span>
              <h1>
                {p.screen === "orders"
                  ? "The little things you picked."
                  : p.screen === "review"
                    ? "Good choice. Your call."
                    : p.screen === "receipt"
                      ? "A little joy, delivered."
                      : "One last little step."}
              </h1>
            </div>
            {p.screen === "orders" ? (
              <section className="spend-orders">
                {!p.wallet ? (
                  <div className="spend-empty">
                    <h3>Your orders belong to you.</h3>
                    <p>Connect your parent wallet to open them.</p>
                    <button className="spend-button" onClick={p.onConnect}>
                      Connect wallet
                    </button>
                  </div>
                ) : p.orders.length === 0 ? (
                  <div className="spend-empty">
                    <ShoppingBag size={32} />
                    <h3>Your first little treat is waiting.</h3>
                    <p>Completed purchases will appear here.</p>
                    <button
                      className="spend-button"
                      onClick={() => p.onScreen("shop")}
                    >
                      Browse gift cards <ArrowRight size={17} />
                    </button>
                  </div>
                ) : (
                  p.orders.map((o) => (
                    <button
                      key={o.id}
                      className="spend-order-row"
                      onClick={() => p.onOrder(o)}
                    >
                      <span>
                        <ShoppingBag size={20} />
                        <strong>{o.product.name}</strong>
                      </span>
                      <span>{money(o.value)}</span>
                      <span>
                        {o.status === "delivered"
                          ? "Ready to use"
                          : o.status === "attention"
                            ? "Needs attention"
                            : o.status === "expired"
                              ? "Expired"
                              : "In progress"}
                      </span>
                      <ArrowUpRight size={18} />
                    </button>
                  ))
                )}
              </section>
            ) : (
              product && (
                <div className="spend-checkout">
                  <aside className="spend-checkout-art">
                    <SpendCard
                      large
                      name={product.name}
                      value={p.screen === "review" ? p.value : order?.value}
                      tone={0}
                    />
                    <div className="spend-purchase-copy">
                      <span className="spend-eyebrow">
                        A LITTLE SOMETHING FOR THEM
                      </span>
                      <h2>{product.name}</h2>
                      <p>
                        Delivered digitally, ready for their next little
                        adventure.
                      </p>
                      <div>
                        <span>Region</span>
                        <strong>United States</strong>
                      </div>
                      <div>
                        <span>Card currency</span>
                        <strong>USD</strong>
                      </div>
                    </div>
                  </aside>
                  <section className="spend-checkout-panel" aria-live="polite">
                    <div className="spend-stepper">
                      {["Choose", "Approve", "Enjoy"].map((s, i) => (
                        <span
                          key={s}
                          className={
                            (p.screen === "receipt" ? 2 : 1) >= i
                              ? "active"
                              : ""
                          }
                        >
                          <b>{i + 1}</b>
                          {s}
                        </span>
                      ))}
                    </div>
                    {p.screen === "review" ? (
                      <>
                        <h2>Make it their kind of treat.</h2>
                        <label className="spend-field-title">
                          Choose a gift-card value
                        </label>
                        <div className="spend-values">
                          {product.values.map((v) => (
                            <button
                              key={v}
                              aria-pressed={v === p.value}
                              onClick={() => p.onValue(v)}
                            >
                              {money(v)}
                            </button>
                          ))}
                        </div>
                        <label className="spend-field">
                          Parent account
                          <select
                            aria-label="Parent account"
                            value={p.vault}
                            onChange={(e) => p.onVault(e.target.value)}
                          >
                            <option value="">
                              {p.wallet
                                ? "Choose your family vault"
                                : "Connect your wallet first"}
                            </option>
                            {p.vaults.map((v) => (
                              <option key={v.id} value={v.id}>
                                Family · {shortAddress(v.id)}
                              </option>
                            ))}
                          </select>
                        </label>
                        <div className="spend-detail">
                          <span>Payment currency</span>
                          <strong>USDC · Base</strong>
                        </div>
                        <div className="spend-detail">
                          <span>Per-purchase limit</span>
                          <strong>${p.catalog?.perOrderLimit ?? 100}</strong>
                        </div>
                        <div className="spend-detail">
                          <span>Daily checkout limit</span>
                          <strong>${p.catalog?.dailyLimit ?? 200}</strong>
                        </div>
                        <div className="spend-total">
                          <span>Gift-card value</span>
                          <strong>{money(p.value)}</strong>
                        </div>
                        <p className="spend-fine">
                          Your exact USDC quote appears before payment. Network
                          fees are separate. Payment comes from your connected
                          wallet; your savings vault stays untouched.
                        </p>
                        <label className="spend-consent">
                          <input
                            type="checkbox"
                            checked={p.approved}
                            onChange={(e) => p.onApprove(e.target.checked)}
                          />
                          <span>
                            I approve this purchase and have checked the US
                            region.
                          </span>
                        </label>
                        <button
                          className="spend-button wide"
                          disabled={
                            p.busy || (!!p.wallet && (!p.approved || !p.vault))
                          }
                          onClick={p.wallet ? p.onCheckout : p.onConnect}
                        >
                          {p.busy
                            ? "Checking…"
                            : p.wallet
                              ? "Approve & get quote"
                              : "Connect parent wallet"}
                          <ArrowRight size={18} />
                        </button>
                        <p className="spend-fine centered">
                          Fulfilled by Bitrefill. Managed here in Sprout.
                        </p>
                      </>
                    ) : (
                      <>
                        <div
                          className={`spend-status ${order?.status === "delivered" ? "complete" : ""}`}
                        >
                          <Check size={18} />
                          {stateLabel}
                        </div>
                        <h2>
                          {order?.status === "delivered"
                            ? "Their next adventure is ready."
                            : order?.status === "expired"
                              ? "This quote has expired."
                              : order?.status === "attention"
                                ? "Let’s check this order."
                                : "Review it. Then make it theirs."}
                        </h2>
                        {order?.status === "delivered" ? (
                          <>
                            <p className="spend-fine">
                              Keep your gift-card details private. You can come
                              back to this order whenever you need them.
                            </p>
                            <div className="spend-redemption">
                              <span>YOUR GIFT CARD</span>
                              <strong>
                                {p.revealed
                                  ? (order.redemption?.code ??
                                    "See redemption instructions below")
                                  : "••••  ••••  ••••"}
                              </strong>
                              {p.revealed && order.redemption?.pin && (
                                <p>PIN: {order.redemption.pin}</p>
                              )}
                              <button
                                className="spend-text-button"
                                onClick={p.onReveal}
                              >
                                {p.revealed
                                  ? "Hide details"
                                  : "Reveal gift card"}{" "}
                                <LockKeyhole size={15} />
                              </button>
                            </div>
                            {p.revealed && (
                              <div className="spend-instructions">
                                {order.redemption?.instructions}
                                {order.redemption?.link && (
                                  <a
                                    href={order.redemption.link}
                                    target="_blank"
                                    rel="noreferrer"
                                  >
                                    Open redemption instructions{" "}
                                    <ArrowUpRight size={14} />
                                  </a>
                                )}
                              </div>
                            )}
                            {p.revealed && order.redemption?.code && (
                              <button
                                className="spend-button wide"
                                onClick={p.onCopy}
                              >
                                <Copy size={17} />
                                {p.copied ? "Copied" : "Copy gift-card code"}
                              </button>
                            )}
                            <button
                              className="spend-text-button"
                              onClick={() => p.onScreen("orders")}
                            >
                              View your orders <ArrowRight size={17} />
                            </button>
                          </>
                        ) : (
                          <>
                            <div className="spend-detail">
                              <span>Gift-card value</span>
                              <strong>{money(order?.value ?? 0)}</strong>
                            </div>
                            <div className="spend-total">
                              <span>Amount to pay</span>
                              <strong>
                                {order?.payment?.amount ?? "—"}{" "}
                                <small>USDC</small>
                              </strong>
                            </div>
                            <div className="spend-detail">
                              <span>Network</span>
                              <strong>Base</strong>
                            </div>
                            {order?.payment && (
                              <div className="spend-detail">
                                <span>Fulfillment payment address</span>
                                <strong>
                                  {shortAddress(order.payment.address)}
                                </strong>
                              </div>
                            )}
                            <p className="spend-fine">
                              Check the amount and network in your wallet. No
                              token allowance is requested. USDC goes directly
                              to the fulfillment invoice.
                            </p>
                            {order?.status === "unpaid" && !p.sent ? (
                              <button
                                className="spend-button wide"
                                onClick={p.onPay}
                                disabled={p.busy}
                              >
                                {p.busy
                                  ? "Check your wallet…"
                                  : "Pay through Sprout"}
                                <ArrowRight size={18} />
                              </button>
                            ) : (
                              <p className="spend-fine">
                                {order?.status === "attention"
                                  ? "Payment or delivery needs a provider check. Keep your order reference and contact Sprout support before placing another order."
                                  : order?.status === "expired"
                                    ? "Do not pay this invoice. Start a fresh checkout for a new quote."
                                    : "Waiting for payment and delivery confirmation. Keep this order open; do not send a second payment."}
                              </p>
                            )}
                            <button
                              className="spend-text-button"
                              onClick={p.onRefresh}
                              disabled={p.busy}
                            >
                              <RefreshCw size={15} /> Check order status
                            </button>
                          </>
                        )}
                        <div className="spend-receipt-ref">
                          <span>Sprout order</span>
                          <code>{order?.id}</code>
                        </div>
                      </>
                    )}
                  </section>
                </div>
              )
            )}
          </>
        )}
        {p.error && (
          <div className="spend-error" role="alert">
            {p.error}
          </div>
        )}
        <footer className="spend-footer">
          <a className="spend-brand" href="/">
            <img src={asset("/brand/sprout-logo.png")} alt="" />
            SPROUT
          </a>
          <p>Little choices. A bigger tomorrow.</p>
          <div>
            <a href="/docs">How Sprout works</a>
            <a href="/dashboard">
              Your garden <ArrowUpRight size={14} />
            </a>
          </div>
        </footer>
      </main>
    </div>
  );
}
