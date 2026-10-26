/** Actual hosted-regtest settlement. Never treats an unfunded wallet as a pass. */
import {chromium} from '@playwright/test';
import {mkdir,writeFile,readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import assert from 'node:assert/strict';
import {parseLightsparkResponseUrl} from './lightspark-response-url.mjs';
const manualFunding=process.env.GYS_MANUAL_REGTEST_FUNDING==='1';
const output=process.env.GYS_ACCEPTANCE_EVIDENCE_DIR||'/tmp/gys-disposable-acceptance';
const origin=process.env.GYS_ACCEPTANCE_ORIGIN||'http://127.0.0.1:5173';
assert.match(origin,/^http:\/\/127\.0\.0\.1:\d+$/,'Acceptance fixture must be local');
await mkdir(output,{recursive:true});
const report={schema:1,sourceCommit:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),network:'regtest',
 realFunds:false,userSecrets:false,apiKey:false,fixtureApprovals:true,physicalDevice:false,fullProductAcceptance:false,
 settlementVerified:false,steps:[],result:'BLOCKED',startedAt:new Date().toISOString()};
report.sdk=JSON.parse(await readFile('vendor/getyoursats-sdk-build.json','utf8'));
report.testFiles={};
for(const file of ['e2e/fixtures/disposable-wallet-acceptance.ts','scripts/security/accept-disposable-spark.mjs','scripts/security/lightspark-response-url.mjs'])report.testFiles[file]=createHash('sha256').update(await readFile(file)).digest('hex');
const launchOptions={headless:process.env.GYS_ACCEPTANCE_HEADED!=='1',...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH?{executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH}:{})};
const resume=process.env.GYS_ACCEPTANCE_RESUME==='1';
if(resume){
 // Keep every prior failure receipt before resuming the retained profiles.
 try{const previous=await readFile(output+'/disposable-spark-acceptance.json');await writeFile(output+'/previous-'+Date.now()+'.json',previous,{flag:'wx'});}catch(e){if(e.code!=='ENOENT')throw e;}
}
const pages=[];
const contexts=[];
async function checkpoint(step){report.currentStep=step;await writeFile(output+'/disposable-spark-progress.json',JSON.stringify({sourceCommit:report.sourceCommit,step,at:new Date().toISOString()})+'\n');}

const deadline=setTimeout(()=>{report.error="Acceptance exceeded its network deadline";for(const ctx of contexts)void ctx.close();},manualFunding?600000:240000);
async function fresh(){
 const profile=output+'/profiles/wallet-'+contexts.length;
 await mkdir(profile,{recursive:true,mode:0o700});
 const ctx=await chromium.launchPersistentContext(profile,{...launchOptions,serviceWorkers:'block'});contexts.push(ctx);
 const page=ctx.pages()[0]||await ctx.newPage();pages.push(page);
 await page.goto(origin+'/e2e/fixtures/disposable-wallet-acceptance.html?network=regtest');
 await page.waitForFunction(()=>typeof window.gysDisposableAcceptance?.connect==='function',undefined,{timeout:60000});
 const wallet=await page.evaluate(resume=>window.gysDisposableAcceptance.connect(resume),resume);return {ctx,page,wallet};
}
async function approveCall(page,invoke){
 const pending=invoke().then(result=>({result}),error=>({error}));
 const ready=await Promise.race([
  pending.then(done=>({done})),
  page.waitForFunction(()=>window.gysDisposableAcceptance.approval()!==null,undefined,{timeout:20000}).then(()=>({approval:true}))
 ]);
 if('done' in ready){if(ready.done.error)throw ready.done.error;throw Error('Operation completed without the required approval');}
 const request=await page.evaluate(()=>window.gysDisposableAcceptance.approval());assert.equal(request.intent.Network,'regtest');
 await page.evaluate(id=>window.gysDisposableAcceptance.approve(id),request.id);
 const done=await pending;if(done.error)throw done.error;return done.result;
}
async function approve(page,operation,arg){
 return approveCall(page,()=>page.evaluate(({operation,arg})=>window.gysDisposableAcceptance[operation](arg),{operation,arg}));
}
async function claimAvailable(page){
 const pending=await page.evaluate(()=>window.gysDisposableAcceptance.discover());
 for(const p of pending){report.lastIncomingCandidate=p;await checkpoint('claim-incoming-transfer');assert.equal(p.fee,'0');await approve(page,'claim',p.id);}
 return pending;
}
async function until(page,predicate,attempts=12){
 let state;
 for(let n=0;n<attempts;n++){
  await claimAvailable(page);state=await page.evaluate(()=>window.gysDisposableAcceptance.status());
  if(predicate(state))return state;
  await page.waitForTimeout(2500);
 }
 report.lastNetworkObservation=state;throw Error('Actual regtest funding or settlement was not observed within the acceptance window');
}
async function send(page,address,amount){
 const result=await approveCall(page,()=>page.evaluate(({address,amount})=>window.gysDisposableAcceptance.send(address,amount),{address,amount}));
 assert.equal(result.fee,'0');return result;
}

try{
 await checkpoint('connect-first-disposable-wallet');const a=await fresh();await checkpoint('connect-second-disposable-wallet');const b=await fresh();assert.notEqual(a.wallet.identity,b.wallet.identity);if(!resume){assert.equal(a.wallet.balance,'0');assert.equal(b.wallet.balance,'0');}
 report.steps.push({step:'two-real-disposable-wallets',result:'PASS',wallets:[a.wallet,b.wallet]});
 if(resume){
  const states=await Promise.all([a.page,b.page].map(p=>p.evaluate(()=>window.gysDisposableAcceptance.status())));
  // A resumed diagnostic must never repeat an already-started payment sequence.
  assert(states.every(s=>s.outgoing.length===0&&!s.payments.some(p=>p.type==='send')),'This acceptance sequence has already submitted a send; reconcile it without repeating the sequence');
  assert.equal(b.wallet.balance,'0','Receiver must be empty before a new acceptance sequence');
 }
 if(resume){report.faucet={mode:'resume-existing-disposable-profiles',requestedSats:0};
 }else if(manualFunding){
  await checkpoint('await-human-regtest-funding');
  console.log(JSON.stringify({action:'Fund this NEW disposable Spark REGTEST wallet using the public faucet',address:a.wallet.address,amountSats:1000,realBitcoin:false,url:'https://app.lightspark.com/regtest-faucet'}));
  report.faucet={mode:'human-assisted',requestedSats:1000};
 }else{
 await checkpoint('request-public-faucet-funding');const faucet=await a.ctx.newPage();const posts=[];const failedHosts=new Set();
 faucet.on('response',r=>{
  if(r.request().method()!=='POST')return;
  const url=parseLightsparkResponseUrl(r.url());
  if(url)posts.push({path:url.pathname,status:r.status()});
 });
 faucet.on('requestfailed',r=>failedHosts.add(new URL(r.url()).hostname));
 await faucet.goto('https://app.lightspark.com/regtest-faucet',{waitUntil:'domcontentloaded',timeout:30000});
 await faucet.getByPlaceholder('500',{exact:true}).fill('1000');
 await faucet.getByPlaceholder('bcrt1... or sparkrt1...',{exact:true}).fill(a.wallet.address);
 await faucet.getByRole('button',{name:'Send Funds',exact:true}).click();
 await faucet.waitForTimeout(5000);
 report.faucet={requestedSats:1000,posts,failedHosts:[...failedHosts],text:(await faucet.locator('body').innerText()).slice(0,1800),
  challengeFrames:faucet.frames().map(f=>f.url().split('?')[0]).filter(u=>/recaptcha|captcha/i.test(u))};
 // Do not solve or bypass a CAPTCHA. The funding observation below is the test.
 await faucet.close();

 }
 await checkpoint('observe-funding-and-claim');const funded=await until(a.page,s=>BigInt(s.balance)>=200n,manualFunding?120:12);
 report.steps.push({step:'faucet-funding-and-explicit-claim',result:'PASS',state:funded});
 await checkpoint('send-100-sats');const outgoing=await send(a.page,b.wallet.address,100);
 const received=await until(b.page,s=>s.balance==='100');
 assert(received.payments.some(p=>p.id===outgoing.id&&p.type==='receive'&&p.status==='completed'&&p.amount==='100'&&p.fee==='0'));
 const debit=await until(a.page,s=>BigInt(s.balance)===BigInt(funded.balance)-100n);
 report.steps.push({step:'direct-spark-settlement',result:'PASS',outgoing,sender:debit,receiver:received});
 await checkpoint('restart-receiving-wallet');await b.page.evaluate(()=>window.gysDisposableAcceptance.stop());await b.page.reload();
 await b.page.waitForFunction(()=>typeof window.gysDisposableAcceptance?.connect==='function');
 const restored=await b.page.evaluate(()=>window.gysDisposableAcceptance.connect(true));
 assert.equal(restored.identity,b.wallet.identity);assert.equal(restored.balance,'100');
 report.steps.push({step:'same-profile-restart',result:'PASS',restored});
 await checkpoint('return-50-sats');const returned=await send(b.page,a.wallet.address,50);const back=await until(a.page,s=>BigInt(s.balance)===BigInt(funded.balance)-50n);
 const residual=await until(b.page,s=>s.balance==='50');
 assert(back.payments.some(p=>p.id===returned.id&&p.type==='receive'&&p.status==='completed'&&p.amount==='50'&&p.fee==='0'));
 report.steps.push({step:'return-transfer',result:'PASS',returned,receiver:back,sender:residual});
 report.settlementVerified=true;report.result='PASS_DIRECT_SPARK_ACCEPTANCE_ONLY';
}catch(error){
 report.error=String(error.message).slice(0,2000);process.exitCode=2;
 report.failureObservations=[];
 for(const page of pages){try{report.failureObservations.push(await page.evaluate(()=>window.gysDisposableAcceptance.status()));}catch(e){report.failureObservations.push({error:String(e.message).slice(0,1000)});}}
}
finally{
 clearTimeout(deadline);for(const ctx of contexts)await ctx.close();
 report.finishedAt=new Date().toISOString();report.walletProfilesClosed=true;report.disposableProfilesRetainedLocally=true;report.doNotFundReportedAddresses=true;
 await writeFile(output+'/disposable-spark-acceptance.json',JSON.stringify(report,null,2)+'\n');
 console.log(JSON.stringify({source:report.sourceCommit,result:report.result,settlementVerified:report.settlementVerified,steps:report.steps.map(s=>({step:s.step,result:s.result})),error:report.error}));
}
