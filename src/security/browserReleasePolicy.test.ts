import {describe,it,expect} from 'vitest';
import type {BreezSdk,InputType} from '@breeztech/breez-sdk-spark';
import {BROWSER_SPENDING_POLICY,browserPaymentRestriction,browserReceivingRestriction,isRestrictedBrowserWallet} from './browserReleasePolicy';
import {DEPOSIT_CLAIMS} from './depositClaimController';
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
describe('browser receiving availability',()=>{
 it.each(['bolt11Invoice','bitcoinAddress','crossChain'] as const)('blocks unsupported %s receiving',type=>{
  expect(browserReceivingRestriction(wallet,type)).toMatch(/unavailable/);
 });
 it.each(['sparkAddress','sparkInvoice'] as const)('retains direct Spark %s receiving',type=>{
  expect(browserReceivingRestriction(wallet,type)).toBeNull();
 });
 it('only enables Bitcoin receipt creation when the bounded deposit capability exists',()=>{
  const fixture={[BROWSER_SPENDING_POLICY]:true,[DEPOSIT_CLAIMS]:{list:()=>{},claim:()=>{},reconcile:()=>{}}} as unknown as BreezSdk;
  expect(browserReceivingRestriction(fixture,'bitcoinAddress')).toBeNull();
  expect(browserReceivingRestriction(fixture,'bolt11Invoice')).toMatch(/unavailable/);
 });
 it('does not mistake a generic adapter method for a deposit claim capability',()=>{
  const fixture=new Proxy({} as BreezSdk,{get:(_target,key)=>key===BROWSER_SPENDING_POLICY?true:()=>{}});
  expect(browserReceivingRestriction(fixture,'bitcoinAddress')).toMatch(/unavailable/);
 });
 it('leaves native receive policy to its implementation',()=>{
  expect(browserReceivingRestriction({} as BreezSdk,'bolt11Invoice')).toBeNull();
 });
});
