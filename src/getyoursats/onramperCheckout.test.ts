import {describe,expect,it} from 'vitest';
import {onramperAvailable,onramperBuyUrl} from './onramperCheckout';

describe('GetYourSats hosted fiat buy handoff',()=>{
 const key='pk_prod_ValidPartner123';
 it('fails closed without explicit mainnet partner activation',()=>{
  expect(onramperAvailable(undefined,key,'mainnet')).toBe(false);
  expect(onramperAvailable('false',key,'mainnet')).toBe(false);
  expect(onramperAvailable('true',undefined,'mainnet')).toBe(false);
  expect(onramperAvailable('true',key,'regtest')).toBe(false);
  expect(onramperAvailable('true',key,'mainnet')).toBe(true);
 });
 it('opens a restricted buy-only hosted checkout without injecting Spark keys or addresses',()=>{
  const url=new URL(onramperBuyUrl(key));
  expect(url.origin).toBe('https://buy.onramper.com');
  expect(url.searchParams.get('apiKey')).toBe(key);
  expect(url.searchParams.get('mode')).toBe('buy');
  expect(url.searchParams.get('onlyCryptos')).toBe('btc');
  expect(url.searchParams.get('onlyCryptoNetworks')).toBe('bitcoin');
  expect(url.searchParams.get('redirectAtCheckout')).toBe('false');
  for(const name of ['wallets','networkWallets','walletAddress','signature','email','paymentMethod'])
   expect(url.searchParams.has(name)).toBe(false);
 });
 it('rejects junk URL injections or unapproved test keys',()=>{
  expect(()=>onramperBuyUrl('pk_prod_bad&networkWallets=attacker')).toThrow();
  expect(()=>onramperBuyUrl('pk_test_fake')).toThrow();
 });
});
