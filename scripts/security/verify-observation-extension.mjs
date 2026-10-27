/** Offline artifact/API checks only. Does not connect a wallet or prove settlement. */
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
const require=createRequire(import.meta.url);
const entry=require.resolve('@breeztech/breez-sdk-spark');
const root=path.resolve(path.dirname(entry),'..');
const sdk=await import('@breeztech/breez-sdk-spark');
assert.equal(typeof sdk.BreezSdk.prototype.observeWalletState,'function');
assert.equal(typeof sdk.BreezSdk.prototype.observePayment,'function');
const manifest=JSON.parse(fs.readFileSync(path.join(root,'getyoursats-build.json'),'utf8'));
assert(manifest.extensions.includes('observation-only-wallet-state-v1'));
assert.equal(manifest.sdkSourceCommit,'57c5b9e5f0749f97ffe5d93bce21c994f6957cf4');
const supported=new Set(['seed-compatible-external-signers-v1','observation-only-wallet-state-v1','signed-recovery-v1','explicit-incoming-claim-v1','bounded-mature-deposit-claim-v1','unreceived-deposit-continuation-v1', 'recovery-signer-envelope-v1']);
for(const extension of manifest.extensions)assert(supported.has(extension),'Unreviewed SDK extension');
for(const [file,digest] of Object.entries(manifest.generatedArtifacts)){
 assert.equal(crypto.createHash('sha256').update(fs.readFileSync(path.join(root,file))).digest('hex'),digest,file);
}
const recovery=manifest.extensions.includes('signed-recovery-v1');
if(recovery){
 for(const method of ['signRefundDeposit','verifyRefundTransaction','inspectRecoveryTransaction'])
  assert.equal(typeof sdk.BreezSdk.prototype[method],'function',method);
}
const incoming=manifest.extensions.includes('explicit-incoming-claim-v1');
if(incoming){
 for(const method of ['claimIncomingTransfer','observeIncomingTransfer'])assert.equal(typeof sdk.BreezSdk.prototype[method],'function',method);
}
if(manifest.extensions.includes('bounded-mature-deposit-claim-v1')){for(const method of ['claimMatureDepositOnce','observeDepositClaim'])assert.equal(typeof sdk.BreezSdk.prototype[method],'function',method);}
const continuation=manifest.extensions.includes('unreceived-deposit-continuation-v1');
if(continuation)assert.equal(typeof sdk.BreezSdk.prototype.continueMatureDepositClaim,'function');
const patch=fs.readFileSync(continuation?'vendor/patches/0005-operation-recovery-source.patch':incoming?'vendor/patches/0004-complete-signed-recovery-source.patch':recovery?'vendor/patches/0003-signed-recovery-continuation.patch':'vendor/patches/0002-observation-only-wallet-state.patch');
assert.equal(crypto.createHash('sha256').update(patch).digest('hex'),manifest.patchSha256);
console.log(JSON.stringify({test:'installed observation/recovery API and artifact integrity',result:'PASS',
 extensions:manifest.extensions,artifacts:Object.keys(manifest.generatedArtifacts).length,networkCalls:0}));
