/** Offline compiled namespace proof. No real storage, SDK wallet, or network is opened. */
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {verifyCanonicalInstalledSdk} from './verify-canonical-installed-sdk.mjs';

const diagnostic=process.argv.includes('--diagnostic');
assert(process.argv.slice(2).every(argument=>argument==='--diagnostic'),'Unsupported verifier argument');
assert(!process.env.GYS_SDK_PACKAGE_ROOT || diagnostic,
  'GYS_SDK_PACKAGE_ROOT requires explicit --diagnostic mode; the normal gate verifies the resolved installed package');
assert(!diagnostic || process.env.GYS_SDK_PACKAGE_ROOT,'Diagnostic mode requires GYS_SDK_PACKAGE_ROOT');
// Both modes use the repository archive and source as authority. Diagnostic
// mode permits a different filesystem copy of that same canonical package.
// This guard imports no SDK code and verifies every archive member first.
const canonical=await verifyCanonicalInstalledSdk(diagnostic
  ? {diagnosticPackageRoot:process.env.GYS_SDK_PACKAGE_ROOT} : {});
const {packageRoot,manifest,metadata,packageArchiveSha256}=canonical;
const wasmBytes=readFileSync(join(packageRoot,'web/breez_sdk_spark_wasm_bg.wasm'));
const sha256=bytes=>createHash('sha256').update(bytes).digest('hex');
const manifestBytes=readFileSync(join(packageRoot,'getyoursats-build.json'));
assert.equal(sha256(wasmBytes),manifest.generatedArtifacts['web/breez_sdk_spark_wasm_bg.wasm'],'Installed WASM matches its build manifest');
assert.equal(sha256(readFileSync(join(packageRoot,'web/breez_sdk_spark_wasm.js'))),manifest.generatedArtifacts['web/breez_sdk_spark_wasm.js'],'Installed wrapper matches its build manifest');
const boundary='GYS_OFFLINE_STORAGE_IDENTITY_BOUNDARY';
const counts={networkAttempts:0,storageOpenAttempts:0,signingOrOtherSignerCalls:0,
  successfulPathCases:0,constructorChecks:0,identityFailureControls:0,treeFactoryControls:0};
let events=[],stopAtTree=false;
globalThis.fetch=async()=>{counts.networkAttempts++;throw new Error('Network forbidden');};
globalThis.WebSocket=class {constructor(){counts.networkAttempts++;throw new Error('WebSocket forbidden');}};
globalThis.XMLHttpRequest=class {constructor(){counts.networkAttempts++;throw new Error('XHR forbidden');}};
globalThis.indexedDB=new Proxy({}, {get(){counts.storageOpenAttempts++;throw new Error('IndexedDB forbidden');}});
globalThis.createDefaultStorage=async name=>{
  events.push({type:'storage',name});
  if(!stopAtTree)throw new Error(boundary);
  // An inert store handle is enough to reach the next factory. Every method
  // access is denied; the tree factory rejects before core SDK construction.
  return new Proxy({}, {get(_target,key){
    if(key==='then')return undefined;
    counts.storageOpenAttempts++;throw new Error(`Storage method forbidden: ${String(key)}`);
  }});
};
globalThis.createDefaultTreeStore=async name=>{
  events.push({type:'tree',name});throw new Error(boundary);
};
const sdk=await import(pathToFileURL(join(packageRoot,'web/breez_sdk_spark_wasm.js')).href);
sdk.initSync({module:wasmBytes});
const constructors=['newWithSigner','newWithSigningOnlySigner'];
const fixtures=[
  {name:'published-bip39-vector',seed:{type:'mnemonic',mnemonic:'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about'}},
  {name:'public-raw-bip32-fixture',seed:Object.assign(Array.from({length:64},(_,i)=>i),{type:'entropy'})},
];

function mockSigners(response){
  return {
    spark:new Proxy({}, {get(_target,key){
      if(key==='then')return undefined;
      if(key==='getIdentityPublicKey')return async()=>{events.push({type:'identity'});return response();};
      return()=>{counts.signingOrOtherSignerCalls++;throw new Error(`Signer operation forbidden: ${String(key)}`);};
    }}),
    breez:new Proxy({}, {get(_target,key){
      if(key==='then')return undefined;
      return()=>{counts.signingOrOtherSignerCalls++;throw new Error(`Breez signer operation forbidden: ${String(key)}`);};
    }}),
  };
}

async function intercept(builder,{external=false,tree=false}={}){
  events=[];stopAtTree=tree;
  await assert.rejects((await builder.withDefaultStorage('spark-wallet-example')).build(),
    error=>String(error).includes(boundary));
  const storage=events.filter(event=>event.type==='storage');
  const trees=events.filter(event=>event.type==='tree');
  const identities=events.filter(event=>event.type==='identity');
  assert.equal(storage.length,1,'exactly one SDK storage factory');
  assert.equal(trees.length,tree?1:0,'durable tree factory is retained');
  if(external){
    assert.equal(identities.length,1,'one actual signer identity read precedes storage construction');
    assert.equal(events[0].type,'identity','storage must not open before signer identity validation');
  }else assert.equal(identities.length,0,'seeded controls do not call external signers');
  if(tree)assert.equal(trees[0].name,storage[0].name,'SDK and durable tree use the same namespace base');
  counts.constructorChecks++;
  return storage[0].name;
}

const paths=[];
for(const network of ['mainnet','regtest','signet']){
  for(const fixture of fixtures){
    for(const account of [undefined,0,7]){
      // Published seed fixtures only; this factory performs offline derivation.
      const handles=sdk.defaultExternalSignersFromSeed(fixture.seed,network,account);
      const breez=handles.breezSigner,spark=handles.sparkSigner;handles.free();
      let identity;
      try{identity=(await spark.getIdentityPublicKey()).bytes;}
      finally{breez.free();spark.free();}
      const expected=`spark-wallet-example/${network}/${sha256(Buffer.from(identity)).slice(0,8)}`;
      let seeded=sdk.SdkBuilder.new(sdk.defaultServerConfig(network),fixture.seed);
      if(account!==undefined)seeded=seeded.withAccountNumber(account);
      assert.equal(await intercept(seeded),expected,'exact pre-existing seeded namespace');
      for(const constructor of constructors){
        const signers=mockSigners(()=>({bytes:[...identity]}));
        // withAccountNumber is documented as inapplicable to external signers.
        // A conflicting explicit value must not change their storage identity.
        const builder=sdk.SdkBuilder[constructor](sdk.defaultServerConfig(network),signers.breez,signers.spark)
          .withAccountNumber(account===7?0:7);
        assert.equal(await intercept(builder,{external:true}),expected,`${constructor} matches seeded identity`);
      }
      counts.successfulPathCases++;
      paths.push({network,fixture:fixture.name,account:account??'default',publicIdentity:Buffer.from(identity).toString('hex'),path:expected});
    }
  }
}
for(const network of ['mainnet','regtest','signet']){
  const defaults=paths.filter(row=>row.network===network&&row.account==='default');
  assert.notEqual(defaults[0].path,defaults[1].path,'different fixture identities are isolated');
}
const defaultMnemonic=paths.filter(row=>row.fixture==='published-bip39-vector'&&row.account==='default');
assert.equal(new Set(defaultMnemonic.map(row=>row.path)).size,3,'different networks are isolated');
assert.equal(defaultMnemonic.find(row=>row.network==='mainnet').path,'spark-wallet-example/mainnet/d2ea863c');
assert.equal(defaultMnemonic.find(row=>row.network==='regtest').path,'spark-wallet-example/regtest/da91de82');

for(const constructor of constructors){
  for(const network of ['mainnet','regtest']){
    const row=paths.find(row=>row.network===network&&row.account==='default');
    const signers=mockSigners(()=>({bytes:[...Buffer.from(row.publicIdentity,'hex')]}));
    const builder=sdk.SdkBuilder[constructor](sdk.defaultServerConfig(network),signers.breez,signers.spark);
    assert.equal(await intercept(builder,{external:true,tree:true}),row.path);
    counts.treeFactoryControls++;
  }
}

const invalidResponses=[
  ['rejected identity',()=>{throw new Error('GYS_TEST_SIGNER_REVOKED');}],
  ['missing response',()=>undefined],
  ['missing key bytes',()=>({})],
  ['empty bytes',()=>({bytes:[]})],
  ['truncated point',()=>({bytes:[2,0]})],
  ['invalid point',()=>({bytes:[2,...Array(32).fill(255)]})],
];
for(const constructor of constructors){
  for(const [label,response] of invalidResponses){
    events=[];stopAtTree=false;
    const signers=mockSigners(response);
    const builder=await sdk.SdkBuilder[constructor](sdk.defaultServerConfig('regtest'),signers.breez,signers.spark)
      .withDefaultStorage('spark-wallet-example');
    await assert.rejects(builder.build(),error=>!String(error).includes(boundary),`${constructor}: ${label}`);
    assert.deepEqual(events,[{type:'identity'}],`${label} cannot open either storage factory`);
    counts.identityFailureControls++;
  }
}
assert.equal(counts.networkAttempts,0);assert.equal(counts.storageOpenAttempts,0);assert.equal(counts.signingOrOtherSignerCalls,0);
const receipt={schema:1,result:'PASS',observedAt:new Date().toISOString(),
  test:'installed external-signer storage identity',
  mode:diagnostic?'explicit diagnostic package':'resolved installed package gate',
  wasmSha256:sha256(wasmBytes),harnessSha256:sha256(readFileSync(new URL(import.meta.url))),
  packageVersion:metadata.version,installedManifestSha256:sha256(manifestBytes),packageArchiveSha256,
  packageInventorySha256:canonical.packageInventorySha256,canonicalFileCount:canonical.files,
  archiveInventorySha256:canonical.archiveInventorySha256,npmIgnoreRenames:canonical.npmIgnoreRenames,
  sdkSourceCommit:manifest.sdkSourceCommit,patchSha256:manifest.patchSha256,
  counts,paths,
  limits:['No real storage or core SDK wallet was opened','No network or signing calls were made',
    'Tree factory selection is verified; adapter persistence is covered by separate tests',
    'Later A,B and A,A,B identity changes and concurrency are covered by the separate storage_identity_ WASM bridge suite',
    'Legacy eight-hex-character path compatibility is retained; this does not prove collision-resistant database ownership',
    'No legacy migration, production profile inspection, or external signer trust verification is performed']};
if(process.env.GYS_STORAGE_IDENTITY_RECEIPT)writeFileSync(process.env.GYS_STORAGE_IDENTITY_RECEIPT,JSON.stringify(receipt,null,2)+'\n');
console.log(JSON.stringify({...receipt,paths:undefined},null,2));
