import {afterEach,beforeEach,describe,it,expect,vi} from 'vitest';
import type {BreezSdk,Config} from '@breeztech/breez-sdk-spark';
const mocks=vi.hoisted(()=>({storage:vi.fn(),directory:vi.fn(),identity:vi.fn(),spark:vi.fn(),raw:{refundDeposit:vi.fn(),getInfo:vi.fn(async()=>({balanceSats:1n})),disconnect:vi.fn(async()=>{}),free:vi.fn()},observed:vi.fn(),config:vi.fn(),connect:vi.fn(),factory:vi.fn(),internalBuilder:vi.fn(),native:vi.fn(()=>false)}));
vi.mock('@capacitor/core',()=>({Capacitor:{isNativePlatform:mocks.native}}));
vi.mock('@breeztech/breez-sdk-spark',()=>{
 const create=vi.fn((config,_breez,spark)=>{mocks.spark(spark);
  mocks.config(config);
  const builder={withPaymentObserver:vi.fn(observer=>{mocks.observed(observer);return builder}),
   withRestChainService:()=>builder,withDefaultStorage:async(directory:string)=>{mocks.directory(directory);return builder;},build:async()=>mocks.raw};
  return builder;
 });
 return {connect:mocks.connect,SdkBuilder:{new:mocks.internalBuilder,newWithSigner:create},defaultExternalSignersFromSeed:(...args:unknown[])=>{
  mocks.factory(...args);return {breezSigner:{free:vi.fn()},sparkSigner:{getIdentityPublicKey:mocks.identity,free:vi.fn()},free:vi.fn()};
 }};
});
vi.mock('./storageMigration/ownedStorage',()=>({prepareOwnedWalletStorage:mocks.storage}));
import {connectSdk} from '../services/sdkConnect';
import {clearSignerIdentity,getSignerIdentityToken,getSpendingSessionEpoch,lockSpendingSession,matchesSignerIdentity,rememberSignerIdentity} from './spendApproval';
beforeEach(()=>{
 mocks.native.mockReturnValue(false);
 mocks.identity.mockReset().mockResolvedValue({bytes:[2,...Array(32).fill(17)]});
 mocks.raw.getInfo.mockReset().mockResolvedValue({identityPubkey:'02'+'11'.repeat(32),balanceSats:1,recoverableFundsSats:0,tokenBalances:new Map()} as never);
 mocks.storage.mockReset().mockResolvedValue('test-identity-owned-directory');
 vi.stubGlobal('indexedDB',{databases:vi.fn(async()=>[])});
});
afterEach(()=>{clearSignerIdentity();vi.clearAllMocks();vi.unstubAllGlobals()});
describe('browser SDK connection security wiring',()=>{
 it('returns a capability facade and installs the veto for imported mnemonic wallets',async()=>{
  const config={network:'mainnet',stableBalanceConfig:{tokens:[]},preferSparkOverLightning:true} as unknown as Config;
  const wallet=await connectSdk({config,seed:{type:'mnemonic',mnemonic:'disposable test seed'},storageDir:'test-only'});
  expect(wallet).not.toBe(mocks.raw);expect(mocks.connect).not.toHaveBeenCalled();
  // A valid-shaped request must still be denied when it bypasses the controller.
  expect(()=>wallet.signRefundDeposit({txid:'00'.repeat(32),vout:0,destinationAddress:'bc1qdisposable',fee:{type:'fixed',amount:100}})).toThrow(/unavailable pending/);
  expect(mocks.raw.refundDeposit).not.toHaveBeenCalled();
  expect(await wallet.getInfo({})).toMatchObject({identityPubkey:'02'+'11'.repeat(32),balanceSats:1});
  expect(mocks.config).toHaveBeenCalledWith(expect.objectContaining({stableBalanceConfig:undefined,preferSparkOverLightning:false,backgroundTasksEnabled:false,realTimeSyncServerUrl:undefined,crossChainConfig:undefined,leafOptimizationConfig:expect.objectContaining({autoEnabled:false}),tokenOptimizationConfig:expect.objectContaining({autoEnabled:false})}));
  expect(config.preferSparkOverLightning).toBe(true);
  expect(mocks.factory).toHaveBeenCalledWith({type:'mnemonic',mnemonic:'disposable test seed'},'mainnet',undefined);
  expect(mocks.observed).toHaveBeenCalledOnce();
  await expect(mocks.observed.mock.calls[0][0].beforeSend([])).rejects.toThrow(/No single-use/);
 });
 it('preserves the literal BIP39 passphrase and the SDK default account selection',async()=>{
  await connectSdk({config:{network:'mainnet'} as Config,seed:{type:'mnemonic',mnemonic:'fixture',passphrase:' Case Sensitive passphrase '},storageDir:'test-passphrase'});
  expect(mocks.factory).toHaveBeenCalledWith({type:'mnemonic',mnemonic:'fixture',passphrase:' Case Sensitive passphrase '},'mainnet',undefined);
 });
 it.each([32,64])('also installs the same boundary for %i-byte passkey-derived raw seeds',async size=>{
  const entropy=Object.assign(Array(size).fill(1),{type:'entropy' as const});
  const wallet:BreezSdk=await connectSdk({config:{network:'mainnet'} as Config,seed:entropy,storageDir:'test-passkey'});
  expect(mocks.factory).toHaveBeenCalledWith(entropy,'mainnet',undefined);
  expect(mocks.internalBuilder).not.toHaveBeenCalled();
  expect(()=>wallet.createTokenAllowance({} as never)).toThrow(/unavailable pending/);
  expect(mocks.observed).toHaveBeenCalledOnce();
 });
 it('fails closed when the seed-compatible signer cannot be constructed',async()=>{
  mocks.factory.mockImplementationOnce(()=>{throw new Error('Signer factory rejected the seed')});
  const seed=Object.assign(Array(32).fill(1),{type:'entropy' as const});
  await expect(connectSdk({config:{network:'mainnet'} as Config,seed,storageDir:'test-failed-factory'}))
   .rejects.toThrow('Signer factory rejected the seed');
  expect(mocks.internalBuilder).not.toHaveBeenCalled();
  expect(mocks.connect).not.toHaveBeenCalled();
  expect(mocks.config).not.toHaveBeenCalled();
 });
 it.each(['spark-wallet-example/mainnet/9ce7940a','spark-wallet-example/mainnet/9ce7940a-tree'])(
  'preserves the current identity and refuses ambiguous legacy storage %s before any SDK mutation',async name=>{
   await rememberSignerIdentity({type:'mnemonic',mnemonic:'current retained wallet'});
   const token=getSignerIdentityToken(),epoch=getSpendingSessionEpoch();
   const open=vi.fn(),remove=vi.fn();
   vi.stubGlobal('indexedDB',{databases:vi.fn(async()=>[{name,version:23}]),open,deleteDatabase:remove});
   await expect(connectSdk({config:{network:'mainnet'} as Config,seed:{type:'mnemonic',mnemonic:'different candidate'},storageDir:'spark-wallet-example'}))
    .rejects.toMatchObject({code:'LEGACY_SHARED_STORAGE'});
   expect(getSignerIdentityToken()).toBe(token);
   expect(getSpendingSessionEpoch()).toBe(epoch);
   expect(mocks.factory).not.toHaveBeenCalled();expect(mocks.config).not.toHaveBeenCalled();expect(mocks.connect).not.toHaveBeenCalled();
   expect(remove).not.toHaveBeenCalled();
  });
 it.each(['unsupported','rejection','malformed'])('refuses %s database-presence evidence before changing identity',async kind=>{
  const epoch=getSpendingSessionEpoch();
  vi.stubGlobal('indexedDB',kind==='unsupported'?{}:{databases:kind==='rejection'?vi.fn(async()=>{throw new Error('metadata unavailable')}):vi.fn(async()=>[{version:23}])});
  await expect(connectSdk({config:{network:'mainnet'} as Config,seed:{type:'mnemonic',mnemonic:'fixture'},storageDir:'spark-wallet-example'}))
   .rejects.toMatchObject({code:'STORAGE_PRESENCE_UNKNOWN'});
  expect(getSpendingSessionEpoch()).toBe(epoch);
  expect(mocks.factory).not.toHaveBeenCalled();expect(mocks.config).not.toHaveBeenCalled();
 });
 it('does not acquire a new session when a pending metadata read finishes after a lock',async()=>{
  let resolve!:(value:[])=>void;
  const databases=vi.fn(()=>new Promise<[]>(done=>{resolve=done}));
  vi.stubGlobal('indexedDB',{databases});
  const pending=connectSdk({config:{network:'mainnet'} as Config,seed:{type:'mnemonic',mnemonic:'fixture'},storageDir:'spark-wallet-example'});
  const rejected=expect(pending).rejects.toThrow(/session changed/);
  void rejected.catch(()=>{});
  await vi.waitFor(()=>expect(databases).toHaveBeenCalledOnce());
  lockSpendingSession();
  const lockedEpoch=getSpendingSessionEpoch();
  resolve([]);
  await rejected;
  expect(getSpendingSessionEpoch()).toBe(lockedEpoch);
  expect(mocks.factory).not.toHaveBeenCalled();expect(mocks.config).not.toHaveBeenCalled();
 });
 it('keeps the checked network stable if the caller mutates config while enumeration is pending',async()=>{
  let resolve!:(value:[])=>void;
  const databases=vi.fn(()=>new Promise<[]>(done=>{resolve=done}));
  vi.stubGlobal('indexedDB',{databases});
  const config={network:'mainnet'} as Config;
  const pending=connectSdk({config,seed:{type:'mnemonic',mnemonic:'fixture'},storageDir:'spark-wallet-example'});
  await vi.waitFor(()=>expect(databases).toHaveBeenCalledOnce());
  config.network='regtest';
  resolve([]);
  await pending;
  expect(mocks.factory).toHaveBeenCalledWith(expect.anything(),'mainnet',undefined);
  expect(mocks.config).toHaveBeenCalledWith(expect.objectContaining({network:'mainnet'}));
 });
 it('uses the entry mnemonic and passphrase if the caller mutates them during metadata enumeration',async()=>{
  let resolve!:(value:[])=>void;
  const databases=vi.fn(()=>new Promise<[]>(done=>{resolve=done}));
  vi.stubGlobal('indexedDB',{databases});
  const seed={type:'mnemonic' as const,mnemonic:'initial fixture',passphrase:' exact initial passphrase '};
  const original={...seed};
  const pending=connectSdk({config:{network:'mainnet'} as Config,seed,storageDir:'spark-wallet-example'});
  await vi.waitFor(()=>expect(databases).toHaveBeenCalledOnce());
  seed.mnemonic='replacement fixture';seed.passphrase='replacement passphrase';
  resolve([]);
  await pending;
  expect(mocks.factory).toHaveBeenCalledWith(original,'mainnet',undefined);
  expect(mocks.factory.mock.calls[0][0]).not.toBe(seed);
  expect(Object.isFrozen(mocks.factory.mock.calls[0][0])).toBe(true);
  expect(await matchesSignerIdentity(original)).toBe(true);
  expect(await matchesSignerIdentity(seed)).toBe(false);
 });
 it('copies the exact raw byte variant before a delayed presence read',async()=>{
  let resolve!:(value:[])=>void;
  const databases=vi.fn(()=>new Promise<[]>(done=>{resolve=done}));
  vi.stubGlobal('indexedDB',{databases});
  const seed=Object.assign(Array.from({length:64},(_,index)=>index),{type:'entropy' as const});
  const original=Object.assign([...seed],{type:'entropy' as const});
  const pending=connectSdk({config:{network:'mainnet'} as Config,seed,storageDir:'spark-wallet-example'});
  await vi.waitFor(()=>expect(databases).toHaveBeenCalledOnce());
  seed.fill(99);seed.push(100);
  resolve([]);
  await pending;
  expect(mocks.factory).toHaveBeenCalledWith(original,'mainnet',undefined);
  expect(mocks.factory.mock.calls[0][0]).not.toBe(seed);
  expect(Object.isFrozen(mocks.factory.mock.calls[0][0])).toBe(true);
  expect(await matchesSignerIdentity(original)).toBe(true);
  expect(await matchesSignerIdentity(seed)).toBe(false);
 });
 it('keeps native seeded storage outside the browser metadata guard',async()=>{
  mocks.native.mockReturnValue(true);
  vi.stubGlobal('indexedDB',undefined);
  mocks.connect.mockResolvedValueOnce(mocks.raw);
  const seed={type:'mnemonic' as const,mnemonic:'retained native seed'};
  expect(await connectSdk({config:{network:'mainnet'} as Config,seed,storageDir:'spark-wallet-example'})).toBe(mocks.raw);
  expect(mocks.connect).toHaveBeenCalledWith({config:{network:'mainnet'},seed,storageDir:'spark-wallet-example'});
  expect(mocks.factory).not.toHaveBeenCalled();
 });
});


describe('owned browser storage integration',()=>{
 it.each([undefined,'03'+'22'.repeat(32),'not-an-identity'])('does not publish a built wallet whose reported identity differs from its storage signer (%s)',async identityPubkey=>{
  mocks.raw.getInfo.mockResolvedValueOnce({identityPubkey,balanceSats:1,recoverableFundsSats:0,tokenBalances:new Map()} as never);
  await expect(connectSdk({config:{network:'regtest'} as Config,seed:{type:'mnemonic',mnemonic:'public fixture'},storageDir:'test-root'}))
   .rejects.toThrow(/identity does not match/);
  expect(mocks.raw.getInfo).toHaveBeenCalledWith({ensureSynced:false});
  expect(mocks.raw.disconnect).toHaveBeenCalledOnce();expect(mocks.raw.free).toHaveBeenCalledOnce();
  expect(mocks.internalBuilder).not.toHaveBeenCalled();expect(mocks.connect).not.toHaveBeenCalled();
 });
 it('closes a built wallet when its read-only identity check fails',async()=>{
  mocks.raw.getInfo.mockRejectedValueOnce(new Error('Read unavailable'));
  await expect(connectSdk({config:{network:'regtest'} as Config,seed:{type:'mnemonic',mnemonic:'public fixture'},storageDir:'test-root'}))
   .rejects.toThrow('Read unavailable');
  expect(mocks.raw.disconnect).toHaveBeenCalledOnce();expect(mocks.raw.free).toHaveBeenCalledOnce();
 });
 it('never publishes a restored wallet when the identity read completes after locking',async()=>{
  let release!:(value:never)=>void;
  mocks.raw.getInfo.mockImplementationOnce(()=>new Promise(resolve=>{release=resolve}));
  const pending=connectSdk({config:{network:'regtest'} as Config,seed:{type:'mnemonic',mnemonic:'public fixture'},storageDir:'test-root'});
  const rejected=expect(pending).rejects.toThrow(/session changed|session is closed/);void rejected.catch(()=>{});
  await vi.waitFor(()=>expect(release).toBeTypeOf('function'));
  lockSpendingSession();
  release({identityPubkey:'02'+'11'.repeat(32),balanceSats:1} as never);
  await rejected;
  expect(mocks.raw.disconnect).toHaveBeenCalledOnce();expect(mocks.raw.free).toHaveBeenCalledOnce();
 });
 it('selects storage from the actual public signer identity before building the wallet',async()=>{
  await connectSdk({config:{network:'regtest'} as Config,seed:{type:'mnemonic',mnemonic:'public fixture'},storageDir:'test-root'});
  expect(mocks.storage).toHaveBeenCalledWith({root:'test-root',network:'regtest',identity:'02'+'11'.repeat(32),assertCurrent:expect.any(Function)});
  expect(mocks.directory).toHaveBeenCalledWith('test-identity-owned-directory');
  expect(mocks.storage.mock.invocationCallOrder[0]).toBeLessThan(mocks.config.mock.invocationCallOrder[0]);
 });
 it('does not construct a wallet or fall back when storage ownership is unresolved',async()=>{
  mocks.storage.mockRejectedValueOnce(new Error('Ownership review required'));
  await expect(connectSdk({config:{network:'mainnet'} as Config,seed:{type:'mnemonic',mnemonic:'public fixture'},storageDir:'test-root'})).rejects.toThrow('Ownership review required');
  expect(mocks.config).not.toHaveBeenCalled();expect(mocks.internalBuilder).not.toHaveBeenCalled();expect(mocks.connect).not.toHaveBeenCalled();
 });
 it('keeps storage selection bound to the original signer even on a later SDK identity read',async()=>{
  await connectSdk({config:{network:'regtest'} as Config,seed:{type:'mnemonic',mnemonic:'public fixture'},storageDir:'test-root'});
  const pinned=mocks.spark.mock.calls[0][0];
  expect(await pinned.getIdentityPublicKey()).toEqual({bytes:[2,...Array(32).fill(17)]});
  mocks.identity.mockResolvedValueOnce({bytes:[3,...Array(32).fill(18)]});
  await expect(pinned.getIdentityPublicKey()).rejects.toThrow(/identity changed/);
 });
 it.each([[],[2,1],[4,...Array(32).fill(17)],[2,...Array(31).fill(17),256]].map(bytes=>({bytes})))('rejects malformed public identity before migration %#',async({bytes})=>{
  mocks.identity.mockResolvedValueOnce({bytes});
  await expect(connectSdk({config:{network:'mainnet'} as Config,seed:{type:'mnemonic',mnemonic:'public fixture'},storageDir:'test-root'})).rejects.toThrow(/public storage identity/);
  expect(mocks.storage).not.toHaveBeenCalled();expect(mocks.config).not.toHaveBeenCalled();
 });
 it('rejects a completed storage handover if its unlocking session was revoked',async()=>{
  mocks.storage.mockImplementationOnce(async()=>{lockSpendingSession();return 'unused-directory';});
  await expect(connectSdk({config:{network:'mainnet'} as Config,seed:{type:'mnemonic',mnemonic:'public fixture'},storageDir:'test-root'})).rejects.toThrow(/session changed/);
  expect(mocks.config).not.toHaveBeenCalled();
 });
});
