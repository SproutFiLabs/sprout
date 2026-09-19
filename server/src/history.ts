import { formatUnits, type Address } from 'viem';
import type { SproutDb } from './db';
import { chainCache, getSettlementDecimals, type ChainContext } from './chain';
import { FOREVER_MS } from './readCache';
import { listChainEventRows } from './repo';

/**
 * A sprout's on-chain history as a spreadsheet: every deposit, gift, purchase
 * and reward, with the amount in whole units, what a purchase was paid with,
 * and the transaction to check it against. Parents asked for something they
 * can keep with their records; this is built only from indexed chain events.
 */

const COLUMNS = ['date_utc', 'event', 'asset', 'amount', 'paid_with', 'paid_amount', 'counterparty', 'details', 'block', 'tx_hash'] as const;
type Row = Partial<Record<(typeof COLUMNS)[number], string>>;

/** Events that carry no meaning for a family's records. */
const SKIPPED = new Set(['Initialized', 'SproutInitialized', 'VenueUpdated']);

const BLOCK_CONCURRENCY = 8;

/** Quote for CSV, and keep spreadsheet apps from reading a field as a formula. */
function csvField(value: string | undefined): string {
  let text = value ?? '';
  if (/^[=+@\t\r]/.test(text)) text = `'${text}`;
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

async function blockTimes(ctx: ChainContext, blocks: number[]): Promise<Map<number, number | null>> {
  const times = new Map<number, number | null>();
  const client = ctx.publicClient;
  if (!client) return times;
  const cache = chainCache(ctx);
  const queue = [...new Set(blocks)];
  const worker = async () => {
    for (let block = queue.shift(); block !== undefined; block = queue.shift()) {
      const n = block;
      try {
        // A mined block's timestamp never changes.
        const time = await cache.get(`block-time:${n}`, FOREVER_MS, async () =>
          Number((await client.getBlock({ blockNumber: BigInt(n) })).timestamp),
        );
        times.set(n, time);
      } catch {
        times.set(n, null);
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(BLOCK_CONCURRENCY, queue.length) }, worker));
  return times;
}

export async function historyCsv(ctx: ChainContext, db: SproutDb, vault: string): Promise<string> {
  const contracts = ctx.config.chain.contracts;
  const settlement = contracts.settlementToken?.toLowerCase();
  const settlementSymbol = contracts.settlementSymbol ?? 'SETTLEMENT';
  let settlementDecimals = ctx.config.settlementDecimals ?? 6;
  if (ctx.publicClient && ctx.config.chain.configured) {
    settlementDecimals = await getSettlementDecimals(ctx).catch(() => settlementDecimals);
  }

  const token = (address: unknown): { symbol: string; decimals: number } => {
    const a = String(address ?? '').toLowerCase();
    if (a === settlement) return { symbol: settlementSymbol, decimals: settlementDecimals };
    const stock = contracts.stockTokens.find((t) => t.address.toLowerCase() === a);
    return stock ? { symbol: stock.symbol, decimals: stock.decimals } : { symbol: a, decimals: 18 };
  };
  const amount = (address: unknown, raw: unknown): { asset: string; amount: string } => {
    const t = token(address);
    return { asset: t.symbol, amount: formatUnits(BigInt(String(raw ?? 0)), t.decimals) };
  };

  const events = listChainEventRows(db, vault).filter((e) => !SKIPPED.has(e.eventName));
  const times = await blockTimes(ctx, events.map((e) => e.blockNumber));

  const rows: Row[] = [];
  for (const e of events) {
    const p = (e.payload ?? {}) as Record<string, unknown>;
    let row: Row;
    switch (e.eventName) {
      case 'SproutCreated':
        row = { event: 'Planted', counterparty: String(p.parent ?? '') };
        break;
      case 'Funded':
        row = { event: 'Deposit', ...amount(p.token, p.amount), counterparty: String(p.from ?? '') };
        break;
      case 'GiftReceived':
        row = { event: 'Gift', ...amount(p.token, p.amount), counterparty: String(p.gifter ?? '') };
        break;
      case 'InvestmentExecuted': {
        const paid = amount(settlement, p.amountIn);
        row = { event: 'Purchase', ...amount(p.token, p.amountOut), paid_with: paid.asset, paid_amount: paid.amount };
        break;
      }
      case 'InvestmentScheduled':
        row = {
          event: 'Weekly plan set',
          ...amount(settlement, p.amount),
          details: `every ${Math.round(Number(p.period ?? 0) / 86400)} day(s)`,
        };
        break;
      case 'InvestmentCancelled':
        row = { event: 'Weekly plan paused' };
        break;
      case 'AllocationUpdated': {
        const assets = (p.assets as unknown[] | undefined) ?? [];
        const weights = (p.weights as unknown[] | undefined) ?? [];
        row = {
          event: 'Mix changed',
          details: assets.map((a, i) => `${token(a).symbol} ${Number(weights[i] ?? 0) / 100}%`).join(' / '),
        };
        break;
      }
      case 'MaxSlippageUpdated':
        row = { event: 'Price protection changed', details: `${Number(p.bps ?? 0) / 100}%` };
        break;
      case 'MilestoneCreated':
        row = { event: 'Chore reward set aside', ...amount(p.token, p.amount), details: String(p.id ?? '') };
        break;
      case 'MilestoneReleased':
        row = { event: 'Chore reward released', ...amount(p.token, p.amount), details: String(p.id ?? '') };
        break;
      case 'MilestoneCancelled':
        row = { event: 'Chore cancelled', details: String(p.id ?? '') };
        break;
      case 'AllowanceClaimed':
        row = { event: 'Allowance claimed', ...amount(p.token, p.amount) };
        break;
      case 'Withdrawn':
        row = { event: 'Withdrawal', ...amount(p.token, p.amount), counterparty: String(p.to ?? '') };
        break;
      default:
        row = { event: e.eventName };
    }
    const time = times.get(e.blockNumber);
    rows.push({
      ...row,
      date_utc: time ? new Date(time * 1000).toISOString().replace('.000Z', 'Z') : '',
      block: String(e.blockNumber),
      tx_hash: e.txHash,
    });
  }

  const lines = [COLUMNS.join(','), ...rows.map((r) => COLUMNS.map((c) => csvField(r[c])).join(','))];
  return `${lines.join('\r\n')}\r\n`;
}

export function historyFilename(vault: Address | string): string {
  return `sprout-${vault.slice(2, 8).toLowerCase()}-history.csv`;
}
