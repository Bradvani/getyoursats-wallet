import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createMarketOverviewHandler,parseSupply,parseSentiment} from '../server/marketOverview.mjs';
const now=1793400000000;
const supply={totalbc:2010000012345678,timestamp:now-1000};
const sentiment={data:[{value:'30',value_classification:'Fear',timestamp:String(now/1000-3600)}],metadata:{error:null}};
const response=()=>({headers:{},setHeader(k,v){this.headers[k]=v;},end(v){this.body=JSON.parse(v);}});
test('supply validates integer satoshis and preserves upstream time',()=>{
  assert.deepEqual(parseSupply(supply,now),{btc:20100000.12345678,updatedAt:now-1000,source:'blockchain.com'});
  for(const totalbc of [-1,0,NaN,21e14+1,'20100000',1.5])assert.throws(()=>parseSupply({...supply,totalbc},now));
  for(const timestamp of [now+61000,now-21600001,0,NaN])assert.throws(()=>parseSupply({...supply,timestamp},now));
});
test('sentiment accepts zero but rejects bad numbers, unknown classifications and stale daily data',()=>{
  assert.equal(parseSentiment(sentiment,now).value,30);
  const point=sentiment.data[0];
  assert.equal(parseSentiment({data:[{...point,value:'0'}]},now).value,0);
  for(const value of ['101','30x','-1','NaN',null,30])assert.throws(()=>parseSentiment({data:[{...point,value}]},now));
  assert.throws(()=>parseSentiment({data:[{...point,value_classification:'Buy now'}]},now));
  assert.throws(()=>parseSentiment(sentiment,now+172800001));
});
test('feeds fail independently, use fixed destinations and do not forward user input',async()=>{
  const calls=[];
  const handler=createMarketOverviewHandler({now:()=>now,fetchImpl:async(url,options)=>{
    calls.push([url,options]);
    if(url.includes('alternative'))throw new Error('offline');
    return Response.json(supply);
  }});
  const res=response();await handler({method:'GET',query:{currency:'INR',wallet:'sensitive'}},res);
  assert.equal(res.statusCode,200);assert.equal(res.body.supply.btc,20100000.12345678);assert.equal(res.body.sentiment,null);
  assert.equal(calls.length,2);assert.ok(calls.every(([url,options])=>!url.includes('sensitive')&&!options.body));
});
test('concurrent requests share cache; expiry retries without stamping old data as fresh',async()=>{
  let time=now,calls=0;
  const handler=createMarketOverviewHandler({now:()=>time,fetchImpl:async url=>{calls++;return Response.json(url.includes('alternative')?sentiment:supply);}});
  const responses=await Promise.all(Array.from({length:6},async()=>{const r=response();await handler({method:'GET'},r);return r;}));
  assert.equal(calls,2);assert.ok(responses.every(r=>r.body.supply.updatedAt===now-1000));
  time+=300001;await handler({method:'GET'},response());assert.equal(calls,4);
  time+=172800001;const r=response();await handler({method:'GET'},r);
  assert.equal(r.statusCode,503);assert.deepEqual(r.body,{supply:null,sentiment:null});
});
test('oversized upstream responses and unsupported methods fail closed',async()=>{
  let calls=0;
  const handler=createMarketOverviewHandler({now:()=>now,fetchImpl:async()=>{calls++;return new Response('x'.repeat(70000));}});
  const post=response();await handler({method:'POST'},post);assert.equal(post.statusCode,405);assert.equal(calls,0);
  const get=response();await handler({method:'GET'},get);assert.equal(get.statusCode,503);
});
