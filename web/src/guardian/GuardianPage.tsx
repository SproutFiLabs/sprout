import { useCallback, useEffect, useRef, useState } from "react";
import {
  createPublicClient,
  http,
  formatUnits,
  sha256,
  stringToHex,
  type Address,
  type Hex,
  type PublicClient,
} from "viem";
import {
  ArrowUpRight,
  Check,
  Clock3,
  Copy,
  Fingerprint,
  ShieldCheck,
} from "lucide-react";
import { sproutVaultAbi } from "@sprout/shared";
import { api, type ChainPublic } from "../api";
import {
  assertWalletReady,
  connectWallet,
  contractWriter,
  toChain,
  waitForSuccess,
  type WalletState,
} from "../wallet";
import {
  GuardianView,
  RecoveryPanel,
  DevicePanel,
  type GuardianTab,
} from "./GuardianView";
import {
  EMPTY,
  ZERO,
  amountUnits,
  countdown,
  guardianAbi,
  guardiansInput,
  readGuardian,
  short,
  walletAddress,
  type GuardianSnapshot,
} from "./model";
import { registerPasskey, signWithPasskey } from "./passkey";
import artifact from "./contract.json";
import { dateLocale, t } from "../i18n";

/**
 * A status or error line, kept as a function so it is translated when shown
 * and follows an EN / 中文 switch instead of staying in the old language.
 */
type Status = { show: () => string };
const QUIET: Status = { show: () => "" };
/** An error written for the family; `show` re-reads the language each render. */
class Notice extends Error {
  readonly show: () => string;
  constructor(show: () => string) {
    super(show());
    this.show = show;
  }
}
/** Our own notices re-translate; wallet and chain errors are shown as they came. */
const failure = (e: unknown, text: string): Status =>
  e instanceof Notice ? { show: e.show } : { show: () => text };

export function GuardianPage() {
  const [chain, setChain] = useState<ChainPublic | null>(null),
    [client, setClient] = useState<PublicClient | null>(null),
    [wallet, setWallet] = useState<WalletState | null>(null);
  const [snapshot, setSnapshot] = useState<GuardianSnapshot | null>(null),
    [tab, setTab] = useState<GuardianTab>("Protection");
  const [account, setAccount] = useState(
      () => new URLSearchParams(location.search).get("account") ?? "",
    ),
    [busy, setBusy] = useState(false),
    [error, setError] = useState<Status>(QUIET),
    [message, setMessage] = useState<Status>(QUIET);
  const [now, setNow] = useState(Math.floor(Date.now() / 1000));
  const [ownerInput, setOwnerInput] = useState(""),
    [guardianInputs, setGuardianInputs] = useState(["", "", ""]),
    [limit, setLimit] = useState("100");
  const [newOwner, setNewOwner] = useState(""),
    [destination, setDestination] = useState(""),
    [amount, setAmount] = useState("25"),
    [usePasskey, setUsePasskey] = useState(false),
    [vault, setVault] = useState("");
  const [graduation, setGraduation] = useState<{
      at: number;
      linked: boolean;
    } | null>(null),
    [policyDestination, setPolicyDestination] = useState(""),
    [policyLimit, setPolicyLimit] = useState("100"),
    [policyGuardians, setPolicyGuardians] = useState(["", "", ""]);
  const [manualTransferId, setManualTransferId] = useState("");
  const [queueEnd, setQueueEnd] = useState<bigint | undefined>();
  const [selectedToken, setSelectedToken] = useState("");
  const loadedAddress = useRef("");
  const accountRef = useRef<Address | null>(null);
  const generation = useRef(0),
    walletRef = useRef<WalletState | null>(null),
    operation = useRef(false),
    mounted = useRef(true);
  const tokenOptions = chain
    ? [
        {
          address: chain.contracts.settlementToken ?? ZERO,
          decimals: chain.contracts.settlementDecimals,
          symbol: chain.contracts.settlementSymbol ?? "USD",
        },
        ...chain.contracts.stockTokens,
        { address: ZERO, decimals: 18, symbol: "ETH" },
      ]
    : [];
  const selectedAsset =
    tokenOptions.find(
      (a) => a.address.toLowerCase() === selectedToken.toLowerCase(),
    ) ?? tokenOptions[0];
  const token = selectedAsset?.address ?? ZERO,
    decimals = selectedAsset?.decimals ?? 6,
    symbol = selectedAsset?.symbol ?? "USD";
  useEffect(() => {
    mounted.current = true;
    void api
      .config()
      .then(({ chain: c }) => {
        if (!mounted.current) return;
        setChain(c);
        if (!c.walletRpcUrl)
          throw new Notice(() => t("Public chain connection is not configured."));
        setClient(
          createPublicClient({
            chain: toChain({
              chainId: c.chainId,
              name: c.name,
              rpcUrl: c.walletRpcUrl,
            }),
            transport: http(c.walletRpcUrl),
          }) as PublicClient,
        );
      })
      .catch((e) => setError(failure(e, e.message)));
    return () => {
      mounted.current = false;
      walletRef.current = null;
      generation.current++;
    };
  }, []);
  useEffect(() => {
    const timer = setInterval(() => setNow((n) => n + 1), 1000);
    return () => clearInterval(timer);
  }, []);
  useEffect(() => {
    if (!wallet) return;
    const changed = () => {
      generation.current++;
      walletRef.current = null;
      setWallet(null);
      setError({
        show: () =>
          t("Wallet or network changed. Reconnect before approving a transaction."),
      });
    };
    wallet.provider.on?.("accountsChanged", changed);
    wallet.provider.on?.("chainChanged", changed);
    return () => {
      wallet.provider.removeListener?.("accountsChanged", changed);
      wallet.provider.removeListener?.("chainChanged", changed);
    };
  }, [wallet]);
  const refresh = useCallback(
    async (address: Address) => {
      if (!client) return;
      const g = ++generation.current;
      const next = await readGuardian(client, address, token, queueEnd);
      if (g !== generation.current || !mounted.current) return;
      setSnapshot(next);
      setNow(next.chainTime);
      accountRef.current = address;
      setAccount(address);
      if (loadedAddress.current !== `${address}:${token}`) {
        loadedAddress.current = `${address}:${token}`;
        setPolicyLimit(formatUnits(next.limit, decimals));
        setPolicyGuardians(next.guardians);
      }
      const u = new URL(location.href);
      u.searchParams.set("account", address);
      history.replaceState(null, "", u);
    },
    [client, token, decimals, queueEnd],
  );
  useEffect(() => {
    if (client && account)
      void Promise.resolve()
        .then(() => refresh(walletAddress(account)))
        .catch((e) => setError(failure(e, e.message)));
  }, [client, token, queueEnd]);
  useEffect(() => {
    if (!snapshot || !client) return;
    let live = true;
    const timer = setInterval(() => {
      const g = generation.current;
      void readGuardian(client, snapshot.address, token, queueEnd)
        .then((s) => {
          if (live && g === generation.current) {
            setSnapshot(s);
            setNow(s.chainTime);
          }
        })
        .catch(() => {});
    }, 15000);
    return () => {
      live = false;
      clearInterval(timer);
    };
  }, [client, snapshot?.address, token, queueEnd]);
  const run = async (fn: () => Promise<(() => string) | void>) => {
    if (operation.current) return;
    operation.current = true;
    setBusy(true);
    setError(QUIET);
    setMessage(QUIET);
    try {
      const show = await fn();
      if (mounted.current && show) setMessage({ show });
    } catch (e) {
      if (mounted.current)
        setError(
          e instanceof Error
            ? failure(
                e,
                (e as { shortMessage?: string }).shortMessage ?? e.message,
              )
            : { show: () => t("Please try again.") },
        );
    } finally {
      operation.current = false;
      if (mounted.current) setBusy(false);
    }
  };
  const connect = () =>
    void run(async () => {
      if (!chain) throw new Notice(() => t("Chain configuration is loading."));
      const w = await connectWallet({
        chainId: chain.chainId,
        name: chain.name,
        rpcUrl: chain.walletRpcUrl,
      });
      await assertWalletReady(w);
      walletRef.current = w;
      setWallet(w);
      setOwnerInput((v) => v || w.address);
      return () =>
        t("Wallet connected. Check the account and action before signing.");
    });
  const currentWallet = async () => {
    const w = walletRef.current;
    if (!w)
      throw new Notice(() =>
        t("Connect a wallet to approve and pay network gas."),
      );
    await assertWalletReady(w);
    if (!mounted.current || walletRef.current !== w)
      throw new Notice(() => t("Wallet changed. Reconnect before signing."));
    return w;
  };
  const write = async (name: string, args: unknown[] = []) => {
    const w = await currentWallet();
    const target = snapshot?.address;
    if (!target || accountRef.current !== target)
      throw new Notice(() => t("Open a Guardian wallet first."));
    const hash = await contractWriter(w)({
      address: target,
      abi: guardianAbi,
      functionName: name,
      args,
    });
    await waitForSuccess(w.publicClient, hash);
    if (walletRef.current !== w)
      throw new Notice(() =>
        t("Transaction submitted; reconnect to refresh this wallet."),
      );
    await refresh(target);
    return hash;
  };
  const isOwner =
    !!snapshot &&
    wallet?.address.toLowerCase() === snapshot.owner.toLowerCase();
  const guardianIndex =
    snapshot?.guardians.findIndex(
      (g) => g.toLowerCase() === wallet?.address.toLowerCase(),
    ) ?? -1;
  const isGuardian = guardianIndex >= 0,
    canManage = isOwner || isGuardian;
  const load = () =>
    void run(async () => {
      if (!client) throw new Notice(() => t("Chain connection is loading."));
      setSnapshot(null);
      await refresh(walletAddress(account));
      return () => t("Guardian bytecode and on-chain state verified.");
    });
  const deploy = () =>
    void run(async () => {
      const w = await currentWallet(),
        owner = walletAddress(ownerInput),
        guardians = guardiansInput(owner, guardianInputs),
        cap = amountUnits(limit, decimals);
      const hash = await w.walletClient.deployContract({
        account: w.address,
        chain: w.chain,
        abi: guardianAbi,
        bytecode: artifact.bytecode as Hex,
        args: [
          owner,
          guardians,
          token,
          cap,
          sha256(stringToHex(location.hostname)),
          location.origin,
        ],
      });
      const receipt = await w.publicClient.waitForTransactionReceipt({ hash });
      if (receipt.status !== "success" || !receipt.contractAddress)
        throw new Notice(() => t("Guardian deployment did not succeed."));
      if (walletRef.current !== w) {
        const address = receipt.contractAddress;
        throw new Notice(() =>
          t("Guardian created at {address}. Reconnect to open it.", {
            address,
          }),
        );
      }
      await refresh(receipt.contractAddress);
      return () =>
        t(
          "Guardian wallet created. Save its address, enroll a passkey, then choose it as the beneficiary of a new sprout.",
        );
    });
  const act = async (action: number, target: Address) => {
    const w = await currentWallet();
    if (!snapshot) throw new Notice(() => t("Open a Guardian wallet."));
    const address = snapshot.address;
    const units = amountUnits(amount, decimals);
    if (!usePasskey) {
      await write("act", [action, target, token, units]);
      return;
    }
    if (snapshot.origin !== location.origin) {
      const origin = snapshot.origin;
      throw new Notice(() =>
        t(
          "This wallet’s passkeys were enrolled at {origin}. Use that origin or approve with the owner wallet.",
          { origin },
        ),
      );
    }
    const block = await w.publicClient.getBlock();
    const deadline = block.timestamp + 300n;
    const challenge = (await w.publicClient.readContract({
      address,
      abi: guardianAbi,
      functionName: "challenge",
      args: [action, target, token, units, deadline],
    })) as Hex;
    const auth = await signWithPasskey(challenge);
    if (walletRef.current !== w)
      throw new Notice(() => t("Wallet changed during passkey approval."));
    await write("actWithPasskey", [
      action,
      target,
      token,
      units,
      deadline,
      auth.deviceId,
      auth.assertion,
    ]);
  };
  const checkVault = () =>
    void run(async () => {
      if (!client || !snapshot)
        throw new Notice(() => t("Open your wallet first."));
      const address = walletAddress(vault);
      const [beneficiary, date] = await Promise.all([
        client.readContract({
          address,
          abi: sproutVaultAbi,
          functionName: "beneficiary",
        }),
        client.readContract({
          address,
          abi: sproutVaultAbi,
          functionName: "graduationTimestamp",
        }),
      ]);
      setGraduation({
        at: Number(date),
        linked: beneficiary.toLowerCase() === snapshot.address.toLowerCase(),
      });
      return beneficiary.toLowerCase() === snapshot.address.toLowerCase()
        ? () => t("This sprout pays into your Guardian wallet.")
        : () =>
            t(
              "This sprout has a different, fixed beneficiary. It cannot be reassigned.",
            );
    });
  const recoveryActive =
    !!snapshot &&
    !snapshot.recovery.closed &&
    snapshot.recovery.expiresAt > now;
  const addPasskey = () =>
    void run(async () => {
      const w = await currentWallet();
      if (!snapshot || !isOwner)
        throw new Notice(() => t("Only the current owner can enroll a passkey."));
      if (snapshot.origin !== location.origin)
        throw new Notice(() =>
          t("Open the original enrollment domain to add passkeys."),
        );
      const target = snapshot.address;
      const key = await registerPasskey();
      if (walletRef.current !== w || target !== snapshot.address)
        throw new Notice(() => t("Wallet changed. Enroll again."));
      const block = await w.publicClient.getBlock();
      await write("addDevice", [
        key.id,
        key.x,
        key.y,
        block.timestamp + 365n * 86400n,
      ]);
      return () =>
        t(
          "Passkey enrolled for one year. The wallet enforces the same transfer rules for this credential.",
        );
    });
  const simple = (name: string, args: unknown[], show: () => string) => () =>
    void run(async () => {
      await write(name, args);
      return show;
    });
  const policy = () => {
    if (!snapshot) throw new Notice(() => t("Open a wallet."));
    return [
      token,
      amountUnits(policyLimit, decimals),
      policyDestination ? walletAddress(policyDestination) : ZERO,
      guardiansInput(snapshot.owner, policyGuardians),
    ];
  };
  const addressFields = (values: string[], set: (v: string[]) => void) => (
    <div className="guardian-form-row three">
      {values.map((g, i) => (
        <label key={i}>
          {t("Guardian {n}", { n: i + 1 })}
          <input
            value={g}
            onChange={(e) =>
              set(values.map((v, j) => (i === j ? e.target.value : v)))
            }
            placeholder="0x…"
            autoComplete="off"
            spellCheck={false}
          />
        </label>
      ))}
    </div>
  );
  return (
    <GuardianView
      snapshot={snapshot}
      tab={tab}
      onTab={setTab}
      onConnect={connect}
      connected={wallet?.address ?? ""}
      busy={busy}
      error={error.show()}
      message={message.show()}
      now={now}
      tokenSymbol={symbol}
      decimals={decimals}
    >
      {snapshot &&
      (tab === "Protection" || tab === "Transfers" || tab === "Settings") ? (
        <label className="guardian-asset-picker">
          {t("Asset")}{" "}
          <select
            value={token}
            disabled={busy}
            onChange={(e) => {
              setSelectedToken(e.target.value);
              setGraduation(null);
              setAmount("1");
            }}
          >
            {tokenOptions.map((option) => (
              <option value={option.address} key={option.address}>
                {option.symbol}
              </option>
            ))}
          </select>
        </label>
      ) : null}
      {!snapshot ? (
        <>
          <p className="guardian-setup-note">
            {t(
              "Create a separate beneficiary wallet with three trusted guardians. The owner should be the person who will control the savings. The connected wallet pays deployment gas; Sprout never holds the signing keys.",
            )}
          </p>
          <form
            className="guardian-form"
            onSubmit={(e) => {
              e.preventDefault();
              deploy();
            }}
          >
            <div className="guardian-form-row">
              <label>
                {t("Owner wallet")}
                <input
                  value={ownerInput}
                  onChange={(e) => setOwnerInput(e.target.value)}
                  placeholder="0x…"
                  required
                />
                <small>
                  {t(
                    "Use the child’s wallet when they are the beneficiary. Guardian addresses must be different.",
                  )}
                </small>
              </label>
              <label>
                {t("Instant transfer budget ({symbol} / 24 hours)", { symbol })}
                <input
                  inputMode="decimal"
                  value={limit}
                  onChange={(e) => setLimit(e.target.value)}
                  required
                />
                <small>
                  {t(
                    "Initially only the owner’s address is trusted. Other transfers wait 24 hours.",
                  )}
                </small>
              </label>
            </div>
            {addressFields(guardianInputs, setGuardianInputs)}
            <p className="guardian-tiny">
              {t(
                "The recovery quorum is two of three. Changes to guardians, budgets or trusted destinations take 48 hours. The current owner can cancel a recovery request. Enrolling guardians publishes their wallet relationships on-chain.",
              )}
            </p>
            <div className="guardian-actions">
              <button
                className="guardian-button"
                disabled={busy || !wallet || !chain?.configured}
                type="submit"
              >
                {t("Create Guardian wallet")} <ShieldCheck size={17} />
              </button>
              {!wallet ? (
                <button
                  type="button"
                  className="guardian-button secondary"
                  onClick={connect}
                  disabled={busy}
                >
                  {t("Connect wallet")}
                </button>
              ) : null}
            </div>
          </form>
          <div className="guardian-details">
            <h3>{t("Already have a Guardian?")}</h3>
            <form
              className="guardian-form"
              onSubmit={(e) => {
                e.preventDefault();
                load();
              }}
            >
              <label>
                {t("Guardian wallet address")}
                <input
                  value={account}
                  onChange={(e) => setAccount(e.target.value)}
                  placeholder="0x…"
                />
              </label>
              <div>
                <button className="guardian-button secondary" disabled={busy}>
                  {t("Open wallet")} <ArrowUpRight size={15} />
                </button>
              </div>
            </form>
          </div>
        </>
      ) : null}
      {snapshot && tab === "Protection" ? (
        <>
          <div className="guardian-actions">
            <button
              className="guardian-button secondary"
              onClick={() =>
                void run(async () => {
                  await navigator.clipboard.writeText(
                    `${location.origin}/guardian?account=${snapshot.address}`,
                  );
                  return () =>
                    t(
                      "Wallet link copied. The link reveals the public wallet address; it grants no signing access.",
                    );
                })
              }
            >
              <Copy size={15} /> {t("Copy wallet link")}
            </button>
            <button
              className="guardian-button secondary"
              onClick={() =>
                void run(async () => {
                  await refresh(snapshot.address);
                  return () => t("On-chain state refreshed.");
                })
              }
            >
              {t("Refresh status")}
            </button>
            <button
              className="guardian-button secondary"
              disabled={busy}
              onClick={() => {
                generation.current++;
                accountRef.current = null;
                setSnapshot(null);
                setAccount("");
                setGraduation(null);
                history.replaceState(null, "", "/guardian");
              }}
            >
              {t("Open another wallet")}
            </button>
          </div>
          <p className="guardian-tiny">
            {t(
              "Save this wallet address and share it with your guardians. Account access uses the connected owner wallet; guardian approvals use each guardian’s own wallet.",
            )}
          </p>
        </>
      ) : null}
      {snapshot && tab === "Recovery" ? (
        <RecoveryPanel
          snapshot={snapshot}
          now={now}
          busy={busy}
          isOwner={isOwner}
          canApprove={isGuardian && !snapshot.approved[guardianIndex]}
          onApprove={simple(
            "approveRecovery",
            [snapshot.recoveryId],
            () => t("Guardian approval confirmed on-chain."),
          )}
          onExecute={simple(
            "executeRecovery",
            [snapshot.recoveryId],
            () =>
              t(
                "Recovery complete. Old credentials and pending transfers are invalid. Connect the replacement owner wallet.",
              ),
          )}
          onCancel={simple(
            "cancelRecovery",
            [],
            () => t("Recovery cancelled by the current owner."),
          )}
        >
          <form
            className="guardian-form"
            onSubmit={(e) => {
              e.preventDefault();
              void run(async () => {
                await write("startRecovery", [walletAddress(newOwner)]);
                return () =>
                  t(
                    "Recovery requested. A second independent guardian must approve before the 48-hour delay begins.",
                  );
              });
            }}
          >
            <label>
              {t("Replacement owner wallet")}
              <input
                value={newOwner}
                onChange={(e) => setNewOwner(e.target.value)}
                placeholder="0x…"
              />
              <small>
                {t(
                  "Verify the new address with the owner through a separate, trusted channel.",
                )}
              </small>
            </label>
            <div>
              <button
                className="guardian-button"
                disabled={busy || !isGuardian}
              >
                {t("Start recovery")} <UsersIcon />
              </button>
            </div>
            {!isGuardian ? (
              <small>
                {t("Connect one of the three guardian wallets to start recovery.")}
              </small>
            ) : null}
          </form>
        </RecoveryPanel>
      ) : null}
      {snapshot && tab === "Passkeys" ? (
        <DevicePanel
          snapshot={snapshot}
          now={now}
          busy={busy}
          isOwner={isOwner}
          canManage={canManage}
          onAdd={addPasskey}
          onRevoke={(id) =>
            void run(async () => {
              await write("revokeDevice", [id]);
              return () =>
                t("Credential revoked on-chain. All synced copies are disabled.");
            })
          }
        />
      ) : null}
      {snapshot && tab === "Transfers" ? (
        <div>
          <div className="guardian-section-heading">
            <div>
              <span className="guardian-eyebrow">
                {t("TIME TO CHECK. TIME TO CANCEL.")}
              </span>
              <h3>{t("Move money with a safety window.")}</h3>
              <p>
                {t(
                  "Instant sends require a trusted destination and enough budget. Queued sends wait 24 hours and can be cancelled by the owner or any guardian.",
                )}
              </p>
            </div>
            <span className="guardian-chip">
              {recoveryActive && snapshot.recovery.approvals >= 2
                ? t("RECOVERY HOLD")
                : t("24-HOUR DELAY")}
            </span>
          </div>
          <form className="guardian-form" onSubmit={(e) => e.preventDefault()}>
            <div className="guardian-form-row">
              <label>
                {t("Destination wallet")}
                <input
                  value={destination}
                  onChange={(e) => setDestination(e.target.value)}
                  placeholder="0x…"
                />
              </label>
              <label>
                {t("Amount ({symbol})", { symbol })}
                <input
                  inputMode="decimal"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                />
              </label>
            </div>
            <label>
              {t("Approval method")}
              <select
                value={usePasskey ? "passkey" : "owner"}
                onChange={(e) => setUsePasskey(e.target.value === "passkey")}
              >
                <option value="owner">{t("Owner wallet")}</option>
                <option value="passkey">
                  {t("Passkey + gas-paying wallet")}
                </option>
              </select>
            </label>
            <div className="guardian-actions">
              <button
                className="guardian-button"
                disabled={busy || !wallet}
                onClick={() =>
                  void run(async () => {
                    await act(0, walletAddress(destination));
                    return () =>
                      t("Transfer confirmed within the wallet’s budget.");
                  })
                }
              >
                {t("Send within budget")} <ArrowUpRight size={15} />
              </button>
              <button
                className="guardian-button secondary"
                disabled={busy || !wallet}
                onClick={() =>
                  void run(async () => {
                    await act(1, walletAddress(destination));
                    return () =>
                      t(
                        "Transfer queued. The 24-hour cancellation window has started.",
                      );
                  })
                }
              >
                {t("Queue for 24 hours")} <Clock3 size={15} />
              </button>
            </div>
          </form>
          <h3>{t("Transfer queue")}</h3>
          {snapshot.transfers.length ? (
            snapshot.transfers
              .slice()
              .reverse()
              .map((transfer) => {
                const valid =
                  !transfer.closed &&
                  transfer.epoch === snapshot.epoch &&
                  now <= transfer.readyAt + 7 * 86400;
                const asset = tokenOptions.find(
                  (a) =>
                    a.address.toLowerCase() === transfer.token.toLowerCase(),
                );
                return (
                  <article
                    className="guardian-transfer"
                    key={String(transfer.id)}
                  >
                    <div>
                      <h4>
                        {t("Transfer #{id} · {amount} {token}", {
                          id: String(transfer.id),
                          amount: formatUnits(
                            transfer.amount,
                            asset?.decimals ?? 0,
                          ),
                          token: asset?.symbol ?? t("raw token units"),
                        })}
                      </h4>
                      <p>
                        {t("To {address} · {status}", {
                          address: short(transfer.to),
                          status: valid
                            ? countdown(transfer.readyAt, now)
                            : t("Closed, expired or invalidated"),
                        })}
                      </p>
                      <p>
                        {t("Token {address}", {
                          address: short(transfer.token),
                        })}
                      </p>
                    </div>
                    <div className="guardian-actions">
                      <button
                        className="guardian-button"
                        disabled={
                          busy ||
                          !valid ||
                          now < transfer.readyAt ||
                          (recoveryActive && snapshot.recovery.approvals >= 2)
                        }
                        onClick={simple("executeTransfer", [transfer.id], () =>
                          t("Queued transfer executed."),
                        )}
                      >
                        {t("Execute")}
                      </button>
                      <button
                        className="guardian-button secondary"
                        disabled={busy || !valid || !canManage}
                        onClick={simple("cancelTransfer", [transfer.id], () =>
                          t("Queued transfer cancelled."),
                        )}
                      >
                        {t("Cancel")}
                      </button>
                    </div>
                  </article>
                );
              })
          ) : (
            <p className="guardian-setup-note">{t("No transfers queued.")}</p>
          )}
          <div className="guardian-actions">
            <button
              className="guardian-button secondary"
              disabled={
                busy ||
                !snapshot.transfers.length ||
                snapshot.transfers[0]!.id <= 1n
              }
              onClick={() => setQueueEnd(snapshot.transfers[0]!.id - 1n)}
            >
              {t("Older requests")}
            </button>
            <button
              className="guardian-button secondary"
              disabled={busy || queueEnd === undefined}
              onClick={() => setQueueEnd(undefined)}
            >
              {t("Latest requests")}
            </button>
          </div>
          <details className="guardian-details">
            <summary>{t("Cancel a transfer by ID")}</summary>
            <p className="guardian-tiny">
              {t(
                "Showing the latest 20 requests. Unrecognized tokens are displayed in raw units. Contract requests bind the exact token, recipient and amount.",
              )}
            </p>
            <form
              className="guardian-form"
              onSubmit={(e) => e.preventDefault()}
            >
              <label>
                {t("Transfer ID")}
                <input
                  value={manualTransferId}
                  onChange={(e) => setManualTransferId(e.target.value)}
                  inputMode="numeric"
                />
              </label>
              <div className="guardian-actions">
                <button
                  className="guardian-button secondary"
                  disabled={busy || !canManage}
                  onClick={() =>
                    void run(async () => {
                      if (!/^\d+$/.test(manualTransferId))
                        throw new Notice(() =>
                          t("Enter a numeric transfer ID."),
                        );
                      await write("cancelTransfer", [BigInt(manualTransferId)]);
                      return () => t("Transfer cancelled.");
                    })
                  }
                >
                  {t("Cancel by ID")}
                </button>
              </div>
            </form>
          </details>
          <details className="guardian-details">
            <summary>
              {t("Claim rewards or withdraw a graduated sprout")}
            </summary>
            <form
              className="guardian-form"
              onSubmit={(e) => e.preventDefault()}
            >
              <label>
                {t("Sprout vault address")}
                <input
                  value={vault}
                  onChange={(e) => {
                    setVault(e.target.value);
                    setGraduation(null);
                  }}
                  placeholder="0x…"
                />
              </label>
              <div>
                <button
                  className="guardian-button secondary"
                  onClick={checkVault}
                  disabled={busy}
                >
                  {t("Check beneficiary & graduation")}
                </button>
              </div>
              {graduation ? (
                <p className="guardian-setup-note">
                  {graduation.linked
                    ? t("Linked to this Guardian. Graduation: {date}.", {
                        date: new Date(graduation.at * 1000).toLocaleString(
                          dateLocale(),
                        ),
                      })
                    : t(
                        "Different beneficiary: this sprout cannot be moved into Guardian automatically.",
                      )}
                </p>
              ) : null}
              <small>
                {t(
                  "Uses the {amount} {symbol} amount and approval method selected above. Proceeds enter this Guardian wallet; outward transfers still follow its policy.",
                  { amount, symbol },
                )}
              </small>
              <div className="guardian-actions">
                <button
                  className="guardian-button"
                  disabled={busy || !graduation?.linked}
                  onClick={() =>
                    void run(async () => {
                      await act(2, walletAddress(vault));
                      return () => t("Allowance claimed into Guardian.");
                    })
                  }
                >
                  {t("Claim allowance")}
                </button>
                <button
                  className="guardian-button"
                  disabled={busy || !graduation?.linked || graduation.at > now}
                  onClick={() =>
                    void run(async () => {
                      await act(3, walletAddress(vault));
                      return () =>
                        t(
                          "Graduated savings received by Guardian. Transfer limits still apply.",
                        );
                    })
                  }
                >
                  {t("Receive graduated savings")}
                </button>
              </div>
            </form>
          </details>
        </div>
      ) : null}
      {snapshot && tab === "Settings" ? (
        <div>
          <span className="guardian-eyebrow">
            {t("YOUR CIRCLE CAN GROW WITH YOU")}
          </span>
          <h3>{t("Change the rules with time to review.")}</h3>
          <p className="guardian-setup-note">
            {t(
              "Only the current owner can propose and execute changes. A 48-hour delay gives existing guardians time to cancel. This is also how the beneficiary chooses their own recovery circle at graduation.",
            )}
          </p>
          <form className="guardian-form" onSubmit={(e) => e.preventDefault()}>
            <div className="guardian-form-row">
              <label>
                {t("New {symbol} budget", { symbol })}
                <input
                  value={policyLimit}
                  onChange={(e) => setPolicyLimit(e.target.value)}
                  inputMode="decimal"
                />
              </label>
              <label>
                {t("Add trusted destination (optional)")}
                <input
                  value={policyDestination}
                  onChange={(e) => setPolicyDestination(e.target.value)}
                  placeholder="0x…"
                />
              </label>
            </div>
            {addressFields(policyGuardians, setPolicyGuardians)}
            <div className="guardian-actions">
              <button
                className="guardian-button"
                disabled={busy || !isOwner}
                onClick={() =>
                  void run(async () => {
                    const args = policy();
                    await write("queuePolicy", args);
                    return () =>
                      t(
                        "Policy change queued for 48 hours. Keep these values to execute the same change.",
                      );
                  })
                }
              >
                {t("Queue policy change")}
              </button>
              <button
                className="guardian-button secondary"
                disabled={
                  busy ||
                  !isOwner ||
                  snapshot.policyHash === EMPTY ||
                  snapshot.policyReadyAt > now
                }
                onClick={() =>
                  void run(async () => {
                    await write("executePolicy", policy());
                    return () =>
                      t("Policy applied. New guardians and budget are active.");
                  })
                }
              >
                {t("Apply matching change")}
              </button>
              {snapshot.policyHash !== EMPTY ? (
                <button
                  className="guardian-button secondary"
                  disabled={busy || !canManage}
                  onClick={simple("cancelPolicy", [], () =>
                    t("Pending policy change cancelled."),
                  )}
                >
                  {t("Cancel pending change")}
                </button>
              ) : null}
            </div>
            {snapshot.policyHash !== EMPTY ? (
              <p className="guardian-notice">
                {t(
                  "Pending change {hash} · {countdown}. Execution requires the exact proposed values.",
                  {
                    hash: short(snapshot.policyHash),
                    countdown: countdown(snapshot.policyReadyAt, now),
                  },
                )}
              </p>
            ) : null}
            <div className="guardian-details">
              <p className="guardian-tiny">
                {t(
                  "To tighten protection immediately, enter a lower budget above. The optional destination will be removed from trusted destinations.",
                )}
              </p>
              <button
                className="guardian-button secondary"
                disabled={busy || !isOwner}
                onClick={() =>
                  void run(async () => {
                    const units =
                      policyLimit === "0"
                        ? 0n
                        : amountUnits(policyLimit, decimals);
                    if (units > snapshot.limit)
                      throw new Notice(() =>
                        t("Immediate changes can only reduce the budget."),
                      );
                    await write("tighten", [
                      token,
                      units,
                      policyDestination
                        ? walletAddress(policyDestination)
                        : ZERO,
                    ]);
                    return () =>
                      t("Budget reduced and selected destination untrusted.");
                  })
                }
              >
                {t("Tighten protection now")}
              </button>
            </div>
          </form>
        </div>
      ) : null}
    </GuardianView>
  );
}
function UsersIcon() {
  return <Check size={16} />;
}
