// Exercise the JS browser implementation explicitly, not its Node crypto shim.
// All input material is public and disconnected from any wallet/network.
import assert from 'node:assert/strict';
import {pbkdf2Sync as nativePbkdf2} from 'node:crypto';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const browserPbkdf2=require('pbkdf2/lib/sync-browser.js');
const mnemonic='abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
assert.equal(browserPbkdf2(mnemonic,'mnemonicTREZOR',2048,64,'sha512').toString('hex'),
 'c55257c360c07c72029aebc1b53c05ed0362ada38ead3e3e9efa3708e53495531f09a6987599d18264c1e1c92f2cf141630c7a3c4ab7c81b2f001698e7463b04');
let comparisons=1;
for(const digest of ['sha256','sha512']){
 for(const size of [0,63,64,65,127,128,129,1024]){
  const password=Buffer.alloc(size,0xa5),salt=Buffer.from('public regression salt');
  assert.deepEqual(browserPbkdf2(password,salt,1024,64,digest),nativePbkdf2(password,salt,1024,64,digest));
  comparisons++;
 }
}
console.log(JSON.stringify({test:'browser PBKDF2 identity compatibility',comparisons,result:'PASS',networkCalls:0}));
