import {describe,it,expect} from 'vitest';
import {validateDcaDraft} from './dcaPlan';
describe('DCA drafts cannot be mistaken for active mandates',()=>{
 it('validates the INR 20 equivalent minimum',()=>{
  const a=validateDcaDraft({amount:'20',denomination:'INR',frequency:'weekly',inrPerBtc:5_000_000});
  expect(a.draft?.status).toBe('draft');expect(a.draft?.estimatedSats).toBe(400);
 });
 it('refuses to price using imaginary INR rates',()=>{
  expect(validateDcaDraft({amount:'0.0001',denomination:'BTC',frequency:'daily'}).draft).toBeUndefined();
 });
 it('rejects amounts below ₹20 and invalid frequency',()=>{
  expect(validateDcaDraft({amount:'19',denomination:'INR',frequency:'weekly',inrPerBtc:5_000_000}).error).toMatch(/minimum/);
  expect(validateDcaDraft({amount:'25',denomination:'INR',frequency:'invalid' as never,inrPerBtc:5_000_000}).error).toMatch(/interval/);
 });
});
