import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import {connect, defaultServerConfig, type BreezSdk, type LightningAddressInfo} from '@breeztech/breez-sdk-spark';
import {withNativeLightningSession} from './nativeLightningSession';

vi.mock('@breeztech/breez-sdk-spark', () => ({
  connect: vi.fn(),
  defaultServerConfig: vi.fn(() => ({network: 'mainnet', backgroundTasksEnabled: false})),
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

beforeEach(() => {
  deleted.length = 0;
  sdk = {
    signMessage: vi.fn().mockResolvedValue({pubkey: IDENTITY, signature: 'fixture'}),
    getLightningAddress: vi.fn().mockResolvedValue(undefined),
    disconnect: vi.fn().mockResolvedValue(undefined),
    free: vi.fn(),
  } as unknown as BreezSdk;
  vi.mocked(connect).mockResolvedValue(sdk);
  vi.stubGlobal('indexedDB', {
    databases: vi.fn(async () => [
      {name: 'spark-wallet-example/mainnet/main-wallet'},
      ...vi.mocked(connect).mock.calls.map(([request]) => ({name: `${request.storageDir}/mainnet/temp-wallet`})),
    ]),
    deleteDatabase: vi.fn((name: string) => {
      deleted.push(name);
      const request = {} as IDBOpenDBRequest;
      queueMicrotask(() => request.onsuccess?.(new Event('success')));
      return request;
    }),
  });
});

afterEach(() => vi.unstubAllGlobals());

const options = () => ({seed: SEED, apiKey: 'test-client-key', expectedIdentityPubkey: IDENTITY});

describe('isolated native Lightning sessions', () => {
  it('uses fresh storage and server mode, then frees only its temporary databases', async () => {
    await withNativeLightningSession({...options(), use: async session => session.address});
    await withNativeLightningSession({...options(), use: async session => session.address});

    expect(defaultServerConfig).toHaveBeenCalledWith('mainnet');
    const [first, second] = vi.mocked(connect).mock.calls.map(([request]) => request);
    expect(first.config.backgroundTasksEnabled).toBe(false);
    expect(first.config.lnurlDomain).toBe('getyoursats.com');
    expect(first.seed).toBe(SEED);
    expect(first.storageDir).not.toBe(second.storageDir);
    expect(deleted).toEqual([
      `${first.storageDir}/mainnet/temp-wallet`, `${second.storageDir}/mainnet/temp-wallet`,
    ]);
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
