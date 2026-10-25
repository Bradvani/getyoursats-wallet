import {afterEach,describe,it,expect,vi} from 'vitest';
import type {BreezSdk,Config} from '@breeztech/breez-sdk-spark';
const mocks=vi.hoisted(()=>({raw:{refundDeposit:vi.fn(),getInfo:vi.fn(async()=>({balanceSats:1n}))},observed:vi.fn(),config:vi.fn(),connect:vi.fn()}));
vi.mock('@capacitor/core',()=>({Capacitor:{isNativePlatform:()=>false}}));
vi.mock('@breeztech/breez-sdk-spark',()=>({
 connect:mocks.connect,
 SdkBuilder:{new:vi.fn(config=>{
  mocks.config(config);
  const builder={withPaymentObserver:vi.fn(observer=>{mocks.observed(observer);return builder}),
   withRestChainService:()=>builder,withDefaultStorage:async()=>builder,build:async()=>mocks.raw};
  return builder;
 })},
}));
import {connectSdk} from '../services/sdkConnect';
import {clearSignerIdentity} from './spendApproval';
afterEach(()=>{clearSignerIdentity();vi.clearAllMocks()});
describe('browser SDK connection security wiring',()=>{
 it('returns a capability facade and installs the veto for imported mnemonic wallets',async()=>{
  const config={network:'mainnet',stableBalanceConfig:{tokens:[]},preferSparkOverLightning:true} as unknown as Config;
  const wallet=await connectSdk({config,seed:{type:'mnemonic',mnemonic:'disposable test seed'},storageDir:'test-only'});
  expect(wallet).not.toBe(mocks.raw);expect(mocks.connect).not.toHaveBeenCalled();
  expect(()=>wallet.refundDeposit({} as never)).toThrow(/unavailable pending/);
  expect(mocks.raw.refundDeposit).not.toHaveBeenCalled();
  expect(await wallet.getInfo({})).toEqual({balanceSats:1n});
  expect(mocks.config).toHaveBeenCalledWith(expect.objectContaining({stableBalanceConfig:undefined,preferSparkOverLightning:false}));
  expect(config.preferSparkOverLightning).toBe(true);
  expect(mocks.observed).toHaveBeenCalledOnce();
  await expect(mocks.observed.mock.calls[0][0].beforeSend([])).rejects.toThrow(/No single-use/);
 });
 it('also installs the same boundary for passkey-derived entropy wallets',async()=>{
  const entropy=Object.assign([1,2,3,4],{type:'entropy' as const});
  const wallet:BreezSdk=await connectSdk({config:{network:'mainnet'} as Config,seed:entropy,storageDir:'test-passkey'});
  expect(()=>wallet.createTokenAllowance({} as never)).toThrow(/unavailable pending/);
  expect(mocks.observed).toHaveBeenCalledOnce();
 });
});
