import {describe,it,expect} from 'vitest';
import {chooseWalletOnboarding, approvedGetYourSatsOrigin, shouldDiscoverExistingPasskey} from './onboardingPolicy';
const cfg={
  prfAvailable:true,origin:'https://wallet.getyoursats.com',
  approvedWebOrigin:'https://wallet.getyoursats.com',isNative:false,nativeAssociationVerified:false,
};
describe('wallet onboarding guard',()=>{
 it('uses synced-capable passkey PRF on the approved canonical origin',()=>{
   expect(chooseWalletOnboarding(cfg)).toBe('passkey');
 });
 it('never creates a passkey wallet on a temporary Vercel preview',()=>{
   expect(chooseWalletOnboarding({...cfg,origin:'https://wallet-git-feature-123.vercel.app'})).toBe('manual');
 });
 it('fails closed when the canonical origin is unconfigured',()=>{
   expect(chooseWalletOnboarding({...cfg,approvedWebOrigin:undefined})).toBe('manual');
 });
 it('requires PRF compatibility, not merely passkey support',()=>{
   expect(chooseWalletOnboarding({...cfg,prfAvailable:false})).toBe('manual');
 });
 it('requires native app RP/cert association approval',()=>{
   expect(chooseWalletOnboarding({...cfg,isNative:true})).toBe('manual');
   expect(chooseWalletOnboarding({...cfg,isNative:true,nativeAssociationVerified:true})).toBe('passkey');
 });
 it('rejects malformed, http and path-scoped approved origins',()=>{
   for(const url of ['not-a-url','http://wallet.getyoursats.com','https://wallet.getyoursats.com/folder']){
      expect(chooseWalletOnboarding({...cfg,approvedWebOrigin:url})).toBe('manual');
   }
 });
});

describe('known wallet origin activation',()=>{
 it('accepts the verified canonical wallet',()=>{
   expect(approvedGetYourSatsOrigin('https://wallet.getyoursats.com')).toBe('https://wallet.getyoursats.com');
 });
 it('does not trust random preview names or parent domains',()=>{
   expect(approvedGetYourSatsOrigin('https://getyoursats-wallet-any.vercel.app')).toBeUndefined();
   expect(approvedGetYourSatsOrigin('https://getyoursats.com')).toBeUndefined();
   expect(approvedGetYourSatsOrigin('http://wallet.getyoursats.com')).toBeUndefined();
 });
});

describe('Start passkey ceremony selection',()=>{
 it('avoids cross-device passkey discovery on a fresh mobile browser',()=>{
  expect(shouldDiscoverExistingPasskey(null,null)).toBe(false);
  expect(shouldDiscoverExistingPasskey('0',null)).toBe(false);
 });
 it('reuses an established passkey instead of silently creating new wallet keys',()=>{
  expect(shouldDiscoverExistingPasskey('1',null)).toBe(true);
  expect(shouldDiscoverExistingPasskey(null,'Default')).toBe(true);
 });
});
