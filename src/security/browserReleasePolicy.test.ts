import {describe,it,expect} from 'vitest';
import type {BreezSdk,InputType} from '@breeztech/breez-sdk-spark';
import {BROWSER_SPENDING_POLICY,browserPaymentRestriction,isRestrictedBrowserWallet} from './browserReleasePolicy';
const wallet={[BROWSER_SPENDING_POLICY]:true} as unknown as BreezSdk;
describe('browser unavailable payment handling',()=>{
 it.each(['crossChainAddress','sparkInvoice','bolt12Offer','lnurlAuth','lnurlWithdraw'])('stops unsupported %s before amount or approval UI',type=>{
  expect(browserPaymentRestriction(wallet,{type} as InputType)).toMatch(/temporarily unavailable/);
 });
 it.each(['bitcoinAddress','bolt11Invoice','sparkAddress','lnurlPay','lightningAddress'])('allows supported %s into review',type=>{
  expect(browserPaymentRestriction(wallet,{type} as InputType)).toBeNull();
 });
 it('leaves native policy to the native implementation',()=>{
  expect(isRestrictedBrowserWallet({} as BreezSdk)).toBe(false);
  expect(browserPaymentRestriction({} as BreezSdk,{type:'crossChainAddress'} as InputType)).toBeNull();
 });
});
