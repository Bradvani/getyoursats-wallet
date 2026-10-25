import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {stripTypeScriptTypes} from 'node:module';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
const root=fileURLToPath(new URL('../../',import.meta.url));
const base=join(root,'node_modules')+'/';
const req=createRequire(base+'bip39/package.json');
const {mnemonicToSeedSync}=req('bip39');
const {HDKey}=await import(base+'@scure/bip32/index.js');
const sdk=await import(base+'@breeztech/breez-sdk-spark/web/breez_sdk_spark_wasm.js');
const wasmBytes=readFileSync(base+'@breeztech/breez-sdk-spark/web/breez_sdk_spark_wasm_bg.wasm');
sdk.initSync({module:wasmBytes});
// Published BIP39 fixture only. No SDK build/connect/storage/network calls.
const mnemonic='abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
let comparisons=0;
const keys={};
for(const network of ['mainnet','regtest','signet']){
  for(const passphrase of [undefined,'disposable test passphrase']){
    for(const account of [undefined,0,7]){
      const material=mnemonicToSeedSync(mnemonic,passphrase);
      const path=`m/8797555'/${account??(network==='mainnet'?1:0)}'/0'`;
      const expected=HDKey.fromMasterSeed(material).derive(path).publicKey;
      const handles=sdk.defaultExternalSigners(mnemonic,passphrase,network,account);
      const breez=handles.breezSigner;
      const spark=handles.sparkSigner;
      handles.free();
      try{
        const sparkKey=await spark.getIdentityPublicKey();
        const breezKey=await breez.derivePublicKey('m');
        assert.deepEqual(Buffer.from(sparkKey.bytes),Buffer.from(expected));
        assert.deepEqual(Buffer.from(breezKey.bytes),Buffer.from(expected));
        comparisons+=2;
        if(!passphrase&&account===undefined)keys[network]=Buffer.from(expected).toString('hex');
      }finally{breez.free();spark.free();}
    }
  }
}
assert.notEqual(keys.mainnet,keys.regtest);
assert.equal(keys.regtest,keys.signet);
console.log(JSON.stringify({test:'installed WASM identity preservation',result:'PASS',comparisons,seedFixtures:2,networks:3,accountModes:3,wasmSha256:createHash('sha256').update(wasmBytes).digest('hex'),publicFixtureIdentity:keys,networkCalls:0},null,2));

// Verify the compiled seed-compatible factory against independent BIP32 roots.
// Raw Seed::Entropy is BIP32 seed material; treating it as mnemonic entropy
// changes the wallet. These fixtures are public and never connected to Spark.
assert.equal(typeof sdk.defaultExternalSignersFromSeed,'function');
let seedFactoryComparisons=0;
const rawFixtures=[Array(32).fill(1),Array.from({length:64},(_,i)=>i)];
for(const network of ['mainnet','regtest','signet']){
 for(const account of [undefined,0,7]){
  const cases=[
   ...[undefined,'disposable test passphrase'].map(passphrase=>({
    seed:{type:'mnemonic',mnemonic,passphrase},
    material:mnemonicToSeedSync(mnemonic,passphrase),
   })),
   ...rawFixtures.map(raw=>({seed:Object.assign([...raw],{type:'entropy'}),material:Buffer.from(raw)})),
  ];
  for(const {seed,material} of cases){
   const accountPath=`m/8797555'/${account??(network==='mainnet'?1:0)}'/0'`;
   const expected=HDKey.fromMasterSeed(material).derive(accountPath);
   const handles=sdk.defaultExternalSignersFromSeed(seed,network,account);
   const breez=handles.breezSigner,spark=handles.sparkSigner;handles.free();
   try{
    assert.deepEqual(Buffer.from((await spark.getIdentityPublicKey()).bytes),Buffer.from(expected.publicKey));
    assert.deepEqual(Buffer.from((await breez.derivePublicKey('m')).bytes),Buffer.from(expected.publicKey));
    seedFactoryComparisons+=2;
    if(seed.type==='mnemonic'){
     const old=sdk.defaultExternalSigners(mnemonic,seed.passphrase,network,account);
     const oldBreez=old.breezSigner,oldSpark=old.sparkSigner;old.free();
     try{
      assert.deepEqual((await breez.signEcdsa({bytes:Array(32).fill(42)},"m/2'/7")).bytes,
        (await oldBreez.signEcdsa({bytes:Array(32).fill(42)},"m/2'/7")).bytes);
      assert.deepEqual((await spark.getStaticDepositPublicKey(3)).bytes,
        (await oldSpark.getStaticDepositPublicKey(3)).bytes);
      seedFactoryComparisons+=2;
     }finally{oldBreez.free();oldSpark.free();}
    }
   }finally{breez.free();spark.free();}
  }
 }
}
console.log(JSON.stringify({test:'compiled seed factory identity and derivation',result:'PASS',
 comparisons:seedFactoryComparisons,rawSeedByteLengths:[32,64],networks:3,accountModes:3,networkCalls:0}));

// Execute the current application guard against the actual browser WASM handles.
// Type erasure only: the source implementation is read from this checkout.
// No SDK build/connect, storage backend, wallet API or network calls are made.
const temp=mkdtempSync(join(tmpdir(),'gys-wasm-guard-'));
try {
  globalThis.document=new EventTarget();
  Object.defineProperty(document,'visibilityState',{value:'visible',writable:true});
  globalThis.window=new EventTarget();
  for(const name of ['spendApproval','guardedExternalSigners']){
    const original=readFileSync(join(root,'src/security',name+'.ts'),'utf8');
    const code=original.replace("from './spendApproval'","from './spendApproval.mjs'");
    writeFileSync(join(temp,name+'.mjs'),stripTypeScriptTypes(code,{mode:'transform'}));
  }
  const {guardExternalSigners}=await import(pathToFileURL(join(temp,'guardedExternalSigners.mjs')).href);
  const {rememberSignerIdentity,lockSpendingSession}=await import(pathToFileURL(join(temp,'spendApproval.mjs')).href);
  for(const seed of [{type:'mnemonic',mnemonic},Object.assign(Array(32).fill(1),{type:'entropy'}),Object.assign(Array(64).fill(2),{type:'entropy'})]){
  await rememberSignerIdentity(seed);
  const guard=guardExternalSigners(sdk.defaultExternalSignersFromSeed(seed,'mainnet',undefined));
  assert.equal(guard.sparkSigner.isRemote(),false);
  assert.equal((await guard.sparkSigner.getIdentityPublicKey()).bytes.length,33);
  assert.equal((await guard.sparkSigner.signMessage([1,2,3])).bytes.length,64);
  const pending=guard.breezSigner.signEcdsa({bytes:Array(32).fill(42)},'m');
  lockSpendingSession();
  await assert.rejects(pending,/locked|replaced|changed/);
  await assert.rejects(guard.sparkSigner.signMessage([1,2,3]),/locked|replaced/);
  assert.throws(()=>guard.sparkSigner.isRemote(),/locked|replaced/);
  await guard.dispose();
  await guard.dispose();
  console.log(JSON.stringify({test:'installed WASM application signer guard',result:'PASS',assertions:6,seedType:seed.type,seedByteLength:Array.isArray(seed)?seed.length:undefined,idempotentDisposal:true,networkCalls:0}));
  }
} finally {
  rmSync(temp,{recursive:true,force:true});
}
