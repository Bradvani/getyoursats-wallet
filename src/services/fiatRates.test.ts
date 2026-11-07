import {afterEach, expect, it, vi} from 'vitest';
import {boundedFiatRequest, currenciesForRates, loadFiatRates} from './fiatRates';
const snapshot=()=>({base:'BTC',source:'coinbase',fetchedAt:Date.now()-30000,rates:[{coin:'USD',value:80000},{coin:'INR',value:7200000}]});
afterEach(()=>{vi.unstubAllGlobals();vi.useRealTimers();});

it('recovers an empty SDK feed and preserves the fallback snapshot time',async()=>{
  const data=snapshot();vi.stubGlobal('fetch',vi.fn().mockResolvedValue(Response.json(data)));
  const result=await loadFiatRates({listFiatRates:vi.fn().mockResolvedValue({rates:[]})});
  expect(result).toEqual({rates:data.rates,fetchedAt:data.fetchedAt});
});

it.each([
  {base:'USD'}, {source:'unknown'}, {fetchedAt:1}, {fetchedAt:Date.now()+600000},
  {rates:[]}, {rates:[{coin:'USD',value:0}]}, {rates:[{coin:'USD',value:'80000'}]},
  {rates:[{coin:'USD',value:80000},{coin:'USD',value:90000}]},
])('rejects invalid or stale fallback data %#',async patch=>{
  vi.stubGlobal('fetch',vi.fn().mockResolvedValue(Response.json({...snapshot(),...patch})));
  await expect(loadFiatRates({listFiatRates:vi.fn().mockRejectedValue(new Error('offline'))})).rejects.toThrow();
});

it('does not wait indefinitely for a stalled SDK request',async()=>{
  vi.useFakeTimers();const pending=boundedFiatRequest(new Promise(()=>{}),100);
  const check=expect(pending).rejects.toThrow('timed out');
  await vi.advanceTimersByTimeAsync(100);await check;
});

it('fills missing currency metadata without replacing existing labels',()=>{
  const known={id:'INR',info:{name:'Indian rupee',fractionSize:2,localizedName:[],localeOverrides:[]}};
  const result=currenciesForRates(snapshot().rates,[known]);
  expect(result.find(x=>x.id==='INR')).toBe(known);
  expect(result.find(x=>x.id==='USD')?.info.fractionSize).toBe(2);
});
