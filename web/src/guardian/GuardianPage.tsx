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
    [error, setError] = useState(""),
    [message, setMessage] = useState("");
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
      (t) => t.address.toLowerCase() === selectedToken.toLowerCase(),
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
          throw new Error("Public chain connection is not configured.");
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
      .catch((e) => setError(e.message));
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
      setError(
        "Wallet or network changed. Reconnect before approving a transaction.",
      );
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
        .catch((e) => setError(e.message));
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
  const run = async (fn: () => Promise<string | void>) => {
    if (operation.current) return;
    operation.current = true;
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const text = await fn();
      if (mounted.current && text) setMessage(text);
    } catch (e) {
      if (mounted.current)
        setError(
          e instanceof Error
            ? ((e as { shortMessage?: string }).shortMessage ?? e.message)
            : "Please try again.",
        );
    } finally {
      operation.current = false;
      if (mounted.current) setBusy(false);
    }
  };
  const connect = () =>
    void run(async () => {
      if (!chain) throw new Error("Chain configuration is loading.");
      const w = await connectWallet({
        chainId: chain.chainId,
        name: chain.name,
        rpcUrl: chain.walletRpcUrl,
      });
      await assertWalletReady(w);
      walletRef.current = w;
      setWallet(w);
      setOwnerInput((v) => v || w.address);
      return "Wallet connected. Check the account and action before signing.";
    });
  const currentWallet = async () => {
    const w = walletRef.current;
    if (!w) throw new Error("Connect a wallet to approve and pay network gas.");
    await assertWalletReady(w);
    if (!mounted.current || walletRef.current !== w)
      throw new Error("Wallet changed. Reconnect before signing.");
    return w;
  };
  const write = async (name: string, args: unknown[] = []) => {
    const w = await currentWallet();
    const target = snapshot?.address;
    if (!target || accountRef.current !== target)
      throw new Error("Open a Guardian wallet first.");
    const hash = await contractWriter(w)({
      address: target,
      abi: guardianAbi,
      functionName: name,
      args,
    });
    await waitForSuccess(w.publicClient, hash);
    if (walletRef.current !== w)
      throw new Error(
        "Transaction submitted; reconnect to refresh this wallet.",
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
      if (!client) throw new Error("Chain connection is loading.");
      setSnapshot(null);
      await refresh(walletAddress(account));
      return "Guardian bytecode and on-chain state verified.";
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
        throw new Error("Guardian deployment did not succeed.");
      if (walletRef.current !== w)
        throw new Error(
          `Guardian created at ${receipt.contractAddress}. Reconnect to open it.`,
        );
      await refresh(receipt.contractAddress);
      return "Guardian wallet created. Save its address, enroll a passkey, then choose it as the beneficiary of a new sprout.";
    });
  const act = async (action: number, target: Address) => {
    const w = await currentWallet();
    if (!snapshot) throw new Error("Open a Guardian wallet.");
    const address = snapshot.address;
    const units = amountUnits(amount, decimals);
    if (!usePasskey) {
      await write("act", [action, target, token, units]);
      return;
    }
    if (snapshot.origin !== location.origin)
      throw new Error(
        `This wallet’s passkeys were enrolled at ${snapshot.origin}. Use that origin or approve with the owner wallet.`,
      );
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
      throw new Error("Wallet changed during passkey approval.");
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
      if (!client || !snapshot) throw new Error("Open your wallet first.");
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
        ? "This sprout pays into your Guardian wallet."
        : "This sprout has a different, fixed beneficiary. It cannot be reassigned.";
    });
  const recoveryActive =
    !!snapshot &&
    !snapshot.recovery.closed &&
    snapshot.recovery.expiresAt > now;
  const addPasskey = () =>
    void run(async () => {
      const w = await currentWallet();
      if (!snapshot || !isOwner)
        throw new Error("Only the current owner can enroll a passkey.");
      if (snapshot.origin !== location.origin)
        throw new Error("Open the original enrollment domain to add passkeys.");
      const target = snapshot.address;
      const key = await registerPasskey();
      if (walletRef.current !== w || target !== snapshot.address)
        throw new Error("Wallet changed. Enroll again.");
      const block = await w.publicClient.getBlock();
      await write("addDevice", [
        key.id,
        key.x,
        key.y,
        block.timestamp + 365n * 86400n,
      ]);
      return "Passkey enrolled for one year. The wallet enforces the same transfer rules for this credential.";
    });
  const simple = (name: string, args: unknown[], text: string) => () =>
    void run(async () => {
      await write(name, args);
      return text;
    });
  const policy = () => {
    if (!snapshot) throw new Error("Open a wallet.");
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
          Guardian {i + 1}
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
      error={error}
      message={message}
      now={now}
      tokenSymbol={symbol}
      decimals={decimals}
    >
      {snapshot &&
      (tab === "Protection" || tab === "Transfers" || tab === "Settings") ? (
        <label className="guardian-asset-picker">
          Asset{" "}
          <select
            value={token}
            disabled={busy}
            onChange={(e) => {
              setSelectedToken(e.target.value);
              setGraduation(null);
              setAmount("1");
            }}
          >
            {tokenOptions.map((t) => (
              <option value={t.address} key={t.address}>
                {t.symbol}
              </option>
            ))}
          </select>
        </label>
      ) : null}
      {!snapshot ? (
        <>
          <p className="guardian-setup-note">
            Create a separate beneficiary wallet with three trusted guardians.
            The owner should be the person who will control the savings. The
            connected wallet pays deployment gas; Sprout never holds the signing
            keys.
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
                Owner wallet
                <input
                  value={ownerInput}
                  onChange={(e) => setOwnerInput(e.target.value)}
                  placeholder="0x…"
                  required
                />
                <small>
                  Use the child’s wallet when they are the beneficiary. Guardian
                  addresses must be different.
                </small>
              </label>
              <label>
                Instant transfer budget ({symbol} / 24 hours)
                <input
                  inputMode="decimal"
                  value={limit}
                  onChange={(e) => setLimit(e.target.value)}
                  required
                />
                <small>
                  Initially only the owner’s address is trusted. Other transfers
                  wait 24 hours.
                </small>
              </label>
            </div>
            {addressFields(guardianInputs, setGuardianInputs)}
            <p className="guardian-tiny">
              The recovery quorum is two of three. Changes to guardians, budgets
              or trusted destinations take 48 hours. The current owner can
              cancel a recovery request. Enrolling guardians publishes their
              wallet relationships on-chain.
            </p>
            <div className="guardian-actions">
              <button
                className="guardian-button"
                disabled={busy || !wallet || !chain?.configured}
                type="submit"
              >
                Create Guardian wallet <ShieldCheck size={17} />
              </button>
              {!wallet ? (
                <button
                  type="button"
                  className="guardian-button secondary"
                  onClick={connect}
                  disabled={busy}
                >
                  Connect wallet
                </button>
              ) : null}
            </div>
          </form>
          <div className="guardian-details">
            <h3>Already have a Guardian?</h3>
            <form
              className="guardian-form"
              onSubmit={(e) => {
                e.preventDefault();
                load();
              }}
            >
              <label>
                Guardian wallet address
                <input
                  value={account}
                  onChange={(e) => setAccount(e.target.value)}
                  placeholder="0x…"
                />
              </label>
              <div>
                <button className="guardian-button secondary" disabled={busy}>
                  Open wallet <ArrowUpRight size={15} />
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
                  return "Wallet link copied. The link reveals the public wallet address; it grants no signing access.";
                })
              }
            >
              <Copy size={15} /> Copy wallet link
            </button>
            <button
              className="guardian-button secondary"
              onClick={() =>
                void run(async () => {
                  await refresh(snapshot.address);
                  return "On-chain state refreshed.";
                })
              }
            >
              Refresh status
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
              Open another wallet
            </button>
          </div>
          <p className="guardian-tiny">
            Save this wallet address and share it with your guardians. Account
            access uses the connected owner wallet; guardian approvals use each
            guardian’s own wallet.
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
            "Guardian approval confirmed on-chain.",
          )}
          onExecute={simple(
            "executeRecovery",
            [snapshot.recoveryId],
            "Recovery complete. Old credentials and pending transfers are invalid. Connect the replacement owner wallet.",
          )}
          onCancel={simple(
            "cancelRecovery",
            [],
            "Recovery cancelled by the current owner.",
          )}
        >
          <form
            className="guardian-form"
            onSubmit={(e) => {
              e.preventDefault();
              void run(async () => {
                await write("startRecovery", [walletAddress(newOwner)]);
                return "Recovery requested. A second independent guardian must approve before the 48-hour delay begins.";
              });
            }}
          >
            <label>
              Replacement owner wallet
              <input
                value={newOwner}
                onChange={(e) => setNewOwner(e.target.value)}
                placeholder="0x…"
              />
              <small>
                Verify the new address with the owner through a separate,
                trusted channel.
              </small>
            </label>
            <div>
              <button
                className="guardian-button"
                disabled={busy || !isGuardian}
              >
                Start recovery <UsersIcon />
              </button>
            </div>
            {!isGuardian ? (
              <small>
                Connect one of the three guardian wallets to start recovery.
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
              return "Credential revoked on-chain. All synced copies are disabled.";
            })
          }
        />
      ) : null}
      {snapshot && tab === "Transfers" ? (
        <div>
          <div className="guardian-section-heading">
            <div>
              <span className="guardian-eyebrow">
                TIME TO CHECK. TIME TO CANCEL.
              </span>
              <h3>Move money with a safety window.</h3>
              <p>
                Instant sends require a trusted destination and enough budget.
                Queued sends wait 24 hours and can be cancelled by the owner or
                any guardian.
              </p>
            </div>
            <span className="guardian-chip">
              {recoveryActive && snapshot.recovery.approvals >= 2
                ? "RECOVERY HOLD"
                : "24-HOUR DELAY"}
            </span>
          </div>
          <form className="guardian-form" onSubmit={(e) => e.preventDefault()}>
            <div className="guardian-form-row">
              <label>
                Destination wallet
                <input
                  value={destination}
                  onChange={(e) => setDestination(e.target.value)}
                  placeholder="0x…"
                />
              </label>
              <label>
                Amount ({symbol})
                <input
                  inputMode="decimal"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                />
              </label>
            </div>
            <label>
              Approval method
              <select
                value={usePasskey ? "passkey" : "owner"}
                onChange={(e) => setUsePasskey(e.target.value === "passkey")}
              >
                <option value="owner">Owner wallet</option>
                <option value="passkey">Passkey + gas-paying wallet</option>
              </select>
            </label>
            <div className="guardian-actions">
              <button
                className="guardian-button"
                disabled={busy || !wallet}
                onClick={() =>
                  void run(async () => {
                    await act(0, walletAddress(destination));
                    return "Transfer confirmed within the wallet’s budget.";
                  })
                }
              >
                Send within budget <ArrowUpRight size={15} />
              </button>
              <button
                className="guardian-button secondary"
                disabled={busy || !wallet}
                onClick={() =>
                  void run(async () => {
                    await act(1, walletAddress(destination));
                    return "Transfer queued. The 24-hour cancellation window has started.";
                  })
                }
              >
                Queue for 24 hours <Clock3 size={15} />
              </button>
            </div>
          </form>
          <h3>Transfer queue</h3>
          {snapshot.transfers.length ? (
            snapshot.transfers
              .slice()
              .reverse()
              .map((t) => {
                const valid =
                  !t.closed &&
                  t.epoch === snapshot.epoch &&
                  now <= t.readyAt + 7 * 86400;
                return (
                  <article className="guardian-transfer" key={String(t.id)}>
                    <div>
                      <h4>
                        Transfer #{String(t.id)} ·{" "}
                        {formatUnits(
                          t.amount,
                          tokenOptions.find(
                            (a) =>
                              a.address.toLowerCase() === t.token.toLowerCase(),
                          )?.decimals ?? 0,
                        )}{" "}
                        {tokenOptions.find(
                          (a) =>
                            a.address.toLowerCase() === t.token.toLowerCase(),
                        )?.symbol ?? "raw token units"}
                      </h4>
                      <p>
                        To {short(t.to)} ·{" "}
                        {valid
                          ? countdown(t.readyAt, now)
                          : "Closed, expired or invalidated"}
                      </p>
                      <p>Token {short(t.token)}</p>
                    </div>
                    <div className="guardian-actions">
                      <button
                        className="guardian-button"
                        disabled={
                          busy ||
                          !valid ||
                          now < t.readyAt ||
                          (recoveryActive && snapshot.recovery.approvals >= 2)
                        }
                        onClick={simple(
                          "executeTransfer",
                          [t.id],
                          "Queued transfer executed.",
                        )}
                      >
                        Execute
                      </button>
                      <button
                        className="guardian-button secondary"
                        disabled={busy || !valid || !canManage}
                        onClick={simple(
                          "cancelTransfer",
                          [t.id],
                          "Queued transfer cancelled.",
                        )}
                      >
                        Cancel
                      </button>
                    </div>
                  </article>
                );
              })
          ) : (
            <p className="guardian-setup-note">No transfers queued.</p>
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
              Older requests
            </button>
            <button
              className="guardian-button secondary"
              disabled={busy || queueEnd === undefined}
              onClick={() => setQueueEnd(undefined)}
            >
              Latest requests
            </button>
          </div>
          <details className="guardian-details">
            <summary>Cancel a transfer by ID</summary>
            <p className="guardian-tiny">
              Showing the latest 20 requests. Unrecognized tokens are displayed
              in raw units. Contract requests bind the exact token, recipient
              and amount.
            </p>
            <form
              className="guardian-form"
              onSubmit={(e) => e.preventDefault()}
            >
              <label>
                Transfer ID
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
                        throw new Error("Enter a numeric transfer ID.");
                      await write("cancelTransfer", [BigInt(manualTransferId)]);
                      return "Transfer cancelled.";
                    })
                  }
                >
                  Cancel by ID
                </button>
              </div>
            </form>
          </details>
          <details className="guardian-details">
            <summary>Claim rewards or withdraw a graduated sprout</summary>
            <form
              className="guardian-form"
              onSubmit={(e) => e.preventDefault()}
            >
              <label>
                Sprout vault address
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
                  Check beneficiary & graduation
                </button>
              </div>
              {graduation ? (
                <p className="guardian-setup-note">
                  {graduation.linked
                    ? `Linked to this Guardian. Graduation: ${new Date(graduation.at * 1000).toLocaleString()}.`
                    : "Different beneficiary: this sprout cannot be moved into Guardian automatically."}
                </p>
              ) : null}
              <small>
                Uses the {amount} {symbol} amount and approval method selected
                above. Proceeds enter this Guardian wallet; outward transfers
                still follow its policy.
              </small>
              <div className="guardian-actions">
                <button
                  className="guardian-button"
                  disabled={busy || !graduation?.linked}
                  onClick={() =>
                    void run(async () => {
                      await act(2, walletAddress(vault));
                      return "Allowance claimed into Guardian.";
                    })
                  }
                >
                  Claim allowance
                </button>
                <button
                  className="guardian-button"
                  disabled={busy || !graduation?.linked || graduation.at > now}
                  onClick={() =>
                    void run(async () => {
                      await act(3, walletAddress(vault));
                      return "Graduated savings received by Guardian. Transfer limits still apply.";
                    })
                  }
                >
                  Receive graduated savings
                </button>
              </div>
            </form>
          </details>
        </div>
      ) : null}
      {snapshot && tab === "Settings" ? (
        <div>
          <span className="guardian-eyebrow">
            YOUR CIRCLE CAN GROW WITH YOU
          </span>
          <h3>Change the rules with time to review.</h3>
          <p className="guardian-setup-note">
            Only the current owner can propose and execute changes. A 48-hour
            delay gives existing guardians time to cancel. This is also how the
            beneficiary chooses their own recovery circle at graduation.
          </p>
          <form className="guardian-form" onSubmit={(e) => e.preventDefault()}>
            <div className="guardian-form-row">
              <label>
                New {symbol} budget
                <input
                  value={policyLimit}
                  onChange={(e) => setPolicyLimit(e.target.value)}
                  inputMode="decimal"
                />
              </label>
              <label>
                Add trusted destination (optional)
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
                    return "Policy change queued for 48 hours. Keep these values to execute the same change.";
                  })
                }
              >
                Queue policy change
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
                    return "Policy applied. New guardians and budget are active.";
                  })
                }
              >
                Apply matching change
              </button>
              {snapshot.policyHash !== EMPTY ? (
                <button
                  className="guardian-button secondary"
                  disabled={busy || !canManage}
                  onClick={simple(
                    "cancelPolicy",
                    [],
                    "Pending policy change cancelled.",
                  )}
                >
                  Cancel pending change
                </button>
              ) : null}
            </div>
            {snapshot.policyHash !== EMPTY ? (
              <p className="guardian-notice">
                Pending change {short(snapshot.policyHash)} ·{" "}
                {countdown(snapshot.policyReadyAt, now)}. Execution requires the
                exact proposed values.
              </p>
            ) : null}
            <div className="guardian-details">
              <p className="guardian-tiny">
                To tighten protection immediately, enter a lower budget above.
                The optional destination will be removed from trusted
                destinations.
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
                      throw new Error(
                        "Immediate changes can only reduce the budget.",
                      );
                    await write("tighten", [
                      token,
                      units,
                      policyDestination
                        ? walletAddress(policyDestination)
                        : ZERO,
                    ]);
                    return "Budget reduced and selected destination untrusted.";
                  })
                }
              >
                Tighten protection now
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
