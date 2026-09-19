import { useRef, useState, type FormEvent } from "react";
import {
  dollarsToCents,
  type RewardOffer,
  type RewardClaim,
} from "@sprout/shared";
import { money } from "./ToolsView";
export function ToolsOperator() {
  const session = useRef(0);
  const [token, setToken] = useState(""),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [data, setData] = useState<{
      offers: RewardOffer[];
      claims: RewardClaim[];
    } | null>(null);
  const req = async (path: string, body?: unknown) => {
    const r = await fetch(`/api/family-tools/operator${path}`, {
      method: body ? "POST" : "GET",
      headers: {
        "content-type": "application/json",
        "x-sprout-admin-token": token,
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    const d = await r.json();
    if (!r.ok) throw new Error(d.error ?? "Operation failed.");
    return d;
  };
  const run = async (fn: () => Promise<void>) => {
    if (busy) return;
    const version = session.current;
    setBusy(true);
    setError("");
    try {
      await fn();
      if (version !== session.current) return;
      const latest = await req("");
      if (version === session.current) setData(latest);
    } catch (e) {
      if (version === session.current) setError(e instanceof Error ? e.message : "Operation failed.");
    } finally {
      setBusy(false);
    }
  };
  const offer = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    void run(async () => {
      await req("/offers", {
        title: f.get("title"),
        product: f.get("product"),
        rateBps: Math.round(Number(f.get("rate")) * 100),
        budgetCents: dollarsToCents(String(f.get("budget"))),
        endsAt: new Date(String(f.get("expiry"))).getTime(),
        terms: f.get("terms"),
      });
    });
  };
  return (
    <div className="ft-root">
      <main className="ft-operator">
        <a href="/rewards">← Rewards</a>
        <h1>Rewards operator desk</h1>
        <p>
          Offers reserve a promotional budget. Funds remain in the treasury.
          Payments are sent manually outside SPROUT; this desk verifies
          receipts.
        </p>
        {error && (
          <p role="alert" className="ft-message ft-error">
            {error}
          </p>
        )}
        <form
          className="ft-form"
          onSubmit={(e) => {
            e.preventDefault();
            void run(async () => {});
          }}
        >
          <label>
            Admin token
            <input
              type="password"
              autoComplete="off"
              value={token}
              onChange={(e) => {
                session.current++;
                setToken(e.target.value);
                setData(null);
              }}
            />
          </label>
          <button disabled={busy}>Open desk</button>
        </form>
        {data && (
          <>
            <section className="ft-panel">
              <h2>Create a funded offer</h2>
              <form className="ft-form" onSubmit={offer}>
                <label>
                  Offer title
                  <input name="title" required maxLength={80} />
                </label>
                <label>
                  Exact Spend product ID
                  <input name="product" required />
                </label>
                <div className="ft-form-row">
                  <label>
                    Rebate percent
                    <input
                      name="rate"
                      type="number"
                      min="0.01"
                      max="20"
                      step="0.01"
                      required
                    />
                  </label>
                  <label>
                    Total budget · USD
                    <input name="budget" required inputMode="decimal" />
                  </label>
                </div>
                <label>
                  Ends at
                  <input name="expiry" type="datetime-local" required />
                </label>
                <label>
                  Offer terms
                  <textarea
                    name="terms"
                    minLength={20}
                    maxLength={1000}
                    required
                    placeholder="Funding source, eligible purchases, exclusions and expected manual payout timing."
                  />
                </label>
                <button disabled={busy} className="ft-primary">
                  Verify treasury & create offer
                </button>
              </form>
            </section>
            <section className="ft-panel">
              <h2>Budget commitments</h2>
              {data.offers.map((o) => (
                <p key={o.id}>
                  <b>{o.title}</b> · {money(o.reservedCents)} reserved /{" "}
                  {money(o.budgetCents)} total
                  <br />
                  <small>{o.id}</small>
                </p>
              ))}
            </section>
            <section className="ft-panel">
              <h2>Reconcile manual payouts</h2>
              {data.claims.map((c) => (
                <article className="ft-offer" key={c.id}>
                  <b>
                    {money(c.cents)} · {c.status}
                  </b>
                  <p>
                    Recipient: <code>{c.owner}</code>
                    <br />
                    Base USDC · exact amount: {BigInt(c.cents) * 10000n +
                      ""}{" "}
                    base units
                  </p>
                  {c.status === "confirmed" && (
                    <form
                      className="ft-form"
                      onSubmit={(e) => {
                        e.preventDefault();
                        const f = new FormData(e.currentTarget);
                        void run(async () => {
                          await req("/payments", {
                            claimId: c.id,
                            txHash: f.get("tx"),
                            logIndex: Number(f.get("index")),
                          });
                        });
                      }}
                    >
                      <label>
                        Transfer transaction hash
                        <input name="tx" pattern="0x[0-9a-fA-F]{64}" required />
                      </label>
                      <label>
                        Transfer log index
                        <input name="index" type="number" min="0" required />
                      </label>
                      <button disabled={busy}>Verify finalized receipt</button>
                    </form>
                  )}
                </article>
              ))}
            </section>
            <button
              onClick={() => {
                session.current++;
                setToken("");
                setData(null);
                setError("");
              }}
            >
              Lock desk
            </button>
          </>
        )}
      </main>
    </div>
  );
}
