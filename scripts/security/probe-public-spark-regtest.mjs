import {chromium} from '@playwright/test';
import {mkdir,writeFile} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import assert from 'node:assert/strict';
const out=process.env.GYS_NETWORK_EVIDENCE_DIR||'/tmp/public-spark-evidence';
await mkdir(out,{recursive:true});
const report={schema:1,sourceCommit:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),
 network:'regtest',usesRealFunds:false,usesUserSecrets:false,apiKeySupplied:false,
 gatewayUsed:true,spendingAttempted:false,claimsAttempted:false,settlementVerified:false,wallets:[],errors:[]};
const browser=await chromium.launch({headless:true});
try{
 for(let i=0;i<2;i++){
  const context=await browser.newContext({serviceWorkers:'block'});
  const page=await context.newPage();
  try{
   await page.goto('http://127.0.0.1:5173/e2e/fixtures/public-spark-regtest.html?network=regtest');
   await page.waitForFunction(()=>typeof window.gysPublicRegtestProbe?.connect==='function',{timeout:60_000});
   const result=await page.evaluate(async()=>{
    return Promise.race([
     window.gysPublicRegtestProbe.connect(),
     new Promise((_,reject)=>setTimeout(()=>reject(new Error('Public regtest connection/observation timed out')),90_000)),
    ]);
   });
   assert.equal(result.network,'regtest');assert.match(result.bitcoinAddress,/^bcrt1/);
   assert.equal(result.balanceSats,'0');assert.equal(result.gatewayInstalled,true);
   report.wallets.push({...result,index:i,connected:true});
   await page.evaluate(()=>window.gysPublicRegtestProbe.stop());
  }catch(error){
   report.errors.push({wallet:i,name:error.name,message:String(error.message).slice(0,1800)});
  }finally{await context.close();}
 }
 if(report.wallets.length===2){assert.notEqual(report.wallets[0].identityPubkey,report.wallets[1].identityPubkey);report.result='PASS_OBSERVATION_ONLY';}
 else report.result='BLOCKED_OR_FAILED';
 // Inspect only the public faucet UI, without logging in, solving a challenge,
 // requesting coins or submitting any form. This identifies the remaining
 // provisioning step without assuming private-image access is mandatory.
 const faucet=await browser.newPage();
 try{
  await faucet.goto('https://app.lightspark.com/regtest-faucet',{waitUntil:'domcontentloaded',timeout:30_000});
  await faucet.waitForTimeout(2500);
  report.faucet={url:faucet.url(),title:await faucet.title(),publicText:(await faucet.locator('body').innerText()).slice(0,2200),
   inputs:await faucet.locator('input').evaluateAll(nodes=>nodes.map(n=>({type:n.type,name:n.name,placeholder:n.placeholder}))),
   buttons:await faucet.getByRole('button').allTextContents(),submitted:false};
 }catch(error){report.faucet={error:String(error.message).slice(0,600),submitted:false};}
 finally{await faucet.close();}
}finally{
 await browser.close();
 await writeFile(out+'/public-spark-observation.json',JSON.stringify(report,null,2)+'\n');
 console.log(JSON.stringify({source:report.sourceCommit,result:report.result,wallets:report.wallets.length,errors:report.errors,settlementVerified:false},null,2));
}
if(report.result!=='PASS_OBSERVATION_ONLY')process.exitCode=1;
