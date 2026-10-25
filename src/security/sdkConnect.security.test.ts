import {afterEach,describe,it,expect,vi} from 'vitest';
import type {BreezSdk,Config} from '@breeztech/breez-sdk-spark';
const mocks=vi.hoisted(()=>({raw:{refundDeposit:vi.fn(),getInfo:vi.fn(async()=>({balanceSats:1n})),disconnect:vi.fn(async()=>{}),free:vi.fn()},observed:vi.fn(),config:vi.fn(),connect:vi.fn(),factory:vi.fn(),internalBuilder:vi.fn()}));
vi.mock('@capacitor/core',()=>({Capacitor:{isNativePlatform:()=>false}}));
vi.mock('@breeztech/breez-sdk-spark',()=>{
 const create=vi.fn(config=>{
  mocks.config(config);
  const builder={withPaymentObserver:vi.fn(observer=>{mocks.observed(observer);return builder}),
   withRestChainService:()=>builder,withDefaultStorage:async()=>builder,build:async()=>mocks.raw};
  return builder;
 });
 return {connect:mocks.connect,SdkBuilder:{new:mocks.internalBuilder,newWithSigner:create},defaultExternalSignersFromSeed:(...args:unknown[])=>{
  mocks.factory(...args);return {breezSigner:{free:vi.fn()},sparkSigner:{free:vi.fn()},free:vi.fn()};
 }};
});
import {connectSdk} from '../services/sdkConnect';
import {clearSignerIdentity} from './spendApproval';
afterEach(()=>{clearSignerIdentity();vi.clearAllMocks()});
describe('browser SDK connection security wiring',()=>{
 it('returns a capability facade and installs the veto for imported mnemonic wallets',async()=>{
  const config={network:'mainnet',stableBalanceConfig:{tokens:[]},preferSparkOverLightning:true} as unknown as Config;
  const wallet=await connectSdk({config,seed:{type:'mnemonic',mnemonic:'disposable test seed'},storageDir:'test-only'});
  expect(wallet).not.toBe(mocks.raw);expect(mocks.connect).not.toHaveBeenCalled();
  // The public refund method now enters the mandatory recovery controller.
  // Raw signing/publication capabilities remain unavailable.
  expect(()=>Reflect.get(wallet,'signRefundDeposit')({})).toThrow(/unavailable pending/);
  expect(mocks.raw.refundDeposit).not.toHaveBeenCalled();
  expect(await wallet.getInfo({})).toEqual({balanceSats:1n});
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

});
