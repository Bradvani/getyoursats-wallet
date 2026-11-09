import test from 'node:test';
import assert from 'node:assert/strict';
import {runAcceptance, requireAcceptanceEnvironment, safeCheckoutURL, matchedOrder, CAMPAIGN} from '../scripts/rampnow-sandbox-acceptance.mjs';

const env = {VERCEL_ENV:'preview', VERCEL_PROJECT_ID:'prj_kVMt4cd9k0WsufaoRCVCH2bpPtWa',
  VERCEL_GIT_COMMIT_REF:'feat/rampnow-integration-20261028', RAMPNOW_ENVIRONMENT:'sandbox',
  RAMPNOW_STORAGE_SOURCE:'upstash_sandbox', UPSTASH_REDIS_REST_URL:'https://test.upstash.io',
  UPSTASH_REDIS_REST_TOKEN:'private-store-token', RAMPNOW_API_KEY:'private-api-key',RAMPNOW_API_SECRET:'private-api-secret'};
const address='0x'+'1'.repeat(40); const privateKey='2'.repeat(64);
const route={orderType:'buy',srcCurrency:'EUR',srcChain:'fiat',srcAmount:'50',dstCurrency:'ETH',dstChain:'sepolia',paymentMode:'card'};
function fixture({checkout, chains, quote, quoteFailure, order, quarantine=[]}={}) {
  const state=new Map(); const calls=[]; let created;
  const json=(v,status=200)=>new Response(JSON.stringify(v),{status,headers:{'content-type':'application/json'}});
  const fetchImpl=async(url, options)=>{
    calls.push({url,options});
    if(url==='https://test.upstash.io/') {
      const c=JSON.parse(options.body); let result;
      if(c[0]==='GET') result=state.get(c[1])??null;
      else if(c[0]==='HGETALL') result=quarantine;
      else if(c[0]==='EVAL') {result=state.has(c[3])?0:1;if(result){state.set(c[3],'dispatch_reserved');state.set(c[4],c[5]);}}
      else if(c[0]==='SET') {result=state.has(c[1])?'OK':null;if(result)state.set(c[1],c[2]);}
      else throw new Error('Unexpected Redis command');
      return json({result});
    }
    assert.equal(new URL(url).origin,'https://api.sandbox.rampnow.io');
    assert.equal(options.redirect,'error');
    if(url.endsWith('/chain_config'))return json({code:0,data:{chains:chains??[{code:'sepolia',isTestnet:true,supportedAssets:['ETH']}]}});
    if(url.endsWith('/quote'))return quoteFailure?json(quoteFailure,500):json({code:0,data:quote??{...route,dstAmount:'0.02'}});
    if(url.endsWith('/checkout')){
      created=JSON.parse(options.body);
      if(checkout)return checkout(created,json);
      return json({code:0,data:{orderUid:'order-1',redirectUrl:'https://app.sandbox.rampnow.io/checkout/test'}});
    }
    const item=order??{...route,externalOrderUid:created?.externalOrderUid,orderUid:'order-1',walletAddress:address,status:'unknown',dstFillAmount:'0'};
    return json({code:0,data:{orderList:created?[item]:[]}});
  };
  return {state,calls,run:(args={})=>runAcceptance({env,fetchImpl,recipientFactory:async()=>({address,privateKey}),...args}),
    creates:()=>calls.filter(c=>c.url.endsWith('/checkout')),getCreated:()=>created};
}
test('rejects production, wrong project/branch and shared storage before any request',()=>{
  for(const patch of [{VERCEL_ENV:'production'},{RAMPNOW_ENVIRONMENT:'production'},
    {VERCEL_PROJECT_ID:'other'},{VERCEL_GIT_COMMIT_REF:'main'},{RAMPNOW_STORAGE_SOURCE:'shared'}]){
    assert.throws(()=>requireAcceptanceEnvironment({...env,...patch}),/SANDBOX_GUARD/);
  }
});
test('rejects non-sandbox checkout URLs including lookalike hosts and credentials',()=>{
  for(const url of ['https://app.rampnow.io/a','https://app.sandbox.rampnow.io.evil.test/a',
    'http://app.sandbox.rampnow.io/a','https://user:pass@app.sandbox.rampnow.io/a']) assert.throws(()=>safeCheckoutURL(url));
});
test('inspect cannot create orders',async()=>{const f=fixture();const report=await f.run();assert.equal(f.creates().length,0);assert.equal(report.cases.length,3);});
test('diagnostics never create orders and retain only scrubbed support evidence',async()=>{
  const f=fixture({quoteFailure:{code:100008,traceId:'trace-test-12345',displayError:'failure private-api-secret private-api-key private-store-token',message:'untrusted internal data'}});
  const report=await f.run({mode:'diagnose'});assert.equal(f.creates().length,0);assert.equal(f.state.size,0);
  const row=report.diagnostics.find(x=>x.label==='sepolia_card');
  assert.equal(row.stage,'quote');assert.equal(row.httpStatus,500);assert.equal(row.providerCode,100008);
  assert.equal(row.traceId,'trace-test-12345');assert.equal(row.displayError,'failure [redacted] [redacted] [redacted]');
  assert.equal(report.diagnostics.find(x=>x.label==='base_sepolia_card').status,'testnet_unverified');
  assert.ok(!JSON.stringify(report).includes('untrusted internal data'));
});
test('rejects arbitrary scenarios before network access',async()=>{const f=fixture();await assert.rejects(f.run({mode:'create',scenario:'mainnet'}),/ACTION_INVALID/);assert.equal(f.calls.length,0);});
test('creates only fixed synthetic card order with explicit testnet recipient',async()=>{
  const f=fixture();const report=await f.run({mode:'create',scenario:'accepted'});
  assert.equal(f.creates().length,1); const p=f.getCreated();
  for(const [k,v]of Object.entries(route))assert.equal(p[k],v);
  assert.equal(p.user.email,'gys-rampnow-20261109@example.invalid');
  assert.equal(p.wallet.crytpoAccountDetail.address,address);
  assert.equal(p.externalOrderUid,CAMPAIGN+'-accepted');
  assert.equal(report.cases[0].lookupVerified,true);
  for(const secret of [privateKey,env.RAMPNOW_API_KEY,env.RAMPNOW_API_SECRET,env.UPSTASH_REDIS_REST_TOKEN,p.user.email])assert.ok(!JSON.stringify(report).includes(secret));
});
test('repeat and concurrent invocation dispatch exactly once',async()=>{
  const f=fixture();await Promise.all([f.run({mode:'create',scenario:'accepted'}),f.run({mode:'create',scenario:'accepted'})]);
  await f.run({mode:'create',scenario:'accepted'});assert.equal(f.creates().length,1);
});
test('permanent reservation prevents redispatch after the detailed record expires',async()=>{
  const f=fixture();await f.run({mode:'create',scenario:'accepted'});
  for(const key of f.state.keys())if(!key.endsWith(':dispatched'))f.state.delete(key);
  await f.run({mode:'create',scenario:'accepted'});assert.equal(f.creates().length,1);
});
test('uncertain timeout is never retried',async()=>{
  const f=fixture({checkout:async()=>{throw new Error('timeout with secret');}});
  const r=await f.run({mode:'create',scenario:'accepted'});await f.run({mode:'create',scenario:'accepted'});
  assert.equal(f.creates().length,1);assert.equal(r.cases[0].phase,'dispatch_requires_reconciliation');
  assert.ok(!JSON.stringify(r).includes('timeout with secret'));
});
test('provider rejection is sanitized and permanently reserved',async()=>{
  const f=fixture({checkout:async(p,json)=>json({code:40001,message:'echo private-api-secret',data:null},400)});
  const r=await f.run({mode:'create',scenario:'accepted'});await f.run({mode:'create',scenario:'accepted'});
  assert.equal(f.creates().length,1);assert.equal(r.cases[0].providerCode,40001);assert.ok(!JSON.stringify(r).includes('private-api-secret'));
});
test('missing, false and ambiguous testnet metadata cannot create orders',async()=>{
  for(const chains of [[],[{code:'sepolia',supportedAssets:['ETH']}],[{code:'sepolia',isTestnet:false,supportedAssets:['ETH']}],
    [{code:'sepolia',isTestnet:true,supportedAssets:['ETH']},{code:'sepolia',isTestnet:true,supportedAssets:['ETH']}]]){
    const f=fixture({chains});await assert.rejects(f.run({mode:'create',scenario:'accepted'}),/CHAIN_UNVERIFIED/);assert.equal(f.creates().length,0);
  }
});
test('quote for a different network fails before reserving or creating',async()=>{
  const f=fixture({quote:{...route,dstChain:'ethereum',dstAmount:'0.02'}});
  await assert.rejects(f.run({mode:'create',scenario:'accepted'}),/QUOTE_MISMATCH/);assert.equal(f.creates().length,0);assert.equal(f.state.size,0);
});
test('lookup checks amount, route, destination and identity',()=>{
  const record={externalOrderUid:'external-1',address,orderUid:'order-1'};
  const order={...route,srcAmount:'50.00',externalOrderUid:'external-1',walletAddress:address,orderUid:'order-1'};
  assert.equal(matchedOrder(order,record),true);
  for(const patch of [{srcAmount:'500'},{dstChain:'ethereum'},{walletAddress:'0x'+'3'.repeat(40)},
    {orderUid:'order-2'},{externalOrderUid:'external-2'}])assert.equal(matchedOrder({...order,...patch},record),false);
});
test('only known order events on the selected route become correlated evidence',async()=>{
  const event={eventUid:'event-1',eventType:'ramp_order.status_change',payload:{...route,
    orderUid:'order-1',externalOrderUid:CAMPAIGN+'-accepted',orderStatus:'completed',
    dstFillAmount:'0.02',updateTime:'2026-11-09T10:00:00Z'}};
  const record=e=>JSON.stringify({classification:'unbound',receivedAt:1794218400,event:e});
  const quarantine=['event-1',record(event),'event-2',record({...event,eventUid:'event-2',payload:{...event.payload,orderUid:'other'}}),
    'event-3',record({...event,eventUid:'event-3',payload:{...event.payload,dstChain:'ethereum'}})];
  const f=fixture({quarantine});const r=await f.run({mode:'create',scenario:'accepted'});
  assert.deepEqual(r.cases[0].callbackEvents.map(e=>e.eventUid),['event-1']);assert.equal(r.cases[0].walletCreditVerified,false);
});
