import {describe,it,expect} from 'vitest';
import {MARKET_QUOTE_UNITS,marketFiatValue,formatMarketFiat} from './marketQuoteUnits';

describe('GetYourSats market denomination carousel',()=>{
 it('covers 1 BTC and approachable 1K through 10M satoshi equivalents',()=>{
   expect(MARKET_QUOTE_UNITS.map(x=>x.label)).toEqual([
     '1 BTC','1K sats','10K sats','100K sats','1M sats','10M sats',
   ]);
   expect(MARKET_QUOTE_UNITS.map(x=>x.satoshis)).toEqual([
     100_000_000,1_000,10_000,100_000,1_000_000,10_000_000,
   ]);
 });
 it('calculates value from one SDK BTC/fiat rate without additional rounding in sats',()=>{
   expect(MARKET_QUOTE_UNITS.map(x=>marketFiatValue(90_000,x.satoshis)))
     .toEqual([90000,0.9,9,90,900,9000]);
   expect(marketFiatValue(90_000, 1_000)).toBeCloseTo(0.9);
 });
 it('never invents a quote when SDK data is missing, invalid or stale',()=>{
   for(const invalid of [undefined,null,NaN,Infinity,0,-5]){
     expect(marketFiatValue(invalid,1_000)).toBeNull();
   }
   expect(formatMarketFiat(undefined,'USD',1_000,'en-US')).toBe('Rate unavailable');
 });
 it('formats global fiat with the selected currency and keeps small quotes legible',()=>{
   expect(formatMarketFiat(90_000,'USD',1_000,'en-US')).toBe('$0.90');
   expect(formatMarketFiat(90_000,'USD',100_000,'en-US')).toBe('$90.00');
   expect(formatMarketFiat(90_000,'USD',100_000_000,'en-US')).toBe('$90,000.00');
 });
});
