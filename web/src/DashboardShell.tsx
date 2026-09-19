import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { Address } from 'viem';
import { formatUnits } from '@sprout/shared';
import {
  ArrowUpRight, CalendarDays, ChartColumn, Check, CheckCircle2, ChevronDown, ChevronRight, FlaskConical,
  Gift, HelpCircle, Home, Leaf, Plus, Settings, Sprout as SproutIcon, Wallet,
  Repeat2,
} from 'lucide-react';
import type {
  AutomationCapability, BeneficiaryState, ChainEvent, ChainPublic, GiftSummary, Growth, Health,
  Holdings, Job, LocalWalletInfo, Milestone, Sprout,
} from './api';
import type { WalletState } from './wallet';
import { PublicCa, SproutAddressRow } from './components/PublicCa';
import { TxnStatusLine, type TxnState } from './components/TxnStatus';
import { getMilestoneTitle } from './localStore';
import { formatRunDateTime } from './dates';
import { cadenceLabel, choreRewardText, holdingSharesText } from './garden/format';
import { ThemeToggle } from './theme/ThemeSettings';
import { ResourcesMenu } from './components/ResourcesMenu';
import { BloomGarden } from './garden/BloomGarden';

export type ViewId = 'overview' | 'portfolio' | 'invest' | 'chores' | 'gifts' | 'graduation';

export interface SampleActivity {
  title: string;
  sub: string;
  amount: string;
  date: string;
  kind: 'gift' | 'chore' | 'invest';
}

export interface SampleDashboard {
  childAvatars: Record<string, string>;
  assetNames: Record<string, string>;
  assetChanges: Record<string, string>;
  activity: SampleActivity[];
  choreLabels: Record<string, string>;
  choreDone: Record<string, boolean>;
  portfolioChange: string;
  weeklyNext: string;
  weeklySubtitle: string;
}

export interface DashboardShellProps {
  health: Health | null;
  chain: ChainPublic | null;
  wallet: WalletState | null;
  connecting: boolean;
  localWallet: LocalWalletInfo | null;
  localRole: 'parent' | 'beneficiary' | 'gifter';
  localAccount: string;
  toolsMessage: string | null;
  fundTool: { token: string; amount: string };
  advanceSeconds: string;
  onFundTool: (v: { token: string; amount: string }) => void;
  onAdvanceSeconds: (v: string) => void;
  onConnect: () => void;
  onConnectLocal: (account: string) => void;
  onLocalRole: (role: 'parent' | 'beneficiary' | 'gifter') => void;
  onLocalAccount: (account: string) => void;
  sprouts: Sprout[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  getNickname: (id: string) => string | null;
  selected: Sprout | null;
  automation: AutomationCapability | null;
  milestones: Milestone[];
  jobs: Job[];
  gifts: GiftSummary[];
  holdings: Holdings | null;
  growth: Growth | null;
  events: ChainEvent[];
  beneficiaryState: BeneficiaryState | null;
  isParent: boolean;
  isBeneficiary: boolean;
  isGraduated: boolean;
  graduationProgress: number;
  chainReady: boolean;
  loading: boolean;
  txn: TxnState | null;
  view: ViewId;
  setView: (v: ViewId) => void;
  drawerOpen: boolean;
  setDrawerOpen: (v: boolean) => void;
  onOpenPlant: () => void;
  onOpenFund: () => void;
  onOpenSchedule: () => void;
  onOpenGift: () => void;
  onOpenGiftPay: (g: GiftSummary) => void;
  anyModalOpen: boolean;
  onOpenAllocation: () => void;
  onOpenWithdraw: () => void;
  onOpenChore: () => void;
  onOpenMilestone: () => void;
  onCancelSchedule: () => void;
  onReleaseMilestone: (m: Milestone) => void;
  onCancelMilestone: (m: Milestone) => void;
  onClaim: (token: Address, bucket: bigint) => void;
  onOpenSettings: () => void;
  onOpenNotifications: () => void;
  onOpenOnboarding?: () => void;
  onOpenHelp?: () => void;
  onOpenAsset: (address: string) => void;
  onRunToolFund: () => void;
  onRunToolAdvance: () => void;
  onReconcile: () => void;
  onRunJobs: () => void;
  symbolFor: (asset: string) => string;
  decimalsFor: (asset: string) => number;
  mode?: 'live' | 'sample';
  sample?: SampleDashboard | null;
  nowMs?: number;
}

const VIEWS: Array<{ id: ViewId; label: string; icon: typeof Home }> = [
  { id: 'overview', label: 'Overview', icon: Home },
  { id: 'portfolio', label: 'Portfolio', icon: ChartColumn },
  { id: 'invest', label: 'Weekly investing', icon: CalendarDays },
  { id: 'chores', label: 'Chores & rewards', icon: CheckCircle2 },
  { id: 'gifts', label: 'Gifts', icon: Gift },
  { id: 'graduation', label: 'Growing up', icon: Leaf },
];

const HEADINGS: Record<ViewId, { title: ReactNode; sub: string }> = {
  overview: { title: null, sub: '' },
  portfolio: { title: <>Their portfolio,<br />at a glance.</>, sub: 'A clear picture of contributions, market value and holdings.' },
  invest: { title: <>A steady habit,<br />every week.</>, sub: 'Choose an amount that works for your family. Change it any time.' },
  chores: { title: <>Small jobs.<br />Meaningful rewards.</>, sub: 'Set a reward. Approve it when the job is done, and the vault releases it.' },
  gifts: { title: <>A little love<br />from their people.</>, sub: 'Give family and friends a simple way to contribute.' },
  graduation: { title: <>Growing into<br />their own.</>, sub: 'The immutable handover plan, one milestone at a time.' },
};

const PERIODS = ['1W', '1M', '3M', '1Y'] as const;
const PERIOD_MS: Record<string, number> = { '1W': 7 * 86400e3, '1M': 30 * 86400e3, '3M': 90 * 86400e3, '1Y': 365 * 86400e3 };

function money(valueUsd: string | null, feedDecimals: number): string {
  if (!valueUsd) return 'unavailable';
  try {
    return `$${Number(formatUnits(BigInt(valueUsd), feedDecimals)).toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
  } catch {
    return 'unavailable';
  }
}

function short(address: string): string {
  if (!address) return 'wallet';
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

function initials(name: string): string {
  const clean = name.trim();
  if (!clean) return 'S';
  const parts = clean.split(/\s+/);
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
  return `${parts[0]![0] ?? ''}${parts[1]![0] ?? ''}`.toUpperCase();
}

function niceDate(tsMs: number): string {
  return new Date(tsMs).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

/** Inline, offline brand marks for the sample/live holdings table. */
function AssetGlyph({ symbol }: { symbol: string }) {
  const s = symbol.toUpperCase();
  if (s === 'AAPL') {
    return (
      <span className="garden-glyph garden-glyph--aapl" aria-hidden>
        <svg viewBox="0 0 24 24" width="18" height="18"><path fill="#111" d="M16.7 12.9c0-2 1.6-3 1.7-3.1-1-1.4-2.4-1.6-2.9-1.6-1.2-.1-2.4.7-3 .7-.6 0-1.6-.7-2.6-.7-1.3 0-2.6.8-3.3 2-1.4 2.4-.4 6 1 8 .7 1 1.5 2.1 2.5 2 1 0 1.4-.6 2.6-.6s1.5.6 2.6.6c1.1 0 1.8-1 2.4-2 .8-1.1 1.1-2.2 1.1-2.3 0 0-2.1-.8-2.1-3zM14.8 6.4c.5-.7.9-1.6.8-2.5-.8 0-1.7.5-2.3 1.2-.5.6-.9 1.5-.8 2.4.9.1 1.8-.4 2.3-1.1z"/></svg>
      </span>
    );
  }
  if (s === 'NVDA') {
    return <span className="garden-glyph garden-glyph--nvda" aria-hidden>NV</span>;
  }
  if (s === 'MSFT') {
    return (
      <span className="garden-glyph" aria-hidden>
        <svg viewBox="0 0 24 24" width="18" height="18"><rect x="3" y="3" width="8.2" height="8.2" fill="#f25022"/><rect x="12.8" y="3" width="8.2" height="8.2" fill="#7fba00"/><rect x="3" y="12.8" width="8.2" height="8.2" fill="#00a4ef"/><rect x="12.8" y="12.8" width="8.2" height="8.2" fill="#ffb900"/></svg>
      </span>
    );
  }
  if (s === 'SPY') {
    return <span className="garden-glyph garden-glyph--spy" aria-hidden>SPR</span>;
  }
  return <span className="garden-glyph garden-glyph--generic" aria-hidden>{symbol.slice(0, 3)}</span>;
}

function GardenChart({
  snapshots,
  period,
  feedDecimals,
  nowMs,
}: {
  snapshots: Growth['snapshots'];
  period: string;
  feedDecimals: number;
  nowMs: number;
}) {
  // Measured geometry: the SVG viewBox always matches the rendered pixel box so
  // axis labels stay ~12px and the line/area fill the real height at every size
  // instead of being scaled into a strip (e.g. 390px wide).
  const ref = useRef<HTMLDivElement>(null);
  const [box, setBox] = useState({ w: 760, h: 190 });
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => setBox((prev) => {
      const w = el.clientWidth || prev.w;
      const h = el.clientHeight || prev.h;
      return w === prev.w && h === prev.h ? prev : { w, h };
    });
    measure();
    const observer = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(measure) : null;
    observer?.observe(el);
    window.addEventListener('resize', measure);
    return () => { observer?.disconnect(); window.removeEventListener('resize', measure); };
  }, []);

  const windowed = snapshots
    .filter((s) => s.takenAt * 1000 >= nowMs - (PERIOD_MS[period] ?? PERIOD_MS['1Y']!))
    .sort((a, b) => a.takenAt - b.takenAt);
  if (windowed.length < 2) {
    return (
      <div className="garden-chart-empty" ref={ref}>
        History unavailable for this period — not enough recorded on-chain snapshots. No returns are invented.
      </div>
    );
  }
  const values = windowed.map((s) => Number(s.valueUsd) / 10 ** s.feedDecimals);
  const times = windowed.map((s) => s.takenAt * 1000);
  const rawMin = Math.min(...values);
  const rawMax = Math.max(...values);
  const step = 500;
  const min = Math.floor(rawMin / step) * step - step;
  const max = (Math.ceil(rawMax / step) * step + step) || min + step * 2;
  const span = max - min || 1;
  const tMin = Math.min(...times);
  const tSpan = Math.max(...times) - tMin || 1;

  const W = Math.max(300, Math.round(box.w));
  const H = Math.max(150, Math.round(box.h));
  const compact = W < 480;
  const padL = compact ? 46 : 58;
  const padR = 12;
  const padT = 12;
  const padB = 30;
  const plotW = W - padL - padR;
  const plotH = H - padT - padB;
  const fontSize = compact ? 11 : 12;

  const xFor = (t: number) => padL + ((t - tMin) / tSpan) * plotW;
  const yFor = (v: number) => padT + (1 - (v - min) / span) * plotH;

  const line = windowed
    .map((s, i) => `${i === 0 ? 'M' : 'L'} ${xFor(times[i]!).toFixed(1)} ${yFor(values[i]!).toFixed(1)}`)
    .join(' ');
  const area = `${line} L ${xFor(times[times.length - 1]!).toFixed(1)} ${(padT + plotH).toFixed(1)} L ${xFor(times[0]!).toFixed(1)} ${(padT + plotH).toFixed(1)} Z`;

  const yTicks = Array.from({ length: 4 }, (_, i) => min + (span * i) / 3);
  const xTickCount = compact ? 4 : 6;
  const xTicks = Array.from({ length: xTickCount }, (_, i) => tMin + (tSpan * i) / (xTickCount - 1));
  const lastX = xFor(times[times.length - 1]!);
  const lastY = yFor(values[values.length - 1]!);
  const tipW = 96;
  const tipRight = lastX + tipW + 16 > W - padR;
  const tipX = Math.min(Math.max(tipRight ? lastX - tipW - 12 : lastX + 12, padL), W - padR - tipW);
  const tipY = Math.max(padT, lastY - 58);
  const plotBottom = padT + plotH;

  return (
    <div className="garden-chart" ref={ref}>
      <svg viewBox={`0 0 ${W} ${H}`} style={{ height: H }} role="img" aria-label="Recorded portfolio value plotted at real timestamps" preserveAspectRatio="xMidYMid meet">
        <defs>
          <linearGradient id="garden-area" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#4f8b4a" stopOpacity="0.22" />
            <stop offset="100%" stopColor="#4f8b4a" stopOpacity="0.02" />
          </linearGradient>
        </defs>
        {yTicks.map((t) => (
          <g key={t}>
            <line x1={padL} y1={yFor(t)} x2={W - padR} y2={yFor(t)} stroke="#efece4" strokeWidth="1" />
            <text x={padL - 8} y={yFor(t) + 4} textAnchor="end" className="garden-axis-label" style={{ fontSize }}>
              ${Math.round(t).toLocaleString('en-US')}
            </text>
          </g>
        ))}
        <path d={area} fill="url(#garden-area)" />
        <path d={line} fill="none" stroke="#5b9455" strokeWidth="2.4" strokeLinejoin="round" strokeLinecap="round" />
        {xTicks.map((t, i) => (
          <text
            key={t}
            x={xFor(t)}
            y={H - 8}
            textAnchor={i === 0 ? 'start' : i === xTicks.length - 1 ? 'end' : 'middle'}
            className="garden-axis-label"
            style={{ fontSize }}
          >
            {new Date(t).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
          </text>
        ))}
        <line x1={padL} y1={plotBottom} x2={W - padR} y2={plotBottom} stroke="#dce3d2" strokeWidth="1" />
        <circle cx={lastX} cy={lastY} r="5.5" fill="#5b9455" />
        <circle cx={lastX} cy={lastY} r="2.2" fill="#fff" />
        <g>
          <rect x={tipX} y={tipY} width={tipW} height="44" rx="10" fill="#ffffff" stroke="#ece7dc" />
          <text x={tipX + 12} y={tipY + 19} className="garden-tip-value" style={{ fontSize: fontSize + 1 }}>
            {`$${values[values.length - 1]!.toLocaleString('en-US', { maximumFractionDigits: 2 })}`}
          </text>
          <text x={tipX + 12} y={tipY + 34} className="garden-tip-date" style={{ fontSize }}>
            {niceDate(times[times.length - 1]!)}
          </text>
        </g>
      </svg>
    </div>
  );
}

export function DashboardShell(props: DashboardShellProps) {
  const {
    health, chain, wallet, connecting, localWallet, localRole, localAccount, toolsMessage, fundTool, advanceSeconds,
    onFundTool, onAdvanceSeconds, onConnect, onConnectLocal, onLocalRole, onLocalAccount, sprouts, selectedId,
    onSelect, getNickname, selected, automation, milestones, jobs, gifts, holdings, growth, events, beneficiaryState,
    isParent, isBeneficiary, isGraduated, graduationProgress, chainReady, loading, txn, view, setView,
    drawerOpen, setDrawerOpen, onOpenPlant, onOpenFund, onOpenSchedule, onOpenGift, onOpenAllocation, onOpenWithdraw,
    onOpenChore, onOpenMilestone, onCancelSchedule, onReleaseMilestone, onCancelMilestone, onClaim, onOpenSettings, onOpenNotifications,
    onOpenHelp, onOpenOnboarding, onOpenAsset, onRunToolFund, onRunToolAdvance, onReconcile, onRunJobs, symbolFor, decimalsFor, anyModalOpen, onOpenGiftPay,
    mode = 'live', sample = null, nowMs,
  } = props;

  const isSample = mode === 'sample';
  // Disconnected live mode still renders the real dashboard shell: the garden
  // layout and navigation are identical to a connected session, and only the
  // first-run panel swaps its call to action from planting to connecting.
  const needsWallet = !isSample && !wallet;
  const chartNow = nowMs ?? Date.now();
  const [period, setPeriod] = useState('3M');
  const [toggledChores, setToggledChores] = useState<Record<string, boolean>>({});

  const settlementToken = chain?.contracts.settlementToken;
  const settlementDecimals = chain?.contracts.settlementDecimals ?? 6;
  const activeJobs = jobs.filter((j) => j.status !== 'cancelled');
  const scheduled = activeJobs[0] ?? null;
  const previousJob = jobs.filter((j) => j.status === 'cancelled' || j.status === 'paused').slice(-1)[0] ?? null;
  const chores = milestones;
  const openChores = chores.filter((m) => m.status === 'created');
  const releasedChores = chores.filter((m) => m.status === 'released');
  const canPlant = isParent && !isGraduated && chainReady;
  const canParentAct = isParent && !isGraduated;

  const choreTitle = (m: Milestone): string => {
    if (isSample && sample?.choreLabels[m.id]) return sample.choreLabels[m.id]!;
    return getMilestoneTitle(chain?.chainId ?? 0, m.vaultId, m.id) ?? `${formatUnits(BigInt(m.amount), decimalsFor(m.token), 2)} ${symbolFor(m.token)}`;
  };
  const choreProgress = chores.length ? Math.round((releasedChores.length / chores.length) * 100) : 0;
  const allowances = beneficiaryState?.allowances ?? [];
  const claimable = allowances.filter((a) => BigInt(a.bucket) > 0n);
  const fmtTokenAmount = (raw: string, token: string): string => {
    try {
      return `${formatUnits(BigInt(raw), decimalsFor(token))} ${symbolFor(token)}`;
    } catch {
      return `${symbolFor(token)}`;
    }
  };
  const nameFor = (id: string): string => getNickname(id) ?? (isSample ? getNickname(id) ?? 'Sprout' : 'Sprout');
  const avatarFor = (id: string): string | null => (isSample ? sample?.childAvatars[id] ?? null : null);
  const assetName = (symbol: string): string | null => (isSample ? sample?.assetNames[symbol] ?? null : null);
  const assetChange = (symbol: string): string | null => (isSample ? sample?.assetChanges[symbol] ?? null : null);

  const activity = events.slice().reverse().slice(0, 30);
  const describe = (e: ChainEvent): { title: string; sub: string; kind: string } => {
    const p = (e.payload ?? {}) as Record<string, unknown>;
    const token = String(p.token ?? '');
    const amt = (v: unknown, dec: number) => {
      try { return formatUnits(BigInt(String(v ?? 0)), dec); } catch { return '—'; }
    };
    switch (e.eventName) {
      case 'Funded': return { title: 'Contribution', sub: fmtTokenAmount(String(p.amount ?? 0), token), kind: 'fund' };
      case 'GiftReceived': return { title: 'Gift received', sub: fmtTokenAmount(String(p.amount ?? 0), token), kind: 'gift' };
      case 'InvestmentExecuted':
        return {
          title: 'Weekly investment',
          sub: `${amt(p.amountIn, chain?.contracts.settlementDecimals ?? 6)} → ${amt(p.amountOut, decimalsFor(token))} ${symbolFor(token)}`,
          kind: 'invest',
        };
      case 'InvestmentScheduled': return { title: 'Weekly plan set', sub: 'Recurring investment scheduled', kind: 'invest' };
      case 'InvestmentCancelled': return { title: 'Weekly plan paused', sub: 'Recurring investment cancelled', kind: 'invest' };
      case 'MilestoneCreated': return { title: 'Chore added', sub: `${fmtTokenAmount(String(p.amount ?? 0), token)} reward`, kind: 'chore' };
      case 'MilestoneReleased': return { title: 'Reward released', sub: `${fmtTokenAmount(String(p.amount ?? 0), token)} to allowance`, kind: 'chore' };
      case 'MilestoneCancelled': return { title: 'Chore cancelled', sub: 'Reward earmark released', kind: 'chore' };
      case 'AllowanceClaimed': return { title: 'Allowance claimed', sub: fmtTokenAmount(String(p.amount ?? 0), token), kind: 'chore' };
      case 'Withdrawn': return { title: 'Withdrawn after graduation', sub: fmtTokenAmount(String(p.amount ?? 0), token), kind: 'gift' };
      case 'SproutInitialized': return { title: 'Sprout planted', sub: 'Vault created on-chain', kind: 'invest' };
      default: return { title: e.eventName, sub: 'on-chain event', kind: 'invest' };
    }
  };

  const activityRows = isSample && sample
    ? sample.activity
    : activity.slice(0, 4).map((e) => {
        const d = describe(e);
        return { title: d.title, sub: d.sub, amount: '', date: '', kind: d.kind as SampleActivity['kind'] };
      });

  const samplePortfolioValue = holdings?.available ? money(holdings.totalValueUsd, holdings.feedDecimals) : isSample ? '$2,480.65' : '—';
  const performance = holdings?.available ? holdings.performance : undefined;
  const changeText = (): ReactNode => {
    if (performance?.available) {
      const gain = BigInt(performance.gainUsd);
      const absoluteGain = money((gain < 0n ? -gain : gain).toString(), performance.feedDecimals);
      return <><span className={gain < 0n ? 'garden-down' : gain > 0n ? 'garden-up' : 'garden-muted'} data-testid="portfolio-gain">{gain < 0n ? '−' : gain > 0n ? '+' : ''}{absoluteGain}</span><span className="garden-muted">{gain < 0n ? 'loss' : 'gain'} since planting · deposits excluded, withdrawals accounted for</span></>;
    }
    return <span className="garden-muted">{performance?.reason ?? 'Verified contribution history is needed to show gain or loss.'}</span>;
  };

  /**
   * The vault holds nothing at all. Distinct from "we could not load it": the
   * chain answered, and the answer is zero. Without this the page renders a
   * blank chart over four zero rows, which reads as a failure rather than as
   * an account nobody has put money into yet.
   */
  const vaultIsEmpty: boolean =
    !isSample && !!holdings?.available && holdings.holdings.every((h) => h.rawBalance === '0') &&
    !!performance?.available && performance.contributedUsd === '0';

  /** Settlement sitting in the vault when nothing has been invested yet. */
  const fundedNotInvested: string | null = (() => {
    if (isSample || !holdings?.available) return null;
    const cash = holdings.holdings.find((h) => h.kind === 'settlement');
    const stock = holdings.holdings.some((h) => h.kind === 'stock' && h.rawBalance !== '0');
    if (!cash || cash.rawBalance === '0' || stock) return null;
    return fmtTokenAmount(cash.rawBalance, cash.address);
  })();

  const holdingsRows: ReactNode = vaultIsEmpty ? (
    <div className="garden-empty-vault" data-testid="empty-vault-holdings">
      <p className="garden-empty-vault-lead">Nothing in this sprout yet.</p>
      <p className="garden-empty-note">
        Planting created the vault; it does not move any money. Add funds to start, and holdings
        will appear here once there is something to hold.
      </p>
      {canParentAct ? (
        <button className="garden-pill garden-pill--dark" data-testid="empty-vault-fund" onClick={onOpenFund} disabled={!chainReady}>
          Add funds <ArrowUpRight size={15} />
        </button>
      ) : null}
    </div>
  ) : !holdings?.available ? (
    <p className="garden-empty-note">{holdings?.reason ?? 'Could not load holdings just now. Your balance is safe on-chain — this is a display problem, not a missing balance. Try again in a moment.'}</p>
  ) : (
    <table className="garden-table">
      <thead>
        <tr>
          <th>Asset</th>
          <th className="garden-right">{isSample ? 'Shares' : 'Tokens'}</th>
          <th className="garden-right">Value</th>
          <th className="garden-right">{isSample ? 'Change (3M)' : 'Change'}</th>
        </tr>
      </thead>
      <tbody>
        {holdings.holdings.slice(0, 4).map((h) => {
          const shares = holdingSharesText({ shareEquivalent: h.shareEquivalent, rawBalance: h.rawBalance, decimals: h.decimals });
          const change = assetChange(h.symbol);
          // The server labels the settlement row "SETTLEMENT", which reads as
          // jargon beside AAPL and NVDA. Show the ticker instead where one is
          // configured. data-testid keeps the server's symbol: the browser and
          // hosted suites select on holding-SETTLEMENT.
          const label = h.kind === 'settlement' ? (chain?.contracts.settlementSymbol ?? h.symbol) : h.symbol;
          return (
            <tr key={h.address + h.kind} data-testid={`holding-${h.symbol}`}>
              <td>
                <button className="garden-asset" onClick={() => onOpenAsset(h.address)}>
                  <AssetGlyph symbol={label} />
                  <span className="garden-asset-name">
                    <b>{label}</b>
                    <small>{assetName(h.symbol) ?? (h.kind === 'settlement' ? 'Cash balance' : 'Stock token')}</small>
                  </span>
                </button>
              </td>
              <td className="garden-right garden-tabular">{shares}</td>
              <td className="garden-right garden-tabular">{money(h.valueUsd, h.feedDecimals)}</td>
              <td className={'garden-right garden-tabular ' + (change ? 'garden-up' : 'garden-muted')}>
                {change ?? (isSample ? '—' : 'n/a')}
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );

  const topRow = (
    <div className="garden-toprow">
      <div className="garden-toprow-left">
        <button
          className="garden-drawer-toggle"
          data-testid="sidebar-toggle"
          aria-label="Open menu"
          onClick={() => setDrawerOpen(true)}
        >
          ☰
        </button>
        <div className="garden-children" role="group" aria-label="Select a sprout">
          {sprouts.map((s) => {
            const active = s.id.toLowerCase() === selectedId?.toLowerCase();
            const avatar = avatarFor(s.id);
            return (
              <button
                key={s.id}
                data-testid="sprout-item"
                className={'garden-child' + (active ? ' garden-child--active' : '')}
                aria-pressed={active}
                onClick={() => onSelect(s.id)}
              >
                {avatar ? (
                  <img className="garden-child-avatar" src={avatar} alt="" />
                ) : (
                  <span className="garden-child-avatar garden-child-avatar--fallback">{initials(nameFor(s.id))}</span>
                )}
                <span className="garden-child-name">{nameFor(s.id)}</span>
                {active ? <ChevronDown size={16} className="garden-child-chevron" /> : null}
              </button>
            );
          })}
        </div>
      </div>
      <div className="garden-toprow-right">
        {isSample ? null : <PublicCa variant="dashboard" />}
        <ThemeToggle />
        {isSample ? (
          <details className="garden-sample" data-testid="sample-menu">
            <summary data-testid="sample-badge" className="garden-sample-badge">
              <FlaskConical size={18} />
              Sample data
            </summary>
            <div className="garden-menu">
              <p className="garden-menu-note">You are viewing a local sample. No wallet, vault or live data is used.</p>
              <a className="garden-menu-action" href="/dashboard" data-testid="sample-go-live">Go to live dashboard</a>
            </div>
          </details>
        ) : (
          <details className="garden-wallet">
            <summary className="garden-wallet-summary" data-testid="wallet-control">
              <Wallet size={17} />
              <span>{wallet ? short(wallet.address) : 'Wallet'}</span>
              <ChevronDown size={15} />
            </summary>
            <div className="garden-menu">
              <div className="garden-menu-row"><span>Network</span><b>{chain?.name ?? 'Not configured'}</b></div>
              {selected ? <SproutAddressRow address={selected.id} /> : null}
              {chain && !chain.configured ? <div className="garden-menu-row"><span>Status</span><b>Unconfigured</b></div> : null}
            </div>
          </details>
        )}
      </div>
    </div>
  );

  const hero = (
    <div className="garden-hero">
      <div className="garden-hero-copy garden-view-enter" key={`hero-${view}-${selectedId ?? 'none'}`}>
        {view === 'overview' ? (
          <>
            <h1>A little today.<br />A growing tomorrow.</h1>
            <p className="garden-hero-sub">Investing, learning, and good habits for {selected ? `${nameFor(selected.id)}’s` : 'their'} big future.</p>
          </>
        ) : (
          <>
            <h1>{HEADINGS[view].title}</h1>
            <p className="garden-hero-sub">{HEADINGS[view].sub}</p>
          </>
        )}
      </div>
      <BloomGarden theme={view} />
    </div>
  );

  const portfolioCard = (
    <div className="garden-card garden-portfolio">
      <div className="garden-card-head">
        <h2>{selected ? `${nameFor(selected.id)}’s portfolio` : 'Portfolio'}</h2>
        <div className="garden-periods" role="group" aria-label="Chart period">
          {PERIODS.map((p) => (
            <button key={p} className={'garden-period' + (p === period ? ' garden-period--active' : '')} aria-pressed={p === period} onClick={() => setPeriod(p)}>
              {p}
            </button>
          ))}
        </div>
      </div>
      <div className="garden-value-comparison">
        <div><span className="garden-value-label">Worth now</span><div className="garden-value" data-testid="portfolio-value">{samplePortfolioValue}</div></div>
        <div><span className="garden-value-label">Put in</span><div className="garden-contributed" data-testid="portfolio-contributed">{performance?.available ? money(performance.contributedUsd, performance.feedDecimals) : '—'}</div></div>
      </div>
      {vaultIsEmpty ? (
        <div className="garden-fund-prompt" data-testid="empty-vault-prompt">
          <span>This sprout has no money in it yet. Planting created the vault — adding funds is a separate step.</span>
          {canParentAct ? (
            <button className="garden-pill garden-pill--dark" data-testid="prompt-fund" onClick={onOpenFund} disabled={!chainReady}>
              Add the first funds <ArrowUpRight size={15} />
            </button>
          ) : null}
        </div>
      ) : (
        <div className="garden-change">{changeText()}</div>
      )}
      {performance?.available && performance.withdrawnUsd !== '0' ? <p className="garden-performance-note">Taken out: {money(performance.withdrawnUsd, performance.feedDecimals)}</p> : null}
      {performance?.available ? <p className="garden-performance-note">{isSample ? 'Illustrative sample values.' : 'Settlement tokens are valued at $1. Network fees are not included.'}</p> : null}
      <span className="garden-value-label garden-chart-label">Portfolio value over time · includes deposits and withdrawals</span>
      {growth?.available ? (
        <GardenChart snapshots={growth.snapshots} period={period} feedDecimals={growth.snapshots[0]?.feedDecimals ?? 8} nowMs={chartNow} />
      ) : (
        <div className="garden-chart-empty">
          {isSample ? 'No sample history.' : vaultIsEmpty
            ? 'Nothing in this sprout yet — add funds and a value line starts from your first deposit.'
            : fundedNotInvested
            /* A funded vault with no snapshots yet used to render as a blank
               chart under a blank change figure, which reads as "the money is
               gone" rather than "nothing has been invested yet". Say where it
               actually is. */
            ? `Funded and waiting. ${fundedNotInvested} is in the vault, ready for the first investment — a return line appears once one has run.`
            : 'No verified valuation snapshots yet. Live returns are only shown when a real feed provides them.'}
        </div>
      )}
    </div>
  );

  const weeklyCard = (
    <div className={'garden-card garden-weekly' + (scheduled && automation?.enabled === false ? ' garden-weekly--automation-off' : '')}>
      <div className="garden-weekly-head">
        <button className="garden-weekly-title" onClick={() => setView('invest')} aria-label="Open weekly investing settings">
          <span className="garden-weekly-icon"><CalendarDays size={28} /></span>
          <span>
            <b>Weekly investing</b>
            <small>{isSample && sample ? sample.weeklySubtitle : 'A little each week can make a big difference.'}</small>
          </span>
        </button>
        <ChevronRight size={18} className="garden-weekly-chevron" />
      </div>
      {scheduled ? (
        <div className="garden-weekly-amount">
          <span className="garden-weekly-figure">
            ${formatUnits(BigInt(scheduled.amount), settlementDecimals, 2)}
            <span className="garden-weekly-unit"> / week</span>
          </span>
          <span className={'garden-chip ' + (automation?.enabled === false ? 'garden-chip--muted' : 'garden-chip--active')}>
            {automation?.enabled === false ? 'Automation off' : scheduled.status === 'active' ? 'Active' : scheduled.status}
          </span>
        </div>
      ) : (
        <div className="garden-weekly-amount">
          <span className="garden-weekly-figure">—<span className="garden-weekly-unit"> / week</span></span>
          <button className="garden-chip garden-chip--link" data-testid="schedule-open" onClick={onOpenSchedule} disabled={!canParentAct || !chainReady}>Set up</button>
        </div>
      )}
      {scheduled && automation?.enabled === false ? (
        <p className="garden-notice" data-testid="automation-unavailable">Automatic investments are temporarily unavailable. Your schedule is unchanged.</p>
      ) : null}
      <div className="garden-weekly-foot">
        <div className="garden-weekly-next">
          <small>Next contribution</small>
          <b>{isSample && sample?.weeklyNext ? sample.weeklyNext : scheduled ? niceDate(scheduled.nextRunAt * 1000) : 'Not scheduled'}</b>
        </div>
        {canParentAct ? (
          <button className="garden-pill garden-pill--dark" data-testid="fund-open" onClick={onOpenFund} disabled={!chainReady}>
            Add money
          </button>
        ) : null}
      </div>
    </div>
  );

  const choresCard = (
    <div className="garden-card garden-chores-preview">
      <div className="garden-card-head">
        <h2>Next up for {selected ? nameFor(selected.id) : 'them'}</h2>
        <button className="garden-see-all" onClick={() => setView('chores')}>See all</button>
      </div>
      {openChores.length === 0 ? (
        <p className="garden-empty-note">
          {canParentAct ? 'No chores yet. Add the first little job from Chores & rewards.' : 'No chores waiting right now.'}
        </p>
      ) : (
        openChores.slice(0, 2).map((m) => {
          const fixtureDone = isSample ? sample?.choreDone?.[m.id] ?? false : m.status === 'released';
          const done = toggledChores[m.id] ?? fixtureDone;
          return (
            <label className={'garden-chore-row' + (done ? ' garden-chore-row--done' : '')} key={m.id}>
              <input
                type="checkbox"
                className="garden-check"
                checked={done}
                aria-label={choreTitle(m)}
                onChange={() => {
                  if (isSample) setToggledChores((prev) => ({ ...prev, [m.id]: !done }));
                  else setView('chores');
                }}
              />
              <span className="garden-chore-title">{choreTitle(m)}</span>
              <span className="garden-chore-amount">
                {choreRewardText({ amount: m.amount, isSample, decimals: decimalsFor(m.token), symbol: symbolFor(m.token) })}
              </span>
            </label>
          );
        })
      )}
    </div>
  );

  const holdingsCard = (
    <div className="garden-card garden-holdings-card">
      <div className="garden-card-head">
        <h2>Top holdings</h2>
        <button className="garden-see-all" onClick={() => setView('portfolio')}>See all</button>
      </div>
      {holdingsRows}
    </div>
  );

  const activityCard = (
    <div className="garden-card garden-activity-card">
      <div className="garden-card-head">
        <h2>Recent activity</h2>
        <button className="garden-see-all" onClick={onOpenNotifications}>See all</button>
      </div>
      {activityRows.length === 0 ? (
        <p className="garden-empty-note">No activity indexed yet. On-chain history is still being read in — a sprout you just created can take a while to appear here. Nothing is lost; this list trails the chain.</p>
      ) : (
        activityRows.map((a, i) => (
          <div className="garden-activity-row" key={`${a.title}-${i}`}>
            <span className={'garden-activity-icon garden-activity-icon--' + a.kind}>
              {a.kind === 'gift' ? <Gift size={18} /> : a.kind === 'chore' ? <CheckCircle2 size={18} /> : <Leaf size={18} />}
            </span>
            <div className="garden-activity-copy">
              <b>{a.title}</b>
              <small>{a.sub}</small>
            </div>
            <div className="garden-activity-meta">
              <b>{a.amount}</b>
              <small>{a.date}</small>
            </div>
          </div>
        ))
      )}
    </div>
  );

  const beneficiaryStrip = isBeneficiary && (claimable.length > 0 || isGraduated) ? (
    <div className="garden-claim-strip">
      <span className="garden-claim-strip-label">Beneficiary actions</span>
      {claimable.map((a) => (
        <button key={a.token} data-testid={`claim-${symbolFor(a.token)}`} className="garden-pill garden-pill--dark" onClick={() => onClaim(a.token, BigInt(a.bucket))} disabled={!chainReady}>
          Claim {fmtTokenAmount(a.bucket, a.token)}
        </button>
      ))}
      {isGraduated ? (
        <button data-testid="withdraw-open" className="garden-pill" onClick={onOpenWithdraw} disabled={!chainReady}>Withdraw</button>
      ) : null}
    </div>
  ) : null;

  const overview = (
    <>
      {beneficiaryStrip}
      <div className="garden-grid garden-grid--upper">
        <div className="garden-grid-col">
          {portfolioCard}
        </div>
        <div className="garden-side-stack">
          {weeklyCard}
          {choresCard}
        </div>
      </div>
      <div className="garden-grid garden-grid--lower">
        {holdingsCard}
        {activityCard}
      </div>
    </>
  );

  const detail = (() => {
    if (!selected) return null;
    if (view === 'portfolio') {
      return (
        <div className="garden-detail">
          {portfolioCard}
          <div className="garden-card">
            <div className="garden-card-head"><h2>Their stock mix</h2></div>
            <p className="garden-empty-note">Your allocation determines how investments are divided.</p>
            {(selected.assets ?? []).map((a, i) => (
              <div className="garden-mix-row" key={a}>
                <b>{symbolFor(a)}</b>
                <div className="garden-progress"><span style={{ width: `${(selected.weights[i] ?? 0) / 100}%` }} /></div>
                <span>{(selected.weights[i] ?? 0) / 100}%</span>
              </div>
            ))}
            {canParentAct ? <button className="garden-pill" data-testid="allocation-open" onClick={onOpenAllocation} disabled={!chainReady}>Edit allocation <ArrowUpRight size={15} /></button> : <p className="garden-empty-note">Allocation editing is parent-only before graduation.</p>}
          </div>
          {holdingsCard}
          {activityCard}
        </div>
      );
    }
    if (view === 'invest') {
      return (
        <div className="garden-detail garden-detail--split">
          <div className="garden-card">
            <div className="garden-card-head">
              <h2>Your weekly plan</h2>
              <span className="garden-chip">{!automation?.enabled ? 'Automation unavailable' : activeJobs.length ? `${activeJobs.length} active` : previousJob ? 'Paused' : 'No plan'}</span>
            </div>
            {activeJobs.length ? activeJobs.map((j) => (
              <div className="garden-plan-row" key={j.id} data-testid="schedule-row">
                <div className="garden-plan-amount">
                  ${formatUnits(BigInt(j.amount), settlementDecimals, 2)}
                  <span className="garden-plan-cadence">/ {cadenceLabel(j.periodSeconds)}</span>
                </div>
                <div className="garden-plan-meta">
                  <div className="garden-plan-field">
                    <small>Next investment</small>
                    <b>{formatRunDateTime(j.nextRunAt)}</b>
                  </div>
                  <div className="garden-plan-field">
                    <small>Status</small>
                    <b data-testid="schedule-status">{j.status}</b>
                  </div>
                </div>
                {canParentAct ? (
                  <div className="garden-plan-actions">
                    <button data-testid="schedule-open" className="garden-pill garden-pill--dark" onClick={onOpenSchedule} disabled={!chainReady}>Edit plan</button>
                    <button data-testid="schedule-cancel" className="garden-pill" onClick={onCancelSchedule} disabled={!chainReady}>Pause plan</button>
                  </div>
                ) : null}
              </div>
            )) : (
              <div className="garden-plan-row garden-plan-row--idle">
                <div className="garden-plan-amount">
                  {previousJob ? `$${formatUnits(BigInt(previousJob.amount), settlementDecimals, 2)}` : '—'}
                  <span className="garden-plan-cadence">/ {previousJob ? cadenceLabel(previousJob.periodSeconds) : 'period'}</span>
                </div>
                <div className="garden-plan-meta">
                  <div className="garden-plan-field">
                    <small>Next investment</small>
                    <b>{previousJob ? 'Paused' : 'Not scheduled'}</b>
                  </div>
                  <div className="garden-plan-field">
                    <small>Status</small>
                    <b data-testid="schedule-status">{previousJob ? 'paused' : 'none'}</b>
                  </div>
                </div>
              </div>
            )}
            <p className="garden-plan-note">
              {previousJob && !activeJobs.length
                ? 'Your last plan is paused. Resuming signs it again with the same amount and period.'
                : 'At most one installment runs each period. If a run is missed, the next one catches up with a single purchase — never more.'}
            </p>
            {!automation?.enabled ? <p className="garden-notice" data-testid="automation-unavailable">Automatic investments are temporarily unavailable. Your schedule is unchanged.</p> : null}
            <details className="garden-how">
              <summary>How it works</summary>
              <p>Your plan is a recurring instruction on the vault. The service checks it each period and places one purchase; if it was offline, the next check places a single catch-up purchase. Quotes, funding and eligibility depend on the market feed connected to the vault.</p>
            </details>
            {canParentAct && !activeJobs.length ? (
              <button data-testid="schedule-open" className="garden-pill garden-pill--dark" onClick={onOpenSchedule} disabled={!chainReady}>
                {previousJob ? 'Resume weekly plan' : 'Set weekly plan'}
              </button>
            ) : null}
          </div>
          <div className="garden-card garden-plan-mix">
            <h2>Familiar names. Little pieces.</h2>
            <p className="garden-empty-note">Their starter mix, chosen by your family.</p>
            <div className="garden-mix-rows">
              {(selected.assets ?? []).map((a) => (
                <div className="garden-mix-stock" key={a}>
                  <span className="garden-mix-icon">{symbolFor(a)[0]?.toLowerCase()}</span>
                  <div><b>{symbolFor(a)}</b><small>Stock token</small></div>
                  <b className="garden-mix-weight">{(selected.weights[(selected.assets ?? []).indexOf(a)] ?? 0) / 100}%</b>
                </div>
              ))}
            </div>
            <p className="garden-mix-foot">Investments follow this mix. Purchases need available funds and a current market quote.</p>
          </div>
        </div>
      );
    }
    if (view === 'chores') {
      return (
        <div className="garden-detail">
          <div className="garden-stats">
            <div><small>Rewards open</small><b>{openChores.length}</b></div>
            <div><small>Released</small><b>{releasedChores.length}</b></div>
            <div><small>Claimable allowance</small><b>{claimable.length ? claimable.map((a) => fmtTokenAmount(a.bucket, a.token)).join(' · ') : '—'}</b></div>
          </div>
          <div className="garden-card">
            <div className="garden-card-head">
              <h2>{selected ? `${nameFor(selected.id)}’s little to-dos` : 'Little to-dos'}</h2>
              {canParentAct ? <button className="garden-pill garden-pill--dark" data-testid="milestone-open" onClick={onOpenMilestone} disabled={!chainReady}>Add a chore</button> : null}
            </div>
            {chores.length === 0 ? <p className="garden-empty-note">No chores yet. Add the first little job above.</p> : chores.map((m) => {
              const status = m.status;
              return (
                <div className={'garden-chores-row' + (status === 'released' ? ' garden-chores-row--done' : '')} key={m.id}>
                  <span className={'garden-chores-symbol' + (status === 'released' ? ' garden-chores-symbol--done' : '')}>
                    {status === 'released' ? <Check size={16} /> : <Leaf size={16} />}
                  </span>
                  <div className="garden-chores-copy">
                    <b>{choreTitle(m)}</b>
                    <small>{`${formatUnits(BigInt(m.amount), decimalsFor(m.token), 2)} ${symbolFor(m.token)} · ${status === 'created' ? 'waiting to approve' : status}`}</small>
                  </div>
                  <b className="garden-chores-amount">{formatUnits(BigInt(m.amount), decimalsFor(m.token), 2)}</b>
                  {canParentAct && status === 'created' ? (
                    <span className="garden-row-actions">
                      <button data-testid="milestone-release" className="garden-pill garden-pill--dark" onClick={() => onReleaseMilestone(m)} disabled={!chainReady}>Approve &amp; reward</button>
                      <button data-testid="milestone-cancel" className="garden-pill" onClick={() => onCancelMilestone(m)} disabled={!chainReady}>Cancel</button>
                    </span>
                  ) : null}
                  {isBeneficiary && BigInt((allowances.find((x) => x.token.toLowerCase() === m.token.toLowerCase())?.bucket) ?? '0') > 0n && status === 'released' ? (
                    <button className="garden-pill" onClick={() => onClaim(m.token, BigInt(allowances.find((x) => x.token.toLowerCase() === m.token.toLowerCase())?.bucket ?? '0'))} disabled={!chainReady}>Claim {symbolFor(m.token)}</button>
                  ) : null}
                </div>
              );
            })}
          </div>
          <div className="garden-info-band">
            Rewards are real. A parent approves a finished chore, the amount moves into the child’s allowance, and the child claims it. Nothing moves without those steps.
          </div>
        </div>
      );
    }
    if (view === 'gifts') {
      return (
        <div className="garden-detail">
          <div className="garden-gift-hero">
            <div>
              <span className="garden-eyebrow">From their people. For their future.</span>
              <h2>Less plastic. More possibility.</h2>
              <p>One shared savings pot. One simple link. Gifts add funds without granting any control.</p>
              {canParentAct ? <button className="garden-pill garden-pill--dark" data-testid="gift-open" onClick={onOpenGift} disabled={!chainReady}>Create a gift link</button> : null}
            </div>
            <img src="/art/card-lavender.png" alt="" aria-hidden />
          </div>
          <div className="garden-card">
            <div className="garden-card-head"><h2>Gift links</h2><span className="garden-muted">{gifts.length ? `${gifts.length} link${gifts.length === 1 ? '' : 's'}` : 'Private links'}</span></div>
            {gifts.length === 0 ? <p className="garden-empty-note">No gift links yet.</p> : (
              <ul className="garden-stack">
                {gifts.map((g) => (
                  <li key={g.id} className="garden-gift-row">
                    <span>{g.label ?? 'Gift link'}</span>
                    <code data-testid="gift-link">{`${window.location.origin}/gift/${g.id}`}</code>
                    <span className="garden-muted" data-testid="gift-count">{g.paymentCount} gift(s)</span>
                    <button data-testid="gift-pay" className="garden-pill" onClick={() => onOpenGiftPay(g)} disabled={!chainReady}>Pay</button>
                  </li>
                ))}
              </ul>
            )}
          </div>
          <div className="garden-card">
            <h2>Every little gift belongs.</h2>
            <p className="garden-empty-note">Even a small gift becomes part of their mix. Donor notes are not supported yet.</p>
            <a className="garden-pill" href="/gift">Preview the gift experience <ArrowUpRight size={15} /></a>
          </div>
        </div>
      );
    }
    // graduation
    return (
      <div className="garden-detail garden-detail--split">
        <div className="garden-card">
          <div className="garden-card-head"><h2>One irreversible handover.</h2><span className="garden-chip">{isGraduated ? 'Graduated' : `${Math.max(0, Math.min(100, Math.round(graduationProgress * 100)))}%`}</span></div>
          <p className="garden-empty-note">Parent powers stop at the fixed graduation timestamp; full control then moves to the beneficiary.</p>
          <div className="garden-ladder">
            {[
              { title: 'Watch & learn', text: 'Their own view of the portfolio.' },
              { title: 'Practice independence', text: 'Allowance spending within parent-set limits.' },
              { title: 'The handover', text: 'Full control of the vault.' },
            ].map((s, i) => (
              <div className="garden-ladder-step" key={s.title}>
                <span>{i + 1}</span>
                <div><b>{s.title}</b><small>{s.text}</small></div>
              </div>
            ))}
          </div>
          <div className="garden-review">
            <b>Graduation</b>
            <p>{selected ? new Date(selected.graduationTimestamp * 1000).toISOString().replace('T', ' ').slice(0, 16) : '—'} UTC</p>
            <p className="garden-empty-note">The graduation date is locked: it is fixed when the sprout is planted and cannot be changed.</p>
          </div>
        </div>
        <div className="garden-card">
          {isBeneficiary ? (
            <>
              <h2>Beneficiary controls</h2>
              {claimable.length ? claimable.map((a) => (
                <button key={a.token} data-testid={`claim-${symbolFor(a.token)}`} className="garden-pill garden-pill--dark" onClick={() => onClaim(a.token, BigInt(a.bucket))} disabled={!chainReady}>Claim {symbolFor(a.token)}</button>
              )) : <p className="garden-empty-note">No claimable allowance right now.</p>}
              {isGraduated ? <button data-testid="withdraw-open" className="garden-pill" onClick={onOpenWithdraw} disabled={!chainReady}>Withdraw balances</button> : <p className="garden-empty-note">Withdrawal unlocks after graduation.</p>}
            </>
          ) : (
            <><h2>Their future. Their keys.</h2><p className="garden-empty-note">Graduation hands full control to the child and is irreversible.</p></>
          )}
        </div>
      </div>
    );
  })();

  return (
    <div className={'garden' + (isSample ? ' garden--sample' : '') + (!selected && !loading ? ' garden--empty' : '')}>
      <aside className={'garden-sidebar' + (drawerOpen ? ' garden-sidebar--open' : '')}>
        <a className="garden-brand" href="/">
          <span className="garden-brand-mark"><img src="/brand/sprout-logo.png" alt="" /></span>
          <span>SPROUT</span>
        </a>
        <button className="garden-drawer-close" aria-label="Close menu" onClick={() => setDrawerOpen(false)}>×</button>
        <nav className="garden-nav" aria-label="Sections">
          {VIEWS.map((v) => (
            <button
              key={v.id}
              data-testid={`nav-${v.id}`}
              className={'garden-nav-link' + (view === v.id ? ' garden-nav-link--active' : '')}
              aria-current={view === v.id ? 'page' : undefined}
              onClick={() => { setView(v.id); setDrawerOpen(false); }}
            >
              <v.icon size={24} />
              <span>{v.label}</span>
            </button>
          ))}
        </nav>
        <div className="garden-nav-divider" aria-hidden />
        {!health?.localDemo ? <img className="garden-branch" src="/art/dashboard/sidebar-branch.png" alt="" aria-hidden /> : null}
        <div className="garden-side-foot">
          {health?.localDemo ? (
            <details className="garden-tools" data-testid="local-tools" open>
              <summary>Local demo tools</summary>
              {localWallet?.enabled ? (
                <>
                  <label>Role
                    <select data-testid="local-role" value={localRole} onChange={(e) => onLocalRole(e.target.value as 'parent')}>
                      <option value="parent">Parent</option><option value="beneficiary">Beneficiary</option><option value="gifter">Gifter</option>
                    </select>
                  </label>
                  <label>Account
                    <select data-testid="local-account" value={localAccount} onChange={(e) => onLocalAccount(e.target.value)}>
                      {localWallet.accounts.map((a) => <option key={a.address} value={a.address}>{a.label} · {short(a.address)}</option>)}
                    </select>
                  </label>
                  <label>Mock fund amount<input data-testid="fund-tool-amount" value={fundTool.amount} onChange={(e) => onFundTool({ ...fundTool, amount: e.target.value })} /></label>
                  <button className="garden-pill garden-pill--sm" data-testid="fund-tool" onClick={onRunToolFund}>Replenish mock funds</button>
                  <label>Advance seconds<input data-testid="advance-seconds" value={advanceSeconds} onChange={(e) => onAdvanceSeconds(e.target.value)} /></label>
                  <button className="garden-pill garden-pill--sm" data-testid="advance-time" onClick={onRunToolAdvance}>Advance local time</button>
                  {toolsMessage ? <p className="garden-tools-message" data-testid="tools-message">{toolsMessage}</p> : null}
                </>
              ) : null}
              <button className="garden-pill garden-pill--sm" data-testid="reconcile" onClick={onReconcile} disabled={!selectedId}>Reconcile chain</button>
              <button className="garden-pill garden-pill--sm" data-testid="run-jobs" onClick={onRunJobs} disabled={!selectedId}>Run due investments</button>
            </details>
          ) : null}
          {!isSample ? (
            <button className="garden-side-link" data-testid="plant-open" onClick={() => { setDrawerOpen(false); onOpenPlant(); }} disabled={!chainReady}><Plus size={22} />Plant a sprout</button>
          ) : null}
          {onOpenOnboarding ? <button className="garden-side-link" data-testid="onboarding-open" onClick={onOpenOnboarding}><SproutIcon size={22} />How SPROUT works</button> : null}
          <ResourcesMenu />
          <button className="garden-side-link" data-testid="settings-open" onClick={() => { setDrawerOpen(false); onOpenSettings(); }}><Settings size={22} />Family settings</button>
          <button className="garden-side-link" data-testid="help-open" onClick={() => { setDrawerOpen(false); (onOpenHelp ?? onOpenNotifications)(); }}><HelpCircle size={22} />Help</button>
        </div>
      </aside>

      <section className="garden-main">
        {topRow}
        {!selected ? (
          loading ? <div className="garden-empty-state garden-empty-state--loading"><p>Loading your little garden…</p></div> : (
            <div className="garden-empty-dashboard" data-testid="empty-dashboard">
              <div className="garden-empty-hero">
                <div className="garden-empty-copy">
                  <span className="garden-eyebrow">A fresh little beginning</span>
                  <h1>{needsWallet ? 'Connect to open their garden.' : 'Plant their first sprout.'}</h1>
                  <p>{needsWallet
                    ? 'Connect a wallet to see your sprouts, or plant the first one. Balances and permissions live on-chain; private names stay on this device.'
                    : 'A place for weekly investing, earned rewards and gifts from their people. Start with a name, then grow it together.'}</p>
                  <div className="garden-empty-actions">
                    {needsWallet ? (
                      <button className="garden-pill garden-pill--dark" data-testid="connect-injected" onClick={onConnect} disabled={connecting || !chain}>
                        {connecting ? 'Connecting…' : 'Connect wallet'}
                      </button>
                    ) : chainReady ? <button className="garden-pill garden-pill--dark" data-testid="empty-plant-open" onClick={onOpenPlant}>Plant a sprout <Plus size={15} /></button> : null}
                    {onOpenOnboarding ? <button className="garden-pill" data-testid="empty-onboarding-open" onClick={onOpenOnboarding}>See how it works</button> : null}
                  </div>
                  {needsWallet && localWallet?.enabled ? (
                    <div className="garden-local-entry" data-testid="local-entry">
                      <p className="garden-empty-note">Local demo mode signs with unlocked public Anvil accounts through a loopback-only proxy. No private keys reach the browser.</p>
                      <label>Role
                        <select data-testid="local-role" value={localRole} onChange={(e) => onLocalRole(e.target.value as 'parent')}>
                          <option value="parent">Parent</option><option value="beneficiary">Beneficiary</option><option value="gifter">Gifter</option>
                        </select>
                      </label>
                      <label>Account
                        <select data-testid="local-account" value={localAccount} onChange={(e) => { onLocalAccount(e.target.value); }}>
                          {localWallet.accounts.map((a) => <option key={a.address} value={a.address}>{a.label} · {short(a.address)}</option>)}
                        </select>
                      </label>
                      <button className="garden-pill garden-pill--dark" data-testid="use-local-wallet" onClick={() => onConnectLocal(localAccount)}>Use local demo wallet</button>
                    </div>
                  ) : null}
                </div>
                <BloomGarden theme={view} compact />
              </div>
              <div className="garden-empty-feature-grid" aria-label="Ways to grow a sprout">
                <div className="garden-empty-feature-card"><span><Repeat2 size={20} /></span><h2>Weekly investing</h2><p>Choose a rhythm that fits your family and adjust it whenever life changes.</p></div>
                <div className="garden-empty-feature-card"><span><Gift size={20} /></span><h2>Family gifts</h2><p>Give grandparents and friends a simple way to add a little love.</p></div>
                <div className="garden-empty-feature-card"><span><CheckCircle2 size={20} /></span><h2>Earned rewards</h2><p>Turn everyday jobs into visible milestones they can understand.</p></div>
              </div>
            </div>
          )
        ) : (
          <>
            {hero}
            <div className="garden-view-enter" key={`content-${view}-${selectedId ?? 'none'}`}>
              {view === 'overview' ? overview : detail}
            </div>
          </>
        )}
        {/* Content-level status covers both branches, so a failed connect or a
            write with no sprout selected is never silent. Suppressed while a
            modal is open because the dialog renders its own status line. */}
        {!anyModalOpen && <TxnStatusLine txn={txn} explorerUrl={chain?.explorerUrl} />}
      </section>
    </div>
  );
}
