import test from 'node:test';
import assert from 'node:assert/strict';
import {runAcceptance, requireAcceptanceEnvironment, safeCheckoutURL, matchedOrder, CAMPAIGN, ENABLEMENT_CAMPAIGN, CONFIRMED_CAMPAIGN, CONTACT_CAMPAIGN, CUSTOMER_CAMPAIGN} from '../scripts/rampnow-sandbox-acceptance.mjs';
import {RAMPNOW_STORE_PREFIX} from '../server/rampnowStore.mjs';

const env = {VERCEL_ENV:'preview', VERCEL_PROJECT_ID:'prj_kVMt4cd9k0WsufaoRCVCH2bpPtWa',
  VERCEL_GIT_COMMIT_REF:'feat/rampnow-integration-20261028', RAMPNOW_ENVIRONMENT:'sandbox',
  RAMPNOW_STORAGE_SOURCE:'upstash_sandbox', UPSTASH_REDIS_REST_URL:'https://test.upstash.io',
  UPSTASH_REDIS_REST_TOKEN:'private-store-token', RAMPNOW_API_KEY:'private-api-key',RAMPNOW_API_SECRET:'private-api-secret'};
const address='0x'+'1'.repeat(40); const privateKey='2'.repeat(64);
const route={orderType:'buy',srcCurrency:'EUR',srcChain:'fiat',srcAmount:'50',dstCurrency:'ETH',dstChain:'ethereum',paymentMode:'card'};
function fixture({checkout, chains, quote, quoteFailure, order, orders, previousLookup, confirmedLookup, contactLookup, quarantine=[]}={}) {
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
    if([CAMPAIGN,ENABLEMENT_CAMPAIGN].some(c=>url.endsWith('/'+c+'-accepted')) && previousLookup) return previousLookup(json,url);
    if(url.endsWith('/'+CONFIRMED_CAMPAIGN+'-accepted') && confirmedLookup) return confirmedLookup(json,url);
    if(url.endsWith('/'+CONTACT_CAMPAIGN+'-accepted') && contactLookup) return contactLookup(json,url);
    if(url.endsWith('/chain_config'))return json({code:0,data:{chains:chains??[{code:'sepolia',isTestnet:true,supportedAssets:['ETH']},{code:'ethereum',isTestnet:false,supportedAssets:['ETH']}]}});
    if(url.endsWith('/quote'))return quoteFailure?json(quoteFailure,500):json({code:0,data:quote??{...route,dstAmount:'0.02'}});
    if(url.endsWith('/checkout')){
      created=JSON.parse(options.body);
      if(checkout)return checkout(created,json);
      return json({code:0,data:{orderUid:'order-1',redirectUrl:'https://app.sandbox.rampnow.io/checkout/test'}});
    }
    const item=order??{...route,uid:'order-1',walletAddress:address,status:'unknown',dstFillAmount:'0'};
    return json({code:0,data:{orderList:orders??(created?[item]:[])}});
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
function seedRejected(f, patch={}, campaign=CAMPAIGN) {
  const prefix=RAMPNOW_STORE_PREFIX+'acceptance:'+campaign+':accepted';
  f.state.set(prefix,JSON.stringify({externalOrderUid:campaign+'-accepted',address,privateKey,
    phase:'dispatch_requires_reconciliation',failure:'provider_rejected',httpStatus:400,providerCode:100004,...patch}));
  f.state.set(prefix+':dispatched','dispatch_reserved');
}
const contactEmail='operator@example.com';
const contactEnv={...env,RAMPNOW_ACCEPTANCE_EMAIL:contactEmail};
const contactArgs={mode:'create',scenario:'accepted',campaign:CONTACT_CAMPAIGN,env:contactEnv};
const previousOrder={...route,uid:'previous-order-3',status:'created'};
function seedConfirmed(f,patch={},campaign=CONFIRMED_CAMPAIGN) {
  const prefix=RAMPNOW_STORE_PREFIX+'acceptance:'+campaign+':accepted';
  f.state.set(prefix,JSON.stringify({externalOrderUid:campaign+'-accepted',address,privateKey,
    phase:'checkout_created',orderUid:previousOrder.uid,redirectUrl:'https://app.sandbox.rampnow.io/checkout/previous',...patch}));
  f.state.set(prefix+':dispatched','dispatch_reserved');
}
function contactFixture(options={}) {
  const f=fixture({previousLookup:json=>json({code:0,data:{orderList:[]}}),
    confirmedLookup:json=>json({code:0,data:{orderList:[previousOrder]}}),...options});
  seedRejected(f);seedRejected(f,{},ENABLEMENT_CAMPAIGN);seedConfirmed(f);
  return f;
}
const customerEmail='customer@example.com';
const customerArgs={mode:'create',scenario:'accepted',campaign:CUSTOMER_CAMPAIGN,
  env:{...env,RAMPNOW_ACCEPTANCE_EMAIL:customerEmail}};
const previousContactOrder={...route,uid:'previous-order-4',status:'created'};
function customerFixture(options={}) {
  const f=contactFixture({contactLookup:json=>json({code:0,data:{orderList:[previousContactOrder]}}),...options});
  seedConfirmed(f,{orderUid:previousContactOrder.uid},CONTACT_CAMPAIGN);
  return f;
}
test('customer comparison reconciles every prior fixture before one accepted order and preserves history',async()=>{
  const f=customerFixture({order:{...route,uid:'order-1',status:'created'}});
  const before=[...f.state.entries()];
  const report=await f.run(customerArgs);const created=f.getCreated();
  assert.equal(created.user.email,customerEmail);
  assert.equal(created.externalOrderUid,CUSTOMER_CAMPAIGN+'-accepted');
  assert.equal(report.campaign,CUSTOMER_CAMPAIGN);assert.equal(f.creates().length,1);
  const createIndex=f.calls.findIndex(c=>c.url.endsWith('/checkout'));
  for(const campaign of [CAMPAIGN,ENABLEMENT_CAMPAIGN,CONFIRMED_CAMPAIGN,CONTACT_CAMPAIGN]) {
    const index=f.calls.findIndex(c=>c.url.endsWith('/'+campaign+'-accepted'));
    assert.ok(index>=0 && index<createIndex);
  }
  for(const [key,value]of before)assert.equal(f.state.get(key),value);
  const saved=JSON.parse(f.state.get(RAMPNOW_STORE_PREFIX+'acceptance:'+CUSTOMER_CAMPAIGN+':accepted'));
  assert.equal(saved.email,undefined);assert.equal(saved.user,undefined);
  for(const secret of [customerEmail,privateKey,env.RAMPNOW_API_KEY,env.RAMPNOW_API_SECRET,env.UPSTASH_REDIS_REST_TOKEN])
    assert.ok(!JSON.stringify(report).includes(secret));
  assert.equal(report.productionReady,false);assert.equal(report.networkReceiptVerified,false);
  assert.equal(report.cases[0].lookupVerified,false);assert.equal(report.cases[0].walletCreditVerified,false);
  assert.deepEqual(report.cases.slice(1).map(c=>c.phase),['not_created','not_created']);
});
test('customer comparison rejects missing or invalid email and unauthorized scenarios before provider calls',async()=>{
  for(const email of [undefined,null,'','not-an-email','user@example.invalid','user@example.test',
    'user@example.localhost','user@example.com\n',' user@example.com','a'.repeat(250)+'@example.com']) {
    const f=customerFixture();const before=[...f.state.entries()];
    await assert.rejects(f.run({...customerArgs,env:{...env,RAMPNOW_ACCEPTANCE_EMAIL:email}}),/OPERATOR_EMAIL_REQUIRED/);
    assert.equal(f.calls.filter(c=>c.url.startsWith('https://api.sandbox.rampnow.io')).length,0);
    assert.deepEqual([...f.state.entries()],before);assert.equal(f.creates().length,0);
  }
  for(const scenario of ['declined','expired','accepted-again']) {
    const f=customerFixture();
    await assert.rejects(f.run({...customerArgs,scenario}),/ACTION_INVALID/);
    assert.equal(f.calls.length,0);
  }
});
test('customer comparison rejects any v4 or v3 identity mismatch before reserving or creating',async()=>{
  for(const [lookup,previous]of [['contactLookup',previousContactOrder],['confirmedLookup',previousOrder]]) {
    const invalidRows=[[],[previous,{...previous}],[null],...[
      {uid:'different-order'},{uid:undefined},{srcAmount:'51'},{srcAmount:'5e1'},{srcAmount:50},
      {orderType:'sell'},{srcCurrency:'USD'},{srcChain:'ethereum'},{dstCurrency:'BTC'},{dstChain:'sepolia'},
      {externalOrderUid:'different-external'},{externalOrderUid:null}
    ].map(p=>[{...previous,...p}])];
    for(const orders of invalidRows) {
      const f=customerFixture({[lookup]:json=>json({code:0,data:{orderList:orders}})});
      const before=[...f.state.entries()];
      await assert.rejects(f.run(customerArgs),/PREVIOUS_ATTEMPT_UNRESOLVED/);
      assert.equal(f.creates().length,0);assert.deepEqual([...f.state.entries()],before);
      assert.ok(!f.calls.some(c=>c.url.endsWith('/quote')||c.url.endsWith('/chain_config')));
    }
    const f=customerFixture({[lookup]:async()=>{throw new Error('lookup timeout');}});
    await assert.rejects(f.run(customerArgs),/lookup timeout/);assert.equal(f.creates().length,0);
  }
});
test('customer comparison requires intact v4 and v3 records and unchanged v1 and v2 rejection evidence',async()=>{
  for(const campaign of [CONTACT_CAMPAIGN,CONFIRMED_CAMPAIGN]) {
    for(const patch of [null,{phase:'dispatch_requires_reconciliation'},{orderUid:'invalid/id'},
      {externalOrderUid:'wrong-external'},{redirectUrl:undefined},{redirectUrl:'https://evil.example/checkout'}]) {
      const f=customerFixture();
      if(patch===null)f.state.delete(RAMPNOW_STORE_PREFIX+'acceptance:'+campaign+':accepted');
      else seedConfirmed(f,{orderUid:campaign===CONTACT_CAMPAIGN?previousContactOrder.uid:previousOrder.uid,...patch},campaign);
      const before=[...f.state.entries()];
      await assert.rejects(f.run(customerArgs),/PREVIOUS_ATTEMPT_UNRESOLVED|CHECKOUT_URL_INVALID/);
      assert.equal(f.creates().length,0);assert.deepEqual([...f.state.entries()],before);
    }
  }
  for(const campaign of [CAMPAIGN,ENABLEMENT_CAMPAIGN]) {
    for(const patch of [null,{failure:'response_unverified'},{httpStatus:500},{providerCode:100008},
      {orderUid:'existing'},{redirectUrl:'https://app.sandbox.rampnow.io/checkout/existing'}]) {
      const f=customerFixture();
      if(patch===null)f.state.delete(RAMPNOW_STORE_PREFIX+'acceptance:'+campaign+':accepted');
      else seedRejected(f,patch,campaign);
      const before=[...f.state.entries()];
      await assert.rejects(f.run(customerArgs),/PREVIOUS_ATTEMPT_UNRESOLVED/);
      assert.equal(f.creates().length,0);assert.deepEqual([...f.state.entries()],before);
    }
    const found=customerFixture({previousLookup:(json,url)=>json({code:0,data:{orderList:url.endsWith(campaign+'-accepted')?[{uid:'unexpected-order'}]:[]}})});
    await assert.rejects(found.run(customerArgs),/PREVIOUS_ATTEMPT_UNRESOLVED/);assert.equal(found.creates().length,0);
  }
});
test('customer comparison cannot redispatch concurrently, after repeating or after details expire',async()=>{
  const f=customerFixture();const before=[...f.state.entries()];
  await Promise.all([f.run(customerArgs),f.run(customerArgs)]);
  await f.run(customerArgs);assert.equal(f.creates().length,1);
  const report=await f.run({campaign:CUSTOMER_CAMPAIGN});assert.equal(report.cases[0].phase,'checkout_created');
  await f.run({...customerArgs,env});assert.equal(f.creates().length,1);
  f.state.delete(RAMPNOW_STORE_PREFIX+'acceptance:'+CUSTOMER_CAMPAIGN+':accepted');
  await f.run(customerArgs);assert.equal(f.creates().length,1);
  for(const [key,value]of before)assert.equal(f.state.get(key),value);
  assert.equal(f.state.get(RAMPNOW_STORE_PREFIX+'acceptance:'+CUSTOMER_CAMPAIGN+':accepted:dispatched'),'dispatch_reserved');
});
test('customer comparison sanitizes rejection and cannot retry an uncertain checkout',async()=>{
  for(const checkout of [(payload,json)=>json({code:100008,displayError:'Cannot use '+payload.user.email+' '+env.RAMPNOW_API_SECRET},400),
    async()=>{throw new Error('uncertain checkout timeout');}]) {
    const f=customerFixture({checkout});const report=await f.run(customerArgs);
    await f.run(customerArgs);assert.equal(f.creates().length,1);
    assert.equal(report.cases[0].phase,'dispatch_requires_reconciliation');
    for(const secret of [customerEmail,env.RAMPNOW_API_SECRET,'uncertain checkout timeout'])
      assert.ok(!JSON.stringify(report).includes(secret));
    assert.ok(!JSON.stringify([...f.state.values()]).includes(customerEmail));
    assert.equal(f.state.get(RAMPNOW_STORE_PREFIX+'acceptance:'+CUSTOMER_CAMPAIGN+':accepted:dispatched'),'dispatch_reserved');
  }
});
test('customer comparison callbacks remain isolated from prior campaigns and never prove wallet credit',async()=>{
  const event={eventUid:'event-current',eventType:'ramp_order.status_change',payload:{...route,
    orderUid:'order-1',externalOrderUid:CUSTOMER_CAMPAIGN+'-accepted',orderStatus:'completed',
    dstFillAmount:'0.02',updateTime:'2026-11-10T10:00:00Z'}};
  const events=[event,...[CONFIRMED_CAMPAIGN,CONTACT_CAMPAIGN].map((campaign,i)=>({...event,eventUid:'event-prior-'+i,
    payload:{...event.payload,externalOrderUid:campaign+'-accepted'}})),
    {...event,eventUid:'event-wrong-order',payload:{...event.payload,orderUid:previousContactOrder.uid}}];
  const quarantine=events.flatMap(e=>[e.eventUid,JSON.stringify({classification:'unbound',receivedAt:1794304800,event:e})]);
  const f=customerFixture({quarantine,order:{...route,uid:'order-1',status:'completed'}});
  const report=await f.run(customerArgs);
  assert.deepEqual(report.cases[0].callbackEvents.map(e=>e.eventUid),['event-current']);
  assert.equal(report.cases[0].lookupVerified,false);assert.equal(report.cases[0].walletCreditVerified,false);
  assert.equal(report.networkReceiptVerified,false);assert.equal(report.productionReady,false);
});
test('contact campaign sends only the supplied operator email after all predecessor lookups and preserves history',async()=>{
  const f=contactFixture(); const before=[...f.state.entries()];
  const report=await f.run(contactArgs); const created=f.getCreated();
  assert.equal(created.user.email,contactEmail);
  assert.equal(created.externalOrderUid,CONTACT_CAMPAIGN+'-accepted');
  assert.equal(created.wallet.crytpoAccountDetail.address,address);
  assert.equal(report.campaign,CONTACT_CAMPAIGN);assert.equal(f.creates().length,1);
  const createIndex=f.calls.findIndex(c=>c.url.endsWith('/checkout'));
  for(const campaign of [CAMPAIGN,ENABLEMENT_CAMPAIGN,CONFIRMED_CAMPAIGN]) {
    const index=f.calls.findIndex(c=>c.url.endsWith('/'+campaign+'-accepted'));
    assert.ok(index>=0 && index<createIndex);
  }
  for(const [key,value]of before)assert.equal(f.state.get(key),value);
  // The provider fixture URL has no email query. Real hosted URLs remain
  // protected handoff data; there must be no separately persisted profile.
  assert.ok(!JSON.stringify(report).includes(contactEmail));
  const saved=JSON.parse(f.state.get(RAMPNOW_STORE_PREFIX+'acceptance:'+CONTACT_CAMPAIGN+':accepted'));
  assert.equal(saved.email,undefined);assert.equal(saved.user,undefined);
  for(const secret of [privateKey,env.RAMPNOW_API_KEY,env.RAMPNOW_API_SECRET,env.UPSTASH_REDIS_REST_TOKEN])assert.ok(!JSON.stringify(report).includes(secret));
  assert.equal(report.networkReceiptVerified,false);assert.equal(report.cases[0].walletCreditVerified,false);
});
test('contact campaign rejects missing and invalid operator email before provider requests or reservations',async()=>{
  for(const email of [undefined,null,'','not-an-email','user@example.invalid','user@example.test',
    'user@example.localhost','user@example.com\n',' user@example.com','a'.repeat(250)+'@example.com']) {
    const f=contactFixture();const before=[...f.state.entries()];
    await assert.rejects(f.run({...contactArgs,env:{...env,RAMPNOW_ACCEPTANCE_EMAIL:email}}),/OPERATOR_EMAIL_REQUIRED/);
    assert.equal(f.calls.filter(c=>c.url.startsWith('https://api.sandbox.rampnow.io')).length,0);
    assert.deepEqual([...f.state.entries()],before);assert.equal(f.creates().length,0);
  }
});
test('contact campaign rejects missing or contradictory predecessor identity without creating',async()=>{
  const invalidRows=[[],[previousOrder,{...previousOrder}],[null],...[
    {uid:'different-order'},{uid:undefined},{srcAmount:'51'},{srcAmount:'5e1'},{srcAmount:50},
    {orderType:'sell'},{srcCurrency:'USD'},{srcChain:'ethereum'},{dstCurrency:'BTC'},{dstChain:'sepolia'},
    {externalOrderUid:'different-external'},{externalOrderUid:null}
  ].map(p=>[{...previousOrder,...p}])];
  for(const orders of invalidRows) {
    const f=contactFixture({confirmedLookup:json=>json({code:0,data:{orderList:orders}})});
    const before=[...f.state.entries()];
    await assert.rejects(f.run(contactArgs),/PREVIOUS_ATTEMPT_UNRESOLVED/);
    assert.equal(f.creates().length,0);assert.deepEqual([...f.state.entries()],before);
  }
  const f=contactFixture({confirmedLookup:async()=>{throw new Error('lookup timeout');}});
  await assert.rejects(f.run(contactArgs),/lookup timeout/);assert.equal(f.creates().length,0);
});
test('contact campaign requires intact created predecessor and both rejected histories',async()=>{
  for(const patch of [null,{phase:'dispatch_requires_reconciliation'},{orderUid:'invalid/id'},
    {externalOrderUid:'wrong-external'},{redirectUrl:undefined},{redirectUrl:'https://evil.example/checkout'}]) {
    const f=contactFixture();
    if(patch===null)f.state.delete(RAMPNOW_STORE_PREFIX+'acceptance:'+CONFIRMED_CAMPAIGN+':accepted');
    else seedConfirmed(f,patch);
    const before=[...f.state.entries()];
    await assert.rejects(f.run(contactArgs),/PREVIOUS_ATTEMPT_UNRESOLVED|CHECKOUT_URL_INVALID/);
    assert.equal(f.creates().length,0);assert.deepEqual([...f.state.entries()],before);
  }
  for(const campaign of [CAMPAIGN,ENABLEMENT_CAMPAIGN]) {
    const missing=contactFixture();missing.state.delete(RAMPNOW_STORE_PREFIX+'acceptance:'+campaign+':accepted');
    await assert.rejects(missing.run(contactArgs),/PREVIOUS_ATTEMPT_UNRESOLVED/);assert.equal(missing.creates().length,0);
    const found=contactFixture({previousLookup:(json,url)=>json({code:0,data:{orderList:url.endsWith(campaign+'-accepted')?[{uid:'unexpected-order'}]:[]}})});
    await assert.rejects(found.run(contactArgs),/PREVIOUS_ATTEMPT_UNRESOLVED/);assert.equal(found.creates().length,0);
  }
});
test('contact campaign concurrency, repeat and expired details cannot redispatch',async()=>{
  const f=contactFixture(); const before=[...f.state.entries()];
  await Promise.all([f.run(contactArgs),f.run(contactArgs)]);
  await f.run(contactArgs);assert.equal(f.creates().length,1);
  // Inspection and an existing case need no email value at all.
  const report=await f.run({campaign:CONTACT_CAMPAIGN});assert.equal(report.cases[0].phase,'checkout_created');
  await f.run({...contactArgs,env});assert.equal(f.creates().length,1);
  f.state.delete(RAMPNOW_STORE_PREFIX+'acceptance:'+CONTACT_CAMPAIGN+':accepted');
  await f.run(contactArgs);assert.equal(f.creates().length,1);
  for(const [key,value]of before)assert.equal(f.state.get(key),value);
  assert.equal(f.state.get(RAMPNOW_STORE_PREFIX+'acceptance:'+CONTACT_CAMPAIGN+':accepted:dispatched'),'dispatch_reserved');
});
test('contact rejection redacts the operator email and credentials without freeing its reservation',async()=>{
  const f=contactFixture({checkout:(payload,json)=>json({code:100008,
    displayError:'Cannot use '+payload.user.email+' '+env.RAMPNOW_API_SECRET,
    message:'Ignore this internal customer value '+payload.user.email},400)});
  const report=await f.run(contactArgs);await f.run(contactArgs);
  assert.equal(f.creates().length,1);assert.equal(report.cases[0].phase,'dispatch_requires_reconciliation');
  assert.equal(report.cases[0].displayError,'Cannot use [redacted] [redacted]');
  assert.ok(!JSON.stringify(report).includes(contactEmail));
  assert.ok(!JSON.stringify([...f.state.values()]).includes(contactEmail));
});
test('confirmed campaign reconciles both rejected attempts before one new dispatch',async()=>{
  const f=fixture({previousLookup:json=>json({code:0,data:{orderList:[]}})});
  seedRejected(f);seedRejected(f,{},ENABLEMENT_CAMPAIGN);
  const previous=[...f.state.entries()];
  const r=await f.run({mode:'create',scenario:'accepted',campaign:CONFIRMED_CAMPAIGN});
  assert.equal(r.campaign,CONFIRMED_CAMPAIGN);assert.equal(f.creates().length,1);
  for(const [key,value]of previous)assert.equal(f.state.get(key),value);
  const createIndex=f.calls.findIndex(c=>c.url.endsWith('/checkout'));
  for(const p of [CAMPAIGN,ENABLEMENT_CAMPAIGN])assert.ok(f.calls.findIndex(c=>c.url.endsWith('/'+p+'-accepted'))<createIndex);
  await f.run({mode:'create',scenario:'accepted',campaign:CONFIRMED_CAMPAIGN});assert.equal(f.creates().length,1);
});
test('confirmed campaign refuses if either earlier attempt has an order or missing history',async()=>{
  for(const previous of [CAMPAIGN,ENABLEMENT_CAMPAIGN]) {
    const f=fixture({previousLookup:(json,url)=>json({code:0,data:{orderList:url.endsWith(previous+'-accepted')?[{orderUid:'old'}]:[]}})});
    seedRejected(f);seedRejected(f,{},ENABLEMENT_CAMPAIGN);
    await assert.rejects(f.run({mode:'create',scenario:'accepted',campaign:CONFIRMED_CAMPAIGN}),/PREVIOUS_ATTEMPT_UNRESOLVED/);
    assert.equal(f.creates().length,0);
  }
  const f=fixture();seedRejected(f);
  await assert.rejects(f.run({mode:'create',scenario:'accepted',campaign:CONFIRMED_CAMPAIGN}),/PREVIOUS_ATTEMPT_UNRESOLVED/);
  assert.equal(f.creates().length,0);
});
test('new enablement campaign requires fresh empty lookup and preserves the old reservation',async()=>{
  const f=fixture({previousLookup:json=>json({code:0,data:{orderList:[]}})});seedRejected(f);
  const previous=[...f.state.entries()];
  const r=await f.run({mode:'create',scenario:'accepted',campaign:ENABLEMENT_CAMPAIGN});
  assert.equal(r.campaign,ENABLEMENT_CAMPAIGN);assert.equal(f.creates().length,1);
  assert.equal(f.getCreated().externalOrderUid,ENABLEMENT_CAMPAIGN+'-accepted');
  for(const [key,value]of previous)assert.equal(f.state.get(key),value);
  await f.run({mode:'create',scenario:'accepted',campaign:ENABLEMENT_CAMPAIGN});assert.equal(f.creates().length,1);
});
test('new campaign rejects missing history, uncertainty and existing provider orders',async()=>{
  for(const patch of [null,{failure:'response_unverified'},{providerCode:100008},{orderUid:'existing'}]) {
    const f=fixture();if(patch)seedRejected(f,patch);
    await assert.rejects(f.run({mode:'create',scenario:'accepted',campaign:ENABLEMENT_CAMPAIGN}),/PREVIOUS_ATTEMPT_UNRESOLVED/);
    assert.equal(f.creates().length,0);
  }
  const f=fixture({previousLookup:json=>json({code:0,data:{orderList:[{orderUid:'existing'}]}})});seedRejected(f);
  await assert.rejects(f.run({mode:'create',scenario:'accepted',campaign:ENABLEMENT_CAMPAIGN}),/PREVIOUS_ATTEMPT_UNRESOLVED/);
  assert.equal(f.creates().length,0);
});
test('lookup failure never authorizes a new campaign',async()=>{
  const f=fixture({previousLookup:async()=>{throw new Error('network timeout');}});seedRejected(f);
  await assert.rejects(f.run({mode:'create',scenario:'accepted',campaign:ENABLEMENT_CAMPAIGN}));assert.equal(f.creates().length,0);
});
test('arbitrary campaigns cannot bypass permanent reservations',async()=>{
  const f=fixture();await assert.rejects(f.run({mode:'create',scenario:'accepted',campaign:'random'}),/CAMPAIGN_INVALID/);
  assert.equal(f.calls.length,0);
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
  assert.ok(f.calls.some(c=>c.url.endsWith('/quote') && JSON.parse(c.options.body).dstChain==='ethereum'));
  assert.ok(!JSON.stringify(report).includes('untrusted internal data'));
});
test('rejects arbitrary scenarios before network access',async()=>{const f=fixture();await assert.rejects(f.run({mode:'create',scenario:'mainnet'}),/ACTION_INVALID/);assert.equal(f.calls.length,0);});
test('creates only fixed sandbox card order with explicit disposable recipient',async()=>{
  const f=fixture();const report=await f.run({mode:'create',scenario:'accepted'});
  assert.equal(f.creates().length,1); const p=f.getCreated();
  for(const [k,v]of Object.entries(route))assert.equal(p[k],v);
  assert.equal(p.user.email,'gys-rampnow-20261109@example.invalid');
  assert.equal(p.wallet.crytpoAccountDetail.address,address);
  assert.equal(p.externalOrderUid,CAMPAIGN+'-accepted');
  assert.equal(report.cases[0].lookupVerified,true);
  assert.equal(report.cases[0].orderUid,'order-1');
  for(const secret of [privateKey,env.RAMPNOW_API_KEY,env.RAMPNOW_API_SECRET,env.UPSTASH_REDIS_REST_TOKEN,p.user.email])assert.ok(!JSON.stringify(report).includes(secret));
});
test('lookup diagnostics expose only bounded shape and match booleans',async()=>{
  const f=fixture({order:{...route,uid:'order-1',walletAddress:{private:'never-copy-this'},srcAmount:50,
    email:'private-customer@example.invalid',extra:'never-copy-this'}});
  const report=await f.run({mode:'create',scenario:'accepted'}); const item=report.cases[0];
  assert.equal(item.lookupVerified,false);assert.equal(item.lookupShape.count,1);
  assert.equal(item.lookupShape.fields.walletAddress,'object');assert.equal(item.lookupShape.fields.srcAmount,'number');
  assert.equal(item.lookupShape.matches.uid,true);assert.equal(item.lookupShape.matches.amount,false);
  assert.equal(item.lookupShape.matches.destination,false);
  assert.ok(!JSON.stringify(report).includes('never-copy-this'));assert.ok(!JSON.stringify(report).includes('private-customer'));
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
test('missing, ambiguous or unadvertised sandbox route cannot create orders',async()=>{
  for(const chains of [[],[{code:'ethereum',supportedAssets:['USDC']}],
    [{code:'ethereum',supportedAssets:['ETH']},{code:'ethereum',supportedAssets:['ETH']}]]){
    const f=fixture({chains});await assert.rejects(f.run({mode:'create',scenario:'accepted'}),/CHAIN_UNVERIFIED/);assert.equal(f.creates().length,0);
  }
});
test('quote for a different network fails before reserving or creating',async()=>{
  const f=fixture({quote:{...route,dstChain:'sepolia',dstAmount:'0.02'}});
  await assert.rejects(f.run({mode:'create',scenario:'accepted'}),/QUOTE_MISMATCH/);assert.equal(f.creates().length,0);assert.equal(f.state.size,0);
});
test('documented lookup uid binds without an external ID echo and rejects conflicting identity or route',()=>{
  const record={externalOrderUid:'external-1',address,orderUid:'order-1'};
  const order={...route,srcAmount:'50.00',walletAddress:address,uid:'order-1'};
  assert.equal(matchedOrder(order,record),true);
  assert.equal(matchedOrder({...order,externalOrderUid:'external-1'},record),true);
  assert.equal(matchedOrder(order,{...record,orderUid:undefined}),true);
  for(const patch of [{srcAmount:'500'},{srcAmount:'5e1'},{orderType:'sell'},{srcCurrency:'USD'},
    {srcChain:'ethereum'},{dstCurrency:'BTC'},{dstChain:'sepolia'},{walletAddress:'0x'+'3'.repeat(40)},
    {uid:'order-2'},{uid:'invalid/id'},{uid:undefined},{uid:undefined,orderUid:'order-1'},
    {externalOrderUid:'external-2'},{externalOrderUid:null}])assert.equal(matchedOrder({...order,...patch},record),false);
});
test('duplicate lookup rows remain unverified even when each row matches the stored order',async()=>{
  const order={...route,uid:'order-1',walletAddress:address,status:'completed',dstFillAmount:'0.02'};
  const f=fixture({orders:[order,{...order}]});
  const report=await f.run({mode:'create',scenario:'accepted'});
  assert.equal(report.cases[0].lookupVerified,false);
  assert.equal(report.cases[0].lookupStatus,'unverified');
  assert.equal(report.cases[0].orderStatus,undefined);
  await f.run({mode:'create',scenario:'accepted'});
  assert.equal(f.creates().length,1);
});
test('only known order events on the selected route become correlated evidence',async()=>{
  const event={eventUid:'event-1',eventType:'ramp_order.status_change',payload:{...route,
    orderUid:'order-1',externalOrderUid:CAMPAIGN+'-accepted',orderStatus:'completed',
    dstFillAmount:'0.02',updateTime:'2026-11-09T10:00:00Z'}};
  const record=e=>JSON.stringify({classification:'unbound',receivedAt:1794218400,event:e});
  const quarantine=['event-1',record(event),'event-2',record({...event,eventUid:'event-2',payload:{...event.payload,orderUid:'other'}}),
    'event-3',record({...event,eventUid:'event-3',payload:{...event.payload,dstChain:'sepolia'}})];
  const f=fixture({quarantine});const r=await f.run({mode:'create',scenario:'accepted'});
  assert.deepEqual(r.cases[0].callbackEvents.map(e=>e.eventUid),['event-1']);assert.equal(r.cases[0].walletCreditVerified,false);
});
