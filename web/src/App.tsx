import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { erc20Abi, parseUnits } from 'viem';
import type { Address } from 'viem';
import { formatUnits, sproutFactoryAbi, sproutVaultAbi } from '@sprout/shared';
import {
  api,
  type BeneficiaryState,
  type ChainPublic,
  type GiftSummary,
  type GiftNote,
  type Growth,
  type Health,
  type AutomationCapability,
  type ChainEvent,
  type Holdings,
  type Job,
  type LocalWalletInfo,
  type Milestone,
  type Sprout,
} from './api';
import {
  connectLocalWallet,
  connectWallet,
  contractWriter,
  ensureChain,
  injectedProvider,
  latestConfirmedBlock,
  waitForSuccess,
  type WalletState,
} from './wallet';
import { getMilestoneTitle, getNickname, setMilestoneTitle, setNickname } from './localStore';
import { t, tj } from './i18n';
import { formatUtcDate, formatZonedDateTime, parseDateOnlyToUtcTs, viewerTimeZone } from './dates';
import { GrowthRing } from './components/GrowthRing';
import { DemoBanner } from './components/DemoBanner';
import { TxnStatusLine, type TxnState } from './components/TxnStatus';
import { MAX_STOCKS, StockMixEditor, initialPicks, pickedTokens } from './components/StockPicker';
import { OnboardingIntro, WelcomeSprout } from './components/OnboardingIntro';
import { RiskLine } from './components/BetaNotice';
import { InvestNowForm } from './components/InvestNow';
import { useAutoInvestLock } from './perks/autoInvest';
import { useHolder } from './perks/holder';
import { holderBouquets, stockLockFor } from './perks/locks';
import { GiftPage } from './GiftPage';
import { GiftQrCard } from './components/GiftQr';
import { DashboardShell, type DashboardShellProps } from './DashboardShell';
import { TITLE_MAX, endOfDayUtc, textProblem } from './components/Campaign';
import {
  ArrowRight, ArrowUpRight, Bell, Check, CheckCheck, ChevronRight, GraduationCap, LayoutGrid, Leaf,
  Pause, Play, Plus, Repeat2, Settings2, ShieldCheck, Sprout as SproutIcon, Wallet,
} from 'lucide-react';

interface Detail {
  sprout: Sprout;
  /** Stock tokens this sprout's factory admitted; null when the server does not say. */
  admittedAssets: Address[] | null;
  automation: AutomationCapability;
  milestones: Milestone[];
  jobs: Job[];
  gifts: GiftSummary[];
}

function randomBytes32(): `0x${string}` {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return `0x${Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')}` as `0x${string}`;
}

function usd(value: string | null, feedDecimals = 8): string {
  if (!value) return t('unavailable');
  try {
    return `$${formatUnits(BigInt(value), feedDecimals, 2)}`;
  } catch {
    return t('unavailable');
  }
}

function short(address: string): string {
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

const giftRouteMatch = window.location.pathname.match(/^\/gift\/(0x[0-9a-fA-F]{64})/);
const ONBOARDING_SEEN = 'sprout-onboarding-intro-seen';

function shouldShowOnboarding(): boolean {
  if (giftRouteMatch || new URLSearchParams(window.location.search).has('new')) return false;
  try { return window.localStorage.getItem(ONBOARDING_SEEN) !== '1'; } catch { return true; }
}

function markOnboardingSeen(): void {
  try { window.localStorage.setItem(ONBOARDING_SEEN, '1'); } catch { /* private mode */ }
}

export function App() {
  const [health, setHealth] = useState<Health | null>(null);
  const [chain, setChain] = useState<ChainPublic | null>(null);
  const [fatal, setFatal] = useState<string | null>(null);
  const [wallet, setWallet] = useState<WalletState | null>(null);
  const [connecting, setConnecting] = useState(false);

  const [parentSprouts, setParentSprouts] = useState<Sprout[]>([]);
  const [beneficiarySprouts, setBeneficiarySprouts] = useState<Sprout[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<Detail | null>(null);
  const [holdings, setHoldings] = useState<Holdings | null>(null);
  const [growth, setGrowth] = useState<Growth | null>(null);
  const [beneficiaryState, setBeneficiaryState] = useState<BeneficiaryState | null>(null);
  const [events, setEvents] = useState<ChainEvent[]>([]);
  const [loading, setLoading] = useState(false);
  const [txn, setTxn] = useState<TxnState | null>(null);
  const [clock, setClock] = useState(Date.now());
  // Mirrors the latest detail fetch so post-write sync can compare the newest
  // verified snapshot against the live on-chain holdings.
  const latestDetail = useRef<{ growth: Growth | null; holdings: Holdings | null }>({ growth: null, holdings: null });

  const [localWallet, setLocalWallet] = useState<LocalWalletInfo | null>(null);
  const [localRole, setLocalRole] = useState<'parent' | 'beneficiary' | 'gifter'>('parent');
  const [localAccount, setLocalAccount] = useState('');
  const [toolsMessage, setToolsMessage] = useState<string | null>(null);
  const [fundTool, setFundTool] = useState({ token: '', amount: '1000' });
  const [advanceSeconds, setAdvanceSeconds] = useState('86400');

  const [showPlant, setShowPlant] = useState(false);
  const [showFund, setShowFund] = useState(false);
  const [showSchedule, setShowSchedule] = useState(false);
  const [showInvestNow, setShowInvestNow] = useState(false);
  const [showGift, setShowGift] = useState(false);
  const [showMilestone, setShowMilestone] = useState(false);
  const [showAllocation, setShowAllocation] = useState(false);
  const [showWithdraw, setShowWithdraw] = useState(false);
  const [showPayGift, setShowPayGift] = useState<GiftSummary | null>(null);
  const [giftQr, setGiftQr] = useState<GiftSummary | null>(null);
  const [view, setView] = useState<'overview' | 'portfolio' | 'invest' | 'chores' | 'gifts' | 'graduation'>('overview');
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [showChore, setShowChore] = useState(false);
  const [choreForm, setChoreForm] = useState({ title: '', amount: '5' });
  const [showSettings, setShowSettings] = useState(false);
  const [showNotifications, setShowNotifications] = useState(false);
  const [showHelp, setShowHelp] = useState(false);
  const [assetDetail, setAssetDetail] = useState<string | null>(null);
  const [plantStep, setPlantStep] = useState(1);
  const [onboardingOpen, setOnboardingOpen] = useState(shouldShowOnboarding);
  const [welcomeOpen, setWelcomeOpen] = useState(false);
  const onboardingConnect = useRef(false);

  const [plantForm, setPlantForm] = useState({
    nickname: '',
    beneficiary: '',
    graduation: new Date(Date.now() + 365 * 24 * 3600 * 1000).toISOString().slice(0, 10),
    percents: {} as Record<string, string>,
    /** Picked stock addresses; null until the parent picks, meaning the default picks. */
    selected: null as string[] | null,
  });
  const [fundForm, setFundForm] = useState({ token: '', amount: '10' });
  const [scheduleForm, setScheduleForm] = useState({ amount: '25', periodDays: '7' });
  const [giftForm, setGiftForm] = useState(GIFT_FORM_DEFAULTS);
  const [allGiftNotes, setAllGiftNotes] = useState<Record<string, GiftNote[]>>({});
  const [milestoneForm, setMilestoneForm] = useState({ token: '', amount: '10', unlock: '', title: '' });
  const [allocationForm, setAllocationForm] = useState({ percents: {} as Record<string, string>, selected: [] as string[] });
  const [payGiftForm, setPayGiftForm] = useState({ token: '', amount: '25' });

  useEffect(() => {
    void (async () => {
      try {
        const [h, c] = await Promise.all([api.health(), api.config()]);
        setHealth(h);
        setChain(c.chain);
      } catch (error) {
        setFatal(error instanceof Error ? error.message : String(error));
      }
    })();
  }, []);

  useEffect(() => {
    const timer = setInterval(() => setClock(Date.now()), 30_000);
    return () => clearInterval(timer);
  }, []);

  // Explicit "new sprout" intent from the landing page (?new=1[&nickname]).
  // Consumed once a wallet is available; it only opens step 1 pre-filled and
  // never signs anything automatically.
  const [pendingNew, setPendingNew] = useState(false);
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (!params.has('new')) return;
    let nickname = '';
    try {
      nickname = sessionStorage.getItem('sprout-pending-nickname') ?? '';
    } catch {
      nickname = '';
    }
    if (nickname) setPlantForm((prev) => ({ ...prev, nickname }));
    setPendingNew(true);
  }, []);

  useEffect(() => {
    if (!pendingNew || !wallet) return;
    setPlantStep(1);
    setShowPlant(true);
    setPendingNew(false);
    try {
      sessionStorage.removeItem('sprout-pending-nickname');
    } catch {
      // private mode
    }
    const url = new URL(window.location.href);
    if (url.searchParams.has('new')) {
      url.searchParams.delete('new');
      window.history.replaceState(null, '', url.toString());
    }
  }, [pendingNew, wallet]);

  // The welcome moment is dismissed by its own Continue button. It used to also
  // self-close after 1.5s, which landed on top of the overlay's own 1.2s fade:
  // the screen was readable for about a second and the button was mostly
  // decorative.

  const decimalsFor = useCallback(
    (asset: string): number => {
      if (!chain) return 18;
      if (asset.toLowerCase() === chain.contracts.settlementToken?.toLowerCase()) return chain.contracts.settlementDecimals;
      return chain.contracts.stockTokens.find((t) => t.address.toLowerCase() === asset.toLowerCase())?.decimals ?? 18;
    },
    [chain],
  );

  const symbolFor = useCallback(
    (asset: string): string => {
      if (!chain) return short(asset);
      if (asset.toLowerCase() === chain.contracts.settlementToken?.toLowerCase()) return chain.contracts.settlementSymbol ?? 'Settlement';
      return chain.contracts.stockTokens.find((t) => t.address.toLowerCase() === asset.toLowerCase())?.symbol ?? short(asset);
    },
    [chain],
  );

  const refreshSprouts = useCallback(
    async (activeWallet: WalletState, selectFirst = false): Promise<string | null> => {
      const [asParent, asBeneficiary] = await Promise.all([
        api.sproutsByParent(activeWallet.address),
        api.sproutsByBeneficiary(activeWallet.address),
      ]);
      setParentSprouts(asParent.sprouts);
      setBeneficiarySprouts(asBeneficiary.sprouts);
      let next = selectedId;
      if (selectFirst || !selectedId) {
        const first = asParent.sprouts[0] ?? asBeneficiary.sprouts[0];
        next = first ? first.id : null;
        setSelectedId(next);
      }
      return next;
    },
    [selectedId],
  );

  const loadDetail = useCallback(
    async (id: string) => {
      setLoading(true);
      try {
        const [sproutDto, hold, grow, evts] = await Promise.all([
          api.sprout(id),
          api.holdings(id, latestConfirmedBlock()),
          api.growth(id),
          api.events(id).catch(() => ({ events: [] })),
        ]);
        const admitted = sproutDto.sprout.admittedAssets ?? sproutDto.admittedAssets;
        setDetail({
          sprout: sproutDto.sprout,
          admittedAssets: Array.isArray(admitted) && admitted.length > 0 ? admitted : null,
          automation: sproutDto.automation,
          milestones: sproutDto.milestones,
          jobs: sproutDto.jobs,
          gifts: sproutDto.gifts,
        });
        setHoldings(hold);
        setGrowth(grow);
        setEvents(evts.events);
        latestDetail.current = { growth: grow, holdings: hold };
        if (chain?.configured) {
          setBeneficiaryState(await api.beneficiaryState(id).catch(() => null));
        }
      } catch (error) {
        setTxn({ label: t('Load sprout'), status: 'failed', error: error instanceof Error ? error.message : String(error) });
      } finally {
        setLoading(false);
      }
    },
    [chain],
  );

  useEffect(() => {
    if (selectedId) void loadDetail(selectedId);
  }, [selectedId, loadDetail]);

  // A vault write is indexed a moment after it confirms, so the first detail
  // load can still show the prior verified snapshot. Reload (bounded) until the
  // newest snapshot agrees with the live holdings, so the history shown beside
  // the balance does not lag it.
  const loadDetailSynced = useCallback(
    async (id: string): Promise<void> => {
      await loadDetail(id);
      for (let attempt = 0; attempt < 10; attempt++) {
        const { growth: g, holdings: h } = latestDetail.current;
        const sorted = g?.available ? [...g.snapshots].sort((a, b) => a.takenAt - b.takenAt) : [];
        const latest = sorted.length > 0 ? sorted[sorted.length - 1]! : null;
        const total = h?.available ? h.totalValueUsd : null;
        if (latest && total !== null) {
          try {
            if (BigInt(latest.valueUsd) === BigInt(total)) return;
          } catch {
            /* keep polling */
          }
        }
        await new Promise((resolve) => setTimeout(resolve, 250));
        await loadDetail(id);
      }
    },
    [loadDetail],
  );

  const connect = useCallback(async (): Promise<WalletState | null> => {
    if (!chain) return null;
    setConnecting(true);
    try {
      const w = await connectWallet({ chainId: chain.chainId, name: chain.name, rpcUrl: chain.walletRpcUrl });
      await ensureChain(w, { chainId: chain.chainId, name: chain.name, rpcUrl: chain.walletRpcUrl });
      setWallet(w);
      const chosen = await refreshSprouts(w);
      setTxn((current) =>
        current?.label === t('Wallet') && current.status === 'failed' && current.error === t('Account changed. Reconnect to continue.')
          ? null
          : current,
      );
      if (onboardingConnect.current) {
        onboardingConnect.current = false;
        if (!chosen) {
          setPlantStep(1);
          setShowPlant(true);
        }
      }
      return w;
    } catch (error) {
      onboardingConnect.current = false;
      setTxn({ label: t('Connect'), status: 'failed', error: error instanceof Error ? error.message : String(error) });
      return null;
    } finally {
      setConnecting(false);
    }
  }, [chain, refreshSprouts]);

  useEffect(() => {
    if (!chain?.isLocal || !health?.localDemo) return;
    void (async () => {
      try {
        const info = await api.localWallet();
        setLocalWallet(info);
        if (info.enabled) {
          const parent = info.accounts.find((a) => a.role === 'parent') ?? info.accounts[0];
          if (parent) setLocalAccount(parent.address);
        }
      } catch {
        // local wallet optional
      }
    })();
  }, [chain, health]);

  const connectLocal = useCallback(
    async (account: string) => {
      if (!chain) return;
      try {
        const w = await connectLocalWallet({
          address: account as Address,
          chainId: chain.chainId,
          name: chain.name,
          rpcUrl: chain.walletRpcUrl,
        });
        setWallet(w);
        setDetail(null);
        setParentSprouts([]);
        setBeneficiarySprouts([]);
        setTxn(null);
        setToolsMessage(null);
        const chosen = await refreshSprouts(w, true);
        // The same sprout id can be selected across roles; force a reload so the
        // role-appropriate detail (allowances, parent controls) is fetched.
        if (chosen) {
          onboardingConnect.current = false;
          await loadDetail(chosen);
        } else {
          setDetail(null);
          if (onboardingConnect.current) {
            onboardingConnect.current = false;
            setPlantStep(1);
            setShowPlant(true);
          }
        }
      } catch (error) {
        onboardingConnect.current = false;
        setTxn({ label: t('Local wallet'), status: 'failed', error: error instanceof Error ? error.message : String(error) });
      }
    },
    [chain, refreshSprouts, loadDetail],
  );

  const closeOnboarding = useCallback(() => {
    markOnboardingSeen();
    setOnboardingOpen(false);
  }, []);

  const continueOnboarding = useCallback(() => {
    markOnboardingSeen();
    setOnboardingOpen(false);
    if (wallet) {
      setPlantStep(1);
      setShowPlant(true);
    } else {
      onboardingConnect.current = true;
      void connect();
    }
  }, [wallet, connect]);

  const switchLocalRole = useCallback(
    async (role: 'parent' | 'beneficiary' | 'gifter') => {
      setLocalRole(role);
      const account = localWallet?.accounts.find((a) => a.role === role) ?? localWallet?.accounts[0];
      if (account) {
        setLocalAccount(account.address);
        await connectLocal(account.address);
      }
    },
    [localWallet, connectLocal],
  );

  // React to account/chain changes by clearing stale state.
  useEffect(() => {
    if (!wallet) return;
    const provider = wallet.provider;
    const onAccounts = (...args: unknown[]) => {
      const accounts = (args[0] as string[]) ?? [];
      if (!accounts.some((a) => a.toLowerCase() === wallet.address.toLowerCase())) {
        setWallet(null);
        setDetail(null);
        setParentSprouts([]);
        setBeneficiarySprouts([]);
        setSelectedId(null);
        setTxn({ label: t('Wallet'), status: 'failed', error: t('Account changed. Reconnect to continue.') });
      }
    };
    const onChain = () => {
      setWallet(null);
      setDetail(null);
      setTxn({ label: t('Wallet'), status: 'failed', error: t('Network changed. Reconnect on the configured chain.') });
    };
    provider.on?.('accountsChanged', onAccounts);
    provider.on?.('chainChanged', onChain);
    return () => {
      provider.removeListener?.('accountsChanged', onAccounts);
      provider.removeListener?.('chainChanged', onChain);
    };
  }, [wallet]);

  const withTxn = useCallback(async (label: string, fn: () => Promise<string | void>) => {
    setTxn({ label, status: 'pending' });
    try {
      const hash = await fn();
      setTxn({ label, status: 'confirmed', hash: typeof hash === 'string' ? hash : undefined });
    } catch (error) {
      setTxn({ label, status: 'failed', error: error instanceof Error ? error.message : String(error) });
    }
  }, []);

  const rolesById = useMemo(() => {
    const map = new Map<string, Set<'parent' | 'beneficiary'>>();
    for (const s of parentSprouts) {
      const key = s.id.toLowerCase();
      map.set(key, (map.get(key) ?? new Set()).add('parent'));
    }
    for (const s of beneficiarySprouts) {
      const key = s.id.toLowerCase();
      map.set(key, (map.get(key) ?? new Set()).add('beneficiary'));
    }
    return map;
  }, [parentSprouts, beneficiarySprouts]);

  const sprouts = useMemo(() => {
    const merged = new Map<string, Sprout>();
    for (const s of [...parentSprouts, ...beneficiarySprouts]) merged.set(s.id.toLowerCase(), s);
    return [...merged.values()];
  }, [parentSprouts, beneficiarySprouts]);

  useEffect(() => {
    if (!onboardingOpen || !wallet || loading || sprouts.length === 0) return;
    markOnboardingSeen();
    setOnboardingOpen(false);
  }, [onboardingOpen, wallet, loading, sprouts.length]);

  const chainReady = chain?.configured === true;
  const anyModalOpen =
    showPlant ||
    showFund ||
    showSchedule ||
    showInvestNow ||
    showGift ||
    showPayGift !== null ||
    giftQr !== null ||
    showMilestone ||
    showAllocation ||
    showWithdraw ||
    showChore ||
    showSettings ||
    showNotifications ||
    showHelp ||
    assetDetail !== null;
  // Opening a dialog clears any previous operation's status so stale errors do
  // not appear on a new form.
  useEffect(() => {
    if (anyModalOpen) setTxn(null);
  }, [anyModalOpen]);
  const stockTokens = chain?.contracts.stockTokens ?? [];
  const settlementToken = chain?.contracts.settlementToken;
  const plantGraduationTs = plantForm.graduation ? parseDateOnlyToUtcTs(plantForm.graduation) : null;
  // A new sprout comes from the configured factory, which admits every configured stock token.
  const plantPicked = pickedTokens(stockTokens, plantForm.selected ?? initialPicks(stockTokens));
  const plantAllocationEntered = plantPicked.reduce((n, token) => n + (Number(plantForm.percents[token.address]) || 0), 0);
  const milestoneUnlockTs = milestoneForm.unlock ? parseDateOnlyToUtcTs(milestoneForm.unlock) : null;

  const selected = detail?.sprout ?? sprouts.find((s) => s.id.toLowerCase() === selectedId?.toLowerCase()) ?? null;
  const selectedRole = selected ? rolesById.get(selected.id.toLowerCase()) : undefined;
  const isParent = selectedRole?.has('parent') ?? false;
  const isBeneficiary = selectedRole?.has('beneficiary') ?? false;
  const isGraduated = selected ? (selected.graduated ?? false) || clock / 1000 >= selected.graduationTimestamp : false;
  // A parent without the SPROUT tier automatic investing needs: their plan runs only with Invest now.
  const autoInvestLocked = useAutoInvestLock(health?.automation, isParent ? selected?.parent : null) !== null;
  // SPROUT holder perks in the stock picker: first dibs on newly added stocks, and holder-only bouquets.
  const holder = useHolder(wallet?.address);
  const stockLock = stockLockFor(holder);

  // The stocks the selected sprout may hold: those its own factory admitted
  // (older sprouts: the original four), plus whatever it holds now. Without
  // word from the server, every configured stock token.
  const admittedTokens = useMemo(() => {
    const fromDetail = detail && selected && detail.sprout.id.toLowerCase() === selected.id.toLowerCase() ? detail.admittedAssets : null;
    const admitted = fromDetail ?? (selected?.admittedAssets?.length ? selected.admittedAssets : null);
    if (!admitted) return stockTokens;
    const allowed = new Set([...admitted, ...(selected?.assets ?? [])].map((a) => a.toLowerCase()));
    return stockTokens.filter((token) => allowed.has(token.address.toLowerCase()));
  }, [detail, selected, stockTokens]);
  // The stocks in the selected sprout's mix now: the only ones it accepts as
  // deposits, gifts or chore rewards (SproutVault.isAllowedAsset).
  const sproutStockTokens = useMemo(() => {
    const held = stockTokens.filter((token) => selected?.assets.some((a) => a.toLowerCase() === token.address.toLowerCase()));
    return held.length > 0 ? held : stockTokens;
  }, [selected, stockTokens]);

  const graduationProgress = useMemo(() => {
    if (!selected) return 0;
    const total = selected.graduationTimestamp - selected.createdAt / 1000;
    const elapsed = clock / 1000 - selected.createdAt / 1000;
    return total > 0 ? elapsed / total : isGraduated ? 1 : 0;
  }, [selected, clock, isGraduated]);

  const balanceChange = useMemo(() => {
    if (!growth?.available || growth.snapshots.length < 2) return null;
    const first = growth.snapshots[0]!;
    const last = growth.snapshots[growth.snapshots.length - 1]!;
    const firstValue = BigInt(first.valueUsd);
    const lastValue = BigInt(last.valueUsd);
    const delta = lastValue - firstValue;
    const pct = firstValue !== 0n ? Number((delta * 10000n) / firstValue) / 100 : null;
    return { delta: usd(delta.toString(), last.feedDecimals), pct };
  }, [growth]);

  const percentToBps = (percent: string): number => Math.round(Number(percent || '0') * 100);

  const submitPlant = async () => {
    const factory = chain?.contracts.factory;
    const venue = chain?.contracts.venue;
    if (!wallet || !chain || !factory || !settlementToken) return;
    await withTxn(t('Plant sprout'), async () => {
      // Only the picked stocks, in pick order, each with its percentage in basis points.
      const tokenAddrs = plantPicked.map((t) => t.address);
      const weights = tokenAddrs.map((addr) => percentToBps(plantForm.percents[addr] ?? '0'));
      const sum = weights.reduce((a, b) => a + b, 0);
      if (tokenAddrs.length > MAX_STOCKS) throw new Error(t('A sprout can hold up to 5 stocks.'));
      if (sum !== 10000) throw new Error(t('Allocation percentages must total 100%'));
      if (!/^0x[0-9a-fA-F]{40}$/.test(plantForm.beneficiary)) throw new Error(t('Enter a valid beneficiary address'));
      const graduation = parseDateOnlyToUtcTs(plantForm.graduation);
      if (!Number.isFinite(graduation) || graduation <= Date.now() / 1000) throw new Error(t('Graduation date must be in the future'));

      const write = contractWriter(wallet);
      const hash = await write({
        address: factory,
        abi: sproutFactoryAbi,
        functionName: 'createSprout',
        args: [plantForm.beneficiary as Address, settlementToken, tokenAddrs, weights, BigInt(graduation), venue ? [venue] : []],
      });
      await waitForSuccess(wallet.publicClient, hash);
      const { sprout } = await api.registerSprout(wallet, hash);
      setNickname(sprout.id, plantForm.nickname);
      await refreshSprouts(wallet);
      setSelectedId(sprout.id);
      setShowPlant(false);
      setWelcomeOpen(true);
      return hash;
    });
  };

  const submitFund = async () => {
    if (!wallet || !selected) return;
    await withTxn(t('Fund sprout'), async () => {
      const token = fundForm.token as Address;
      const amount = parseUnits(fundForm.amount || '0', decimalsFor(token));
      if (amount <= 0n) throw new Error(t('Amount must be positive'));
      const write = contractWriter(wallet);
      const approveHash = await write({ address: token, abi: erc20Abi, functionName: 'approve', args: [selected.id, amount] });
      await waitForSuccess(wallet.publicClient, approveHash);
      const hash = await write({ address: selected.id, abi: sproutVaultAbi, functionName: 'fund', args: [token, amount] });
      await waitForSuccess(wallet.publicClient, hash);
      await loadDetailSynced(selected.id);
      setShowFund(false);
      return hash;
    });
  };

  const submitSchedule = async () => {
    if (!wallet || !selected) return;
    await withTxn(t('Schedule investment'), async () => {
      const amount = parseUnits(scheduleForm.amount || '0', chain?.contracts.settlementDecimals ?? 6);
      const period = Math.floor(Number(scheduleForm.periodDays) * 24 * 3600);
      if (amount <= 0n || period < 3600) throw new Error(t('Enter a positive amount and at least one hour'));
      const write = contractWriter(wallet);
      const hash = await write({
        address: selected.id,
        abi: sproutVaultAbi,
        functionName: 'scheduleInvestment',
        args: [amount, BigInt(period), BigInt(Math.floor(Date.now() / 1000))],
      });
      await waitForSuccess(wallet.publicClient, hash);
      await api.schedule(wallet, selected.id, hash);
      await loadDetail(selected.id);
      setShowSchedule(false);
      return hash;
    });
  };

  const cancelSchedule = async () => {
    if (!wallet || !selected) return;
    await withTxn(t('Cancel schedule'), async () => {
      const write = contractWriter(wallet);
      const hash = await write({ address: selected.id, abi: sproutVaultAbi, functionName: 'cancelInvestment', args: [] });
      await waitForSuccess(wallet.publicClient, hash);
      await api.cancelSchedule(wallet, selected.id, hash);
      await loadDetail(selected.id);
      return hash;
    });
  };

  const submitGift = async () => {
    if (!wallet || !selected || !settlementToken) return;
    await withTxn(giftForm.campaign ? t('Start campaign') : t('Create gift link'), async () => {
      // The vault takes gifts only in cash and the stocks in its mix now.
      const accepted = [settlementToken, ...sproutStockTokens.map((t) => t.address)];
      let campaign: { title: string; goalDollars: number; endsAt: number } | undefined;
      if (giftForm.campaign) {
        const title = giftForm.title.trim();
        const goalDollars = Number(giftForm.goal);
        const endsAt = endOfDayUtc(giftForm.ends);
        const problem = !title ? t('Give the campaign a title.') : textProblem(title, TITLE_MAX, 'The title');
        if (problem) throw new Error(problem);
        if (!Number.isInteger(goalDollars) || goalDollars < 1 || goalDollars > 100_000) throw new Error(t('Set a goal between $1 and $100,000 in whole dollars.'));
        if (!endsAt || endsAt * 1000 <= Date.now()) throw new Error(t('Pick an end date in the future.'));
        campaign = { title, goalDollars, endsAt };
      }
      const { gift } = await api.createGift(wallet, selected.id, campaign?.title ?? giftForm.label, accepted, campaign);
      setDetail((prev) =>
        prev
          ? {
              ...prev,
              gifts: [
                ...prev.gifts,
                {
                  id: gift.id,
                  vaultId: gift.vaultId,
                  label: gift.label,
                  status: 'open',
                  acceptedAssets: gift.acceptedAssets,
                  paymentCount: 0,
                  totals: {},
                  campaign: gift.campaign ?? null,
                  notes: [],
                  hiddenNotes: 0,
                },
              ],
            }
          : prev,
      );
      setShowGift(false);
      setGiftForm(GIFT_FORM_DEFAULTS);
      return;
    });
  };

  const showAllGiftNotes = (g: GiftSummary) =>
    void withTxn(t('Load gift notes'), async () => {
      if (!wallet) return;
      const { notes } = await api.giftNotes(wallet, g.id);
      setAllGiftNotes((prev) => ({ ...prev, [g.id]: notes }));
    });

  const toggleGiftNote = (g: GiftSummary, note: GiftNote) =>
    void withTxn(note.hidden ? t('Show gift note') : t('Hide gift note'), async () => {
      if (!wallet || !selected) return;
      const { notes } = await api.setGiftNoteHidden(wallet, g.id, note, !note.hidden);
      setAllGiftNotes((prev) => ({ ...prev, [g.id]: notes }));
      await loadDetail(selected.id);
    });

  const submitPayGift = async () => {
    if (!wallet || !showPayGift || !selected) return;
    await withTxn(t('Pay gift'), async () => {
      const token = payGiftForm.token as Address;
      const amount = parseUnits(payGiftForm.amount || '0', decimalsFor(token));
      const write = contractWriter(wallet);
      const approveHash = await write({ address: token, abi: erc20Abi, functionName: 'approve', args: [showPayGift.vaultId, amount] });
      await waitForSuccess(wallet.publicClient, approveHash);
      const hash = await write({
        address: showPayGift.vaultId,
        abi: sproutVaultAbi,
        functionName: 'payGift',
        args: [token, amount, showPayGift.id],
      });
      await waitForSuccess(wallet.publicClient, hash);
      await api.recordGiftPayment(wallet, showPayGift.id, hash).catch(() => undefined);
      await loadDetail(showPayGift.vaultId);
      setShowPayGift(null);
      return hash;
    });
  };

  const submitMilestone = async () => {
    if (!wallet || !selected) return;
    await withTxn(t('Create milestone'), async () => {
      const id = randomBytes32();
      const token = (milestoneForm.token || settlementToken) as Address;
      const amount = parseUnits(milestoneForm.amount || '0', decimalsFor(token));
      const unlock = milestoneForm.unlock ? parseDateOnlyToUtcTs(milestoneForm.unlock) : 0;
      const write = contractWriter(wallet);
      const hash = await write({
        address: selected.id,
        abi: sproutVaultAbi,
        functionName: 'createMilestone',
        args: [id, token, amount, BigInt(unlock)],
      });
      await waitForSuccess(wallet.publicClient, hash);
      // Only the id and tx hash are sent; the backend derives the chain fields.
      await api.createMilestone(wallet, selected.id, { milestoneId: id, txHash: hash });
      if (milestoneForm.title.trim() && chain) setMilestoneTitle(chain.chainId, selected.id, id, milestoneForm.title);
      await loadDetail(selected.id);
      setShowMilestone(false);
      return hash;
    });
  };

  const createChore = async () => {
    if (!wallet || !selected || !chain) return;
    await withTxn(t('Create chore'), async () => {
      const id = randomBytes32();
      const token = (settlementToken ?? milestoneForm.token) as Address;
      const amount = parseUnits(choreForm.amount || '0', decimalsFor(token));
      if (amount <= 0n) throw new Error(t('Reward must be positive'));
      const write = contractWriter(wallet);
      const hash = await write({
        address: selected.id,
        abi: sproutVaultAbi,
        functionName: 'createMilestone',
        args: [id, token, amount, 0n],
      });
      await waitForSuccess(wallet.publicClient, hash);
      await api.createMilestone(wallet, selected.id, { milestoneId: id, txHash: hash });
      if (choreForm.title.trim()) setMilestoneTitle(chain.chainId, selected.id, id, choreForm.title);
      await loadDetail(selected.id);
      setShowChore(false);
      return hash;
    });
  };

  const releaseMilestone = async (milestone: Milestone) => {
    if (!wallet || !selected) return;
    await withTxn(t('Release milestone'), async () => {
      const write = contractWriter(wallet);
      const hash = await write({ address: selected.id, abi: sproutVaultAbi, functionName: 'releaseMilestone', args: [milestone.id] });
      await waitForSuccess(wallet.publicClient, hash);
      await api.releaseMilestone(wallet, selected.id, milestone.id, hash);
      await loadDetail(selected.id);
      return hash;
    });
  };

  const cancelMilestone = async (milestone: Milestone) => {
    if (!wallet || !selected) return;
    await withTxn(t('Cancel milestone'), async () => {
      const write = contractWriter(wallet);
      const hash = await write({ address: selected.id, abi: sproutVaultAbi, functionName: 'cancelMilestone', args: [milestone.id] });
      await waitForSuccess(wallet.publicClient, hash);
      await api.cancelMilestone(wallet, selected.id, milestone.id, hash);
      await loadDetail(selected.id);
      return hash;
    });
  };

  const submitAllocation = async () => {
    if (!wallet || !selected) return;
    await withTxn(t('Update allocation'), async () => {
      // Only picked stocks this sprout's factory admitted; a zero share drops the stock.
      const entries = pickedTokens(admittedTokens, allocationForm.selected)
        .map((t) => ({ asset: t.address, bps: percentToBps(allocationForm.percents[t.address] ?? '0') }))
        .filter((e) => e.bps > 0);
      const sum = entries.reduce((acc, e) => acc + e.bps, 0);
      if (entries.length === 0) throw new Error(t('Allocate at least one asset'));
      if (entries.length > MAX_STOCKS) throw new Error(t('A sprout can hold up to 5 stocks.'));
      if (sum !== 10000) throw new Error(t('Allocation percentages must total 100%'));
      const write = contractWriter(wallet);
      const hash = await write({
        address: selected.id,
        abi: sproutVaultAbi,
        functionName: 'updateAllocation',
        args: [entries.map((e) => e.asset), entries.map((e) => e.bps)],
      });
      await waitForSuccess(wallet.publicClient, hash);
      await loadDetail(selected.id);
      setShowAllocation(false);
      return hash;
    });
  };

  const claimAllowance = async (token: Address, bucket: bigint) => {
    if (!wallet || !selected) return;
    await withTxn(t('Claim allowance'), async () => {
      const write = contractWriter(wallet);
      const hash = await write({ address: selected.id, abi: sproutVaultAbi, functionName: 'claimAllowance', args: [token, bucket] });
      await waitForSuccess(wallet.publicClient, hash);
      await loadDetail(selected.id);
      return hash;
    });
  };

  const withdraw = async (token: Address, amount: bigint) => {
    if (!wallet || !selected) return;
    await withTxn(t('Withdraw'), async () => {
      const write = contractWriter(wallet);
      const hash = await write({
        address: selected.id,
        abi: sproutVaultAbi,
        functionName: 'withdraw',
        args: [token, amount, wallet.address],
      });
      await waitForSuccess(wallet.publicClient, hash);
      await loadDetail(selected.id);
      setShowWithdraw(false);
      return hash;
    });
  };

  const runToolFund = () =>
    withTxn(t('Fund dev account'), async () => {
      const result = await api.localFund(localAccount, fundTool.amount, fundTool.token || undefined);
      setToolsMessage(t('Minted {amount} mock tokens to {account} (tx {hash}...)', { amount: fundTool.amount, account: short(localAccount), hash: result.txHash.slice(0, 10) }));
    });

  const runToolAdvance = () =>
    withTxn(t('Advance local time'), async () => {
      const result = await api.advanceTime(Number(advanceSeconds));
      setToolsMessage(
        result.failedFeeds.length > 0
          ? t('{label} ({refreshed} refreshed, {failed} failed)', { label: result.label, refreshed: result.refreshedFeeds.length, failed: result.failedFeeds.length })
          : t('{label} ({refreshed} refreshed)', { label: result.label, refreshed: result.refreshedFeeds.length }),
      );
      if (selectedId) await loadDetail(selectedId);
    });

  if (fatal) {
    return (
      <main className="page">
        <h1>Sprout</h1>
        <div className="card error-card">
          <h2>{t('Backend unavailable')}</h2>
          <p>{fatal}</p>
          <p>{tj('Start the backend with {command} and reload.', { command: <code>bun run dev:server</code> })}</p>
        </div>
      </main>
    );
  }

  if (giftRouteMatch && chain) {
    return (
      <GiftPage
        giftId={giftRouteMatch[1]!}
        chain={chain}
        wallet={wallet}
        localWallet={localWallet}
        connectTxn={txn}
        onConnect={async () => void (await connect())}
        onConnectLocal={async () => void (await switchLocalRole('gifter'))}
      />
    );
  }

  const shell: DashboardShellProps = {
    health, chain, wallet, connecting, localWallet, localRole, localAccount, toolsMessage, fundTool, advanceSeconds,
    onFundTool: setFundTool, onAdvanceSeconds: setAdvanceSeconds,
    onConnect: () => void connect(),
    onConnectLocal: (account) => void connectLocal(account),
    onLocalRole: (role) => void switchLocalRole(role),
    onLocalAccount: (account) => { setLocalAccount(account); void connectLocal(account); },
    sprouts, selectedId, onSelect: (id) => setSelectedId(id), getNickname: (id) => getNickname(id),
    selected, automation: detail?.automation ?? null, milestones: detail?.milestones ?? [], jobs: detail?.jobs ?? [], gifts: detail?.gifts ?? [],
    holdings, growth, events, beneficiaryState, isParent, isBeneficiary, isGraduated, graduationProgress, balanceChange,
    chainReady, loading, txn, view, setView, drawerOpen, setDrawerOpen,
    onOpenPlant: () => { setPlantStep(1); setShowPlant(true); },
    onOpenFund: () => { setFundForm({ token: settlementToken ?? '', amount: '10' }); setShowFund(true); },
    onOpenSchedule: () => {
      const jobs = detail?.jobs ?? [];
      const job = jobs.find((j) => j.status === 'active') ?? jobs.filter((j) => j.status !== 'active').slice(-1)[0];
      if (job) {
        setScheduleForm({
          amount: formatUnits(BigInt(job.amount), chain?.contracts.settlementDecimals ?? 6),
          periodDays: String(Math.max(1, Math.round(job.periodSeconds / 86400))),
        });
      } else {
        setScheduleForm({ amount: '25', periodDays: '7' });
      }
      setShowSchedule(true);
    },
    onOpenInvestNow: () => setShowInvestNow(true),
    onOpenGift: () => setShowGift(true),
    onOpenAllocation: () => {
      const percents: Record<string, string> = {};
      for (const t of admittedTokens) {
        const idx = selected?.assets.findIndex((a) => a.toLowerCase() === t.address.toLowerCase()) ?? -1;
        percents[t.address] = idx >= 0 ? String((selected?.weights[idx] ?? 0) / 100) : '0';
      }
      const current = (selected?.assets ?? []).filter((_, i) => (selected?.weights[i] ?? 0) > 0);
      setAllocationForm({ percents, selected: initialPicks(admittedTokens, current) });
      setShowAllocation(true);
    },
    onOpenWithdraw: () => setShowWithdraw(true),
    onOpenChore: () => { setChoreForm({ title: '', amount: '5' }); setShowChore(true); },
    onOpenMilestone: () => { setMilestoneForm({ token: settlementToken ?? '', amount: '10', unlock: '', title: '' }); setShowMilestone(true); },
    onCancelSchedule: () => void cancelSchedule(),
    onReleaseMilestone: (m) => void releaseMilestone(m),
    onCancelMilestone: (m) => void cancelMilestone(m),
    onClaim: (token, bucket) => void claimAllowance(token, bucket),
    onOpenSettings: () => setShowSettings(true),
    onOpenNotifications: () => setShowNotifications(true),
    onOpenOnboarding: () => setOnboardingOpen(true),
    onOpenHelp: () => setShowHelp(true),
    gifting: {
      onOpenCampaign: () => {
        const name = selected ? getNickname(selected.id) : null;
        setGiftForm({
          ...GIFT_FORM_DEFAULTS,
          campaign: true,
          title: name ? `${name}’s birthday` : '',
          ends: new Date(Date.now() + 14 * 86_400_000).toISOString().slice(0, 10),
        });
        setShowGift(true);
      },
      allNotes: allGiftNotes,
      onShowAllNotes: showAllGiftNotes,
      onToggleNoteHidden: toggleGiftNote,
    },
    onOpenAsset: (address) => setAssetDetail(address),
    onRunToolFund: () => void runToolFund(),
    onRunToolAdvance: () => void runToolAdvance(),
    onReconcile: () => void withTxn(t('Reconcile'), async () => { await fetch('/api/index/reconcile', { method: 'POST' }); if (selectedId) await loadDetail(selectedId); }),
    onRunJobs: () => void withTxn(t('Run due investments'), async () => { await api.runJobs(); if (selectedId) await loadDetail(selectedId); }),
    onOpenGiftQr: (g) => setGiftQr(g),
    onOpenGiftPay: (g) => { setPayGiftForm({ token: g.acceptedAssets[0] ?? '', amount: '25' }); setShowPayGift(g); },
    anyModalOpen, symbolFor, decimalsFor,
  };

  return (
    <main className="garden-root">
      <DashboardShell {...shell} />

      {!giftRouteMatch ? <OnboardingIntro open={onboardingOpen} connected={Boolean(wallet)} canConnect={Boolean(chain)} onClose={closeOnboarding} onConnect={continueOnboarding} onPlant={continueOnboarding} /> : null}
      <WelcomeSprout open={welcomeOpen} address={selectedId} onClose={() => setWelcomeOpen(false)} onFund={() => { setFundForm({ token: settlementToken ?? '', amount: '10' }); setShowFund(true); }} />

      {showPlant ? (
        <Modal title={t('Plant a sprout')} onClose={() => setShowPlant(false)} txn={txn} explorerUrl={chain?.explorerUrl}>
          <RiskLine action={t('Planting a sprout')} />
          <div className="step-dots" aria-label={t('Step {step} of 3', { step: plantStep })}>
            {[1, 2, 3].map((i) => (
              <span key={i} className={i <= plantStep ? 'filled' : ''} aria-hidden="true" />
            ))}
            <span className="fine-print">{t('Step {step} of 3 · {phase}', { step: plantStep, phase: plantStep === 1 ? t('name & beneficiary') : plantStep === 2 ? t('allocation') : t('graduation & review') })}</span>
          </div>

          {plantStep === 1 ? (
            <>
              <label>
                {t('Nickname (stays on this device)')}
                <input data-testid="plant-nickname" value={plantForm.nickname} onChange={(e) => setPlantForm({ ...plantForm, nickname: e.target.value })} placeholder={t('e.g. Robin')} maxLength={24} />
              </label>
              <label>
                {t('Beneficiary wallet')}
                <input data-testid="plant-beneficiary" value={plantForm.beneficiary} onChange={(e) => setPlantForm({ ...plantForm, beneficiary: e.target.value })} placeholder="0x..." />
              </label>
              <p className="fine-print" data-testid="plant-beneficiary-note">{tj('{rule}: rewards you approve before graduation, and everything at graduation. It can’t be changed later, so use a wallet your family can open. The nickname stays on this device.', { rule: <b>{t('Money in this sprout can only ever be paid to this wallet')}</b> })}</p>
            </>
          ) : null}

          {plantStep === 2 ? (
            <fieldset>
              <legend>{t('Allocation (percent, must total 100%)')}</legend>
              <StockMixEditor
                candidates={stockTokens}
                value={{ selected: plantPicked.map((token) => token.address), percents: plantForm.percents }}
                onChange={(mix) => setPlantForm({ ...plantForm, selected: mix.selected, percents: mix.percents })}
                weightTestId={(symbol) => `plant-weight-${symbol}`}
                stockLock={stockLock}
                extraMixes={holderBouquets(holder, stockTokens.map((token) => token.symbol))}
              />
              <p className="fine-print">{t('Only factory-admitted stock tokens can be selected. Weights must total exactly 100%.')}</p>
            </fieldset>
          ) : null}

          {plantStep === 3 ? (
            <>
              <label>
                {t('Graduation date')}
                <input data-testid="plant-graduation" type="date" value={plantForm.graduation} onChange={(e) => setPlantForm({ ...plantForm, graduation: e.target.value })} />
              </label>
              {plantGraduationTs !== null ? (
                <p className="muted" data-testid="plant-graduation-utc">
                  {t('Contract timestamp: {date} 00:00 UTC ({local} in {zone})', { date: formatUtcDate(plantGraduationTs), local: formatZonedDateTime(plantGraduationTs, viewerTimeZone()), zone: viewerTimeZone() })}
                </p>
              ) : null}
              <div className="review-card">
                <b>{plantForm.nickname.trim() || t('A new sprout')}</b>
                <p>{t('Beneficiary {address}', { address: plantForm.beneficiary || '—' })}</p>
                <p>{t('Allocation {mix}', { mix: plantPicked.map((token) => `${token.symbol} ${plantForm.percents[token.address] ?? '0'}%`).join(' · ') })}</p>
              </div>
              <p className="warning">{t('Graduation is irreversible. After the timestamp, the beneficiary has full control.')}</p>
            </>
          ) : null}

          <div className="form-actions">
            {plantStep > 1 ? <button type="button" data-testid="plant-back" className="btn" onClick={() => setPlantStep(plantStep - 1)}>{t('Back')}</button> : null}
            {plantStep < 3 ? (
              <button type="button" data-testid="plant-next" className="btn button-primary" onClick={() => setPlantStep(plantStep + 1)} disabled={plantStep === 1 ? plantForm.beneficiary.trim().length === 0 : plantAllocationEntered <= 0}>
                {t('Next')}
              </button>
            ) : (
              <button data-testid="plant-submit" className="btn button-primary" onClick={() => void submitPlant()}>{t('Plant and sign')}</button>
            )}
          </div>
        </Modal>
      ) : null}

      {showFund && selected ? (
        <Modal title={t('Fund sprout')} onClose={() => setShowFund(false)} txn={txn} explorerUrl={chain?.explorerUrl}>
          <RiskLine action={t('Adding funds')} />
          <label>
            {t('Asset')}
            <select data-testid="fund-token" value={fundForm.token} onChange={(e) => setFundForm({ ...fundForm, token: e.target.value })}>
              {settlementToken ? <option value={settlementToken}>{chain?.contracts.settlementSymbol ? t('{symbol} (settlement)', { symbol: chain.contracts.settlementSymbol }) : t('Settlement')}</option> : null}
              {sproutStockTokens.map((t) => (
                <option key={t.address} value={t.address}>
                  {t.symbol}
                </option>
              ))}
            </select>
          </label>
          <label>
            {t('Amount')}
            <input data-testid="fund-amount" value={fundForm.amount} onChange={(e) => setFundForm({ ...fundForm, amount: e.target.value })} />
          </label>
          <p className="muted">{t('Recipient: {address}', { address: selected.id })}</p>
          <button data-testid="fund-submit" className="btn btn--primary" onClick={() => void submitFund()}>
            {t('Approve and fund')}
          </button>
        </Modal>
      ) : null}

      {showSchedule ? (
        <Modal title={t('Schedule recurring investment')} onClose={() => setShowSchedule(false)} txn={txn} explorerUrl={chain?.explorerUrl}>
          <label>
            {t('Amount per period (settlement)')}
            <input data-testid="schedule-amount" value={scheduleForm.amount} onChange={(e) => setScheduleForm({ ...scheduleForm, amount: e.target.value })} />
          </label>
          <label>
            {t('Period (days)')}
            <input data-testid="schedule-days" type="number" min={1} value={scheduleForm.periodDays} onChange={(e) => setScheduleForm({ ...scheduleForm, periodDays: e.target.value })} />
          </label>
          <p className="muted">{t('At most one installment runs each period. If a run is missed, the next one catches up with a single purchase — never more.')}</p>
          <button data-testid="schedule-submit" className="btn btn--primary" onClick={() => void submitSchedule()}>
            {t('Schedule')}
          </button>
        </Modal>
      ) : null}

      {showInvestNow && selected && wallet && chain ? (
        <Modal title={t('Invest now')} onClose={() => setShowInvestNow(false)} txn={txn} explorerUrl={chain.explorerUrl}>
          <InvestNowForm
            wallet={wallet}
            vault={selected.id}
            chain={chain}
            settlementBalance={holdings?.holdings.find((h) => h.kind === 'settlement')?.rawBalance ?? null}
            runTxn={withTxn}
            automationEnabled={autoInvestLocked ? false : health?.automation.enabled ?? null}
            onDone={() => loadDetailSynced(selected.id)}
            onClose={() => setShowInvestNow(false)}
          />
        </Modal>
      ) : null}

      {showGift ? (
        <Modal
          title={giftForm.campaign ? t('Start a birthday campaign') : t('Create gift link')}
          onClose={() => {
            setShowGift(false);
            setGiftForm(GIFT_FORM_DEFAULTS);
          }}
          txn={txn}
          explorerUrl={chain?.explorerUrl}
        >
          {giftForm.campaign ? (
            <>
              <label>
                {t('Title')}
                <input
                  data-testid="campaign-title"
                  value={giftForm.title}
                  maxLength={TITLE_MAX}
                  placeholder={t('Maya turns 8')}
                  onChange={(e) => setGiftForm({ ...giftForm, title: e.target.value })}
                />
              </label>
              <label>
                {t('Goal (US dollars)')}
                <input
                  data-testid="campaign-goal"
                  inputMode="numeric"
                  value={giftForm.goal}
                  onChange={(e) => setGiftForm({ ...giftForm, goal: e.target.value.replace(/[^\d]/g, '') })}
                />
              </label>
              <label>
                {t('Ends on')}
                <input data-testid="campaign-ends" type="date" value={giftForm.ends} onChange={(e) => setGiftForm({ ...giftForm, ends: e.target.value })} />
              </label>
              <p className="muted">
                {t('Family open the link, see the goal and how close it is, and can leave a short note with their gift. Gifts still arrive after the end date; the page just stops counting down. The title is shown to anyone with the link.')}
              </p>
            </>
          ) : (
            <>
              <label>
                {t('Label')}
                <input data-testid="gift-label" value={giftForm.label} onChange={(e) => setGiftForm({ ...giftForm, label: e.target.value })} />
              </label>
              <p className="muted">{t('The link carries only an opaque id and accepted assets, never a child name or spending key.')}</p>
            </>
          )}
          <button data-testid="gift-submit" className="btn btn--primary" onClick={() => void submitGift()}>
            {giftForm.campaign ? t('Start campaign') : t('Create gift link')}
          </button>
        </Modal>
      ) : null}

      {showPayGift ? (
        <Modal title={t('Pay gift to {address}', { address: short(showPayGift.vaultId) })} onClose={() => setShowPayGift(null)} txn={txn} explorerUrl={chain?.explorerUrl}>
          <label>
            {t('Asset')}
            <select data-testid="paygift-token" value={payGiftForm.token} onChange={(e) => setPayGiftForm({ ...payGiftForm, token: e.target.value })}>
              {showPayGift.acceptedAssets.map((asset) => (
                <option key={asset} value={asset}>
                  {symbolFor(asset)}
                </option>
              ))}
            </select>
          </label>
          <label>
            {t('Amount')}
            <input data-testid="paygift-amount" value={payGiftForm.amount} onChange={(e) => setPayGiftForm({ ...payGiftForm, amount: e.target.value })} />
          </label>
          <button data-testid="paygift-submit" className="btn btn--primary" onClick={() => void submitPayGift()}>
            {t('Approve and pay')}
          </button>
        </Modal>
      ) : null}

      {giftQr ? (
        <Modal title={t('Gift link QR code')} onClose={() => setGiftQr(null)} txn={txn} explorerUrl={chain?.explorerUrl}>
          <GiftQrCard url={`${window.location.origin}/gift/${giftQr.id}`} label={giftQr.label} />
        </Modal>
      ) : null}

      {showMilestone ? (
        <Modal title={t('Add a chore (allowance milestone)')} onClose={() => setShowMilestone(false)} txn={txn} explorerUrl={chain?.explorerUrl}>
          <label>
            {t('Chore title (stays on this device)')}
            <input data-testid="milestone-title" value={milestoneForm.title} onChange={(e) => setMilestoneForm({ ...milestoneForm, title: e.target.value })} placeholder={t('e.g. Help water the garden')} maxLength={80} />
          </label>
          <label>
            {t('Asset')}
            <select data-testid="milestone-token" value={milestoneForm.token} onChange={(e) => setMilestoneForm({ ...milestoneForm, token: e.target.value })}>
              {settlementToken ? <option value={settlementToken}>{chain?.contracts.settlementSymbol ? t('{symbol} (settlement)', { symbol: chain.contracts.settlementSymbol }) : t('Settlement')}</option> : null}
              {sproutStockTokens.map((t) => (
                <option key={t.address} value={t.address}>
                  {t.symbol}
                </option>
              ))}
            </select>
          </label>
          <label>
            {t('Amount')}
            <input data-testid="milestone-amount" value={milestoneForm.amount} onChange={(e) => setMilestoneForm({ ...milestoneForm, amount: e.target.value })} />
          </label>
          <label>
            {t('Unlock date (optional)')}
            <input data-testid="milestone-unlock" type="date" value={milestoneForm.unlock} onChange={(e) => setMilestoneForm({ ...milestoneForm, unlock: e.target.value })} />
          </label>
          {milestoneUnlockTs !== null ? (
            <p className="muted" data-testid="milestone-unlock-utc">
              {t('Unlocks {date} 00:00 UTC ({local} in {zone})', { date: formatUtcDate(milestoneUnlockTs), local: formatZonedDateTime(milestoneUnlockTs, viewerTimeZone()), zone: viewerTimeZone() })}
            </p>
          ) : null}
          <button data-testid="milestone-submit" className="btn btn--primary" onClick={() => void submitMilestone()}>
            {t('Create milestone')}
          </button>
        </Modal>
      ) : null}

      {showAllocation && selected ? (
        <Modal title={t('Edit allocation')} onClose={() => setShowAllocation(false)} txn={txn} explorerUrl={chain?.explorerUrl}>
          <fieldset>
            <legend>{t('Percent (must total 100%; zero removes an asset)')}</legend>
            <StockMixEditor
              candidates={admittedTokens}
              value={allocationForm}
              onChange={(mix) => setAllocationForm(mix)}
              weightTestId={(symbol) => `allocation-${symbol}`}
              stockLock={stockLock}
              extraMixes={holderBouquets(holder, admittedTokens.map((token) => token.symbol))}
            />
          </fieldset>
          <p className="muted">{t('Only factory-admitted assets can be selected.')}</p>
          <button data-testid="allocation-submit" className="btn btn--primary" onClick={() => void submitAllocation()}>
            {t('Save allocation')}
          </button>
        </Modal>
      ) : null}

      {showWithdraw && selected && holdings ? (
        <Modal title={t('Withdraw after graduation')} onClose={() => setShowWithdraw(false)} txn={txn} explorerUrl={chain?.explorerUrl}>
          <p className="muted">{t('As beneficiary you can withdraw any balance to your wallet.')}</p>
          <ul className="stack">
            {holdings.holdings
              .filter((h) => BigInt(h.rawBalance) > 0n)
              .map((h) => (
                <li key={h.address} className="gift-row">
                  <span>
                    {h.symbol}: {formatUnits(BigInt(h.rawBalance), h.decimals, 4)}
                  </span>
                  <button data-testid={`withdraw-all-${h.symbol}`} className="btn btn--small" onClick={() => void withdraw(h.address, BigInt(h.rawBalance))} disabled={!chainReady}>
                    {t('Withdraw all')}
                  </button>
                </li>
              ))}
          </ul>
        </Modal>
      ) : null}

      {showChore ? (
        <Modal title={t('Add a chore')} onClose={() => setShowChore(false)} txn={txn} explorerUrl={chain?.explorerUrl}>
          <label>
            {t('Chore title (stays on this device)')}
            <input data-testid="chore-title" value={choreForm.title} onChange={(e) => setChoreForm({ ...choreForm, title: e.target.value })} placeholder={t('e.g. Help water the garden')} maxLength={80} />
          </label>
          <label>
            {t('Reward ({symbol})', { symbol: symbolFor(settlementToken ?? '') })}
            <input data-testid="chore-amount" value={choreForm.amount} onChange={(e) => setChoreForm({ ...choreForm, amount: e.target.value })} />
          </label>
          <p className="muted">
            {t('The on-chain vault stores only a milestone id and amount. A release moves the reward into the beneficiary allowance bucket; the beneficiary then claims it.')}
          </p>
          <button data-testid="chore-submit" className="btn button-primary" onClick={() => void createChore()}>
            {t('Create chore')}
          </button>
        </Modal>
      ) : null}

      {showSettings ? (
        <Modal title={t('Family settings')} onClose={() => setShowSettings(false)} txn={txn} explorerUrl={chain?.explorerUrl}>
          <div className="review-card">
            <b>{t('{count} sprout(s) in this workspace', { count: sprouts.length })}</b>
            <p>{t('Nicknames and chore titles are stored on this device only. Balances, roles and graduation live on-chain.')}</p>
          </div>
          <p className="muted">
            {t('Family co-parent accounts and notification delivery are not implemented in the backend. Nothing is faked here.')}
          </p>
          <div className="review-card">
            <b>{t('Local demo reset')}</b>
            <p>{t('In local demo mode you can reset device labels without deleting on-chain data. On-chain records cannot be deleted by the app.')}</p>
            <button
              className="btn"
              onClick={() => {
                try {
                  for (const s of sprouts) setNickname(s.id, '');
                } catch {
                  /* local only */
                }
                setToolsMessage(t('Cleared device-local labels. On-chain records are unchanged.'));
                setShowSettings(false);
              }}
            >
              {t('Clear device-local labels')}
            </button>
          </div>
        </Modal>
      ) : null}

      {showNotifications ? (
        <Modal title={t('A few little updates')} onClose={() => setShowNotifications(false)} txn={txn} explorerUrl={chain?.explorerUrl}>
          <p className="muted">{t('These are the real indexed on-chain events for this sprout. Push/email notification delivery is not implemented.')}</p>
          {events.length === 0 ? <p className="empty-note">{t('No indexed events yet.')}</p> : (
            <ul className="stack">
              {events.slice(-6).reverse().map((e) => (
                <li key={`${e.blockNumber}-${e.logIndex}`} className="gift-row">
                  <span>{e.eventName}</span>
                  <span className="muted">{t('block {number}', { number: e.blockNumber })}</span>
                </li>
              ))}
            </ul>
          )}
        </Modal>
      ) : null}

      {showHelp ? (
        <Modal title={t('Help')} onClose={() => setShowHelp(false)} txn={txn} explorerUrl={chain?.explorerUrl}>
          <p className="muted">
            {t('This is your live family workspace. Balances, roles and graduation live on-chain; nicknames and chore titles stay on this device.')}
          </p>
          <div className="review-card">
            <b>{t('Updates')}</b>
            <p>{t('Push/email notification delivery is not implemented. The activity list shows the real indexed on-chain events.')}</p>
            <button className="btn" data-testid="notifications-open" onClick={() => { setShowHelp(false); setShowNotifications(true); }}>
              {t('View recent activity')}
            </button>
          </div>
        </Modal>
      ) : null}

      {assetDetail ? (() => {
        const h = holdings?.holdings.find((x) => x.address.toLowerCase() === assetDetail.toLowerCase());
        return (
          <Modal title={h ? t('{symbol} details', { symbol: h.symbol }) : t('Asset details')} onClose={() => setAssetDetail(null)} txn={txn} explorerUrl={chain?.explorerUrl}>
            {h ? (
              <>
                <div className="review-card">
                  <b>{h.symbol} · {h.kind === 'settlement' ? t('settlement') : t('stock token')}</b>
                  <p>{t('Balance {amount} · value {value}', { amount: formatUnits(BigInt(h.rawBalance), h.decimals, 4), value: h.valueUsd ? usd(h.valueUsd, h.feedDecimals) : t('unavailable') })}</p>
                  <p>{t('Valuation status: {status}', { status: t(h.status) })}</p>
                </div>
                <p className="fine-print">
                  {t('Stock tokens are tokenized exposure, not direct ownership of a brokerage-held share. Availability depends on eligibility. Prices come from configured feeds; when a feed is stale the value is shown as unavailable.')}
                </p>
              </>
            ) : (
              <p className="muted">{t('No live holding data for this asset.')}</p>
            )}
          </Modal>
        );
      })() : null}
    </main>
  );
}

const GIFT_FORM_DEFAULTS = { label: 'Birthday gift', campaign: false, title: '', goal: '100', ends: '' };

function Modal({
  title,
  onClose,
  txn,
  explorerUrl,
  children,
}: {
  title: string;
  onClose: () => void;
  txn?: TxnState | null;
  explorerUrl?: string;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  // Keep the latest close handler without re-running the mount effects. `onClose`
  // is an inline callback from the parent, so depending on it would re-focus the
  // first field on every render and steal focus mid-typing.
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);
  // Focus the first control exactly once, when the dialog mounts, and hand focus
  // back to whatever opened the dialog when it closes.
  useEffect(() => {
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const first = ref.current?.querySelector<HTMLElement>('input, select, textarea, button');
    first?.focus();
    return () => opener?.focus();
  }, []);
  // Escape always invokes the latest close handler and never moves focus. Tab
  // cycles inside the dialog: `aria-modal` promises the rest of the page is
  // inert, so focus must not walk out into the dashboard behind it.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onCloseRef.current();
        return;
      }
      if (event.key !== 'Tab' || !ref.current) return;
      const nodes = [...ref.current.querySelectorAll<HTMLElement>(
        'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
      )].filter((node) => !node.hasAttribute('disabled') && node.offsetParent !== null);
      if (!nodes.length) return;
      const first = nodes[0]!;
      const last = nodes[nodes.length - 1]!;
      const active = document.activeElement;
      if (!ref.current.contains(active)) {
        event.preventDefault();
        first.focus();
      } else if (event.shiftKey && active === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && active === last) {
        event.preventDefault();
        first.focus();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label={title}>
      <div className="modal" ref={ref}>
        <div className="modal-head">
          <h2>{title}</h2>
          <button data-testid="modal-close" className="btn btn--small" onClick={onClose} aria-label={t('Close')}>
            {t('Close')}
          </button>
        </div>
        <TxnStatusLine txn={txn ?? null} explorerUrl={explorerUrl} />
        {children}
      </div>
    </div>
  );
}
