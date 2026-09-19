import { useEffect, useRef, useState } from "react";
import { bytesToHex, formatUnits, type Hex } from "viem";
import { exactUnits } from "./amounts";
import {
  allocateGift,
  claimDigest,
  claimSchema,
  orderSchema,
  policyHash,
  policySchema,
  savingsSchema,
} from "@sprout/shared/privacy-v2";
import {
  createStealthIdentity,
  deriveStealthDestination,
} from "@sprout/shared/stealth";
import {
  createVault,
  seal,
  unlockVault,
  type EncryptedVault,
} from "../privacy/crypto";
import {
  privacyFeatures,
  initialFields,
  type FeatureId,
  type WorkspaceFields,
  type PublicVenue,
} from "./catalog";
import { PrivacyWorkspaceView } from "./WorkspaceView";

const STORAGE = "sprout-privacy-workspace-v2",
  OWNER = "sprout-private-preparation-v2";
const randomHash = () => bytesToHex(crypto.getRandomValues(new Uint8Array(32)));
type Identity = ReturnType<typeof createStealthIdentity>;
type Data = {
  account: Hex;
  identity: Identity;
  policyEpoch: number;
  records: Record<string, string>;
};
function readBackup(): EncryptedVault | null {
  try {
    return JSON.parse(localStorage.getItem(STORAGE) ?? "null");
  } catch {
    return null;
  }
}
export function PrivacyWorkspace() {
  const initial = new URLSearchParams(location.search).get("tool");
  const [active, setActive] = useState<FeatureId>(
    privacyFeatures.some((f) => f.id === initial)
      ? (initial as FeatureId)
      : "swaps",
  );
  const [fields, setFields] = useState<WorkspaceFields>(initialFields),
    [password, setPassword] = useState("");
  const [backup, setBackup] = useState<EncryptedVault | null>(readBackup),
    [data, setData] = useState<Data | null>(null);
  const [busy, setBusy] = useState(false),
    [notice, setNotice] = useState(""),
    [result, setResult] = useState("");
  const [venue, setVenue] = useState<PublicVenue | null>(null);
  const key = useRef<CryptoKey | null>(null),
    input = useRef<HTMLInputElement>(null);
  const lock = () => {
    key.current = null;
    setData(null);
    setPassword("");
    setResult("");
    setFields(initialFields);
  };
  useEffect(() => {
    const abort = new AbortController();
    fetch("/api/privacy/venue", { signal: abort.signal })
      .then(async (r) => {
        if (r.ok) {
          const value = (await r.json()) as PublicVenue;
          if (
            value.sproutSettlementEnabled === false &&
            Array.isArray(value.markets)
          )
            setVenue(value);
        }
      })
      .catch(() => {
        /* manual contract entry remains available; settlement is always disabled */
      });
    return () => abort.abort();
  }, []);
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const hide = () => {
      clearTimeout(timer);
      if (document.hidden) timer = setTimeout(lock, 5 * 60_000);
    };
    const unload = () => {
      key.current = null;
    };
    document.addEventListener("visibilitychange", hide);
    window.addEventListener("pagehide", unload);
    return () => {
      clearTimeout(timer);
      document.removeEventListener("visibilitychange", hide);
      window.removeEventListener("pagehide", unload);
    };
  }, []);
  async function unlock() {
    setBusy(true);
    setNotice("");
    try {
      if (backup) {
        const opened = await unlockVault(backup, OWNER, password);
        const parsed = JSON.parse(opened.data.workspace ?? "") as Data;
        if (
          !parsed.identity ||
          !parsed.account ||
          !parsed.records ||
          !Number.isSafeInteger(parsed.policyEpoch)
        )
          throw new Error("Invalid workspace backup.");
        key.current = opened.key;
        setData(parsed);
      } else {
        const next: Data = {
          account: randomHash(),
          identity: createStealthIdentity(),
          policyEpoch: 0,
          records: {},
        };
        const created = await createVault(OWNER, password, {
          workspace: JSON.stringify(next),
        });
        localStorage.setItem(STORAGE, JSON.stringify(created.vault));
        key.current = created.key;
        setBackup(created.vault);
        setData(next);
      }
      setPassword("");
    } catch {
      setNotice(
        "Unable to unlock or save. Check your passphrase and browser storage.",
      );
    } finally {
      setBusy(false);
    }
  }
  async function save(next: Data, output: string) {
    const currentKey = key.current;
    if (!currentKey || !backup) throw new Error("Unlock the workspace first.");
    if (localStorage.getItem(STORAGE) !== JSON.stringify(backup))
      throw new Error(
        "This workspace changed in another tab. Reload and unlock it before saving.",
      );
    const encrypted = await seal(
      currentKey,
      JSON.stringify({ workspace: JSON.stringify(next) }),
      `${OWNER}:data`,
    );
    if (key.current !== currentKey)
      throw new Error("Workspace locked. Unlock before saving.");
    if (localStorage.getItem(STORAGE) !== JSON.stringify(backup))
      throw new Error(
        "This workspace changed in another tab. Reload before saving.",
      );
    const updated = { ...backup, data: encrypted };
    localStorage.setItem(STORAGE, JSON.stringify(updated));
    setBackup(updated);
    setData(next);
    setResult(output);
  }
  async function prepare() {
    if (!data) return;
    setBusy(true);
    setNotice("");
    setResult("");
    try {
      const now = Math.floor(Date.now() / 1000);
      let value: unknown,
        output = "",
        epoch = data.policyEpoch;
      const mix = () => [
        { asset: fields.asset, bps: Number(fields.weight) * 100 },
        { asset: fields.secondAsset, bps: 10000 - Number(fields.weight) * 100 },
      ];
      if (active === "policy") {
        epoch++;
        value = policySchema.parse({
          version: 1,
          chainId: 4663,
          account: data.account,
          epoch,
          expiresAt: now + 30 * 86400,
          maxOrderValue: exactUnits(fields.limit, 6),
          assets: [
            { asset: fields.asset, maxWeightBps: Number(fields.weight) * 100 },
          ],
        });
        output = `Policy version ${epoch}\nCommitment ${policyHash(value as Parameters<typeof policyHash>[0])}\nSaved locally · valid for 30 days`;
      } else if (active === "swaps") {
        if (!data.records.policy)
          throw new Error(
            "Create family rules first, so the order is bound to a policy.",
          );
        const p = policySchema.parse(JSON.parse(data.records.policy));
        if (p.expiresAt <= now)
          throw new Error("Renew the expired family policy first.");
        if (
          !p.assets.some(
            (a) => a.asset.toLowerCase() === fields.asset.toLowerCase(),
          )
        )
          throw new Error("Choose an asset from your family rules.");
        const decimals = venue?.markets.find(
          (m) => m.token.toLowerCase() === fields.asset.toLowerCase(),
        )?.decimals;
        if (decimals === undefined)
          throw new Error(
            "Wait for the public asset check before preparing an order.",
          );
        const quantity = exactUnits(fields.amount, decimals),
          limitPrice = exactUnits(fields.limit, 6);
        if (
          (BigInt(quantity) * BigInt(limitPrice) +
            10n ** BigInt(decimals) -
            1n) /
            10n ** BigInt(decimals) >
          BigInt(p.maxOrderValue)
        )
          throw new Error("This order exceeds the family’s dollar limit.");
        value = orderSchema.parse({
          account: data.account,
          asset: fields.asset,
          side: "buy",
          quantity,
          limitPrice,
          window: Math.floor(now / 300) + 1,
          policyHash: policyHash(p),
          nonce: randomHash(),
          minimumFill: "0",
          displayQuantity: quantity,
          pegOffsetBps: 0,
          backstop: false,
          maxSpreadBps: 0,
        });
        output = `Limit-order intent encrypted\nBound to policy version ${p.epoch}\nAwaiting a verified settlement connection`;
      } else if (active === "tags") {
        const tag = fields.tag.trim().toLowerCase();
        if (!/^[a-z0-9][a-z0-9-]{2,31}$/.test(tag))
          throw new Error("Use an alias of 3–32 letters, digits or hyphens.");
        const destination = deriveStealthDestination(
          data.identity.spendingPublicKey,
          data.identity.viewingPublicKey,
        );
        value = { tag, ...destination, createdAt: now };
        output = `Local alias @sprout/${tag}\nFresh destination ${destination.address}\nView tag ${destination.viewTag} · keep your encrypted key backup`;
      } else if (active === "gifts") {
        const allocations = allocateGift(
          BigInt(exactUnits(fields.amount, 2)),
          mix(),
        );
        value = {
          version: 1,
          denomination: "USD-cents",
          allocations,
          createdAt: now,
          expiresAt: now + 86400,
        };
        output = `Gift plan saved\n${allocations.map((a) => `$${formatUnits(BigInt(a.amount), 2)} → ${venue?.markets.find((m) => m.token.toLowerCase() === a.asset.toLowerCase())?.symbol ?? a.asset}`).join("\n")}\nNo transfer or conversion submitted`;
      } else if (active === "adult") {
        value = savingsSchema.parse({
          version: 1,
          kind: "adult",
          amount: exactUnits(fields.amount, 2),
          cadenceDays: Number(fields.cadence),
          startAt: now,
          mix: mix(),
          backstop: false,
          maxSpreadBps: Number(fields.spread),
        });
        output = `Savings plan encrypted\nEvery ${fields.cadence} days · ${fields.weight}/${100 - Number(fields.weight)} mix\nBackstop off · execution not scheduled`;
      } else {
        value = claimSchema.parse({
          version: 1,
          kind: fields.claim,
          chainId: 4663,
          verifier: fields.verifier,
          root: fields.root,
          epoch: 0,
          audience: fields.audience,
          challenge: randomHash(),
          expiresAt: now + 300,
          threshold: fields.amount,
        });
        output = `Audience-bound request\nDigest ${claimDigest(value as Parameters<typeof claimDigest>[0], now)}\nExpires in five minutes · no proof issued`;
      }
      await save(
        {
          ...data,
          policyEpoch: epoch,
          records: { ...data.records, [active]: JSON.stringify(value) },
        },
        output,
      );
    } catch (e) {
      setNotice(
        e instanceof Error
          ? e.name === "ZodError"
            ? "Check contract addresses, whole-unit amounts and allocation values."
            : e.message
          : "Unable to prepare this request.",
      );
    } finally {
      setBusy(false);
    }
  }
  function download() {
    if (!backup) return;
    const url = URL.createObjectURL(
      new Blob([JSON.stringify(backup)], { type: "application/json" }),
    );
    const a = document.createElement("a");
    a.href = url;
    a.download = "sprout-private-workspace.encrypted.json";
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  async function restore(file?: File) {
    if (!file) return;
    setNotice("");
    try {
      if (file.size > 256000) throw new Error("Backup is too large.");
      const restored = JSON.parse(await file.text()) as EncryptedVault;
      // Authenticate the complete backup before replacing any existing data.
      const opened = await unlockVault(restored, OWNER, password);
      const parsed = JSON.parse(opened.data.workspace ?? "") as Data;
      if (!parsed.identity || !parsed.account || !parsed.records)
        throw new Error("Invalid backup.");
      localStorage.setItem(STORAGE, JSON.stringify(restored));
      setBackup(restored);
      lock();
      setNotice("Backup restored. Unlock it with its passphrase.");
    } catch {
      setNotice(
        "Backup not restored. Enter its passphrase first and choose a valid encrypted backup.",
      );
    }
    if (input.current) input.current.value = "";
  }
  return (
    <PrivacyWorkspaceView
      active={active}
      fields={fields}
      unlocked={Boolean(data)}
      busy={busy}
      result={result}
      notice={notice}
      venue={venue}
      onSelect={(id) => {
        setActive(id);
        setResult("");
        setNotice("");
        history.replaceState(null, "", `/privacy-workspace?tool=${id}`);
      }}
      onField={(name, value) => setFields((f) => ({ ...f, [name]: value }))}
      onAction={() => void prepare()}
    >
      <section className="pv-security">
        <div>
          <h2>
            {data
              ? "Backup and lock"
              : backup
                ? "Unlock your workspace"
                : "Set up your workspace"}
          </h2>
          <p>
            {data
              ? "Download an encrypted backup before closing this browser. Losing the keys loses access to derived destinations."
              : "Use a passphrase of at least 12 characters. Your keys and plans are encrypted locally; Sprout cannot recover them."}
          </p>
        </div>
        {data ? (
          <div className="pv-security-actions">
            <button onClick={download}>Download encrypted backup ↓</button>
            <button onClick={lock}>Lock workspace</button>
          </div>
        ) : (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void unlock();
            }}
          >
            <label className="pv-field">
              Workspace passphrase
              <input
                type="password"
                minLength={12}
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete={backup ? "current-password" : "new-password"}
              />
            </label>
            <button className="pv-primary" disabled={busy}>
              {busy
                ? "Unlocking…"
                : backup
                  ? "Unlock workspace"
                  : "Create encrypted workspace"}
            </button>
            <button type="button" onClick={() => input.current?.click()}>
              Restore encrypted backup
            </button>
            <input
              hidden
              ref={input}
              type="file"
              accept=".json,application/json"
              onChange={(e) => void restore(e.target.files?.[0])}
            />
          </form>
        )}
      </section>
    </PrivacyWorkspaceView>
  );
}
