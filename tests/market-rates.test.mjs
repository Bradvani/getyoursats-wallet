import {test} from 'node:test';
import assert from 'node:assert/strict';
import {fetchMarketRates,createMarketRatesHandler} from '../server/marketRates.mjs';
const body={data:{currency:'BTC',rates:{USD:'80000',INR:'7200000',JPY:'12000000',BTC:'1',ETH:'20',BAD:'0'}}};
function response(data=body,headers={}){return Response.json(data,{headers});}
function result(){return {statusCode:0,headers:{},setHeader(k,v){this.headers[k]=v;},end(text){this.body=JSON.parse(text);}};}

test('public BTC rates use a fixed endpoint and exclude crypto symbols',async()=>{
  const market=await fetchMarketRates(async(url,options)=>{
    assert.equal(url,'https://api.coinbase.com/v2/exchange-rates?currency=BTC');
    assert.equal(options.redirect,'error');assert.equal(options.headers.Authorization,undefined);
    return response();
  },()=>1000000);
  assert.equal(market.base,'BTC');assert.equal(market.fetchedAt,1000000);
  assert.equal(market.rates.find(x=>x.coin==='INR').value,7200000);
  assert.equal(market.rates.find(x=>x.coin==='USD').value,80000);
  assert.equal(market.rates.find(x=>x.coin==='ETH'),undefined);
  assert.equal(market.rates.find(x=>x.coin==='BTC'),undefined);
});
test('upstream cache age remains in the published rate timestamp',async()=>{
  const market=await fetchMarketRates(async()=>response(body,{age:'30'}),()=>1000000);
  assert.equal(market.fetchedAt,970000);
  await assert.rejects(fetchMarketRates(async()=>response(body,{age:'180'})));
});
test('invalid base, empty values, oversized data and upstream errors fail closed',async()=>{
  for(const data of [{data:{...body.data,currency:'USD'}},{data:{currency:'BTC',rates:{USD:'NaN'}}},
    {data:{currency:'BTC',rates:{USD:'-1'}}},{data:{currency:'BTC',rates:[]}}])
    await assert.rejects(fetchMarketRates(async()=>response(data)));
  await assert.rejects(fetchMarketRates(async()=>new Response('x'.repeat(128*1024+1))));
  await assert.rejects(fetchMarketRates(async()=>new Response('',{status:429})));
});
test('concurrent reads share an upstream request and cached timestamps never advance',async()=>{
  let calls=0,clock=1000000,release;
  const wait=new Promise(resolve=>{release=resolve;});
  const handler=createMarketRatesHandler({now:()=>clock,fetchImpl:async()=>{calls++;await wait;return response();}});
  const a=result(),b=result();const one=handler({method:'GET'},a),two=handler({method:'GET'},b);
  release();await Promise.all([one,two]);assert.equal(calls,1);assert.deepEqual(a.body,b.body);
  clock+=10000;const c=result();await handler({method:'GET'},c);
  assert.equal(calls,1);assert.equal(c.body.fetchedAt,1000000);
  assert.match(c.headers['Cache-Control'],/s-maxage=30/);
});
test('expired cache and upstream failure return unavailable instead of a fresh-looking old price',async()=>{
  let clock=1000000,fail=false;
  const handler=createMarketRatesHandler({now:()=>clock,fetchImpl:async()=>{if(fail)throw Error('offline');return response();}});
  await handler({method:'GET'},result());clock+=30000;fail=true;
  const res=result();await handler({method:'GET'},res);
  assert.equal(res.statusCode,503);assert.equal(res.headers['Cache-Control'],'no-store');
  assert.equal(res.body.rates,undefined);
});
test('unsupported methods do not contact the feed',async()=>{
  const handler=createMarketRatesHandler({fetchImpl:async()=>{throw Error('must not fetch');}});
  const res=result();await handler({method:'POST'},res);assert.equal(res.statusCode,405);
});
