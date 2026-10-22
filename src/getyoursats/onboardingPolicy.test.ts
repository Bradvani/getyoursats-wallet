import {describe,it,expect} from 'vitest';
import {chooseWalletOnboarding} from './onboardingPolicy';
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
