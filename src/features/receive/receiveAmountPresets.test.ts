import {describe,it,expect} from 'vitest';
import {receiveAmountPresets} from './receiveAmountPresets';
describe('currency-first receive presets',()=>{
  it('gives meaningful sats and BTC amounts',()=>{
    expect(receiveAmountPresets('sats')).toEqual(['1000','5000','10000']);
    expect(receiveAmountPresets('BTC')).toEqual(['0.00001','0.00005','0.0001']);
  });
  it('uses sensible fiat presets and stable-balance mode',()=>{
    expect(receiveAmountPresets('INR')).toEqual(['100','500','1000']);
    expect(receiveAmountPresets('USD')).toEqual(['5','20','50']);
    expect(receiveAmountPresets('sats',true)).toEqual(['5','20','50']);
  });
});
