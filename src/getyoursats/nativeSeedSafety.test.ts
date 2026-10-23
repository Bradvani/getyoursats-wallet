import {describe,it,expect} from 'vitest';
import {readFileSync} from 'node:fs';
describe('GetYourSats native first-run key safety',()=>{
 const app=readFileSync('src/App.tsx','utf8');
 it('retrieves any existing seed before generating a new one',()=>{
   const start=app.indexOf('const handleGetYourSatsStart = async');
   const end=app.indexOf('const handleGetYourSatsManual',start);
   const flow=app.slice(start,end);
   expect(flow.indexOf('deviceOnlyStorage.retrieveSeed()')).toBeGreaterThan(-1);
   expect(flow.indexOf('deviceOnlyStorage.retrieveSeed()')).toBeLessThan(flow.indexOf('bip39.generateMnemonic(128)'));
 });
 it('only creates after explicit proof of an empty vault',()=>{
   expect(app).toContain("err.code === 'NO_STORED_SEED'");
   expect(app).toContain("err instanceof SecureStorageError");
   expect(app).not.toContain('await deviceOnlyStorage.hasStoredSeed()');
 });
 it('validates the new seed is actually recoverable before SDK connect',()=>{
   expect(app).toContain('recovered.mnemonic !== mnemonic');
   expect(app).toContain("sdk.connectWallet(seed, false, undefined, 'secureStorage')");
 });
});