import { randomUUID } from 'node:crypto';
import { Hono, type Context } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { createPublicClient, decodeEventLog, erc20Abi, getAddress, http, parseUnits, type Address, type Hex } from 'viem';
import { z } from 'zod';
import { HARVEST_CHAIN_ID, HARVEST_TOKEN, HARVEST_RULES, allocateHarvest, type HarvestRound, type HarvestRegistration } from '@sprout/shared';
import { AuthError } from './auth';
import { createMutex } from './lock';
import type { SproutDb } from './db';

const address = z.string().regex(/^0x[\da-fA-F]{40}$/).transform(v => getAddress(v).toLowerCase());
const hash = z.string().regex(/^0x[\da-fA-F]{64}$/).transform(v => v.toLowerCase());
const fail = (message: string, status = 400): never => { throw new AuthError(message, status); };
const idSchema = z.string().uuid();
export interface HarvestRuntime {
  snapshot(): Promise<{number: bigint; hash: string}>;
  asset(token: string, funder: string): Promise<{symbol: string; decimals: number; balance: bigint}>;
  holding(round: HarvestRound, wallet: string): Promise<bigint>;
  holdingDecimals(): Promise<number>;
  verifyPayment(round: HarvestRound, registration: HarvestRegistration, tx: string, index: number): Promise<void>;
}
export function createHarvestRuntime(rpcUrl = process.env.SPROUT_HARVEST_RPC_URL || 'https://rpc.mainnet.chain.robinhood.com', clock:()=>number=Date.now): HarvestRuntime {
  const client = createPublicClient({transport: http(rpcUrl, {timeout: 15000, retryCount: 0})});
  const fresh = async () => {
    if (await client.getChainId() !== HARVEST_CHAIN_ID) fail('Payout network could not be verified.', 503);
    const latest = await client.getBlock({blockTag:'latest'});
    if (Math.abs(clock() / 1000 - Number(latest.timestamp)) > 300) fail('Payout network data is stale.', 503);
  };
  const finalized = async () => {
    await fresh();
    const block = await client.getBlock({blockTag:'finalized'});
    if (block.number === null || !block.hash) return fail('A finalized block is unavailable.', 503);
    return {number:block.number, hash:block.hash};
  };
  return {
    snapshot: finalized,
    async asset(token, funder) {
      await fresh();
      const [symbol, decimals, balance] = await Promise.all([
        client.readContract({address:token as Address,abi:erc20Abi,functionName:'symbol'}),
        client.readContract({address:token as Address,abi:erc20Abi,functionName:'decimals'}),
        client.readContract({address:token as Address,abi:erc20Abi,functionName:'balanceOf',args:[funder as Address]}),
      ]);
      if (decimals > 18 || !/^[a-zA-Z0-9 ._-]{1,20}$/.test(symbol)) fail('Unsupported payout token metadata.');
      return {symbol,decimals,balance};
    },
    async holdingDecimals() {
      await fresh();
      const decimals = await client.readContract({address:HARVEST_TOKEN,abi:erc20Abi,functionName:'decimals'});
      if (decimals > 18) fail('Unsupported SPROUT decimals.',503);
      return decimals;
    },
    async holding(round,wallet) {
      await fresh();
      const block = await client.getBlock({blockNumber:BigInt(round.snapshotBlock)});
      if (block.hash !== round.snapshotHash) fail('Snapshot no longer matches the canonical chain.',503);
      return client.readContract({address:HARVEST_TOKEN,abi:erc20Abi,functionName:'balanceOf',args:[wallet as Address],blockNumber:BigInt(round.snapshotBlock)});
    },
    async verifyPayment(round, registration, tx, index) {
      const tip = await finalized();
      const receipt = await client.getTransactionReceipt({hash:tx as Hex});
      const block = await client.getBlock({blockNumber:receipt.blockNumber});
      if (receipt.status !== 'success' || receipt.blockNumber > tip.number || receipt.blockHash !== block.hash) fail('Payment is not successful and finalized on the canonical chain.');
      if (!round.payoutAfterBlock || receipt.blockNumber <= BigInt(round.payoutAfterBlock)) fail('Payment predates allocation locking.');
      if (!round.lockedAt || Number(block.timestamp) * 1000 < round.lockedAt) fail('Payment predates allocation locking.');
      const log = receipt.logs.find(l => l.logIndex === index && l.address.toLowerCase() === round.token);
      if (!log) fail('No transfer from the configured payout token at that log index.');
      let transfer;
      try { transfer = decodeEventLog({abi:erc20Abi,eventName:'Transfer',data:log!.data,topics:log!.topics}); }
      catch { return fail('The selected log is not an ERC-20 transfer.'); }
      if (transfer.args.from.toLowerCase() !== round.funder || transfer.args.to.toLowerCase() !== registration.address || transfer.args.value !== BigInt(registration.amount!)) fail('Transfer sender, recipient or exact amount does not match the allocation.');
    },
  };
}
export function registerHarvestRoutes(app: Hono, deps: {
  db: SproutDb; runtime?: HarvestRuntime; now?: () => number;
  requireAuth: (c: Context,purpose:string) => Promise<string>;
  requireAdmin: (c: Context) => void;
}) {
  const {db} = deps, runtime = deps.runtime ?? createHarvestRuntime(), now = deps.now ?? Date.now;
  const serialize = createMutex();
  const getRound = (id: string) => {
    if (!idSchema.safeParse(id).success) return fail('Invalid round ID.');
    const row = db.query('SELECT data FROM harvest_rounds WHERE id=?').get(id) as {data:string}|null;
    if (!row) return fail('Round not found.',404);
    return JSON.parse(row.data) as HarvestRound;
  };
  const save = (round:HarvestRound) => db.query('INSERT INTO harvest_rounds(id,data) VALUES (?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data').run(round.id,JSON.stringify(round));
  const audit = (roundId:string, action:string, detail:string) => db.query('INSERT INTO harvest_audit(round_id,action,detail,created_at) VALUES (?,?,?,?)').run(roundId,action,detail,now());
  const registration = (row:Record<string,unknown>):HarvestRegistration => ({roundId:row.round_id as string,address:row.address as string,balance:row.balance as string,registeredAt:row.registered_at as number,amount:row.amount as string|null,txHash:row.tx_hash as string|null,logIndex:row.log_index as number|null,paidAt:row.paid_at as number|null});
  const withSubmission = (row:Record<string,unknown>):HarvestRegistration => {
    const value=registration(row);
    const pending=db.query('SELECT tx_hash,log_index FROM harvest_submissions WHERE round_id=? AND address=?').get(value.roundId,value.address) as {tx_hash:string;log_index:number}|null;
    return {...value,pendingTxHash:pending?.tx_hash??null,pendingLogIndex:pending?.log_index??null};
  };
  const registrations = (id:string) => (db.query('SELECT * FROM harvest_registrations WHERE round_id=? ORDER BY address').all(id) as Record<string,unknown>[]).map(withSubmission);
  const readBody = async <T extends z.ZodTypeAny>(c:Context,schema:T):Promise<z.infer<T>> => {
    let input:unknown; try { input = await c.req.json(); } catch { return fail('Invalid JSON.'); }
    const parsed=schema.safeParse(input); if (!parsed.success) return fail(parsed.error.issues.map(i=>`${i.path.join('.')}: ${i.message}`).join('; '));
    return parsed.data;
  };
  const chainRead = async <T>(work:()=>Promise<T>) => {
    try { return await work(); } catch(e) { if (e instanceof AuthError) throw e; return fail('Could not verify current chain data. Try again later.',503); }
  };
  app.use('/api/harvest/*',bodyLimit({maxSize:8192,onError:c=>c.json({error:'Request is too large.'},413)}));
  app.use('/api/harvest/admin/*',async(c,next)=>{ deps.requireAdmin(c); await next(); });
  app.get('/api/harvest/admin/status',c=>c.json({authorized:true}));
  app.get('/api/harvest',c=> {
    const rounds=(db.query('SELECT data FROM harvest_rounds ORDER BY rowid DESC LIMIT 100').all() as {data:string}[]).map(r=>JSON.parse(r.data) as HarvestRound);
    return c.json({chainId:HARVEST_CHAIN_ID,token:HARVEST_TOKEN,rules:HARVEST_RULES,rounds,mode:'manual',serverTime:now()});
  });
  app.get('/api/harvest/account/:address',c=> {
    const parsed=address.safeParse(c.req.param('address')); if(!parsed.success) return c.json({error:'Invalid wallet.'},400);
    return c.json({registrations:(db.query('SELECT * FROM harvest_registrations WHERE address=? ORDER BY registered_at DESC').all(parsed.data) as Record<string,unknown>[]).map(withSubmission)});
  });
  app.post('/api/harvest/rounds/:id/register',async c=> {
    const round=getRound(c.req.param('id'));
    if(round.state!=='open'||now()>=round.closesAt) return fail('Registration is closed.',409);
    const wallet=(await deps.requireAuth(c,`harvest:${round.id}`)).toLowerCase();
    if (db.query('SELECT 1 FROM harvest_registrations WHERE round_id=? AND address=?').get(round.id,wallet)) return c.json({registered:true});
    const balance=await chainRead(()=>runtime.holding(round,wallet));
    if(balance<BigInt(round.minHolding)) return fail('This wallet held fewer than 1,000,000 SPROUT at the snapshot.',403);
    await serialize(async()=> {
      const current=getRound(round.id);
      if(current.state!=='open'||now()>=current.closesAt) return fail('Registration closed while the balance was being checked.',409);
      const count=db.query('SELECT COUNT(*) AS n FROM harvest_registrations WHERE round_id=?').get(round.id) as {n:number};
      if(count.n>=10000) return fail('This round has reached its registration capacity.',409);
      db.query('INSERT OR IGNORE INTO harvest_registrations(round_id,address,balance,registered_at) VALUES (?,?,?,?)').run(round.id,wallet,balance.toString(),now());
    });
    return c.json({registered:true});
  });
  app.get('/api/harvest/admin/rounds/:id',c=> {const round=getRound(c.req.param('id'));return c.json({round,registrations:registrations(round.id)});});
  app.post('/api/harvest/admin/rounds',async c=> {
    const input=await readBody(c,z.object({title:z.string().trim().min(3).max(80),token:address,funder:address,budget:z.string().regex(/^\d{1,30}(\.\d{1,18})?$/),closesAt:z.number().int().positive()}));
    if(input.funder==='0x0000000000000000000000000000000000000000') return fail('A treasury wallet is required.');
    if(input.closesAt < now()+3600000 || input.closesAt>now()+30*86400000) return fail('Set a registration deadline between one hour and 30 days from now.');
    const [snapshot,asset,holdingDecimals]=await chainRead(()=>Promise.all([runtime.snapshot(),runtime.asset(input.token,input.funder),runtime.holdingDecimals()]));
    if((input.budget.split('.')[1]?.length??0)>asset.decimals) return fail('Budget has more decimal places than the payout token.');
    const budget=parseUnits(input.budget,asset.decimals);
    if(budget<=0n||budget>=2n**256n||asset.balance<budget) return fail('Treasury balance must cover the positive round budget.');
    const round:HarvestRound={id:randomUUID(),title:input.title,state:'open',chainId:HARVEST_CHAIN_ID,token:input.token,symbol:asset.symbol,decimals:asset.decimals,funder:input.funder,budget:budget.toString(),snapshotBlock:snapshot.number.toString(),snapshotHash:snapshot.hash,holdingDecimals,minHolding:(1000000n*10n**BigInt(holdingDecimals)).toString(),closesAt:input.closesAt,createdAt:now()};
    await serialize(async()=>db.transaction(()=>{
      const existing=(db.query('SELECT data FROM harvest_rounds').all() as {data:string}[]).map(r=>JSON.parse(r.data) as HarvestRound);
      const outstanding=existing.filter(r=>r.token===round.token&&r.funder===round.funder&&r.state!=='cancelled').reduce((sum,r)=>sum+(r.state==='open'?BigInt(r.budget):registrations(r.id).filter(v=>!v.txHash).reduce((n,v)=>n+BigInt(v.amount??'0'),0n)),0n);
      if(asset.balance<budget+outstanding) return fail('Treasury balance must also cover its existing unpaid round budgets.',409);
      save(round);audit(round.id,'created',JSON.stringify(round));
    })());
    return c.json({round},201);
  });
  app.post('/api/harvest/admin/rounds/:id/lock',async c=> {
    const round=getRound(c.req.param('id'));
    if(round.state!=='open'||now()<round.closesAt) return fail('Allocations can be locked only after registration closes.',409);
    const [block,asset]=await chainRead(()=>Promise.all([runtime.snapshot(),runtime.asset(round.token,round.funder)]));
    if(asset.balance<BigInt(round.budget)) return fail('Treasury no longer covers the round budget.',409);
    await serialize(async()=>db.transaction(()=>{
      const current=getRound(round.id);if(current.state!=='open') return fail('Round is already locked or cancelled.',409);
      const allocation=allocateHarvest(BigInt(current.budget),registrations(current.id));
      for(const item of allocation.allocations) db.query('UPDATE harvest_registrations SET amount=? WHERE round_id=? AND address=?').run(item.amount.toString(),current.id,item.address);
      save({...current,state:'locked',lockedAt:now(),payoutAfterBlock:block.number.toString(),allocated:allocation.allocated.toString(),remainder:allocation.remainder.toString()});
      audit(current.id,'locked',allocation.allocated.toString());
    })());
    return c.json({round:getRound(round.id),registrations:registrations(round.id)});
  });
  app.post('/api/harvest/admin/rounds/:id/cancel',async c=> {
    const round=getRound(c.req.param('id'));
    await serialize(async()=>db.transaction(()=>{ const current=getRound(round.id); if(current.state!=='open') return fail('Only an unlocked round can be cancelled.',409);save({...current,state:'cancelled'});audit(current.id,'cancelled','Cancelled before allocation.');})());
    return c.json({round:getRound(round.id)});
  });
  app.get('/api/harvest/admin/rounds/:id/export',c=> {
    const round=getRound(c.req.param('id'));if(round.state!=='locked') return fail('Lock allocations before exporting.',409);
    const rows=registrations(round.id).filter(r=>r.amount&&BigInt(r.amount)>0n&&!r.txHash&&!r.pendingTxHash);
    c.header('Content-Disposition',`attachment; filename="harvest-${round.id}.csv"`);c.header('Content-Type','text/csv');
    return c.body('round_id,chain_id,token,treasury,recipient,amount_base_units,decimals\n'+rows.map(r=>[round.id,round.chainId,round.token,round.funder,r.address,r.amount,round.decimals].join(',')).join('\n'));
  });
  app.post('/api/harvest/admin/rounds/:id/payment',async c=> {
    const round=getRound(c.req.param('id'));
    const input=await readBody(c,z.object({address,txHash:hash,logIndex:z.number().int().min(0)}));
    const row=registrations(round.id).find(r=>r.address===input.address);
    if(round.state!=='locked'||!row?.amount||BigInt(row.amount)<=0n) return fail('No payable allocation for this wallet.',409);
    if(row.txHash) return fail('This allocation is already marked paid.',409);
    await serialize(async()=>db.transaction(()=>{
      const pending=db.query('SELECT tx_hash,log_index FROM harvest_submissions WHERE round_id=? AND address=?').get(round.id,input.address) as {tx_hash:string;log_index:number}|null;
      if(pending&&(pending.tx_hash!==input.txHash||pending.log_index!==input.logIndex)) return fail('Clear the previous submitted transfer before changing it.',409);
      const used=db.query('SELECT round_id,address FROM harvest_submissions WHERE tx_hash=? AND log_index=?').get(input.txHash,input.logIndex) as {round_id:string;address:string}|null;
      if(used&&(used.round_id!==round.id||used.address!==input.address)) return fail('This transfer is already submitted for another allocation.',409);
      if(db.query('SELECT 1 FROM harvest_registrations WHERE tx_hash=? AND log_index=?').get(input.txHash,input.logIndex)) return fail('This transfer was already used.',409);
      db.query('INSERT OR IGNORE INTO harvest_submissions(round_id,address,tx_hash,log_index) VALUES (?,?,?,?)').run(round.id,input.address,input.txHash,input.logIndex);
      audit(round.id,'submitted',JSON.stringify(input));
    })());
    await chainRead(()=>runtime.verifyPayment(round,row,input.txHash,input.logIndex));
    await serialize(async()=>db.transaction(()=>{
      const current=registrations(round.id).find(r=>r.address===input.address);
      if(current?.txHash) return fail('This allocation is already marked paid.',409);
      if(current?.pendingTxHash!==input.txHash||current.pendingLogIndex!==input.logIndex) return fail('Submission changed during verification. Retry the current transfer.',409);
      if(db.query('SELECT 1 FROM harvest_registrations WHERE tx_hash=? AND log_index=?').get(input.txHash,input.logIndex)) return fail('This transfer has already been used as payment.',409);
      db.query('UPDATE harvest_registrations SET tx_hash=?,log_index=?,paid_at=? WHERE round_id=? AND address=?').run(input.txHash,input.logIndex,now(),round.id,input.address);
      db.query('DELETE FROM harvest_submissions WHERE round_id=? AND address=?').run(round.id,input.address);
      audit(round.id,'payment',JSON.stringify(input));
    })());
    return c.json({verified:true});
  });
  app.post('/api/harvest/admin/rounds/:id/clear-submission',async c=> {
    const round=getRound(c.req.param('id')),input=await readBody(c,z.object({address,reason:z.string().trim().min(10).max(300)}));
    await serialize(async()=>db.transaction(()=>{
      if(registrations(round.id).find(r=>r.address===input.address)?.txHash) return fail('A verified payment cannot be cleared.',409);
      db.query('DELETE FROM harvest_submissions WHERE round_id=? AND address=?').run(round.id,input.address);
      audit(round.id,'submission-cleared',JSON.stringify(input));
    })());
    return c.json({cleared:true});
  });
}
