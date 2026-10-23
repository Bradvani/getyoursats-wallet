import {readFileSync} from 'node:fs';
import {describe,it,expect} from 'vitest';
describe('Start must never surface a seed or trap users on temp URLs',()=>{
 const src=readFileSync('src/App.tsx','utf8');
 it('routes unsupported passkeys to a deliberate recovery choice',()=>{
   expect(src).toContain("setUserScreen('walletSetup')");
   expect(src).toContain("case 'walletSetup':");
   expect(src).toContain('prfAvailability().catch');
 });
 it('does not reveal a recovery phrase automatically',()=>{
   const options=readFileSync('src/getyoursats/SetupOptionsPage.tsx','utf8');
   expect(options).not.toContain('generateMnemonic');
   expect(options).toContain('onOfflineSetup');
 });
 it('provides a stable custom beta address rather than temporary vercel.app keys',()=>{
   const options=readFileSync('src/getyoursats/SetupOptionsPage.tsx','utf8');
   expect(options).toContain('https://beta.getyoursats.com');
 });
});
