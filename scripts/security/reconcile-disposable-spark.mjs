/** Continue a recorded disposable-regtest transfer without submitting it again. */
import {chromium} from '@playwright/test';
import {readFile,writeFile,mkdir,access} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import assert from 'node:assert/strict';
const origin=process.env.GYS_ACCEPTANCE_ORIGIN;
const profiles=process.env.GYS_ACCEPTANCE_PROFILE_ROOT;
const priorPath=process.env.GYS_ACCEPTANCE_PRIOR_REPORT;
const output=process.env.GYS_ACCEPTANCE_EVIDENCE_DIR;
assert.match(origin??'',/^http:\/\/127\.0\.0\.1:\d+$/);
assert(profiles?.endsWith('/profiles')&&priorPath&&output,'Explicit disposable profiles, prior receipt and evidence directory required');
const priorBytes=await readFile(priorPath),prior=JSON.parse(priorBytes);
assert.equal(prior.network,'regtest');assert.equal(prior.realFunds,false);assert.equal(prior.fullProductAcceptance,false);
const wallets=prior.steps.find(s=>s.step==='two-real-disposable-wallets')?.wallets;
const funding=prior.steps.find(s=>s.step==='faucet-funding-and-explicit-claim')?.state;
assert(wallets?.length===2&&funding,'A positively funded two-wallet receipt is required');
const initial=BigInt(funding.balance);assert(initial>=200n&&initial<=10000n);
const original=prior.failureObservations?.[0]?.outgoing;
assert.equal(original?.length,1,'Require exactly one original outgoing operation');
const first=original[0];
const commitment=identity=>createHash('sha256').update('spark\0'+identity.toLowerCase()).digest('hex');
function exactOperation(row,amount,recipient){
 assert.equal(row.network,'regtest');assert.equal(row.route,'spark');assert.equal(row.amountSats,String(amount));
 assert.equal(row.feeLimitSats,'0');assert.equal(row.recipientHash,commitment(recipient));
 assert.equal(row.operationId,row.paymentId);assert.match(row.paymentId,/^[0-9a-f-]{36}$/);
 return row;
}
exactOperation(first,100,wallets[1].identity);
const sdk=JSON.parse(await readFile('vendor/getyoursats-sdk-build.json','utf8'));
assert.equal(prior.sdk.packageSha256,sdk.packageSha256,'Reconcile on the exact recorded SDK artifact');
await mkdir(output,{recursive:true});
const report={schema:1,network:'regtest',realFunds:false,userSecrets:false,fixtureApprovals:true,physicalDevice:false,fullProductAcceptance:false,
 sourceCommit:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),
 sourceDirty:execFileSync('git',['status','--porcelain','--untracked-files=no'],{encoding:'utf8'}).trim()!=='',
 priorReceiptSha256:createHash('sha256').update(priorBytes).digest('hex'),sdk,
 fixtureSha256:createHash('sha256').update(await readFile('e2e/fixtures/disposable-wallet-acceptance.ts')).digest('hex'),
 scriptSha256:createHash('sha256').update(await readFile(new URL(import.meta.url))).digest('hex'),
 originalOperationId:first.paymentId,originalSendResubmitted:false,steps:[],result:'BLOCKED',settlementVerified:false,startedAt:new Date().toISOString()};
const contexts=[],pages=[];
const deadline=setTimeout(()=>{for(const c of contexts)void c.close();},240000);
async function connect(index){
 const ctx=await chromium.launchPersistentContext(profiles+'/wallet-'+index,{headless:true,serviceWorkers:'block',executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH});contexts.push(ctx);
 const page=ctx.pages()[0]||await ctx.newPage();pages.push(page);
 await page.goto(origin+'/e2e/fixtures/disposable-wallet-acceptance.html?network=regtest');
 await page.waitForFunction(()=>typeof window.gysDisposableAcceptance?.connect==='function');
 const restored=await page.evaluate(()=>window.gysDisposableAcceptance.connect(true));
 assert.equal(restored.identity,wallets[index].identity);assert.equal(restored.address,wallets[index].address);return page;
}
async function state(page){return page.evaluate(()=>window.gysDisposableAcceptance.status());}
async function reconcile(page){await page.evaluate(()=>window.gysDisposableAcceptance.reconcile());return state(page);}
async function approve(page,operation,arg){
 const pending=page.evaluate(({operation,arg})=>operation==='send'?window.gysDisposableAcceptance.send(arg.address,arg.amount):window.gysDisposableAcceptance.claim(arg),{operation,arg}).then(result=>({result}),error=>({error}));
 const ready=await Promise.race([pending.then(done=>({done})),page.waitForFunction(()=>window.gysDisposableAcceptance.approval()!==null,undefined,{timeout:20000}).then(()=>({approval:true}))]);
 if(ready.done){if(ready.done.error)throw ready.done.error;throw Error('Operation completed without approval');}
 const request=await page.evaluate(()=>window.gysDisposableAcceptance.approval());assert.equal(request.intent.Network,'regtest');
 await page.evaluate(id=>window.gysDisposableAcceptance.approve(id),request.id);
 const done=await pending;if(done.error)throw done.error;return done.result;
}
function receipt(s,id,amount,type){return s.payments.some(p=>p.id===id&&p.amount===String(amount)&&p.fee==='0'&&p.status==='completed'&&p.type===type);}
async function receiveExact(page,id,amount){
 let s=await reconcile(page);
 if(!receipt(s,id,amount,'receive')&&!s.incoming.some(r=>r.paymentId===id)){
  const candidates=await page.evaluate(()=>window.gysDisposableAcceptance.discover());
  const p=candidates.find(p=>p.id===id);assert(p,'The exact incoming transfer is not available');assert.equal(p.amount,String(amount));assert.equal(p.fee,'0');
  try{await approve(page,'claim',id);}catch(error){report.steps.push({step:'claim-awaits-reconciliation',id,error:String(error.message).slice(0,500)});}
 }
 for(let n=0;n<20;n++){
  s=await reconcile(page);
  if(receipt(s,id,amount,'receive')&&s.incoming.some(r=>r.paymentId===id&&r.state==='settled'))return s;
  await page.waitForTimeout(1500);
 }
 throw Error('Exact incoming receipt remains unresolved; do not repeat the claim');
}
async function settleSender(page,id,amount,balance){
 for(let n=0;n<20;n++){
  const s=await reconcile(page);
  if(s.balance===String(balance)&&receipt(s,id,amount,'send')&&s.outgoing.some(r=>r.paymentId===id&&r.state==='completed'))return s;
  await page.waitForTimeout(1500);
 }
 throw Error('Sender operation remains unresolved; do not resubmit');
}
try{
 const a=await connect(0),b=await connect(1);
 const aBefore=await state(a),bBefore=await state(b);
 assert.equal(aBefore.outgoing.length,1);assert.equal(aBefore.outgoing[0].paymentId,first.paymentId);
 exactOperation(aBefore.outgoing[0],100,wallets[1].identity);
 assert(bBefore.outgoing.length<=1,'Unexpected additional receiver operations');
 const received=await receiveExact(b,first.paymentId,100);
 const debited=await settleSender(a,first.paymentId,100,initial-100n);
 report.steps.push({step:'original-direct-spark-settlement',result:'PASS',id:first.paymentId,sender:debited,receiver:received});
 await b.evaluate(()=>window.gysDisposableAcceptance.stop());await b.reload();await b.waitForFunction(()=>typeof window.gysDisposableAcceptance?.connect==='function');
 const restored=await b.evaluate(()=>window.gysDisposableAcceptance.connect(true));assert.equal(restored.identity,wallets[1].identity);
 assert.equal(restored.balance,bBefore.outgoing.length?'50':'100');
 report.steps.push({step:'same-profile-restart',result:'PASS',restored});
 let bState=await state(b),returned;
 if(bState.outgoing.length===0){
  const marker=output+'/return-transfer-attempt.json';
  try{await access(marker);throw Error('Return was previously attempted without a recoverable journal; do not repeat');}catch(e){if(e.code!=='ENOENT')throw e;}
  await writeFile(marker,JSON.stringify({amountSats:50,recipientCommitment:commitment(wallets[0].identity),createdAt:new Date().toISOString()}),{flag:'wx'});
  try{returned=await approve(b,'send',{address:wallets[0].address,amount:50});}
  catch(error){assert.match(String(error),/UncertainPaymentError/);report.returnPending=true;}
  bState=await state(b);
 }
 assert.equal(bState.outgoing.length,1);
 const row=exactOperation(bState.outgoing[0],50,wallets[0].identity);
 if(returned)assert.equal(returned.id,row.paymentId);
 const back=await receiveExact(a,row.paymentId,50);assert.equal(back.balance,String(initial-50n));
 const residual=await settleSender(b,row.paymentId,50,50n);
 report.steps.push({step:'return-direct-spark-settlement',result:'PASS',id:row.paymentId,sender:residual,receiver:back});
 report.result='PASS_DIRECT_SPARK_RECONCILIATION_AND_RETURN_ONLY';report.settlementVerified=true;
}catch(error){report.error=String(error.message).slice(0,1500);process.exitCode=2;}
finally{
 clearTimeout(deadline);report.finalObservations=[];
 for(const p of pages){try{report.finalObservations.push(await state(p));}catch{report.finalObservations.push({unavailable:true});}}
 for(const c of contexts)await c.close();
 report.finishedAt=new Date().toISOString();report.profilesRetained=true;report.doNotFundReportedAddresses=true;
 await writeFile(output+'/disposable-spark-reconciliation.json',JSON.stringify(report,null,2)+'\n');
 console.log(JSON.stringify({result:report.result,settlementVerified:report.settlementVerified,originalSendResubmitted:false,steps:report.steps.map(s=>({step:s.step,result:s.result})),error:report.error}));
}
