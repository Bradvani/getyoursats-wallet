import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Seed } from '@breeztech/breez-sdk-spark';
import {
  assertNativeWalletSwitchAllowed, chooseNativeSeedTier, getNativeSeedTier, prepareNativeSeedConnection, readSeedForActiveNativeWallet, readSelectedNativeSeed,
  resetNativeSeedSelection, setActiveNativeSeedWallet, setNativeSeedTier,
} from './nativeSeedSelection';
import { clearSignerIdentity, lockSpendingSession, rememberSignerIdentity } from '../security/spendApproval';
import {
  assertNativeReadLease, captureNativeAuthentication, captureNativeReadLease, completeNativeAuthentication,
  confirmNativePinPolicy, getNativePinPolicyRevision, invalidateNativePinPolicy, lockNativeReadAccess,
} from './nativeReadLease';

const mocks = vi.hoisted(() => ({
  device: { isSupported: vi.fn(), hasStoredSeed: vi.fn(), retrieveSeed: vi.fn() },
  bound: { isSupported: vi.fn(), hasStoredSeed: vi.fn(), retrieveSeed: vi.fn() },
  factory: vi.fn(), identity: vi.fn(), getInfo: vi.fn(),
  breezFree: vi.fn(), sparkFree: vi.fn(), containerFree: vi.fn(),
}));
vi.mock('./secureStorage', () => ({ deviceOnlyStorage: mocks.device, secureStorage: mocks.bound }));
vi.mock('@breeztech/breez-sdk-spark', () => ({ defaultExternalSignersFromSeed: mocks.factory }));
vi.mock('./sdkReady', () => ({ sdkReady: vi.fn(async () => {}) }));

const SEED = { type: 'mnemonic' as const, mnemonic: Array(11).fill('abandon').concat('about').join(' ') };
const KEY_BYTES = [2, ...Array(32).fill(17)];
const IDENTITY = KEY_BYTES.map(byte => byte.toString(16).padStart(2, '0')).join('');

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(finish => { resolve = finish; });
  return { promise, resolve };
}

beforeEach(async () => {
  Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' });
  invalidateNativePinPolicy();
  confirmNativePinPolicy(false, getNativePinPolicyRevision());
  resetNativeSeedSelection();
  clearSignerIdentity();
  await rememberSignerIdentity(SEED);
  for (const store of [mocks.device, mocks.bound]) {
    store.isSupported.mockReset().mockReturnValue(true);
    store.hasStoredSeed.mockReset().mockResolvedValue(false);
    store.retrieveSeed.mockReset().mockResolvedValue(SEED);
  }
  mocks.getInfo.mockReset().mockResolvedValue({ identityPubkey: IDENTITY });
  mocks.identity.mockReset().mockResolvedValue({ bytes: KEY_BYTES.slice() });
  mocks.factory.mockReset().mockReturnValue({
    breezSigner: { free: mocks.breezFree },
    sparkSigner: { getIdentityPublicKey: mocks.identity, free: mocks.sparkFree },
    free: mocks.containerFree,
  });
  setActiveNativeSeedWallet({ getInfo: mocks.getInfo }, 'regtest');
});
afterEach(() => { resetNativeSeedSelection(); clearSignerIdentity(); });

describe('native record selection', () => {
  it('chooses device-only precedence without reading or deleting the other record', async () => {
    mocks.device.hasStoredSeed.mockResolvedValue(true);
    mocks.bound.hasStoredSeed.mockResolvedValue(true);
    await expect(chooseNativeSeedTier()).resolves.toBe('device');
    await expect(readSelectedNativeSeed({ verifyIdentity: false })).resolves.toEqual(SEED);
    expect(mocks.bound.hasStoredSeed).not.toHaveBeenCalled();
    expect(mocks.bound.retrieveSeed).not.toHaveBeenCalled();
  });

  it('keeps a selected bound record if another tier later appears', async () => {
    mocks.bound.hasStoredSeed.mockResolvedValue(true);
    await expect(chooseNativeSeedTier()).resolves.toBe('biometric');
    mocks.device.hasStoredSeed.mockResolvedValue(true);
    await expect(readSelectedNativeSeed({ verifyIdentity: false })).resolves.toEqual(SEED);
    expect(mocks.device.retrieveSeed).not.toHaveBeenCalled();
    expect(getNativeSeedTier()).toBe('biometric');
  });

  it('retries an unconfirmed probe and advances only after a fresh absence response', async () => {
    const error = new Error('Presence unavailable');
    mocks.device.hasStoredSeed.mockRejectedValue(error);
    await expect(chooseNativeSeedTier()).rejects.toBe(error);
    expect(getNativeSeedTier()).toBeNull();
    expect(mocks.bound.hasStoredSeed).not.toHaveBeenCalled();
    mocks.device.hasStoredSeed.mockResolvedValue(false);
    mocks.bound.hasStoredSeed.mockResolvedValue(true);
    await expect(chooseNativeSeedTier()).resolves.toBe('biometric');
    expect(mocks.device.hasStoredSeed).toHaveBeenCalledTimes(2);
    expect(mocks.bound.hasStoredSeed).toHaveBeenCalledOnce();
  });

  it('coalesces concurrent probes without exposing a provisional selection', async () => {
    const presence = deferred<boolean>();
    mocks.device.hasStoredSeed.mockReturnValue(presence.promise);
    const first = chooseNativeSeedTier();
    const second = chooseNativeSeedTier();
    let returned = false;
    void second.then(() => { returned = true; });
    await Promise.resolve();
    expect(returned).toBe(false);
    expect(getNativeSeedTier()).toBeNull();
    expect(mocks.device.hasStoredSeed).toHaveBeenCalledOnce();
    presence.resolve(true);
    await expect(Promise.all([first, second])).resolves.toEqual(['device', 'device']);
  });

  it('retries the exact unconfirmed bound probe without switching to a newly appearing device record', async () => {
    mocks.bound.hasStoredSeed.mockRejectedValueOnce(new Error('Bound presence unavailable')).mockResolvedValue(true);
    await expect(chooseNativeSeedTier()).rejects.toThrow('Bound presence unavailable');
    mocks.device.hasStoredSeed.mockResolvedValue(true);
    await expect(chooseNativeSeedTier()).resolves.toBe('biometric');
    expect(mocks.device.hasStoredSeed).toHaveBeenCalledOnce();
    expect(mocks.bound.hasStoredSeed).toHaveBeenCalledTimes(2);
  });

  it('never falls back after the selected record disappears or cannot be read', async () => {
    setNativeSeedTier('device');
    const error = new Error('Selected record is unavailable');
    mocks.device.retrieveSeed.mockRejectedValue(error);
    mocks.bound.hasStoredSeed.mockResolvedValue(true);
    await expect(readSelectedNativeSeed()).rejects.toBe(error);
    expect(mocks.bound.retrieveSeed).not.toHaveBeenCalled();
    expect(getNativeSeedTier()).toBe('device');
  });
});

describe('native wallet switching preserves saved identities', () => {
  it.each(['device', 'bound'] as const)('blocks a saved %s record before reading any key', async tier => {
    mocks[tier].hasStoredSeed.mockResolvedValue(true);
    await expect(assertNativeWalletSwitchAllowed()).rejects.toThrow(/saved wallet records/);
    expect(mocks.device.retrieveSeed).not.toHaveBeenCalled();
    expect(mocks.bound.retrieveSeed).not.toHaveBeenCalled();
  });

  it.each(['device', 'bound'] as const)('blocks unknown %s presence', async tier => {
    mocks[tier].hasStoredSeed.mockRejectedValue(new Error('Storage unavailable'));
    await expect(assertNativeWalletSwitchAllowed()).rejects.toThrow(/Could not verify saved wallet/);
    expect(mocks.device.retrieveSeed).not.toHaveBeenCalled();
    expect(mocks.bound.retrieveSeed).not.toHaveBeenCalled();
  });

  it('requires strict absence from both tiers', async () => {
    mocks.bound.hasStoredSeed.mockResolvedValue(undefined);
    await expect(assertNativeWalletSwitchAllowed()).rejects.toThrow(/saved wallet records/);
    mocks.bound.hasStoredSeed.mockResolvedValue(false);
    await expect(assertNativeWalletSwitchAllowed()).resolves.toBeUndefined();
    expect(mocks.device.hasStoredSeed).toHaveBeenCalledTimes(2);
    expect(mocks.bound.hasStoredSeed).toHaveBeenCalledTimes(2);
  });

  it('retains a selected wallet even if its record later disappears', async () => {
    setNativeSeedTier('device');
    await expect(assertNativeWalletSwitchAllowed()).rejects.toThrow(/saved wallet records/);
    expect(mocks.device.hasStoredSeed).not.toHaveBeenCalled();
  });

  it('rejects a changed selection during an absence probe', async () => {
    const probe = deferred<boolean>();
    mocks.device.hasStoredSeed.mockReturnValue(probe.promise);
    const checking = assertNativeWalletSwitchAllowed();
    setNativeSeedTier('biometric');
    probe.resolve(false);
    await expect(checking).rejects.toThrow(/saved wallet records/);
    expect(mocks.bound.hasStoredSeed).not.toHaveBeenCalled();
  });
});

describe('native reads bind the exact connected wallet', () => {
  it.each([
    { type: 'mnemonic', mnemonic: SEED.mnemonic, passphrase: '  TREZOR \u212b  ' },
    Object.assign(Array.from({ length: 32 }, (_, index) => index), { type: 'entropy' }),
  ].map(seed => ({ seed: Object.freeze(seed) as Seed })))('passes the unchanged seed variant %# to the SDK factory and frees all three handles', async ({ seed }) => {
    setNativeSeedTier('device');
    mocks.device.retrieveSeed.mockResolvedValue(seed);
    const verified = await readSelectedNativeSeed();
    expect(verified).toEqual(seed);
    expect(verified).not.toBe(seed);
    expect(Object.isFrozen(verified)).toBe(true);
    expect(mocks.factory).toHaveBeenCalledWith(seed, 'regtest', undefined);
    expect(mocks.getInfo).toHaveBeenCalledWith({ ensureSynced: false });
    expect(mocks.identity).toHaveBeenCalledOnce();
    expect(mocks.breezFree).toHaveBeenCalledOnce();
    expect(mocks.sparkFree).toHaveBeenCalledOnce();
    expect(mocks.containerFree).toHaveBeenCalledOnce();
  });

  it('rejects a different stored identity and leaves the selected tier unchanged', async () => {
    setNativeSeedTier('device');
    mocks.identity.mockResolvedValue({ bytes: [3, ...Array(32).fill(34)] });
    await expect(readSelectedNativeSeed()).rejects.toThrow('does not match');
    expect(getNativeSeedTier()).toBe('device');
    expect(mocks.bound.retrieveSeed).not.toHaveBeenCalled();
    expect(mocks.breezFree).toHaveBeenCalledOnce();
    expect(mocks.sparkFree).toHaveBeenCalledOnce();
    expect(mocks.containerFree).toHaveBeenCalledOnce();
  });

  it('requires an active connection before reading backup or funding seed material', async () => {
    setNativeSeedTier('device');
    setActiveNativeSeedWallet(null);
    await expect(readSelectedNativeSeed()).rejects.toThrow(/connection/);
    expect(mocks.device.retrieveSeed).not.toHaveBeenCalled();
    expect(mocks.factory).not.toHaveBeenCalled();
  });

  it('rejects a wallet replacement before the tier-choice continuation resumes', async () => {
    setNativeSeedTier('device');
    const read = readSelectedNativeSeed();
    setActiveNativeSeedWallet({ getInfo: mocks.getInfo }, 'regtest');
    await expect(read).rejects.toThrow(/changed/);
    expect(mocks.device.retrieveSeed).not.toHaveBeenCalled();
  });

  it('returns the immutable seed that was verified even if the source object changes during proof', async () => {
    setNativeSeedTier('device');
    const seed = { ...SEED, passphrase: 'original passphrase' };
    mocks.device.retrieveSeed.mockResolvedValue(seed);
    const pending = deferred<{ bytes: number[] }>();
    mocks.identity.mockReturnValue(pending.promise);
    const read = readSelectedNativeSeed();
    await vi.waitFor(() => expect(mocks.identity).toHaveBeenCalledOnce());
    seed.passphrase = 'changed passphrase';
    pending.resolve({ bytes: KEY_BYTES });
    const verified = await read;
    expect(verified).toEqual({ ...SEED, passphrase: 'original passphrase' });
    expect(verified).not.toBe(seed);
    expect(Object.isFrozen(verified)).toBe(true);
  });

  it.each(['lock', 'disconnect', 'switch', 'tier'] as const)('rejects %s during a native prompt before returning any seed', async change => {
    setNativeSeedTier('device');
    const pending = deferred<Seed>();
    mocks.device.retrieveSeed.mockReturnValue(pending.promise);
    const read = readSelectedNativeSeed();
    await vi.waitFor(() => expect(mocks.device.retrieveSeed).toHaveBeenCalledOnce());
    if (change === 'lock') lockNativeReadAccess();
    if (change === 'disconnect') setActiveNativeSeedWallet(null);
    if (change === 'switch') setActiveNativeSeedWallet({ getInfo: mocks.getInfo }, 'regtest');
    if (change === 'tier') setNativeSeedTier('biometric');
    pending.resolve(SEED);
    await expect(read).rejects.toThrow(/changed|locked/);
    expect(mocks.factory).not.toHaveBeenCalled();
  });

  it('also rejects a native lock during the initial native unlock read', async () => {
    setNativeSeedTier('biometric');
    setActiveNativeSeedWallet(null);
    const pending = deferred<Seed>();
    mocks.bound.retrieveSeed.mockReturnValue(pending.promise);
    const read = readSelectedNativeSeed({ verifyIdentity: false });
    await vi.waitFor(() => expect(mocks.bound.retrieveSeed).toHaveBeenCalledOnce());
    lockNativeReadAccess();
    pending.resolve(SEED);
    await expect(read).rejects.toThrow(/changed/);
  });

  it('rejects disconnect during the active identity read', async () => {
    const pending = deferred<{ identityPubkey: string }>();
    mocks.getInfo.mockReturnValue(pending.promise);
    const read = readSeedForActiveNativeWallet(async () => SEED);
    await vi.waitFor(() => expect(mocks.getInfo).toHaveBeenCalledOnce());
    setActiveNativeSeedWallet(null);
    pending.resolve({ identityPubkey: IDENTITY });
    await expect(read).rejects.toThrow(/changed/);
    expect(mocks.factory).not.toHaveBeenCalled();
  });

  it('frees temporary handles after a lock during the local public-key proof', async () => {
    const pending = deferred<{ bytes: number[] }>();
    mocks.identity.mockReturnValue(pending.promise);
    const read = readSeedForActiveNativeWallet(async () => SEED);
    await vi.waitFor(() => expect(mocks.identity).toHaveBeenCalledOnce());
    lockSpendingSession();
    pending.resolve({ bytes: KEY_BYTES });
    await expect(read).rejects.toThrow(/changed|locked/);
    expect(mocks.breezFree).toHaveBeenCalledOnce();
    expect(mocks.sparkFree).toHaveBeenCalledOnce();
    expect(mocks.containerFree).toHaveBeenCalledOnce();
  });
});

describe('native read leases preserve entry authorization', () => {
  it('does not use browser spending locked state as native read authorization', async () => {
    setNativeSeedTier('device');
    lockSpendingSession('Independent browser state');
    await expect(readSelectedNativeSeed()).resolves.toEqual(SEED);
  });

  it('requires verified native policy even when the browser signer is remembered', async () => {
    setNativeSeedTier('device');
    invalidateNativePinPolicy();
    await expect(readSelectedNativeSeed()).rejects.toThrow(/locked/);
    expect(mocks.device.retrieveSeed).not.toHaveBeenCalled();
  });

  it.each(['tier', 'connection', 'reset'] as const)('%s changes revoke pending reads and authentication without granting access', change => {
    confirmNativePinPolicy(true, getNativePinPolicyRevision());
    const authentication = captureNativeAuthentication();
    if (change === 'tier') setNativeSeedTier('device');
    if (change === 'connection') setActiveNativeSeedWallet({ getInfo: mocks.getInfo }, 'regtest');
    if (change === 'reset') resetNativeSeedSelection();
    expect(() => completeNativeAuthentication(authentication)).toThrow(/changed/);
    expect(() => captureNativeReadLease()).toThrow(/locked/);
  });

  it('revokes an already-authorized lease on selection change without opening a locked policy', () => {
    const lease = captureNativeReadLease();
    setNativeSeedTier('device');
    expect(() => assertNativeReadLease(lease)).toThrow(/changed/);
    expect(() => captureNativeReadLease()).not.toThrow();
  });

  it('does not adopt a fresh authorization after a delayed selection probe and reauthentication', async () => {
    confirmNativePinPolicy(true, getNativePinPolicyRevision());
    completeNativeAuthentication(captureNativeAuthentication());
    const pending = deferred<boolean>();
    mocks.device.hasStoredSeed.mockReturnValue(pending.promise);
    const result = readSelectedNativeSeed();
    lockNativeReadAccess();
    completeNativeAuthentication(captureNativeAuthentication());
    pending.resolve(true);
    await expect(result).rejects.toThrow(/changed|locked/);
    expect(mocks.device.retrieveSeed).not.toHaveBeenCalled();
    expect(mocks.factory).not.toHaveBeenCalled();
  });

  it('requires a new sensitive read after first selection revokes its entry binding', async () => {
    mocks.device.hasStoredSeed.mockResolvedValue(true);
    await expect(readSelectedNativeSeed()).rejects.toThrow(/changed/);
    expect(mocks.device.retrieveSeed).not.toHaveBeenCalled();
    await expect(readSelectedNativeSeed()).resolves.toEqual(SEED);
  });

  it('returns null on the unsupported native path without requiring native policy', async () => {
    resetNativeSeedSelection();
    invalidateNativePinPolicy();
    mocks.device.isSupported.mockReturnValue(false);
    mocks.bound.isSupported.mockReturnValue(false);
    await expect(readSelectedNativeSeed()).resolves.toBeNull();
    expect(mocks.device.retrieveSeed).not.toHaveBeenCalled();
  });
});

describe('initial native connection selects and proves its saved tier', () => {
  it.each(['device', 'biometric'] as const)('establishes %s from a matching fresh record without granting native access', async tier => {
    setActiveNativeSeedWallet(null);
    invalidateNativePinPolicy();
    const store = tier === 'device' ? mocks.device : mocks.bound;
    store.hasStoredSeed.mockResolvedValue(true);
    const seed = await prepareNativeSeedConnection(SEED);
    expect(seed).toEqual(SEED);
    expect(seed).not.toBe(SEED);
    expect(Object.isFrozen(seed)).toBe(true);
    expect(getNativeSeedTier()).toBe(tier);
    expect(store.retrieveSeed).toHaveBeenCalledOnce();
    expect(() => captureNativeReadLease()).toThrow(/locked/);
  });

  it.each([
    { ...SEED, passphrase: 'different passphrase' },
    Object.assign(Array(32).fill(1), { type: 'entropy' as const }),
  ].map(seed => ({ seed: seed as Seed })))('rejects a different supplied identity %# without using the other tier', async ({ seed }) => {
    setActiveNativeSeedWallet(null);
    mocks.device.hasStoredSeed.mockResolvedValue(true);
    mocks.bound.hasStoredSeed.mockResolvedValue(true);
    await expect(prepareNativeSeedConnection(seed)).rejects.toThrow(/does not match/);
    expect(getNativeSeedTier()).toBe('device');
    expect(mocks.bound.retrieveSeed).not.toHaveBeenCalled();
  });

  it('keeps raw seed bytes and their variant unchanged', async () => {
    setActiveNativeSeedWallet(null);
    const raw = Object.assign(Array.from({ length: 32 }, (_, index) => index), { type: 'entropy' as const });
    mocks.device.hasStoredSeed.mockResolvedValue(true);
    mocks.device.retrieveSeed.mockResolvedValue(raw);
    const result = await prepareNativeSeedConnection(raw);
    expect(result).toEqual(raw);
    expect(result).not.toBe(raw);
    expect(Object.isFrozen(result)).toBe(true);
  });

  it('does not treat absence or an unknown probe as permission to connect a supplied seed', async () => {
    setActiveNativeSeedWallet(null);
    await expect(prepareNativeSeedConnection(SEED)).rejects.toThrow(/unavailable/);
    mocks.device.hasStoredSeed.mockRejectedValue(new Error('Presence unavailable'));
    await expect(prepareNativeSeedConnection(SEED)).rejects.toThrow(/unavailable/);
    expect(mocks.device.retrieveSeed).not.toHaveBeenCalled();
  });

  it('cancels an initial proof if the saved tier changes during the fresh read', async () => {
    setActiveNativeSeedWallet(null);
    const pending = deferred<Seed>();
    mocks.device.hasStoredSeed.mockResolvedValue(true);
    mocks.device.retrieveSeed.mockReturnValue(pending.promise);
    const connecting = prepareNativeSeedConnection(SEED);
    await vi.waitFor(() => expect(mocks.device.retrieveSeed).toHaveBeenCalledOnce());
    setNativeSeedTier('biometric');
    pending.resolve(SEED);
    await expect(connecting).rejects.toThrow(/changed/);
  });

  it('snapshots the supplied identity before selection or native reads await', async () => {
    setActiveNativeSeedWallet(null);
    const pending = deferred<Seed>();
    const input = { ...SEED, passphrase: 'original' };
    mocks.device.hasStoredSeed.mockResolvedValue(true);
    mocks.device.retrieveSeed.mockReturnValue(pending.promise);
    const connecting = prepareNativeSeedConnection(input);
    input.passphrase = 'mutated';
    await vi.waitFor(() => expect(mocks.device.retrieveSeed).toHaveBeenCalledOnce());
    pending.resolve({ ...SEED, passphrase: 'original' });
    await expect(connecting).resolves.toEqual({ ...SEED, passphrase: 'original' });
  });

  it('does not prompt again after consuming a completed immutable startup/retry read', async () => {
    setNativeSeedTier('biometric');
    const seed = await readSelectedNativeSeed({ verifyIdentity: false });
    expect(Object.isFrozen(seed)).toBe(true);
    await expect(prepareNativeSeedConnection(seed!)).resolves.toEqual(SEED);
    expect(mocks.bound.retrieveSeed).toHaveBeenCalledOnce();
    expect(mocks.device.retrieveSeed).not.toHaveBeenCalled();
    await expect(prepareNativeSeedConnection(seed!)).rejects.toThrow(/already been used/);
    expect(mocks.bound.retrieveSeed).toHaveBeenCalledOnce();
  });
});

describe('native connection proof cannot be inferred from tier selection', () => {
  it('rejects the same mismatched direct seed on every retry after selection', async () => {
    setActiveNativeSeedWallet(null);
    mocks.device.hasStoredSeed.mockResolvedValue(true);
    mocks.device.retrieveSeed.mockResolvedValue({ ...SEED, passphrase: 'saved wallet' });
    for (let attempt = 0; attempt < 2; attempt++) {
      await expect(prepareNativeSeedConnection(SEED)).rejects.toThrow(/does not match/);
    }
    expect(mocks.device.retrieveSeed).toHaveBeenCalledTimes(2);
  });

  it('does not turn a selected tier from a failed fresh read into connection proof', async () => {
    setActiveNativeSeedWallet(null);
    mocks.device.hasStoredSeed.mockResolvedValue(true);
    mocks.device.retrieveSeed.mockRejectedValue(new Error('Saved record unavailable'));
    for (let attempt = 0; attempt < 2; attempt++) {
      await expect(prepareNativeSeedConnection(SEED)).rejects.toThrow(/unavailable/);
    }
    expect(mocks.device.retrieveSeed).toHaveBeenCalledTimes(2);
  });

  it('checks an arbitrary supplied seed even when the tier was already selected', async () => {
    setNativeSeedTier('device');
    mocks.device.retrieveSeed.mockResolvedValue({ ...SEED, passphrase: 'saved wallet' });
    await expect(prepareNativeSeedConnection(SEED)).rejects.toThrow(/does not match/);
    expect(mocks.device.retrieveSeed).toHaveBeenCalledOnce();
  });
});

describe('one-use startup read provenance', () => {
  it.each(['native lock', 'lock and reauthorize', 'connection', 'selection', 'browser epoch'] as const)('rejects a completed raw read after %s changes', async change => {
    setNativeSeedTier('device');
    const seed = await readSelectedNativeSeed({ verifyIdentity: false });
    if (change === 'native lock') lockNativeReadAccess();
    if (change === 'lock and reauthorize') {
      lockNativeReadAccess();
      confirmNativePinPolicy(false, getNativePinPolicyRevision());
    }
    if (change === 'connection') setActiveNativeSeedWallet({ getInfo: mocks.getInfo }, 'regtest');
    if (change === 'selection') setNativeSeedTier('device');
    if (change === 'browser epoch') lockSpendingSession();
    await expect(prepareNativeSeedConnection(seed!)).rejects.toThrow(/changed/);
    expect(mocks.device.retrieveSeed).toHaveBeenCalledOnce();
  });

  it.each([undefined, null, '  \u212b caf\u00e9  '])('preserves exact passphrase meaning %s in a direct saved-seed proof', async passphrase => {
    setActiveNativeSeedWallet(null);
    mocks.device.hasStoredSeed.mockResolvedValue(true);
    mocks.device.retrieveSeed.mockResolvedValue({ ...SEED, passphrase: passphrase ?? undefined });
    const input = { ...SEED, passphrase } as Seed;
    await expect(prepareNativeSeedConnection(input)).resolves.toEqual(input);
  });

  it('does not invoke a seed reader with a stale explicitly propagated entry lease', async () => {
    const lease = captureNativeReadLease();
    lockNativeReadAccess();
    confirmNativePinPolicy(false, getNativePinPolicyRevision());
    const read = vi.fn(async () => SEED);
    await expect(readSeedForActiveNativeWallet(read, lease)).rejects.toThrow(/changed/);
    expect(read).not.toHaveBeenCalled();
  });
});
