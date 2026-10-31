import {describe,it,expect} from 'vitest';
import {checkedOverview} from './MarketOverview';
describe('public market overview validation',()=>{
  it('rejects malformed and stale data without suppressing an independently valid feed',()=>{
    const now=Date.now();
    const sentiment={value:0,classification:'Extreme Fear' as const,updatedAt:now-3600000};
    expect(checkedOverview({supply:{btc:21000001,updatedAt:now},sentiment},now)).toEqual({supply:null,sentiment});
    expect(checkedOverview({supply:null,sentiment:{...sentiment,updatedAt:now-172800001}},now).sentiment).toBeNull();
    expect(checkedOverview({supply:null,sentiment:{...sentiment,value:1000}},now).sentiment).toBeNull();
  });
});
