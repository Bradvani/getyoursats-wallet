import {describe,it,expect} from 'vitest';
import {amountToSats,satsToAmount,getDenomination,saveDenomination} from './denomination';
describe('sats BTC INR unit input',()=>{
  it('converts 1 BTC exactly to 100 million sats',()=>expect(amountToSats('1.00000000','BTC')).toBe(100000000));
  it('converts 123 sats exactly',()=>expect(amountToSats('123','sats')).toBe(123));
  it('uses an explicit BTC/INR rate, not a fixed fake market quote',()=>{
     expect(amountToSats('50','INR',5_000_000)).toBe(1000);
     expect(satsToAmount(1000,'INR',5_000_000)).toBe('50.00');
  });
  it('rejects INR input without a valid rate',()=>expect(amountToSats('20','INR')).toBeNull());
  it('rejects overprecision, zero, negatives, nonnumbers and unsafe sats',()=>{
    for(const v of ['-1','0','1e8','NaN','12.5'])expect(amountToSats(v,'sats')).toBeNull();
    expect(amountToSats('0.000000001','BTC')).toBeNull();
    expect(amountToSats('1.001','INR',5_000_000)).toBeNull();
    expect(amountToSats('999999999999999999','sats')).toBeNull();
  });
  it('does not turn rounded INR into zero-value invoices',()=>{
    expect(amountToSats('0.01','INR',20_000_000)).toBeNull();
  });
  it('formats smaller BTC units',()=>expect(satsToAmount(1000,'BTC')).toBe('0.00001'));
  it('persists shared denomination preference',()=>{
    saveDenomination('INR');expect(getDenomination()).toBe('INR');saveDenomination('sats');
  });
});
