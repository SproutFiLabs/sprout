import { useEffect, useRef, useState, type FormEvent } from "react";
import { X, Trash2 } from "lucide-react";
import {
  dollarsToCents,
  type AssetPassport,
  type FamilyPlan,
  type InvestmentProvider,
  type LedgerEntry,
  type ToolsData,
} from "@sprout/shared";
import {
  api,
  authorizeFamily,
  clearFamilySession,
  familyHeaders,
} from "../api";
import {
  connectWallet,
  ensureChain,
  injectedProvider,
  type WalletState,
} from "../wallet";
import { ToolsView, type ToolPage } from "./ToolsView";
const empty: ToolsData = {
  entries: [],
  offers: [],
  claims: [],
  plan: null,
  premium: false,
  rewardReady: false,
};
function download(data: string, name: string, type: string) {
  const url = URL.createObjectURL(new Blob([data], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export function FamilyToolsPage({ page }: { page: ToolPage }) {
  const [wallet, setWallet] = useState<WalletState | null>(null),
    [data, setData] = useState<ToolsData>(empty),
    [passports, setPassports] = useState<AssetPassport[]>([]),
    [provider, setProvider] = useState<InvestmentProvider | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [asset, setAsset] = useState(
      new URLSearchParams(location.search).get("asset") ?? "",
    ),
    [search, setSearch] = useState(""),
    [year, setYear] = useState("all"),
    [filter, setFilter] = useState("all"),
    [edit, setEdit] = useState<LedgerEntry | "new" | null>(null);
  const epoch = useRef(0),
    lock = useRef(false),
    file = useRef<HTMLInputElement>(null),
    current = useRef<WalletState | null>(null);
  const request = async <T,>(
    path: string,
    method = "GET",
    body?: unknown,
  ): Promise<T> => {
    const version = epoch.current;
    const r = await fetch(path, {
      method,
      headers: { ...familyHeaders(), "content-type": "application/json" },
      cache: "no-store",
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    const value = await r.json();
    if (version !== epoch.current)
      throw new Error("Wallet changed. Reconnect to continue.");
    if (!r.ok) {
      if (r.status === 401) reset();
      throw new Error(value.error ?? "This action could not finish.");
    }
    return value as T;
  };
  const reset = () => {
    epoch.current++;
    clearFamilySession();
    current.current = null;
    setWallet(null);
    setData(empty);
    setEdit(null);
    setNotice("");
    setError("");
  };
  const refresh = async () => {
    const pub = await request<{
      passports: AssetPassport[];
      offers: ToolsData["offers"];
      provider: InvestmentProvider | null;
      rewardReady: boolean;
    }>("/api/family-tools/public");
    setPassports(pub.passports);
    setProvider(pub.provider);
    if (current.current) setData(await request<ToolsData>("/api/family-tools"));
    else
      setData({ ...empty, offers: pub.offers, rewardReady: pub.rewardReady });
  };
  const run = async (fn: () => Promise<void>) => {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setError("");
    setNotice("");
    const version = epoch.current;
    try {
      await fn();
    } catch (e) {
      if (version === epoch.current)
        setError(e instanceof Error ? e.message : "Please try again.");
    } finally {
      lock.current = false;
      setBusy(false);
    }
  };
  useEffect(() => {
    document.title = `${{ home: "Family toolkit", rewards: "Rewards", tax: "Tax Garden", passports: "Asset Passports", investing: "Family Investing" }[page]} · SPROUT`;
    const boot = setTimeout(() => void run(refresh), 0);
    const p = injectedProvider();
    const changed = () => reset();
    p?.on?.("accountsChanged", changed);
    p?.on?.("chainChanged", changed);
    p?.on?.("disconnect", changed);
    window.addEventListener("sprout-family-session-ended", changed);
    return () => {
      clearTimeout(boot);
      epoch.current++;
      p?.removeListener?.("accountsChanged", changed);
      p?.removeListener?.("chainChanged", changed);
      p?.removeListener?.("disconnect", changed);
      window.removeEventListener("sprout-family-session-ended", changed);
      clearFamilySession();
    };
  }, []);
  const connect = () =>
    run(async () => {
      const { chain } = await api.config();
      const w = await connectWallet({
        chainId: chain.chainId,
        name: chain.name,
        rpcUrl: chain.walletRpcUrl,
      });
      await ensureChain(w, {
        chainId: chain.chainId,
        name: chain.name,
        rpcUrl: chain.walletRpcUrl,
      });
      const v = epoch.current;
      await authorizeFamily(w);
      if (v !== epoch.current) throw new Error("Your wallet changed.");
      current.current = w;
      setWallet(w);
      await refresh();
    });
  const saveEntry = (entry: LedgerEntry) =>
    run(async () => {
      if (edit !== "new") {
        await request(
          `/api/family-tools/ledger/${encodeURIComponent(entry.id)}`,
          "PATCH",
          {
            basisCents: entry.basisCents,
            usdCents: entry.usdCents,
            feeCents: entry.feeCents,
            date: entry.date,
            note: entry.note,
          },
        );
      } else
        await request("/api/family-tools/ledger", "POST", { entries: [entry] });
      await refresh();
      setEdit(null);
      setNotice("Record saved.");
    });
  const exportCsv = (advanced: boolean) =>
    run(async () => {
      const v = epoch.current;
      const r = await fetch(
        `/api/family-tools/ledger.csv?advanced=${advanced ? "1" : "0"}`,
        { headers: familyHeaders(), cache: "no-store" },
      );
      if (!r.ok)
        throw new Error((await r.json()).error ?? "Export unavailable.");
      const text = await r.text();
      if (v !== epoch.current) throw new Error("Wallet changed.");
      download(
        text,
        advanced
          ? "SPROUT-accountant-records.csv"
          : "SPROUT-family-records.csv",
        "text/csv",
      );
      setNotice("Your records were exported. This is not a filed tax return.");
    });
  return (
    <>
      <ToolsView
        page={page}
        wallet={wallet?.address ?? null}
        busy={busy}
        error={error}
        notice={notice}
        data={data}
        passports={passports}
        provider={provider}
        selectedAsset={asset}
        search={search}
        year={year}
        ledgerFilter={filter}
        onConnect={() => void connect()}
        onLock={reset}
        onRefresh={() => void run(refresh)}
        onSearch={setSearch}
        onAsset={setAsset}
        onYear={setYear}
        onFilter={setFilter}
        onAdd={() => {
          setError("");
          setEdit("new");
        }}
        onEdit={(entry) => {
          setError("");
          setEdit(entry);
        }}
        onDelete={() => {}}
        onImport={() => file.current?.click()}
        onTemplate={() =>
          download(
            JSON.stringify(
              {
                entries: [
                  {
                    id: "replace-with-unique-reference",
                    date: "2026-09-19T12:00:00.000Z",
                    kind: "purchase",
                    asset: "USDC",
                    quantity: "25",
                    chainId: 8453,
                    wallet:
                      wallet?.address ??
                      "0x0000000000000000000000000000000000000000",
                    usdCents: 2500,
                    basisCents: 2500,
                    feeCents: 0,
                    note: "Replace this example with your own transaction.",
                    source: "import",
                  },
                ],
              },
              null,
              2,
            ),
            "SPROUT-import-template.json",
            "application/json",
          )
        }
        onExport={(v) => void exportCsv(v)}
        onSync={() =>
          void run(async () => {
            const r = await request<{ added: number }>(
              "/api/family-tools/sync",
              "POST",
              {},
            );
            await refresh();
            setNotice(
              `${r.added} new records added. Review dates, historical USD values, basis and fees.`,
            );
          })
        }
        onConfirm={(id) =>
          void run(async () => {
            await request(
              `/api/family-tools/rewards/${id}/confirm`,
              "POST",
              {},
            );
            await refresh();
            setNotice("Reward confirmed for manual payout.");
          })
        }
        onPlan={(plan) =>
          void run(async () => {
            await request("/api/family-tools/plan", "PUT", plan);
            await refresh();
            setNotice(
              "Your family plan is saved. No account was opened or trade placed.",
            );
          })
        }
        onDeletePlan={() =>
          void run(async () => {
            await request("/api/family-tools/plan", "DELETE");
            await refresh();
            setNotice("Saved plan deleted.");
          })
        }
        onDownloadPlan={() =>
          download(
            JSON.stringify(
              {
                plan: data.plan,
                notice:
                  "Planning record only. No account, investment order or promised return.",
              },
              null,
              2,
            ),
            "SPROUT-family-plan.json",
            "application/json",
          )
        }
        onProvider={() =>
          void run(async () => {
            const r = await request<{ url: string }>(
              "/api/family-tools/provider-handoff",
              "POST",
              {},
            );
            window.location.assign(r.url);
          })
        }
      />
      <input
        ref={file}
        type="file"
        accept="application/json,.json"
        hidden
        onChange={(e) => {
          const f = e.target.files?.[0];
          e.target.value = "";
          if (!f) return;
          void run(async () => {
            if (f.size > 1_000_000)
              throw new Error("Choose a JSON file smaller than 1 MB.");
            let imported: unknown;
            try {
              imported = JSON.parse(await f.text());
            } catch {
              throw new Error(
                "This file is not valid JSON. Download the template to see the format.",
              );
            }
            const r = await request<{ added: number; duplicates: number }>(
              "/api/family-tools/ledger",
              "POST",
              imported,
            );
            await refresh();
            setNotice(
              `${r.added} records imported; ${r.duplicates} duplicate references skipped.`,
            );
          });
        }}
      />
      {edit && (
        <LedgerDialog
          entry={edit}
          wallet={wallet?.address ?? ""}
          busy={busy}
          serverError={error}
          onClose={() => setEdit(null)}
          onSave={saveEntry}
          onDelete={(id) =>
            void run(async () => {
              await request(
                `/api/family-tools/ledger/${encodeURIComponent(id)}`,
                "DELETE",
              );
              setEdit(null);
              await refresh();
              setNotice(
                "Record deleted. Synced records can be imported again.",
              );
            })
          }
        />
      )}
    </>
  );
}
function LedgerDialog({
  entry,
  wallet,
  busy,
  serverError,
  onClose,
  onSave,
  onDelete,
}: {
  entry: LedgerEntry | "new";
  wallet: string;
  busy: boolean;
  serverError: string;
  onClose: () => void;
  onSave: (e: LedgerEntry) => void;
  onDelete: (id: string) => void;
}) {
  const e = entry === "new" ? null : entry;
  const [error, setError] = useState(""),
    [deleting, setDeleting] = useState(false);
  const dialog = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const before = document.activeElement as HTMLElement;
    const el = dialog.current;
    el?.querySelector<HTMLElement>("input,button")?.focus();
    const key = (ev: KeyboardEvent) => {
      if (ev.key === "Escape") onClose();
      if (ev.key === "Tab") {
        const all = Array.from(
          el?.querySelectorAll<HTMLElement>(
            "button:not(:disabled),input,select,textarea,a[href]",
          ) ?? [],
        );
        const first = all[0],
          last = all.at(-1);
        if (ev.shiftKey && document.activeElement === first) {
          ev.preventDefault();
          last?.focus();
        } else if (!ev.shiftKey && document.activeElement === last) {
          ev.preventDefault();
          first?.focus();
        }
      }
    };
    document.addEventListener("keydown", key);
    const old = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", key);
      document.body.style.overflow = old;
      before?.focus();
    };
  }, []);
  const submit = (ev: FormEvent<HTMLFormElement>) => {
    ev.preventDefault();
    setError("");
    try {
      const f = new FormData(ev.currentTarget);
      const val = (n: string) => String(f.get(n) ?? "");
      onSave({
        id: e?.id ?? crypto.randomUUID(),
        date: val("date")
          ? new Date(val("date") + (e ? "Z" : "")).toISOString()
          : e!.date,
        kind: e?.kind ?? (val("kind") as LedgerEntry["kind"]),
        asset: e?.asset ?? val("asset").trim().toUpperCase(),
        quantity: e?.quantity ?? val("quantity"),
        chainId: e?.chainId ?? Number(val("chain")),
        wallet: e?.wallet ?? wallet,
        source: e?.source ?? "manual",
        note: val("note"),
        ...(e?.txHash ? { txHash: e.txHash } : {}),
        usdCents: dollarsToCents(val("value")),
        basisCents: dollarsToCents(val("basis")),
        feeCents: dollarsToCents(val("fee")) ?? 0,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Check this record.");
    }
  };
  return (
    <div className="ft-root ft-modal-backdrop fw-drawer-backdrop">
      <div
        className="ft-modal fw-record-drawer"
        role="dialog"
        aria-modal="true"
        aria-labelledby="ledger-dialog-title"
        ref={dialog}
      >
        <header>
          <h2 id="ledger-dialog-title">
            {e ? "Review record" : "Add a record"}
          </h2>
          <button aria-label="Close record" onClick={onClose}>
            <X size={18} />
          </button>
        </header>
        <p className="ft-fine">
          Leave unknown values blank. Enter the cost basis for this disposal,
          not the balance of your entire wallet.
        </p>
        {e && (
          <>
            <div className="fw-record-summary">
              <b>{e.asset}</b>
              <span>
                {e.quantity} {e.asset} · {e.kind}
                <small>{e.source} record</small>
              </span>
            </div>
            <a
              className="fw-drawer-explain"
              href={`/intelligence?context=ledger&id=${encodeURIComponent(e.id)}&q=Explain%20this%20record%20and%20its%20missing%20information`}
            >
              Ask Intelligence about this record ↗
            </a>
          </>
        )}
        <form className="ft-form fw-record-form" onSubmit={submit}>
          <div className="fw-form-section-label">
            <span>01</span> Transaction details
          </div>
          {!e && (
            <>
              <div className="ft-form-row">
                <label>
                  Activity
                  <select name="kind">
                    <option value="purchase">Asset purchase</option>
                    <option value="sale">Asset sale</option>
                    <option value="spend">Spent crypto</option>
                    <option value="transfer">Transfer</option>
                    <option value="gift">Gift</option>
                    <option value="reward">Reward</option>
                  </select>
                </label>
                <label>
                  Date & time · your timezone
                  <input type="datetime-local" name="date" required />
                </label>
              </div>
              <div className="ft-form-row">
                <label>
                  Asset symbol
                  <input
                    name="asset"
                    placeholder="USDC"
                    required
                    maxLength={20}
                  />
                </label>
                <label>
                  Quantity
                  <input
                    name="quantity"
                    placeholder="25.00"
                    required
                    pattern="[0-9]+([.][0-9]+)?"
                  />
                </label>
              </div>
              <label>
                Network chain ID
                <input
                  name="chain"
                  type="number"
                  min="1"
                  required
                  defaultValue={8453}
                />
              </label>
            </>
          )}
          {e && (
            <label>
              Transaction date & time · UTC
              <input
                type="datetime-local"
                name="date"
                defaultValue={e.date.slice(0, 16)}
                required
              />
            </label>
          )}
          <div className="fw-form-section-label">
            <span>02</span> Values at the time
          </div>
          <div className="ft-form-row">
            <label>
              Value at transaction · USD
              <input
                name="value"
                inputMode="decimal"
                defaultValue={
                  e?.usdCents == null ? "" : String(e.usdCents / 100)
                }
                placeholder="Unknown"
              />
            </label>
            <label>
              Cost basis · USD
              <input
                name="basis"
                inputMode="decimal"
                defaultValue={
                  e?.basisCents == null ? "" : String(e.basisCents / 100)
                }
                placeholder="Unknown"
              />
            </label>
          </div>
          <label>
            Fees · USD
            <input
              name="fee"
              inputMode="decimal"
              defaultValue={e ? String(e.feeCents / 100) : "0"}
            />
          </label>
          <div className="fw-form-section-label">
            <span>03</span> Keep a note
          </div>
          <label>
            A note for later
            <textarea
              name="note"
              maxLength={300}
              defaultValue={e?.note ?? ""}
              placeholder="No child names or private account details."
            />
          </label>
          {(error || serverError) && (
            <p role="alert" className="ft-error">
              {error || serverError}
            </p>
          )}
          <div className="ft-actions fw-drawer-actions">
            <button className="ft-primary" disabled={busy}>
              Save record <CheckMark />
            </button>
            {e && (
              <button
                className="ft-delete"
                disabled={busy}
                type="button"
                onClick={() => (deleting ? onDelete(e.id) : setDeleting(true))}
              >
                <Trash2 size={15} />
                {deleting ? "Confirm delete" : "Delete record"}
              </button>
            )}
          </div>
        </form>
      </div>
    </div>
  );
}
function CheckMark() {
  return <span aria-hidden>✓</span>;
}
