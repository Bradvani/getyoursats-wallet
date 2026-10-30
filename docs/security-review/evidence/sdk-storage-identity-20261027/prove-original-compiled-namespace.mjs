import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync, writeFileSync} from 'node:fs';
import {join, resolve} from 'node:path';
import {pathToFileURL} from 'node:url';

// Offline bridge probe only. The real compiled builder is terminated at its
// first storage factory call, before a store opens or the core SDK starts.
const packageRoot = resolve(process.env.GYS_SDK_PACKAGE_ROOT ?? '');
if (!process.env.GYS_SDK_PACKAGE_ROOT) throw new Error('GYS_SDK_PACKAGE_ROOT is required');
const output = process.env.GYS_NAMESPACE_RECEIPT;
const wasmPath = join(packageRoot, 'web/breez_sdk_spark_wasm_bg.wasm');
const wasmBytes = readFileSync(wasmPath);
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const operations = {networkAttempts:0, storageOpenAttempts:0, treeFactoryCalls:0,
  externalSignerIdentityReads:0, externalSignerOtherCalls:0};
const storageCalls = [];
const boundary = 'GYS_OFFLINE_STORAGE_BOUNDARY';
globalThis.fetch = async () => { operations.networkAttempts++; throw new Error('Network forbidden'); };
globalThis.WebSocket = class { constructor() { operations.networkAttempts++; throw new Error('WebSocket forbidden'); } };
globalThis.XMLHttpRequest = class { constructor() { operations.networkAttempts++; throw new Error('XHR forbidden'); } };
globalThis.indexedDB = new Proxy({}, {get() { operations.storageOpenAttempts++; throw new Error('IndexedDB forbidden'); }});
globalThis.createDefaultStorage = async name => { storageCalls.push(name); throw new Error(boundary); };
globalThis.createDefaultTreeStore = async () => { operations.treeFactoryCalls++; throw new Error('Tree storage forbidden'); };

const sdk = await import(pathToFileURL(join(packageRoot, 'web/breez_sdk_spark_wasm.js')).href);
sdk.initSync({module:wasmBytes});
const fixtures = [
  {name:'published-bip39-vector', seed:{type:'mnemonic',mnemonic:'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about'}},
  {name:'public-raw-bip32-fixture', seed:Object.assign(Array.from({length:64},(_,i)=>i),{type:'entropy'})},
];
const results = [];
function mockSigners(identity) {
  const spark = new Proxy({}, {get(_target,key) {
    if (key === 'then') return undefined;
    if (key === 'getIdentityPublicKey') return async () => {
      operations.externalSignerIdentityReads++;
      return {bytes:[...identity]};
    };
    return () => { operations.externalSignerOtherCalls++; throw new Error(`Signer operation forbidden: ${String(key)}`); };
  }});
  const breez = new Proxy({}, {get(_target,key) {
    if (key === 'then') return undefined;
    return () => { operations.externalSignerOtherCalls++; throw new Error(`Breez signer operation forbidden: ${String(key)}`); };
  }});
  return {spark,breez};
}
async function intercept(builder) {
  const before = storageCalls.length;
  await assert.rejects((await builder.withDefaultStorage('spark-wallet-example')).build(),
    error => String(error).includes(boundary));
  assert.equal(storageCalls.length,before+1);
  return storageCalls.at(-1);
}
for (const network of ['mainnet','regtest']) {
  for (const fixture of fixtures) {
    // This public factory derives keys only. It does not build or connect a wallet.
    const handles = sdk.defaultExternalSignersFromSeed(fixture.seed,network,undefined);
    const breez = handles.breezSigner, spark = handles.sparkSigner;
    handles.free();
    let identity;
    try { identity = (await spark.getIdentityPublicKey()).bytes; }
    finally { breez.free(); spark.free(); }
    assert.equal(identity.length,33);
    const expected = `spark-wallet-example/${network}/${sha256(Buffer.from(identity)).slice(0,8)}`;
    const signers = mockSigners(identity);
    const seeded = await intercept(sdk.SdkBuilder.new(sdk.defaultServerConfig(network),fixture.seed));
    const external = await intercept(sdk.SdkBuilder.newWithSigner(sdk.defaultServerConfig(network),signers.breez,signers.spark));
    const signingOnly = await intercept(sdk.SdkBuilder.newWithSigningOnlySigner(sdk.defaultServerConfig(network),signers.breez,signers.spark));
    assert.equal(seeded,expected,'seeded production namespace must follow the real public identity');
    assert.equal(external,signingOnly,'both external constructors use the same defective namespace');
    assert.notEqual(external,seeded,'external constructor hides this pre-existing seeded namespace');
    results.push({network,fixture:fixture.name,publicIdentity:Buffer.from(identity).toString('hex'),seeded,external,signingOnly});
  }
  const sameNetwork = results.filter(result => result.network===network);
  assert.notEqual(sameNetwork[0].seeded,sameNetwork[1].seeded);
  assert.equal(sameNetwork[0].external,sameNetwork[1].external,'different identities collide before the signer identity is read');
}
assert.deepEqual(operations,{networkAttempts:0,storageOpenAttempts:0,treeFactoryCalls:0,
  externalSignerIdentityReads:0,externalSignerOtherCalls:0});
const receipt = {schema:1,observedAt:new Date().toISOString(),result:'CONFIRMED',
  scope:'Compiled WASM builder interrupted at the first default-storage factory before storage opening and core SDK startup',
  packageVersion:JSON.parse(readFileSync(join(packageRoot,'package.json'),'utf8')).version,
  wasmSha256:sha256(wasmBytes),harnessSha256:sha256(readFileSync(new URL(import.meta.url))),
  cases:results.length,constructorInvocations:storageCalls.length,results,operations,
  limits:['Published synthetic seed fixtures only','No real profile or wallet API was used','No stored records were opened, modified, or enumerated',
    'This proves the default-storage bridge; PostgreSQL and MySQL tenant scoping are source-traced, not executed',
    'Installed compiled package is the retained 0005 build; pinned source and cumulative 0006 retain the same namespace dataflow']};
if (output) writeFileSync(output,JSON.stringify(receipt,null,2)+'\n');
console.log(JSON.stringify(receipt,null,2));
