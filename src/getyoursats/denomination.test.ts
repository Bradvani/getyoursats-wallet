import {describe,it,expect} from 'vitest';
import {amountToSats,satsToAmount,getDenomination,saveDenomination,currencyDecimals} from './denomination';
describe('global sats BTC fiat denominations',()=>{
 it('converts exactly 1 BTC',()=>expect(amountToSats('1.00000000','BTC')).toBe(100000000));
 it('keeps integer sats exact',()=>expect(amountToSats('123','sats')).toBe(123));
 it('uses an actual fiat/BTC rate for USD',()=>{
  expect(amountToSats('50','USD',50000)).toBe(100000);
  expect(satsToAmount(100000,'USD',50000)).toBe('50.00');
 });
 it('accepts JPY zero-decimal currency without allowing fractions',()=>{
  expect(currencyDecimals('JPY')).toBe(0);
  expect(amountToSats('50','JPY',10000000)).toBe(500);
  expect(amountToSats('50.5','JPY',10000000)).toBeNull();
 });
 it('preserves previously saved INR for returning users',()=>{
  expect(amountToSats('50','INR',5000000)).toBe(1000);
  expect(satsToAmount(1000,'INR',5000000)).toBe('50.00');
 });
 it('rejects fake fiat quotes and invalid amounts',()=>{
  expect(amountToSats('20','USD')).toBeNull();
  for(const v of ['-1','0','1e8','NaN','12.5'])expect(amountToSats(v,'sats')).toBeNull();
  expect(amountToSats('0.000000001','BTC')).toBeNull();
  expect(amountToSats('999999999999999999','sats')).toBeNull();
 });
 it('persists the current denomination safely',()=>{
  saveDenomination('EUR');expect(getDenomination()).toBe('EUR');
  saveDenomination('sats');expect(getDenomination()).toBe('sats');
  expect(()=>saveDenomination('USD;DROP')).toThrow();
 });
});
