import { randomBytes } from 'node:crypto';
import { rmSync } from 'node:fs';
import { join } from 'node:path';
import type { Address, WalletClient } from 'viem';
import { erc20Abi } from 'viem';
import { sproutFactoryAbi, sproutVaultAbi } from '@sprout/shared';
import { createServer } from '../server/src/index';
import { loadServerConfig } from '../server/src/config';
import {
  ANVIL_KEYS,
  ROOT,
  accountClient,
  beneficiaryAccount,
  gifterAccount,
  getJson,
  parentAccount,
  post,
  rpcClients,
  signedPost,
  waitForRpc,
} from './lib';
import { deployLocal } from './deploy-local';

// Isolated from any running preview (RPC 18545) so the gate never touches it.
const RPC_PORT = 28546;
const rpcUrl = `http://127.0.0.1:${RPC_PORT}`;

const failures: string[] = [];
function check(name: string, condition: boolean, detail?: unknown): void {
  if (condition) console.log(`  PASS  ${name}`);
  else {
    failures.push(name);
    console.error(`  FAIL  ${name}`, detail ?? '');
  }
}

async function main(): Promise<void> {
  const anvil = Bun.spawn(['anvil', '--port', String(RPC_PORT), '--chain-id', '31337', '--silent'], {
    stdout: 'ignore',
    stderr: 'ignore',
  });

  let server: ReturnType<typeof createServer> | null = null;
  try {
    await waitForRpc(rpcUrl);
    console.log('anvil ready');

    const { publicClient, walletClient } = rpcClients(rpcUrl);
    const deployment = await deployLocal(publicClient, walletClient, rpcUrl);
    console.log('contracts deployed', deployment.factory);

    const dbPath = join(ROOT, 'tmp', 'e2e-smoke.sqlite');
    for (const suffix of ['', '-wal', '-shm']) rmSync(dbPath + suffix, { force: true });

    const config = loadServerConfig({
      SPROUT_CHAIN_ID: '31337',
      SPROUT_RPC_URL: rpcUrl,
      SPROUT_FACTORY_ADDRESS: deployment.factory,
      SPROUT_SETTLEMENT_TOKEN: deployment.settlement,
      SPROUT_VENUE_ADDRESS: deployment.venue,
      SPROUT_STOCK_TOKENS:
        `AAA:${deployment.stockA}:18:1000000000000000000:${deployment.feedA}:86400,` +
        `BBB:${deployment.stockB}:18:1000000000000000000:${deployment.feedB}:86400`,
      SPROUT_SETTLEMENT_DECIMALS: '6',
      SPROUT_LOCAL_DEMO: '1',
      SPROUT_USE_LOCAL_KEYS: '1',
      SPROUT_KEEPER_PRIVATE_KEY: ANVIL_KEYS[0],
      // Isolated local test budgets (never used live).
      SPROUT_KEEPER_MAX_FEE_PER_GAS_WEI: '5000000000',
      SPROUT_KEEPER_MAX_PRIORITY_FEE_PER_GAS_WEI: '2000000000',
      SPROUT_KEEPER_GAS_LIMIT_CAP: '6000000',
      SPROUT_KEEPER_DAILY_FEE_BUDGET_WEI: '100000000000000000',
      SPROUT_PUBLIC_WALLET_RPC_URL: rpcUrl,
      SPROUT_DB_PATH: dbPath,
      SPROUT_PORT: '0',
    });
    server = createServer(config);
    const base = `http://127.0.0.1:${server.httpPort}`;
    console.log('service ready', base);

    const parentClient = accountClient(rpcUrl, parentAccount);
    const beneficiaryClient = accountClient(rpcUrl, beneficiaryAccount);
    const gifterClient = accountClient(rpcUrl, gifterAccount);

    const send = async (client: WalletClient, request: Record<string, unknown>, label: string): Promise<`0x${string}`> => {
      const hash = (await client.writeContract({ ...request } as never)) as `0x${string}`;
      const receipt = await publicClient.waitForTransactionReceipt({ hash });
      if (receipt.status !== 'success') throw new Error(`${label} reverted`);
      return hash;
    };
    const reconcile = () => post(base, '/api/index/reconcile', {});

    // 1. Plant
    const graduation = BigInt(Math.floor(Date.now() / 1000) + 300);
    const plantHash = await send(
      parentClient,
      {
        address: deployment.factory,
        abi: sproutFactoryAbi,
        functionName: 'createSprout',
        args: [
          beneficiaryAccount.address,
          deployment.settlement,
          [deployment.stockA, deployment.stockB],
          [6000, 4000],
          graduation,
          [deployment.venue],
        ],
      },
      'createSprout',
    );
    await signedPost(base, '/api/sprouts', parentAccount, 'plant', { txHash: plantHash });
    const list = await getJson<{ sprouts: Array<{ id: Address; beneficiary: Address; graduationTimestamp: number }> }>(
      base,
      `/api/sprouts?parent=${parentAccount.address}`,
    );
    const vault = list.sprouts[0]?.id;
    check('plant persists sprout', list.sprouts.length === 1 && !!vault, list);
    if (!vault) throw new Error('no sprout planted');

    // 2. Fund
    const fundAmount = 10_000n * 10n ** 6n;
    await send(parentClient, { address: deployment.settlement, abi: erc20Abi, functionName: 'approve', args: [vault, fundAmount] }, 'approve fund');
    await send(parentClient, { address: vault, abi: sproutVaultAbi, functionName: 'fund', args: [deployment.settlement, fundAmount] }, 'fund');
    await reconcile();
    const afterFund = await getJson<{ holdings: Array<{ kind: string; rawBalance: string }> }>(base, `/api/sprouts/${vault}/holdings`);
    check('fund deposits settlement on-chain', afterFund.holdings.find((h) => h.kind === 'settlement')?.rawBalance === fundAmount.toString(), afterFund.holdings);

    // 3. Schedule + keeper execution through the Uniswap V3 adapter
    const scheduleHash = await send(
      parentClient,
      {
        address: vault,
        abi: sproutVaultAbi,
        functionName: 'scheduleInvestment',
        args: [10_000_000n, 604_800n, BigInt(Math.floor(Date.now() / 1000))],
      },
      'scheduleInvestment',
    );
    await signedPost(base, `/api/sprouts/${vault}/schedule`, parentAccount, 'schedule', { txHash: scheduleHash });
    await reconcile();
    const withJob = await getJson<{ jobs: Array<{ status: string }> }>(base, `/api/sprouts/${vault}`);
    check('schedule persists an active job', withJob.jobs.some((j) => j.status === 'active'), withJob.jobs);

    // Cancel is authoritative: an old schedule receipt must not reactivate it.
    const cancelHash = await send(parentClient, { address: vault, abi: sproutVaultAbi, functionName: 'cancelInvestment', args: [] }, 'cancelInvestment');
    await signedPost(base, `/api/sprouts/${vault}/schedule/cancel`, parentAccount, 'cancel-schedule', { txHash: cancelHash });
    await reconcile();
    const cancelledJobs = await getJson<{ jobs: Array<{ status: string }> }>(base, `/api/sprouts/${vault}`);
    check('cancel marks the job cancelled', !cancelledJobs.jobs.some((j) => j.status === 'active'), cancelledJobs.jobs);
    let staleRejected = false;
    try {
      await signedPost(base, `/api/sprouts/${vault}/schedule`, parentAccount, 'schedule', { txHash: scheduleHash });
    } catch (error) {
      staleRejected = String(error).includes('409');
    }
    check('old schedule receipt cannot reactivate a cancelled schedule', staleRejected);

    // Re-schedule for real, then execute.
    const rescheduleHash = await send(
      parentClient,
      {
        address: vault,
        abi: sproutVaultAbi,
        functionName: 'scheduleInvestment',
        args: [10_000_000n, 604_800n, BigInt(Math.floor(Date.now() / 1000))],
      },
      'scheduleInvestment2',
    );
    await signedPost(base, `/api/sprouts/${vault}/schedule`, parentAccount, 'schedule', { txHash: rescheduleHash });
    await reconcile();

    const jobRun = await post<{ results: Array<{ status: string; txHash?: string; error?: string }> }>(base, '/api/jobs/run', {});
    check('keeper executes a due investment via the adapter', jobRun.results.some((r) => r.status === 'executed'), jobRun.results);
    await reconcile();
    const afterInvest = await getJson<{ holdings: Array<{ symbol: string; rawBalance: string }> }>(base, `/api/sprouts/${vault}/holdings`);
    const stockHolding = afterInvest.holdings.find((h) => h.symbol === 'AAA');
    check('adapter bought stock tokens', !!stockHolding && BigInt(stockHolding.rawBalance) > 0n, stockHolding);
    const residualAllowance = (await publicClient.readContract({
      address: deployment.settlement,
      abi: erc20Abi,
      functionName: 'allowance',
      args: [vault, deployment.venue],
    })) as bigint;
    check('no residual venue allowance remains', residualAllowance === 0n, residualAllowance);

    // 4. Gift link + payment indexed independently of any client callback
    const gift = await signedPost<{ gift: { id: string } }>(base, '/api/gifts', parentAccount, 'gift-create', {
      vaultId: vault,
      label: 'Birthday',
      acceptedAssets: [deployment.settlement],
    });
    const giftId = gift.gift.id;
    await send(gifterClient, { address: deployment.settlement, abi: erc20Abi, functionName: 'approve', args: [vault, 5_000_000n] }, 'gift approve');
    const giftHash = await send(
      gifterClient,
      { address: vault, abi: sproutVaultAbi, functionName: 'payGift', args: [deployment.settlement, 5_000_000n, giftId] },
      'payGift',
    );
    // No /api/gifts/:id/payments call here: the indexer must recover it alone.
    await reconcile();
    const giftView = await getJson<{ paymentCount: number; totals: Record<string, string> }>(base, `/api/gifts/${giftId}`);
    check('gift payment indexed without a browser callback', giftView.paymentCount === 1, giftView);
    const totalKey = Object.keys(giftView.totals).find((k) => k.toLowerCase() === deployment.settlement.toLowerCase());
    check('gift total matches on-chain amount', !!totalKey && giftView.totals[totalKey] === '5000000', giftView.totals);

    // The client callback remains idempotent on the same chain log.
    const duplicate = await signedPost<{ accepted: boolean; duplicate: boolean }>(
      base,
      `/api/gifts/${giftId}/payments`,
      gifterAccount,
      'gift-pay',
      { txHash: giftHash },
    );
    check('repeated gift callback cannot duplicate a payment', duplicate.duplicate === true, duplicate);
    const giftAfter = await getJson<{ paymentCount: number }>(base, `/api/gifts/${giftId}`);
    check('gift payment count stays at one', giftAfter.paymentCount === 1, giftAfter);

    // 5. Milestone derived from receipt, released, allowance claimed
    const milestoneId = `0x${randomBytes(32).toString('hex')}` as `0x${string}`;
    const milestoneAmount = 100_000_000n;
    const msHash = await send(
      parentClient,
      { address: vault, abi: sproutVaultAbi, functionName: 'createMilestone', args: [milestoneId, deployment.settlement, milestoneAmount, 0n] },
      'createMilestone',
    );
    // Client sends only the id and txHash; token/amount come from the event.
    await signedPost(base, `/api/sprouts/${vault}/milestones`, parentAccount, 'milestone-create', { milestoneId, txHash: msHash });
    const milestonesAfterCreate = await getJson<{ milestones: Array<{ id: string; token: string; amount: string; status: string }> }>(
      base,
      `/api/sprouts/${vault}/milestones`,
    );
    check(
      'milestone fields derived from the receipt',
      milestonesAfterCreate.milestones[0]?.amount === milestoneAmount.toString() &&
        milestonesAfterCreate.milestones[0]?.token.toLowerCase() === deployment.settlement.toLowerCase(),
      milestonesAfterCreate.milestones,
    );
    const releaseHash = await send(
      parentClient,
      { address: vault, abi: sproutVaultAbi, functionName: 'releaseMilestone', args: [milestoneId] },
      'releaseMilestone',
    );
    await signedPost(base, `/api/sprouts/${vault}/milestones/${milestoneId}/release`, parentAccount, 'milestone-release', {
      txHash: releaseHash,
    });
    const beforeClaim = (await publicClient.readContract({
      address: deployment.settlement,
      abi: erc20Abi,
      functionName: 'balanceOf',
      args: [beneficiaryAccount.address],
    })) as bigint;
    await send(
      beneficiaryClient,
      { address: vault, abi: sproutVaultAbi, functionName: 'claimAllowance', args: [deployment.settlement, milestoneAmount] },
      'claimAllowance',
    );
    await reconcile();
    const milestones = await getJson<{ milestones: Array<{ status: string }> }>(base, `/api/sprouts/${vault}/milestones`);
    check('milestone released and indexed', milestones.milestones[0]?.status === 'released', milestones.milestones);
    const afterClaim = (await publicClient.readContract({
      address: deployment.settlement,
      abi: erc20Abi,
      functionName: 'balanceOf',
      args: [beneficiaryAccount.address],
    })) as bigint;
    check('allowance increased beneficiary balance', afterClaim - beforeClaim === milestoneAmount, { beforeClaim, afterClaim });

    // Beneficiary can discover the vault they are entitled to.
    const beneficiaryList = await getJson<{ sprouts: Array<{ id: string; role: string }> }>(
      base,
      `/api/sprouts?beneficiary=${beneficiaryAccount.address}`,
    );
    check('beneficiary sees the sprout', beneficiaryList.sprouts.some((s) => s.id.toLowerCase() === vault.toLowerCase()), beneficiaryList.sprouts);
    const beneficiaryState = await getJson<{ allowances: Array<{ bucket: string }> }>(base, `/api/sprouts/${vault}/beneficiary`);
    check('beneficiary allowance state is readable', beneficiaryState.allowances.length > 0, beneficiaryState);

    // 6. Graduation
    await publicClient.request({ method: 'evm_increaseTime', params: [400] } as never);
    await publicClient.request({ method: 'evm_mine', params: [] } as never);
    const vaultBalance = (await publicClient.readContract({
      address: deployment.settlement,
      abi: erc20Abi,
      functionName: 'balanceOf',
      args: [vault],
    })) as bigint;
    const withdrawHash = await send(
      beneficiaryClient,
      { address: vault, abi: sproutVaultAbi, functionName: 'withdraw', args: [deployment.settlement, vaultBalance, beneficiaryAccount.address] },
      'withdraw',
    );
    check('beneficiary withdrew after graduation', withdrawHash.startsWith('0x'));
    await reconcile();
    const finalList = await getJson<{ sprouts: Array<{ graduated: boolean }> }>(base, `/api/sprouts?parent=${parentAccount.address}`);
    check('sprout reports graduated', finalList.sprouts[0]?.graduated === true, finalList.sprouts);

    // 7. Persisted service status
    const growth = await getJson<{ available: boolean; snapshots: unknown[] }>(base, `/api/sprouts/${vault}/growth`);
    check('growth snapshots persisted or explicitly unavailable', growth.available ? growth.snapshots.length > 0 : true, growth);
    const events = await getJson<{ events: unknown[] }>(base, `/api/sprouts/${vault}/events`);
    check('chain events indexed with unique keys', events.events.length >= 5, events.events.length);

    console.log('\n----- e2e smoke summary -----');
    console.log(`chainId=${config.chain.chainId} vault=${vault}`);
    console.log(`anvil pid=${anvil.pid} db=${dbPath}`);
  } finally {
    if (server) await server.stop();
    anvil.kill();
    await anvil.exited;
  }

  if (failures.length > 0) {
    console.error(`\n${failures.length} check(s) failed: ${failures.join(', ')}`);
    process.exit(1);
  }
  console.log('\nSMOKE TEST PASSED');
}

await main();
