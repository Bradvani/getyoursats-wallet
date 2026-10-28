import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import {defaultServerConfig, type BreezSdk, type LightningAddressInfo, type PaymentObserver} from '@breeztech/breez-sdk-spark';
import {clearSignerIdentity,lockSpendingSession,rememberSignerIdentity} from '../security/spendApproval';
import {withNativeLightningSession, type NativeLightningCapabilities} from './nativeLightningSession';

const harness = vi.hoisted(() => ({build:vi.fn(),config:vi.fn(),storage:vi.fn(),observer:vi.fn(),factory:vi.fn(),rawConnect:vi.fn()}));
vi.mock('@breeztech/breez-sdk-spark', () => ({
  connect: harness.rawConnect,
  defaultServerConfig: vi.fn(() => ({network: 'mainnet', backgroundTasksEnabled: false})),
  defaultExternalSignersFromSeed: (...args:unknown[]) => {
    harness.factory(...args);
    return {breezSigner:{free:vi.fn()},sparkSigner:{free:vi.fn()},free:vi.fn()};
  },
  SdkBuilder:{newWithSigner:(config:unknown)=>{
    harness.config(config);
    const builder={
      withPaymentObserver:(observer:unknown)=>{harness.observer(observer);return builder;},
      withDefaultStorage:async(directory:string)=>{harness.storage(directory);return builder;},
      build:harness.build,
    };
    return builder;
  }},
}));
vi.mock('./sdkReady', () => ({sdkReady: vi.fn().mockResolvedValue(undefined)}));

const IDENTITY = `02${'1'.repeat(64)}`;
const OTHER_IDENTITY = `03${'2'.repeat(64)}`;
const SEED = {type: 'mnemonic' as const, mnemonic: 'public non-wallet test fixture'};
const ADDRESS: LightningAddressInfo = {
  username: 'alice', lightningAddress: 'alice@getyoursats.com', description: 'Pay to Alice',
  lnurl: {url: 'lnurlp://getyoursats.com/lnurlp/alice', bech32: 'lnurl1fixture'},
};

let sdk: BreezSdk;
const deleted: string[] = [];

beforeEach(async () => {
  vi.clearAllMocks();
  await rememberSignerIdentity(SEED);
  deleted.length = 0;
  sdk = {
    signMessage: vi.fn().mockResolvedValue({pubkey: IDENTITY, signature: 'fixture'}),
    getLightningAddress: vi.fn().mockResolvedValue(undefined),
    disconnect: vi.fn().mockResolvedValue(undefined),
    free: vi.fn(),
    checkLightningAddressAvailable:vi.fn().mockResolvedValue(true),
    registerLightningAddress:vi.fn().mockResolvedValue(ADDRESS),
  } as unknown as BreezSdk;
  harness.build.mockResolvedValue(sdk);
  vi.stubGlobal('indexedDB', {
    databases: vi.fn(async () => [
      {name: 'spark-wallet-example/mainnet/main-wallet'},
      ...harness.storage.mock.calls.map(([directory]) => ({name: `${directory}/mainnet/temp-wallet`})),
    ]),
    deleteDatabase: vi.fn((name: string) => {
      deleted.push(name);
      const request = {} as IDBOpenDBRequest;
      queueMicrotask(() => request.onsuccess?.(new Event('success')));
      return request;
    }),
  });
});

afterEach(() => {clearSignerIdentity();vi.unstubAllGlobals();});

const options = () => ({seed: SEED, apiKey: 'test-client-key', expectedIdentityPubkey: IDENTITY});

describe('isolated native Lightning sessions', () => {
  it('uses fresh storage and server mode, then frees only its temporary databases', async () => {
    await withNativeLightningSession({...options(), use: async session => session.address});
    await withNativeLightningSession({...options(), use: async session => session.address});

    expect(defaultServerConfig).toHaveBeenCalledWith('mainnet');
    const [first, second] = harness.storage.mock.calls.map(([directory]) => directory);
    expect(harness.config).toHaveBeenCalledWith(expect.objectContaining({backgroundTasksEnabled:false,lnurlDomain:'getyoursats.com',realTimeSyncServerUrl:undefined,crossChainConfig:undefined,stableBalanceConfig:undefined}));
    expect(harness.factory).toHaveBeenCalledWith(SEED,'mainnet',undefined);
    expect(harness.rawConnect).not.toHaveBeenCalled();
    expect(first).not.toBe(second);
    expect(deleted).toEqual([`${first}/mainnet/temp-wallet`, `${second}/mainnet/temp-wallet`]);
    expect(deleted.some(name => name.includes('spark-wallet-example'))).toBe(false);
    expect(sdk.disconnect).toHaveBeenCalledTimes(2);
    expect(sdk.free).toHaveBeenCalledTimes(2);
  });

  it('waits for authoritative recovery before allowing a claim operation', async () => {
    let finish!: (address: LightningAddressInfo) => void;
    vi.mocked(sdk.getLightningAddress).mockImplementation(() => new Promise(resolve => {finish = resolve;}));
    const use = vi.fn(async session => session.address);
    const task = withNativeLightningSession({...options(), use});
    await vi.waitFor(() => expect(sdk.getLightningAddress).toHaveBeenCalled());
    expect(use).not.toHaveBeenCalled();
    finish(ADDRESS);
    await expect(task).resolves.toEqual(ADDRESS);
    expect(use).toHaveBeenCalledWith(expect.objectContaining({address: ADDRESS, identityPubkey: IDENTITY}));
  });

  it('rejects a different passkey identity before native lookup or mutation', async () => {
    vi.mocked(sdk.signMessage).mockResolvedValue({pubkey: OTHER_IDENTITY, signature: 'fixture'});
    const use = vi.fn();
    await expect(withNativeLightningSession({...options(), use})).rejects.toThrow('different wallet');
    expect(sdk.getLightningAddress).not.toHaveBeenCalled();
    expect(use).not.toHaveBeenCalled();
    expect(sdk.disconnect).toHaveBeenCalled();
    expect(sdk.free).toHaveBeenCalled();
  });

  it('does not treat a failed lookup as an unregistered name', async () => {
    vi.mocked(sdk.getLightningAddress).mockRejectedValue(new Error('Network unavailable'));
    const use = vi.fn();
    await expect(withNativeLightningSession({...options(), use})).rejects.toThrow('Network unavailable');
    expect(use).not.toHaveBeenCalled();
    expect(sdk.free).toHaveBeenCalled();
  });

  it('blocks native work when the active wallet changes during recovery', async () => {
    let active = true;
    vi.mocked(sdk.getLightningAddress).mockImplementation(async () => {active = false; return ADDRESS;});
    const use = vi.fn();
    await expect(withNativeLightningSession({...options(),
      ensureActive: () => {if (!active) throw new Error('Wallet changed');}, use,
    })).rejects.toThrow('Wallet changed');
    expect(use).not.toHaveBeenCalled();
    expect(sdk.free).toHaveBeenCalled();
  });

  it('rejects an address from the wrong domain without invoking the claim callback', async () => {
    vi.mocked(sdk.getLightningAddress).mockResolvedValue({...ADDRESS, lightningAddress: 'alice@breez.tips'});
    const use = vi.fn();
    await expect(withNativeLightningSession({...options(), use})).rejects.toThrow('confirm your GetYourSats address');
    expect(use).not.toHaveBeenCalled();
  });

  it('releases storage and signer when the claim operation fails', async () => {
    await expect(withNativeLightningSession({...options(), use: async () => {throw new Error('Claim rejected');}}))
      .rejects.toThrow('Claim rejected');
    expect(sdk.disconnect).toHaveBeenCalled();
    expect(sdk.free).toHaveBeenCalled();
    expect(deleted).toHaveLength(1);
  });
});


describe('Lightning-name capability and signing lifetime',()=>{
  it('exposes only name operations and revokes a retained capability after completion',async()=>{
    let retained:NativeLightningCapabilities|undefined;
    await withNativeLightningSession({...options(),use:async session=>{
      retained=session.sdk;
      expect(Object.getPrototypeOf(session.sdk)).toBeNull();
      expect(Object.keys(session.sdk).sort()).toEqual(['checkLightningAddressAvailable','registerLightningAddress']);
      expect(Reflect.get(session.sdk,'sendPayment')).toBeUndefined();
      expect(Reflect.get(session.sdk,'signMessage')).toBeUndefined();
      expect(Reflect.get(session.sdk,'claimDeposit')).toBeUndefined();
      expect(Object.isFrozen(session.sdk)).toBe(true);
      await session.sdk.checkLightningAddressAvailable({username:'alice'});
      return session.sdk.registerLightningAddress({username:'alice'});
    }});
    expect(sdk.registerLightningAddress).toHaveBeenCalledOnce();
    await expect(retained!.registerLightningAddress({username:'bob'})).rejects.toThrow(/closed/);
    expect(sdk.registerLightningAddress).toHaveBeenCalledOnce();
  });
  it('blocks all payment-observer requests in the temporary SDK',async()=>{
    await withNativeLightningSession({...options(),use:async()=>{
      const observer=harness.observer.mock.calls[0][0] as PaymentObserver;
      await expect(observer.beforeSend([])).rejects.toThrow(/cannot send payments/);
    }});
  });
  it('rejects seed material that differs from the active signing session before building another signer',async()=>{
    await expect(withNativeLightningSession({...options(),seed:{type:'mnemonic',mnemonic:'different-disposable-fixture'},use:vi.fn()}))
      .rejects.toThrow(/different wallet/);
    expect(harness.factory).not.toHaveBeenCalled();
    expect(harness.build).not.toHaveBeenCalled();
  });
  it('does not expose name operations after backgrounding during provider recovery',async()=>{
    const use=vi.fn();
    vi.mocked(sdk.getLightningAddress).mockImplementation(async()=>{
      lockSpendingSession('Backgrounded during name recovery');
      return ADDRESS;
    });
    await expect(withNativeLightningSession({...options(),use})).rejects.toThrow(/session changed|locked/);
    expect(use).not.toHaveBeenCalled();
    expect(sdk.disconnect).toHaveBeenCalledOnce();
    expect(sdk.free).toHaveBeenCalledOnce();
  });
});
