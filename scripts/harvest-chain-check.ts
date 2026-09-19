/** Local-only integration check. Never connects to a public RPC or real wallet. */
import { homedir } from 'node:os';
import { createPublicClient, createWalletClient, erc20Abi, http } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { HARVEST_TOKEN, type HarvestRound, type HarvestRegistration } from '@sprout/shared';
import { createHarvestRuntime } from '../server/src/harvest';
import { account as recipient, otherAccount as treasury, testimonialChain, memoryDb } from '../server/test/helpers';
import { createApp } from '../server/src/app';
import { issueNonce } from '../server/src/auth';

const rpc='http://127.0.0.1:18467';
const anvilProcess=Bun.spawn([Bun.env.ANVIL_BIN ?? `${homedir()}/.foundry/bin/anvil`,'--host','127.0.0.1','--port','18467','--chain-id','4663','--silent'],{stdout:'ignore',stderr:'pipe'});
const publicClient=createPublicClient({transport:http(rpc,{retryCount:0}),pollingInterval:50});
const genesis=privateKeyToAccount('0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80');
const writer=createWalletClient({account:genesis,transport:http(rpc)});
const rpcCall=async(method:string,params:unknown[]=[])=>{const res=await fetch(rpc,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:1,method,params})});const json=await res.json();if(json.error)throw new Error(json.error.message);return json.result;};
const assert=(condition:unknown,message:string)=>{if(!condition)throw new Error(message);};
const reject=async(work:()=>Promise<unknown>,label:string)=>{let rejected=false;try{await work();}catch{rejected=true;}assert(rejected,label);};
const db=memoryDb();
try {
  for(let i=0;i<60;i++){try{if(await publicClient.getChainId()===4663)break;}catch{}await Bun.sleep(100);}
  assert(await publicClient.getChainId()===4663,'Expected isolated local chain');
  const artifact=await Bun.file(new URL('../contracts/out/MockERC20.sol/MockERC20.json',import.meta.url)).json();
  const hash=await writer.deployContract({abi:artifact.abi,bytecode:artifact.bytecode.object,args:['Harvest local test dollar','TEST',6],chain:null});
  const deployed=await publicClient.waitForTransactionReceipt({hash});const payout=deployed.contractAddress!;
  const code=await publicClient.getCode({address:payout});
  await rpcCall('anvil_setCode',[HARVEST_TOKEN,code]);
  await writer.writeContract({address:HARVEST_TOKEN,abi:artifact.abi,functionName:'mint',args:[recipient.address,2000000n*10n**6n],chain:null});
  await writer.writeContract({address:payout,abi:artifact.abi,functionName:'mint',args:[treasury.address,1000n*10n**6n],chain:null});
  await rpcCall('anvil_mine',['0x50']);
  let now=Date.now();const runtime=createHarvestRuntime(rpc,()=>now);
  const app=createApp({db,chain:testimonialChain(),localDemo:false,adminToken:'local-test',harvest:runtime,now:()=>now});
  const admin=async(path:string,body:unknown)=>{const res=await app.request('/api/harvest/admin/'+path,{method:'POST',headers:{'x-sprout-admin-token':'local-test','content-type':'application/json'},body:JSON.stringify(body)});const result=await res.json();assert(res.ok,JSON.stringify(result));return result;};
  const {round}=await admin('rounds',{title:'Local chain test',token:payout,funder:treasury.address,budget:'100',closesAt:now+3600001}) as {round:HarvestRound};
  assert(await runtime.holding(round,recipient.address)===2000000n*10n**6n,'Snapshot balance mismatch');
  const nonce=issueNonce(db,{address:recipient.address,purpose:`harvest:${round.id}`,now});
  const registered=await app.request(`/api/harvest/rounds/${round.id}/register`,{method:'POST',headers:{'x-sprout-address':recipient.address,'x-sprout-nonce':nonce.nonce,'x-sprout-signature':await recipient.signMessage({message:nonce.message})}});
  assert(registered.ok,'Registration failed');
  now+=3600002;await rpcCall('evm_setNextBlockTimestamp',[Math.ceil(now/1000)+1]);await rpcCall('evm_mine');
  const locked=await admin(`rounds/${round.id}/lock`,{}) as {round:HarvestRound;registrations:HarvestRegistration[]};
  const row=locked.registrations[0]!;assert(row.amount==='100000000','Allocation mismatch');
  const sender=createWalletClient({account:treasury,transport:http(rpc)});
  await rpcCall('evm_setNextBlockTimestamp',[Math.ceil(now/1000)+2]);
  const payment=await sender.writeContract({address:payout,abi:erc20Abi,functionName:'transfer',args:[recipient.address,BigInt(row.amount!)],chain:null});
  const receipt=await publicClient.waitForTransactionReceipt({hash:payment});const index=receipt.logs[0]!.logIndex;
  await rpcCall('anvil_mine',['0x50']);
  await runtime.verifyPayment(locked.round,row,payment,index);
  await reject(()=>runtime.verifyPayment(locked.round,{...row,amount:'1'},payment,index),'Wrong amount accepted');
  await reject(()=>runtime.verifyPayment(locked.round,{...row,address:treasury.address.toLowerCase()},payment,index),'Wrong recipient accepted');
  await reject(()=>runtime.verifyPayment({...locked.round,token:HARVEST_TOKEN},row,payment,index),'Wrong token accepted');
  await reject(()=>runtime.verifyPayment({...locked.round,funder:recipient.address.toLowerCase()},row,payment,index),'Wrong sender accepted');
  await reject(()=>runtime.verifyPayment({...locked.round,payoutAfterBlock:receipt.blockNumber.toString()},row,payment,index),'Old transfer accepted');
  await reject(()=>runtime.verifyPayment(locked.round,row,payment,index+1),'Wrong log accepted');
  await admin(`rounds/${round.id}/payment`,{address:recipient.address,txHash:payment,logIndex:index});
  const records=await (await app.request(`/api/harvest/account/${recipient.address}`)).json();assert(records.registrations[0].txHash===payment,'Verified payment missing');
  assert(await publicClient.readContract({address:payout,abi:erc20Abi,functionName:'balanceOf',args:[recipient.address]})===100000000n,'Recipient did not receive local test funds');
  console.log('PASS: local ERC-20 funding, fixed snapshot registration, allocation, manual transfer and verified receipt. Wrong sender, recipient, token, amount, old block and log rejected. No public transactions sent.');
} finally {db.close();anvilProcess.kill();await anvilProcess.exited;}
