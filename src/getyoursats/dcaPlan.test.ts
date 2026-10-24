import {describe,it,expect} from 'vitest';
import {validateDcaDraft} from './dcaPlan';
describe('Global fiat recurring buy draft, not an active payment mandate',()=>{
 it('validates USD plans using a real quoted fiat per BTC rate',()=>{
  const a=validateDcaDraft({amount:'20',denomination:'USD',frequency:'weekly',fiatCurrency:'USD',fiatPerBtc:50_000});
  expect(a.draft?.status).toBe('draft');
  expect(a.draft?.estimatedSats).toBe(40000);
  expect(a.draft?.fiatCurrency).toBe('USD');
 });
 it('rejects missing fiat quote rather than inventing a price',()=>{
  expect(validateDcaDraft({amount:'0.0001',denomination:'BTC',frequency:'daily'}).draft).toBeUndefined();
 });
 it('does not impose a fictitious India-only minimum globally',()=>{
  expect(validateDcaDraft({amount:'0.10',denomination:'USD',frequency:'weekly',fiatCurrency:'USD',fiatPerBtc:50_000}).draft?.status).toBe('draft');
 });
 it('rejects invalid frequency and overprecision',()=>{
  expect(validateDcaDraft({amount:'25',denomination:'USD',frequency:'invalid' as never,fiatPerBtc:50_000}).error).toMatch(/interval/);
  expect(validateDcaDraft({amount:'0.000000001',denomination:'BTC',frequency:'weekly',fiatPerBtc:50_000}).draft).toBeUndefined();
 });
});
