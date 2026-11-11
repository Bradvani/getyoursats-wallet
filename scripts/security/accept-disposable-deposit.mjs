/** Genuine public-regtest cooperative withdrawal + mature deposit. Never real funds. */
import {chromium} from '@playwright/test';
import {mkdir,readFile,writeFile,access} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import assert from 'node:assert/strict';
const origin=process.env.GYS_ACCEPTANCE_ORIGIN||'http://127.0.0.1:5175';
assert.match(origin,/^http:\/\/127\.0\.0\.1:\d+$/);
const profiles=process.env.GYS_ACCEPTANCE_PROFILE_ROOT;
assert(profiles&&profiles.endsWith('/profiles'),'Explicit retained disposable profile directory is required');
const output=process.env.GYS_ACCEPTANCE_EVIDENCE_DIR||'/tmp/gys-deposit-acceptance';
await mkdir(output,{recursive:true});
const report={schema:1,sourceCommit:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),network:'regtest',realFunds:false,
 fixtureApprovals:true,fullProductAcceptance:false,physicalDevice:false,result:'BLOCKED',steps:[],startedAt:new Date().toISOString(),
 sdk:JSON.parse(await readFile('vendor/getyoursats-sdk-build.json','utf8')),files:{}};
for(const f of ['scripts/security/accept-disposable-deposit.mjs','e2e/fixtures/disposable-wallet-acceptance.ts','src/security/depositClaimController.ts','src/security/depositClaimAuthorization.ts','src/security/depositClaimJournal.ts','src/security/operationGateway.ts'])report.files[f]=createHash('sha256').update(await readFile(f)).digest('hex');
const small=process.env.GYS_ACCEPTANCE_SMALL_FRESH_DEPOSIT==='1';
const amount=small?500:5000,feeCap=small?2000:3000,senderStart=small?2520n:9950n,receiverStart=small?0n:50n,speed=small?'slow':'fast';
report.scenario=small?'fresh-500-sat-deposit':'original-5000-sat-deposit';
const contexts=[],pages=[];
const deadline=setTimeout(()=>{for(const c of contexts)void c.close();},300000);
async function checkpoint(step){await writeFile(output+'/progress.json',JSON.stringify({step,at:new Date().toISOString()}));}
async function connect(index,allowCreate=false){
 const ctx=await chromium.launchPersistentContext(profiles+'/wallet-'+index,{headless:true,serviceWorkers:'block',...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH?{executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH}:{})});contexts.push(ctx);
 const page=ctx.pages()[0]||await ctx.newPage();pages.push(page);await page.goto(origin+'/e2e/fixtures/disposable-wallet-acceptance.html?network=regtest');
 await page.waitForFunction(()=>typeof window.gysDisposableAcceptance?.connect==='function');
 const resume=allowCreate?await page.evaluate(()=>localStorage.length!==0):true;
 const wallet=await page.evaluate(resume=>window.gysDisposableAcceptance.connect(resume),resume);return {page,wallet};
}
async function chain(path){const r=await fetch('https://regtest-mempool.us-west-2.sparkinfra.net/api/'+path,{signal:AbortSignal.timeout(15000)});if(!r.ok)throw Error('Regtest chain query failed: '+r.status);return r.json();}
async function approval(page,operation,arg){
 const pending=page.evaluate(({operation,arg})=>window.gysDisposableAcceptance[operation](arg),{operation,arg}).then(result=>({result}),error=>({error}));
 const ready=await Promise.race([pending.then(done=>({done})),page.waitForFunction(()=>window.gysDisposableAcceptance.approval()!==null,undefined,{timeout:30000}).then(()=>({approval:true}))]);
 if('done' in ready){if(ready.done.error)throw ready.done.error;throw Error('Operation skipped required approval');}
 const r=await page.evaluate(()=>window.gysDisposableAcceptance.approval());assert.equal(r.intent.Network,'regtest');
 report.steps.push({step:'fixture-approval',operation,intent:r.intent});await page.evaluate(id=>window.gysDisposableAcceptance.approve(id),r.id);
 const done=await pending;if(done.error)throw done.error;return done.result;
}
try{
 await checkpoint('connect-retained-wallets');const a=await connect(0),b=await connect(small?2:1,small);
 assert.notEqual(a.wallet.identity,b.wallet.identity);
 const resumePath=process.env.GYS_ACCEPTANCE_RESUME_RECEIPT;
 let prior,priorBytes;
 if(resumePath){priorBytes=await readFile(resumePath);prior=JSON.parse(priorBytes);assert.equal(prior.network,'regtest');assert.equal(prior.realFunds,false);assert.equal(prior.fullProductAcceptance,false);assert(prior.withdrawal&&prior.funding);report.resumedReceiptSha256=createHash('sha256').update(priorBytes).digest('hex');}
 await a.page.evaluate(()=>window.gysDisposableAcceptance.reconcile());
 const before=await a.page.evaluate(()=>window.gysDisposableAcceptance.status());
 let address,quote;
 if(prior){
  const preflight=prior.steps.find(s=>s.step==='withdrawal-preflight');assert(preflight);
  assert.equal(a.wallet.identity,preflight.sender.identity);assert.equal(b.wallet.identity,preflight.receiver.identity);
  address=await b.page.evaluate(()=>window.gysDisposableAcceptance.depositAddress());assert.equal(address.address,preflight.address.address);
  assert.equal(prior.withdrawal.amount,String(amount));assert(BigInt(prior.withdrawal.fee)<=BigInt(feeCap));assert.equal(prior.funding.value,amount);
  assert(before.outgoing.some(o=>o.paymentId===prior.withdrawal.id&&o.route==='bitcoin'&&o.amountSats===String(amount)));
  report.steps.push({...preflight,step:'withdrawal-preflight',resumed:true});
 }else{
  assert(before.outgoing.every(o=>o.state==='completed'),'Prior outgoing operation unresolved');
  assert.equal(before.outgoing.length,small?2:1,'This sequence requires the original direct-Spark sender, with no subsequent send');
  assert.equal(a.wallet.balance,String(senderStart));assert.equal(b.wallet.balance,String(receiverStart));
  address=await b.page.evaluate(()=>window.gysDisposableAcceptance.depositAddress());assert.match(address.address,/^bcrt1/);
  assert.equal((await chain('address/'+address.address+'/utxo')).length,0,'Deposit address already funded');
  quote=await a.page.evaluate(({address,amount})=>window.gysDisposableAcceptance.bitcoinQuote(address,amount),{address:address.address,amount});
  report.steps.push({step:'withdrawal-preflight',sender:a.wallet,receiver:b.wallet,address,quote});
  assert.equal(quote.isEstimate,false,'Provider did not return an executable quote');
  const q=speed==='slow'?quote.speedSlow:quote.speedFast,withdrawalFee=q.userFeeSat+q.l1BroadcastFeeSat;
  assert(Number.isSafeInteger(withdrawalFee)&&withdrawalFee>=0&&withdrawalFee<=feeCap,'Withdrawal fee exceeds disposable budget');
 }
 if(process.env.GYS_ACCEPTANCE_EXECUTE!=='1')report.result='READY_FOR_DISPOSABLE_WITHDRAWAL';
 else{
  let sent;
  if(prior){sent=prior.withdrawal;report.withdrawal=sent;}
  else{
   const marker=output+'/withdrawal-attempt.json';let exists=true;try{await access(marker);}catch(e){if(e.code==='ENOENT')exists=false;else throw e;}
   assert(!exists,'Withdrawal already attempted; reconcile without submitting again');
   await writeFile(marker,JSON.stringify({address:address.address,amount,maxFeeSats:feeCap,speed,at:new Date().toISOString()}),{flag:'wx'});
   await checkpoint('withdraw-regtest-sats');
   sent=await approval(a.page,'bitcoinSend',{address:address.address,amount,maxFeeSats:feeCap,speed});report.withdrawal=sent;
  }
  assert(BigInt(sent.fee)<=BigInt(feeCap));assert.equal(sent.amount,String(amount));
  let utxo;
  await checkpoint('wait-for-bitcoin-confirmation');
  for(let i=0;i<60;i++){
   const candidates=(await chain('address/'+address.address+'/utxo')).filter(u=>u.value===amount&&u.status.confirmed&&(!prior||(u.txid===prior.funding.txid&&u.vout===prior.funding.vout)));
   if(candidates.length===1){utxo=candidates[0];break;}assert(candidates.length<=1,'Ambiguous deposit funding');await a.page.waitForTimeout(2000);
  }
  assert(utxo,'Bitcoin payout did not confirm');report.funding=utxo;
  const tx=await chain('tx/'+utxo.txid);assert.equal(tx.vout[utxo.vout].scriptpubkey_address,address.address);assert.equal(tx.vout[utxo.vout].value,amount);
  let debit;
  await checkpoint('reconcile-confirmed-withdrawal');
  for(let i=0;i<20;i++){
   await a.page.evaluate(()=>window.gysDisposableAcceptance.reconcile());debit=await a.page.evaluate(()=>window.gysDisposableAcceptance.status());
   if(debit.outgoing.some(o=>o.paymentId===sent.id&&o.state==='completed'))break;
   await a.page.waitForTimeout(2000);
  }
  report.withdrawalState=debit;
  assert.equal(debit.balance,(senderStart-BigInt(amount)-BigInt(sent.fee)).toString());
  assert(debit.payments.some(p=>p.id===sent.id&&p.txId===utxo.txid),'Payout transaction is not linked to the approved withdrawal');
  assert(debit.outgoing.some(o=>o.paymentId===sent.id&&o.state==='completed'));
  report.steps.push({step:'cooperative-bitcoin-exit',result:'PASS',sent,txid:utxo.txid,sender:debit});
  await checkpoint('quote-mature-deposit');const depositQuote=await b.page.evaluate(u=>window.gysDisposableAcceptance.depositQuote(u.txid,u.vout),utxo);
  assert.equal(depositQuote.amountSats,amount);assert.equal(depositQuote.mature.isEstimate,false);assert(depositQuote.confirmations>=1);
  const fee=depositQuote.mature.feeSats;assert(Number.isSafeInteger(fee)&&fee>=0&&fee<=Math.floor(amount/2));report.depositQuote=depositQuote;
  assert.equal((await b.page.evaluate(()=>window.gysDisposableAcceptance.depositRecords())).length,0,'A deposit was already attempted; observe it without claiming again');
  await checkpoint('claim-mature-deposit');
  try{await approval(b.page,'depositClaim',{txid:utxo.txid,vout:utxo.vout,maxFee:{onchain:{type:'fixed',amount:fee}}});}
  catch(e){report.claimInitialError=String(e.message).slice(0,1500);}
  let state,records;
  for(let i=0;i<20;i++){
   records=await b.page.evaluate(()=>window.gysDisposableAcceptance.depositReconcile());state=await b.page.evaluate(()=>window.gysDisposableAcceptance.status());
   if(records.some(r=>r.intent.txid===utxo.txid&&r.intent.vout===utxo.vout&&r.state==='settled'))break;
   await b.page.waitForTimeout(2000);
  }
  report.depositState=state;report.depositRecords=records;
  const record=records.find(r=>r.intent.txid===utxo.txid&&r.intent.vout===utxo.vout);assert.equal(record?.state,'settled');
  const payment=state.payments.find(p=>p.id===record.paymentId);assert(payment&&payment.type==='receive'&&payment.method==='deposit'&&payment.status==='completed');
  assert.equal(BigInt(payment.amount)+BigInt(payment.fee),BigInt(amount));assert(BigInt(payment.fee)<=BigInt(fee));
  assert.equal(state.balance,(receiverStart+BigInt(payment.amount)).toString());
  await b.page.evaluate(()=>window.gysDisposableAcceptance.stop());await b.page.reload();await b.page.waitForFunction(()=>typeof window.gysDisposableAcceptance?.connect==='function');
  const restored=await b.page.evaluate(()=>window.gysDisposableAcceptance.connect(true));assert.equal(restored.identity,b.wallet.identity);assert.equal(restored.balance,state.balance);
  report.steps.push({step:'mature-deposit-and-restart',result:'PASS',payment,restored});report.result='PASS_COOPERATIVE_EXIT_AND_MATURE_DEPOSIT_ONLY';
 }
}catch(e){
 report.error=String(e.message).slice(0,2000);process.exitCode=2;
 report.failureObservations=[];
 for(const page of pages){try{report.failureObservations.push(await page.evaluate(async()=>({wallet:await window.gysDisposableAcceptance.status(),deposits:await window.gysDisposableAcceptance.depositRecords()})));}catch(error){report.failureObservations.push({unavailable:String(error.message).slice(0,300)});}}
}
finally{
 clearTimeout(deadline);for(const c of contexts)await c.close();report.finishedAt=new Date().toISOString();
 report.doNotFundReportedAddresses=true;
 await writeFile(output+'/receipt-'+Date.now()+'.json',JSON.stringify(report,null,2)+'\n');
 await writeFile(output+'/latest.json',JSON.stringify(report,null,2)+'\n');
 console.log(JSON.stringify({result:report.result,error:report.error,steps:report.steps.map(s=>({step:s.step,result:s.result}))}));
}
