import { useMemo, useState } from 'react';
import { DashboardShell, type ViewId } from './DashboardShell';
import {
  EMMA, HOLDINGS, JOB, MILESTONES, NAMES, SAMPLE, SAMPLE_NOW, SETTLEMENT, SPROUTS, buildGrowth, sampleHealth,
} from './sampleData';

/**
 * Fully local sample preview for /dashboard/preview.
 *
 * This module has NO wallet, API, RPC or storage dependency: it only builds
 * plain fixture objects (see ./sampleData) and renders the exact same
 * presentational components as the live dashboard. Nothing here can mutate
 * live storage or trigger wallet calls, and sample values are never used in
 * live mode (DashboardShell only reads them when mode === 'sample').
 */
export function Preview({ displayName = 'Emma', onRestartTour }: { displayName?: string; onRestartTour?: () => void } = {}) {
  const [view, setView] = useState<ViewId>('overview');
  const [selectedId, setSelectedId] = useState<string>(EMMA);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const growth = useMemo(buildGrowth, []);
  const selected = SPROUTS.find((s) => s.id.toLowerCase() === selectedId.toLowerCase()) ?? SPROUTS[0]!;

  const live = (what: string) => setNotice(`${what} is sample-only in this preview. Connect a real wallet on the live dashboard to use it with your vault.`);

  return (
    <div className="garden-root" data-testid="sample-preview">
      <DashboardShell
        mode="sample"
        sample={SAMPLE}
        nowMs={SAMPLE_NOW * 1000}
        health={sampleHealth()}
        chain={null}
        wallet={null}
        connecting={false}
        localWallet={null}
        localRole="parent"
        localAccount=""
        toolsMessage={null}
        fundTool={{ token: '', amount: '0' }}
        advanceSeconds="0"
        onFundTool={() => undefined}
        onAdvanceSeconds={() => undefined}
        onConnect={() => undefined}
        onConnectLocal={() => undefined}
        onLocalRole={() => undefined}
        onLocalAccount={() => undefined}
        sprouts={SPROUTS}
        selectedId={selectedId}
        onSelect={setSelectedId}
        getNickname={(id) => id.toLowerCase() === EMMA.toLowerCase() ? displayName : (NAMES[id.toLowerCase()] ?? 'Sprout')}
        selected={selected}
        automation={sampleHealth().automation}
        milestones={MILESTONES}
        jobs={[JOB]}
        gifts={[]}
        holdings={HOLDINGS}
        growth={growth}
        events={[]}
        beneficiaryState={null}
        isParent
        isBeneficiary={false}
        isGraduated={false}
        graduationProgress={0.18}
        balanceChange={{ delta: '+$340.28', pct: 15.9 }}
        chainReady
        loading={false}
        txn={null}
        view={view}
        setView={setView}
        drawerOpen={drawerOpen}
        setDrawerOpen={setDrawerOpen}
        onOpenPlant={() => live('Planting a sprout')}
        onOpenFund={() => live('Adding money')}
        onOpenSchedule={() => live('Editing the weekly plan')}
        onOpenGift={() => live('Creating a gift link')}
        onOpenGiftPay={() => live('Paying a gift')}
        anyModalOpen={notice !== null}
        onOpenAllocation={() => live('Editing the allocation')}
        onOpenWithdraw={() => live('Withdrawing')}
        onOpenChore={() => live('Adding a chore')}
        onOpenMilestone={() => live('Adding a chore')}
        onCancelSchedule={() => live('Cancelling the weekly plan')}
        onReleaseMilestone={() => live('Approving a reward')}
        onCancelMilestone={() => live('Cancelling a chore')}
        onClaim={() => live('Claiming an allowance')}
        onOpenSettings={() => setNotice('Settings are simplified in this sample preview.')}
        onOpenNotifications={() => setNotice('Activity is sample data here. The live dashboard shows real indexed on-chain events.')}
        onOpenOnboarding={onRestartTour}
        onOpenHelp={() => setNotice('This is a local sample preview of the approved garden design. Open /dashboard to use a real wallet.')}
        onOpenAsset={() => setNotice('Asset details are sample data in this preview.')}
        onRunToolFund={() => undefined}
        onRunToolAdvance={() => undefined}
        onReconcile={() => undefined}
        onRunJobs={() => undefined}
        symbolFor={(a) => {
          if (a.toLowerCase() === SETTLEMENT.toLowerCase()) return 'Settlement';
          return HOLDINGS.holdings.find((h) => h.address.toLowerCase() === a.toLowerCase())?.symbol ?? a.slice(-4).toUpperCase();
        }}
        decimalsFor={() => 6}
      />
      {notice ? (
        <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label="Sample preview">
          <div className="modal">
            <div className="modal-head">
              <h2>Sample preview</h2>
              <button className="btn btn--small" data-testid="sample-modal-close" onClick={() => setNotice(null)}>Close</button>
            </div>
            <p className="muted">{notice}</p>
            <a className="garden-pill garden-pill--dark" href="/dashboard" data-testid="sample-modal-live">Go to live dashboard</a>
          </div>
        </div>
      ) : null}
    </div>
  );
}
