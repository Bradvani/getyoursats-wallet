/**
 * Native initialization must preserve existing vault records. Bookkeeping
 * may be missing or unavailable independently of the Keychain / Keystore;
 * it cannot authorize deletion or prove a cryptographic migration.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Preferences } from '@capacitor/preferences';
import type { Seed } from '@breeztech/breez-sdk-spark';
import { wipeAllLocalData } from './accountDeletion';

const INSTALL_MARKER_KEY = 'glow.secureStorageInitialized';
const F3_MIGRATION_MARKER_KEY = 'glow.secureStorageF3Migrated';

// Keep Preferences independent of localStorage so either backend can fail
// without accidentally simulating a failure of both copies at once.
const preferenceFixture = vi.hoisted(() => {
  const values = new Map<string, string>();
  return {
    values,
    plugin: {
      get: async ({ key }: { key: string }) => ({ value: values.get(key) ?? null }),
      set: async ({ key, value }: { key: string; value: string }) => { values.set(key, value); },
      clear: async () => { values.clear(); },
    },
  };
});
vi.mock('@capacitor/preferences', () => ({ Preferences: preferenceFixture.plugin }));

vi.mock('@capacitor/core', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@capacitor/core')>();
  return {
    ...actual,
    Capacitor: { ...actual.Capacitor, isNativePlatform: () => true },
  };
});

/** Stands in for the Keychain / Keystore: survives module resets, like the
 *  real vault survives a process restart. */
const vault: { deviceOnly: string | null; bound: string | null } = {
  deviceOnly: null,
  bound: null,
};

/** How the OS answers each auth prompt; set per test. Android rejects
 *  the device-owner one outright, which is why the biometric fallback
 *  exists. */
let deviceOwnerPrompt: 'pass' | { code: string } = 'pass';
let biometricPrompt: 'pass' | { code: string } = 'pass';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
(globalThis as any).window = globalThis;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
(globalThis as any).Capacitor = {
  Plugins: {
    NativeVault: {
      hasStoredSeedDeviceOnly: async () => ({ stored: vault.deviceOnly !== null }),
      storeSeedDeviceOnly: async ({ seed }: { seed: string }) => { vault.deviceOnly = seed; },
      retrieveSeedDeviceOnly: async () => {
        if (vault.deviceOnly === null) throw { code: 'NO_STORED_SEED' };
        return { seed: vault.deviceOnly };
      },
      clearSeedDeviceOnly: async () => { vault.deviceOnly = null; },
      // Retired bound tier: no `storeSeed`, matching the real plugin.
      // A legacy entry only ever comes from an old build, so a test that
      // needs one assigns `vault.bound` directly.
      hasStoredSeed: async () => ({ stored: vault.bound !== null }),
      retrieveSeed: async () => {
        if (vault.bound === null) throw { code: 'NO_STORED_SEED' };
        return { seed: vault.bound };
      },
      clearSeed: async () => { vault.bound = null; },
      authenticateDeviceOwner: async () => {
        if (deviceOwnerPrompt !== 'pass') throw deviceOwnerPrompt;
      },
      authenticate: async () => {
        if (biometricPrompt !== 'pass') throw biometricPrompt;
      },
    },
  },
};

/** Re-import with a clean module registry: the init memo is module-level,
 *  so this is what a cold start looks like. */
async function coldStart() {
  vi.resetModules();
  return import('./secureStorage');
}

const SEED = { type: 'mnemonic', mnemonic: 'abandon ability able about' } as const;

describe('secure storage install marker', () => {
  beforeEach(async () => {
    vault.deviceOnly = null;
    vault.bound = null;
    localStorage.clear();
    await Preferences.clear();
  });

  it('writes the marker when a seed is stored', async () => {
    const { deviceOnlyStorage } = await coldStart();
    await deviceOnlyStorage.storeSeed(SEED);

    expect((await Preferences.get({ key: INSTALL_MARKER_KEY })).value).not.toBeNull();
    expect(vault.deviceOnly).not.toBeNull();
  });

  it('keeps the seed across a cold start once the marker is set', async () => {
    const first = await coldStart();
    await first.deviceOnlyStorage.storeSeed(SEED);

    const second = await coldStart();
    expect(await second.deviceOnlyStorage.hasStoredSeed()).toBe(true);
    expect(vault.deviceOnly).not.toBeNull();
  });

  it('keeps the original seed when bookkeeping disappears between cold starts', async () => {
    const first = await coldStart();
    await first.deviceOnlyStorage.storeSeed(SEED);

    const original = vault.deviceOnly;
    // Bookkeeping loss does not prove that the surviving vault is stale.
    localStorage.clear();
    await Preferences.clear();

    const second = await coldStart();
    expect(await second.deviceOnlyStorage.hasStoredSeed()).toBe(true);
    expect(await second.deviceOnlyStorage.retrieveSeed()).toEqual(SEED);
    expect(vault.deviceOnly).toBe(original);
  });

  it('re-marks a seed stored after a logout wipe, so the next cold start keeps it', async () => {
    const session = await coldStart();
    await session.deviceOnlyStorage.storeSeed(SEED);

    // Logout: erases the vault and every local store, markers included.
    await session.deviceOnlyStorage.clearSeed();
    await wipeAllLocalData();
    session.resetSecureStorageInit();

    // Re-onboard in the SAME session, no app restart.
    await session.deviceOnlyStorage.storeSeed(SEED);
    expect((await Preferences.get({ key: INSTALL_MARKER_KEY })).value).not.toBeNull();

    // The account must survive the next launch.
    const relaunch = await coldStart();
    expect(await relaunch.deviceOnlyStorage.hasStoredSeed()).toBe(true);
  });
});

/**
 * Neither an old install nor a missing marker proves a surviving vault can
 * be deleted. Use distinct seeds in both slots to detect cross-tier damage.
 */
describe('non-destructive native initialization', () => {
  const localGet = vi.mocked(localStorage.getItem).getMockImplementation()!;
  const localSet = vi.mocked(localStorage.setItem).getMockImplementation()!;
  const timestamp = '2026-10-27T00:00:00.000Z';
  const boundSeed = { ...SEED, passphrase: '  \u212b caf\u00e9  ' };
  const bytes = Array.from({ length: 32 }, (_, index) => index);
  const deviceSeed = Object.assign(bytes.slice(), { type: 'entropy' as const });
  const original = {
    bound: JSON.stringify({ version: 1, seed: boundSeed, createdAt: timestamp }),
    deviceOnly: JSON.stringify({ version: 1, seed: { type: 'entropy', bytes }, createdAt: timestamp }),
  };
  const nativeVault = (globalThis as unknown as { Capacitor: { Plugins: { NativeVault: {
    clearSeed: () => Promise<void>;
    clearSeedDeviceOnly: () => Promise<void>;
    retrieveSeed: () => Promise<{ seed: string }>;
    retrieveSeedDeviceOnly: () => Promise<{ seed: string }>;
    storeSeedDeviceOnly: (options: { seed: string }) => Promise<void>;
  } } } }).Capacitor.Plugins.NativeVault;

  beforeEach(async () => {
    vi.mocked(localStorage.getItem).mockImplementation(localGet);
    vi.mocked(localStorage.setItem).mockImplementation(localSet);
    vault.bound = original.bound;
    vault.deviceOnly = original.deviceOnly;
    localStorage.clear();
    await Preferences.clear();
  });
  afterEach(() => {
    // These methods are already vi.fn() fixtures; restoreAllMocks alone does
    // not restore an implementation replaced on a pre-existing mock.
    vi.mocked(localStorage.getItem).mockImplementation(localGet);
    vi.mocked(localStorage.setItem).mockImplementation(localSet);
  });

  const markerStates = [
    { name: 'both markers absent', prepare: async () => {} },
    { name: 'old F2 install marker without F3', prepare: async () => {
      await Preferences.set({ key: INSTALL_MARKER_KEY, value: timestamp });
    } },
    { name: 'legacy localStorage install marker only', prepare: async () => {
      localStorage.setItem(INSTALL_MARKER_KEY, timestamp);
    } },
    { name: 'historical F3 marker without install marker', prepare: async () => {
      await Preferences.set({ key: F3_MIGRATION_MARKER_KEY, value: timestamp });
      localStorage.setItem(F3_MIGRATION_MARKER_KEY, timestamp);
    } },
    { name: 'malformed bookkeeping', prepare: async () => {
      await Preferences.set({ key: INSTALL_MARKER_KEY, value: '' });
      await Preferences.set({ key: F3_MIGRATION_MARKER_KEY, value: 'not-a-migration-proof' });
      localStorage.setItem(F3_MIGRATION_MARKER_KEY, 'not-a-migration-proof');
    } },
    { name: 'Preferences read failure', prepare: async () => {
      vi.spyOn(Preferences, 'get').mockRejectedValue(new Error('Preferences unavailable'));
    } },
    { name: 'localStorage read failure', prepare: async () => {
      vi.spyOn(localStorage, 'getItem').mockImplementation(() => { throw new Error('WebView storage unavailable'); });
    } },
    { name: 'both marker reads fail', prepare: async () => {
      vi.spyOn(Preferences, 'get').mockRejectedValue(new Error('Preferences unavailable'));
      vi.spyOn(localStorage, 'getItem').mockImplementation(() => { throw new Error('WebView storage unavailable'); });
    } },
    { name: 'Preferences write failure', prepare: async () => {
      vi.spyOn(Preferences, 'set').mockRejectedValue(new Error('Preferences write failed'));
    } },
    { name: 'localStorage write failure', prepare: async () => {
      vi.spyOn(localStorage, 'setItem').mockImplementation(() => { throw new Error('WebView quota exceeded'); });
    } },
    { name: 'both marker writes fail', prepare: async () => {
      vi.spyOn(Preferences, 'set').mockRejectedValue(new Error('Preferences write failed'));
      vi.spyOn(localStorage, 'setItem').mockImplementation(() => { throw new Error('WebView quota exceeded'); });
    } },
  ];

  describe.each(['bound', 'deviceOnly'] as const)('%s is read first', first => {
    it.each(markerStates)('preserves both exact seeds with $name, including after restart', async ({ prepare }) => {
      await prepare();
      const oldF3 = preferenceFixture.values.get(F3_MIGRATION_MARKER_KEY);
      const clearBound = vi.spyOn(nativeVault, 'clearSeed');
      const clearDevice = vi.spyOn(nativeVault, 'clearSeedDeviceOnly');
      const writeSeed = vi.spyOn(nativeVault, 'storeSeedDeviceOnly');
      const markerWrites = vi.spyOn(Preferences, 'set');
      const mirrorWrites = vi.spyOn(localStorage, 'setItem');
      markerWrites.mockClear();
      mirrorWrites.mockClear();

      for (let start = 0; start < 2; start++) {
        const session = await coldStart();
        const { logger } = await import('./logger');
        const info = vi.spyOn(logger, 'info');
        if (first === 'bound') {
          expect(await session.secureStorage.hasStoredSeed()).toBe(true);
          expect(await session.secureStorage.retrieveSeed()).toEqual(boundSeed);
          expect(await session.deviceOnlyStorage.retrieveSeed()).toEqual(deviceSeed);
        } else {
          expect(await session.deviceOnlyStorage.hasStoredSeed()).toBe(true);
          expect(await session.deviceOnlyStorage.retrieveSeed()).toEqual(deviceSeed);
          expect(await session.secureStorage.retrieveSeed()).toEqual(boundSeed);
        }
        expect(vault).toEqual(original);
        expect(info.mock.calls.some(([, message]) => /Migrated.*F3/i.test(message))).toBe(false);
      }
      expect(clearBound).not.toHaveBeenCalled();
      expect(clearDevice).not.toHaveBeenCalled();
      expect(writeSeed).not.toHaveBeenCalled();
      expect(markerWrites.mock.calls.some(([{ key }]) => key === F3_MIGRATION_MARKER_KEY)).toBe(false);
      expect(mirrorWrites.mock.calls.some(([key]) => key === F3_MIGRATION_MARKER_KEY)).toBe(false);
      expect(preferenceFixture.values.get(F3_MIGRATION_MARKER_KEY)).toBe(oldF3);
    });
  });

  it.each([
    { storage: 'secureStorage', method: 'retrieveSeed' },
    { storage: 'deviceOnlyStorage', method: 'retrieveSeedDeviceOnly' },
  ] as const)('preserves records when $storage reports KEY_INVALIDATED with no markers', async ({ storage, method }) => {
    const clearBound = vi.spyOn(nativeVault, 'clearSeed');
    const clearDevice = vi.spyOn(nativeVault, 'clearSeedDeviceOnly');
    vi.spyOn(nativeVault, method).mockRejectedValue({ code: 'KEY_INVALIDATED' });
    const session = await coldStart();

    await expect(session[storage].retrieveSeed()).rejects.toMatchObject({ code: 'KEY_INVALIDATED' });
    expect(vault).toEqual(original);
    expect(clearBound).not.toHaveBeenCalled();
    expect(clearDevice).not.toHaveBeenCalled();
  });

  it('does not claim F3 conversion when an explicit device-only write leaves the bound record intact', async () => {
    vault.deviceOnly = null;
    const session = await coldStart();
    await session.deviceOnlyStorage.storeSeed(SEED);

    expect(vault.bound).toBe(original.bound);
    expect(await session.deviceOnlyStorage.retrieveSeed()).toEqual(SEED);
    expect(preferenceFixture.values.has(F3_MIGRATION_MARKER_KEY)).toBe(false);
    expect(localStorage.getItem(F3_MIGRATION_MARKER_KEY)).toBeNull();
  });

  it('only clears the requested slot after an explicit clear, even when all bookkeeping is absent', async () => {
    const clearBound = vi.spyOn(nativeVault, 'clearSeed');
    const clearDevice = vi.spyOn(nativeVault, 'clearSeedDeviceOnly');
    const session = await coldStart();
    await session.secureStorage.clearSeed();

    expect(clearBound).toHaveBeenCalledTimes(1);
    expect(clearDevice).not.toHaveBeenCalled();
    expect(vault.bound).toBeNull();
    expect(vault.deviceOnly).toBe(original.deviceOnly);
    expect(await session.deviceOnlyStorage.retrieveSeed()).toEqual(deviceSeed);

    await session.deviceOnlyStorage.clearSeed();
    expect(clearDevice).toHaveBeenCalledTimes(1);
    expect(vault).toEqual({ bound: null, deviceOnly: null });
  });
});

/** The retired tier remains readable in place until an explicit erase. */
describe('retired biometric-bound tier', () => {
  beforeEach(async () => {
    vault.deviceOnly = null;
    vault.bound = null;
    localStorage.clear();
    await Preferences.clear();
  });

  /**
   * An old build may have left both historical markers. Neither is
   * evidence that a later launch may delete or convert its saved seed.
   */
  async function plantLegacyInstall() {
    vault.bound = JSON.stringify({
      version: 1,
      seed: { type: 'mnemonic', mnemonic: SEED.mnemonic },
      createdAt: new Date().toISOString(),
    });
    const now = new Date().toISOString();
    await Preferences.set({ key: INSTALL_MARKER_KEY, value: now });
    await Preferences.set({ key: F3_MIGRATION_MARKER_KEY, value: now });
  }

  it('reads a legacy seed and supports a caller-requested copy and explicit erase', async () => {
    await plantLegacyInstall();

    const { secureStorage, deviceOnlyStorage } = await coldStart();
    expect(await secureStorage.hasStoredSeed()).toBe(true);
    expect(await secureStorage.retrieveSeed()).toEqual(SEED);

    // These are explicit API calls, not automatic initialization or unlock.
    await deviceOnlyStorage.storeSeed(SEED);
    await secureStorage.clearSeed();

    expect(vault.bound).toBeNull();
    expect(await secureStorage.hasStoredSeed()).toBe(false);
    expect(await deviceOnlyStorage.hasStoredSeed()).toBe(true);
  });

  it('exposes no way to write the tier back', async () => {
    const { secureStorage } = await coldStart();
    // Compile-time guaranteed by DrainOnlySecureStorage; asserted at
    // runtime too, because the type would not catch a stray re-add on
    // the class itself.
    expect('storeSeed' in secureStorage).toBe(false);
  });
});

describe('native mnemonic passphrase validation', () => {
  beforeEach(async () => {
    vault.deviceOnly = null;
    vault.bound = null;
    localStorage.clear();
    await Preferences.clear();
  });

  const blob = (passphrase: unknown) => JSON.stringify({
    version: 1,
    seed: { ...SEED, passphrase },
    createdAt: '2026-10-27T00:00:00.000Z',
  });

  async function preserveInstallMarkers() {
    const value = '2026-10-27T00:00:00.000Z';
    await Preferences.set({ key: INSTALL_MARKER_KEY, value });
    await Preferences.set({ key: F3_MIGRATION_MARKER_KEY, value });
  }

  describe.each([
    { slot: 'deviceOnly', storage: 'deviceOnlyStorage' },
    { slot: 'bound', storage: 'secureStorage' },
  ] as const)('$storage', ({ slot, storage }) => {
    it.each(['KEY_INVALIDATED', 'UNKNOWN'])('preserves %s presence failures instead of reporting an empty wallet', async code => {
      const original = blob('retained passphrase');
      vault[slot] = original;
      await preserveInstallMarkers();
      const plugin = (globalThis as unknown as {Capacitor: {Plugins: {NativeVault: {
        hasStoredSeed: () => Promise<{stored: boolean}>;
        hasStoredSeedDeviceOnly: () => Promise<{stored: boolean}>;
      }}}}).Capacitor.Plugins.NativeVault;
      vi.spyOn(plugin, slot === 'deviceOnly' ? 'hasStoredSeedDeviceOnly' : 'hasStoredSeed').mockRejectedValue({code});
      const session = await coldStart();

      await expect(session[storage].hasStoredSeed()).rejects.toMatchObject({code});
      expect(vault[slot]).toBe(original);
    });

    it('rejects a malformed presence response instead of selecting another wallet', async () => {
      const original = blob('retained passphrase');
      vault[slot] = original;
      await preserveInstallMarkers();
      const plugin = (globalThis as unknown as {Capacitor: {Plugins: {NativeVault: {
        hasStoredSeed: () => Promise<{stored: boolean}>;
        hasStoredSeedDeviceOnly: () => Promise<{stored: boolean}>;
      }}}}).Capacitor.Plugins.NativeVault;
      vi.spyOn(plugin, slot === 'deviceOnly' ? 'hasStoredSeedDeviceOnly' : 'hasStoredSeed').mockResolvedValue({stored: null} as never);
      const session = await coldStart();

      await expect(session[storage].hasStoredSeed()).rejects.toMatchObject({code: 'UNKNOWN'});
      expect(vault[slot]).toBe(original);
    });

    it.each([false, true, 0, 1, [], {}].map(passphrase => ({ passphrase })))('rejects malformed stored passphrase %# and retains the original record across reads', async ({ passphrase }) => {
      const original = blob(passphrase);
      vault[slot] = original;
      await preserveInstallMarkers();

      const first = await coldStart();
      await expect(first[storage].retrieveSeed()).rejects.toMatchObject({ code: 'INVALID_STORED_SEED' });
      expect(vault[slot]).toBe(original);

      const restarted = await coldStart();
      expect(await restarted[storage].hasStoredSeed()).toBe(true);
      await expect(restarted[storage].retrieveSeed()).rejects.toMatchObject({ code: 'INVALID_STORED_SEED' });
      expect(vault[slot]).toBe(original);
    });

    it.each(['not valid JSON', JSON.stringify({ version: 1, createdAt: '2026-10-27', seed: {} })])('does not misclassify malformed envelope %# as OS key invalidation', async original => {
      vault[slot] = original;
      await preserveInstallMarkers();
      const session = await coldStart();

      await expect(session[storage].retrieveSeed()).rejects.toMatchObject({ code: 'INVALID_STORED_SEED' });
      expect(vault[slot]).toBe(original);
      expect(await session[storage].hasStoredSeed()).toBe(true);
    });

    it.each([undefined, null, '', 'TREZOR', '  \u212b caf\u00e9  '])('reads supported passphrase %s without rewriting the saved identity', async passphrase => {
      const original = blob(passphrase);
      vault[slot] = original;
      await preserveInstallMarkers();

      const session = await coldStart();
      await expect(session[storage].retrieveSeed()).resolves.toEqual({
        ...SEED,
        passphrase: passphrase ?? undefined,
      });
      expect(vault[slot]).toBe(original);
    });
  });

  it.each([false, 0, NaN, [], {}].map(passphrase => ({ passphrase })))('rejects malformed write %# before storage initialization can alter an existing record', async ({ passphrase }) => {
    const original = blob('original passphrase');
    vault.deviceOnly = original;
    // Invalid input must be rejected before initialization writes bookkeeping
    // or a replacement write can alter the selected wallet.
    const session = await coldStart();
    const seed = Object.freeze({ ...SEED, passphrase }) as unknown as Seed;

    await expect(session.deviceOnlyStorage.storeSeed(seed)).rejects.toThrow(/passphrase/i);
    expect(vault.deviceOnly).toBe(original);
    expect((await Preferences.get({ key: INSTALL_MARKER_KEY })).value).toBeNull();
    expect(seed).toHaveProperty('passphrase', passphrase);
  });

  it('does not replace an initialized valid wallet with a malformed passphrase', async () => {
    const session = await coldStart();
    await session.deviceOnlyStorage.storeSeed({ ...SEED, passphrase: 'original passphrase' });
    const original = vault.deviceOnly;

    await expect(session.deviceOnlyStorage.storeSeed({ ...SEED, passphrase: false } as unknown as Seed)).rejects.toThrow(/passphrase/i);
    expect(vault.deviceOnly).toBe(original);
    const restarted = await coldStart();
    await expect(restarted.deviceOnlyStorage.retrieveSeed()).resolves.toEqual({ ...SEED, passphrase: 'original passphrase' });
  });

  it.each([undefined, null, '', '  \u212b caf\u00e9  '])('round-trips supported passphrase %s without mutating the caller', async passphrase => {
    const seed = Object.freeze({ ...SEED, passphrase }) as Seed;
    const session = await coldStart();
    await session.deviceOnlyStorage.storeSeed(seed);
    const restarted = await coldStart();
    await expect(restarted.deviceOnlyStorage.retrieveSeed()).resolves.toEqual({ ...SEED, passphrase: passphrase ?? undefined });
    expect(seed).toHaveProperty('passphrase', passphrase);
  });

  it('preserves the raw seed variant and original bytes through storage', async () => {
    const bytes = Array.from({ length: 32 }, (_, index) => index);
    const seed = Object.assign(bytes.slice(), { type: 'entropy' as const });
    const session = await coldStart();
    await session.deviceOnlyStorage.storeSeed(seed);
    const restarted = await coldStart();
    const restored = await restarted.deviceOnlyStorage.retrieveSeed();
    expect(restored).toEqual(seed);
    expect(restored).not.toBe(seed);
    expect(Array.from(seed)).toEqual(bytes);
  });
});

describe('device-owner gate in front of a local erase', () => {
  beforeEach(() => {
    deviceOwnerPrompt = 'pass';
    biometricPrompt = 'pass';
  });

  it('lets the erase run once the owner passes the prompt', async () => {
    const { confirmDeviceOwner } = await coldStart();
    expect(await confirmDeviceOwner('Erase all Glow data')).toBe(true);
  });

  it('refuses when the prompt is cancelled', async () => {
    const { confirmDeviceOwner } = await coldStart();
    deviceOwnerPrompt = { code: 'USER_CANCELLED' };
    expect(await confirmDeviceOwner('Erase all Glow data')).toBe(false);
  });

  it('falls back to the biometric prompt where device-owner auth is unavailable', async () => {
    // Android: the plugin rejects authenticateDeviceOwner outright, so
    // the biometric prompt has to carry the check there.
    const { confirmDeviceOwner } = await coldStart();
    deviceOwnerPrompt = { code: 'BIOMETRIC_UNAVAILABLE' };
    biometricPrompt = { code: 'USER_CANCELLED' };
    expect(await confirmDeviceOwner('Erase all Glow data')).toBe(false);

    biometricPrompt = 'pass';
    expect(await confirmDeviceOwner('Erase all Glow data')).toBe(true);
  });

  it('lets the erase run when there is no check left to run', async () => {
    // Neither passcode nor biometrics enrolled: refusing here would leave
    // a forgotten PIN with no way out except reinstalling.
    const { confirmDeviceOwner } = await coldStart();
    deviceOwnerPrompt = { code: 'BIOMETRIC_UNAVAILABLE' };
    biometricPrompt = { code: 'BIOMETRIC_NOT_ENROLLED' };
    expect(await confirmDeviceOwner('Erase all Glow data')).toBe(true);
  });
});

/** Reconstructed after workspace loss; these cases validate the new bytes. */
describe('device-only create-or-same preservation', () => {
  const nativeVault = (globalThis as unknown as { Capacitor: { Plugins: { NativeVault: {
    hasStoredSeedDeviceOnly: () => Promise<{ stored: boolean }>;
    retrieveSeedDeviceOnly: () => Promise<{ seed: string }>;
    retrieveSeed: () => Promise<{ seed: string }>;
    storeSeedDeviceOnly: (options: { seed: string }) => Promise<void>;
    clearSeedDeviceOnly: () => Promise<void>;
    clearSeed: () => Promise<void>;
  } } } }).Capacitor.Plugins.NativeVault;
  const originalSeed = { ...SEED, passphrase: '  \u212b caf\u00e9  ' };
  const differentSeed = { ...SEED, passphrase: 'different wallet' };
  const rawBytes = Array.from({ length: 32 }, (_, index) => index);
  const rawSeed = () => Object.assign(rawBytes.slice(), { type: 'entropy' as const });
  const envelope = (seed: unknown) => JSON.stringify({
    version: 1, seed, createdAt: '2026-01-01T00:00:00.000Z',
    preservedMetadata: { note: 'Retain the original envelope byte-for-byte' },
  }, null, 2);
  const original = envelope(originalSeed);
  const originalBound = envelope({ ...SEED, passphrase: 'retained bound wallet' });
  function watchMutations() {
    return {
      write: vi.spyOn(nativeVault, 'storeSeedDeviceOnly'),
      clearDevice: vi.spyOn(nativeVault, 'clearSeedDeviceOnly'),
      clearBound: vi.spyOn(nativeVault, 'clearSeed'),
    };
  }
  function expectUnchanged(writes: ReturnType<typeof watchMutations>, saved = original) {
    expect(vault.deviceOnly).toBe(saved);
    expect(vault.bound).toBe(originalBound);
    expect(writes.write).not.toHaveBeenCalled();
    expect(writes.clearDevice).not.toHaveBeenCalled();
    expect(writes.clearBound).not.toHaveBeenCalled();
  }
  function deferred() {
    let resolve!: () => void;
    const promise = new Promise<void>(done => { resolve = done; });
    return { promise, resolve };
  }

  beforeEach(async () => {
    vault.deviceOnly = original;
    vault.bound = originalBound;
    localStorage.clear();
    await Preferences.clear();
  });

  it('creates only after an exact native absence response, without a presence fallback', async () => {
    vault.deviceOnly = null;
    const writes = watchMutations();
    const read = vi.spyOn(nativeVault, 'retrieveSeedDeviceOnly');
    const presence = vi.spyOn(nativeVault, 'hasStoredSeedDeviceOnly');
    const { deviceOnlyStorage } = await coldStart();
    await deviceOnlyStorage.storeSeed(originalSeed);
    expect(read).toHaveBeenCalledTimes(1);
    expect(presence).not.toHaveBeenCalled();
    expect(writes.write).toHaveBeenCalledTimes(1);
    expect(await deviceOnlyStorage.retrieveSeed()).toEqual(originalSeed);
    expect(vault.bound).toBe(originalBound);
    expect(writes.clearDevice).not.toHaveBeenCalled();
    expect(writes.clearBound).not.toHaveBeenCalled();
  });

  it.each([
    { name: 'mnemonic', saved: originalSeed, incoming: originalSeed },
    { name: 'raw bytes', saved: { type: 'entropy', bytes: rawBytes }, incoming: rawSeed() },
    { name: 'null to undefined absence', saved: { ...SEED, passphrase: null }, incoming: SEED },
    { name: 'undefined to null absence', saved: SEED, incoming: { ...SEED, passphrase: null } },
    { name: 'empty passphrase', saved: { ...SEED, passphrase: '' }, incoming: { ...SEED, passphrase: '' } },
  ])('preserves the exact $name envelope across idempotent calls and restart', async ({ saved, incoming }) => {
    const retained = envelope(saved);
    vault.deviceOnly = retained;
    const writes = watchMutations();
    for (let restart = 0; restart < 2; restart++) {
      const { deviceOnlyStorage } = await coldStart();
      await deviceOnlyStorage.storeSeed(incoming as Seed);
      expectUnchanged(writes, retained);
    }
  });

  it.each([
    { name: 'different passphrase', saved: originalSeed, incoming: differentSeed },
    { name: 'different mnemonic', saved: originalSeed, incoming: { ...originalSeed, mnemonic: 'ability abandon able about' } },
    { name: 'empty versus absent passphrase', saved: SEED, incoming: { ...SEED, passphrase: '' } },
    { name: 'Unicode normalization', saved: originalSeed, incoming: { ...originalSeed, passphrase: originalSeed.passphrase.normalize('NFKD') } },
    { name: 'mnemonic to raw variant', saved: originalSeed, incoming: rawSeed() },
    { name: 'raw to mnemonic variant', saved: { type: 'entropy', bytes: rawBytes }, incoming: originalSeed },
    { name: 'different raw bytes', saved: { type: 'entropy', bytes: rawBytes }, incoming: Object.assign(rawBytes.map(value => value + 1), { type: 'entropy' as const }) },
  ])('rejects $name without replacing either slot', async ({ saved, incoming }) => {
    const retained = envelope(saved);
    vault.deviceOnly = retained;
    const writes = watchMutations();
    const { deviceOnlyStorage } = await coldStart();
    await expect(deviceOnlyStorage.storeSeed(incoming as Seed)).rejects.toMatchObject({ code: 'SEED_CONFLICT' });
    expectUnchanged(writes, retained);
  });

  it.each([
    'not JSON', 'null', envelope({}), envelope({ ...SEED, passphrase: false }),
    envelope({ type: 'entropy', bytes: [0, -1] }),
    envelope({ type: 'entropy', bytes: [0, 256] }),
    envelope({ type: 'entropy', bytes: [0, 0.5] }),
    envelope({ type: 'entropy', bytes: [0, '1'] }),
    envelope({ type: 'entropy', bytes: [0, null] }),
    JSON.stringify({ version: 2, seed: originalSeed, createdAt: '2026-01-01' }),
  ])('retains malformed stored record %# through create and restart', async retained => {
    vault.deviceOnly = retained;
    const writes = watchMutations();
    const first = await coldStart();
    await expect(first.deviceOnlyStorage.storeSeed(originalSeed)).rejects.toMatchObject({ code: 'INVALID_STORED_SEED' });
    const restarted = await coldStart();
    await expect(restarted.deviceOnlyStorage.retrieveSeed()).rejects.toMatchObject({ code: 'INVALID_STORED_SEED' });
    expectUnchanged(writes, retained);
  });

  it.each([undefined, null, {}, { seed: null }, { seed: 0 }, { seed: { toString: () => original } }].map(response => ({ response })))('does not treat malformed native response %# as absence', async ({ response }) => {
    const writes = watchMutations();
    vi.spyOn(nativeVault, 'retrieveSeedDeviceOnly').mockResolvedValue(response as never);
    const { deviceOnlyStorage } = await coldStart();
    await expect(deviceOnlyStorage.storeSeed(differentSeed)).rejects.toMatchObject({ code: 'INVALID_STORED_SEED' });
    expectUnchanged(writes);
  });

  it.each(['KEY_INVALIDATED', 'UNKNOWN', 'USER_CANCELLED', 'BIOMETRIC_LOCKOUT', 'NOT_SUPPORTED'])('retains %s failures without falling back to presence', async code => {
    const writes = watchMutations();
    vi.spyOn(nativeVault, 'retrieveSeedDeviceOnly').mockRejectedValue({ code });
    const presence = vi.spyOn(nativeVault, 'hasStoredSeedDeviceOnly').mockResolvedValue({ stored: false });
    const { deviceOnlyStorage } = await coldStart();
    await expect(deviceOnlyStorage.storeSeed(differentSeed)).rejects.toMatchObject({ code });
    expectUnchanged(writes);
    expect(presence).not.toHaveBeenCalled();
  });

  it.each([
    { code: ['NO_STORED_SEED'] },
    { code: Object('NO_STORED_SEED') },
    { code: { toString: () => 'NO_STORED_SEED' } },
    { code: { [Symbol.toPrimitive]: () => 'NO_STORED_SEED' } },
    { code: null }, { code: undefined }, { code: false }, { code: 0 },
    { code: ' NO_STORED_SEED' }, { code: 'NO_STORED_SEED ' },
    { message: 'NO_STORED_SEED' }, 'NO_STORED_SEED',
    { code: 'SOME_OTHER_ERROR', message: 'NO_STORED_SEED' },
    { code: 'INVALID_STORED_SEED' }, { code: 'SEED_CONFLICT' },
  ].map(failure => ({ failure })))('does not turn malformed or unsupported absence claim %# into write permission', async ({ failure }) => {
    const writes = watchMutations();
    vi.spyOn(nativeVault, 'retrieveSeedDeviceOnly').mockRejectedValue(failure);
    const { deviceOnlyStorage } = await coldStart();
    await expect(deviceOnlyStorage.storeSeed(differentSeed)).rejects.toMatchObject({ code: 'UNKNOWN' });
    expectUnchanged(writes);
  });

  it.each([
    undefined, null, false, 0, {}, { type: 'mnemonic', mnemonic: null },
    { ...SEED, passphrase: false }, { type: 'unknown' },
    { type: 'entropy', bytes: rawBytes },
    Object.assign([0, -1], { type: 'entropy' }),
    Object.assign([0, 256], { type: 'entropy' }),
    Object.assign([0, 0.5], { type: 'entropy' }),
    Object.assign([0, NaN], { type: 'entropy' }),
    Object.assign([0, '1'], { type: 'entropy' }),
    Object.assign(new Array(2), { type: 'entropy' }),
  ].map(seed => ({ seed })))('rejects malformed incoming shape %# before any vault or bookkeeping call', async ({ seed }) => {
    const writes = watchMutations();
    const read = vi.spyOn(nativeVault, 'retrieveSeedDeviceOnly');
    const marker = vi.spyOn(Preferences, 'get');
    const { deviceOnlyStorage } = await coldStart();
    await expect(deviceOnlyStorage.storeSeed(seed as Seed)).rejects.toThrow();
    expectUnchanged(writes);
    expect(read).not.toHaveBeenCalled();
    expect(marker).not.toHaveBeenCalled();
  });

  it.each(['mnemonic', 'entropy'] as const)('snapshots mutable %s before the first await', async variant => {
    vault.deviceOnly = null;
    const incoming: Seed = variant === 'mnemonic' ? { ...originalSeed } : rawSeed();
    const expected = variant === 'mnemonic' ? { ...originalSeed } : rawSeed();
    const { deviceOnlyStorage } = await coldStart();
    const store = deviceOnlyStorage.storeSeed(incoming);
    if (incoming.type === 'mnemonic') {
      incoming.mnemonic = 'mutated mnemonic';
      incoming.passphrase = 'mutated passphrase';
    } else incoming[0] = 255;
    await store;
    expect(await deviceOnlyStorage.retrieveSeed()).toEqual(expected);
  });

  it.each([false, true])('serializes concurrent creates, same incoming identity=%s', async same => {
    vault.deviceOnly = null;
    const started = deferred();
    const finish = deferred();
    const writes = watchMutations();
    writes.write.mockImplementationOnce(async ({ seed }) => {
      started.resolve();
      await finish.promise;
      vault.deviceOnly = seed;
    });
    const { deviceOnlyStorage } = await coldStart();
    const results = Promise.allSettled([
      deviceOnlyStorage.storeSeed(originalSeed),
      deviceOnlyStorage.storeSeed(same ? originalSeed : differentSeed),
    ]);
    await started.promise;
    const writesWhilePending = writes.write.mock.calls.length;
    finish.resolve();
    const [first, second] = await results;
    expect(first.status).toBe('fulfilled');
    if (same) expect(second.status).toBe('fulfilled');
    else expect(second).toMatchObject({ status: 'rejected', reason: { code: 'SEED_CONFLICT' } });
    expect(writesWhilePending).toBe(1);
    expect(writes.write).toHaveBeenCalledTimes(1);
    expect(await deviceOnlyStorage.retrieveSeed()).toEqual(originalSeed);
    expect(vault.bound).toBe(originalBound);
  });

  it.each([false, true])('retains a committed write after lost acknowledgement, same retry=%s', async same => {
    vault.deviceOnly = null;
    const writes = watchMutations();
    writes.write.mockImplementationOnce(async ({ seed }) => {
      vault.deviceOnly = seed;
      throw new Error('Native write committed but acknowledgement was lost');
    });
    const { deviceOnlyStorage } = await coldStart();
    const [first, second] = await Promise.allSettled([
      deviceOnlyStorage.storeSeed(originalSeed),
      deviceOnlyStorage.storeSeed(same ? originalSeed : differentSeed),
    ]);
    expect(first).toMatchObject({ status: 'rejected', reason: { code: 'UNKNOWN' } });
    if (same) expect(second.status).toBe('fulfilled');
    else expect(second).toMatchObject({ status: 'rejected', reason: { code: 'SEED_CONFLICT' } });
    expect(writes.write).toHaveBeenCalledTimes(1);
    expect(writes.clearDevice).not.toHaveBeenCalled();
    expect(writes.clearBound).not.toHaveBeenCalled();
    const restarted = await coldStart();
    expect(await restarted.deviceOnlyStorage.retrieveSeed()).toEqual(originalSeed);
    expect(vault.bound).toBe(originalBound);
  });

  it('allows a later create after an uncommitted write failure and a fresh absence read', async () => {
    vault.deviceOnly = null;
    const writes = watchMutations();
    const read = vi.spyOn(nativeVault, 'retrieveSeedDeviceOnly');
    writes.write.mockRejectedValueOnce({ code: 'UNKNOWN' });
    const { deviceOnlyStorage } = await coldStart();
    const [first, second] = await Promise.allSettled([
      deviceOnlyStorage.storeSeed(originalSeed), deviceOnlyStorage.storeSeed(differentSeed),
    ]);
    expect(first).toMatchObject({ status: 'rejected', reason: { code: 'UNKNOWN' } });
    expect(second.status).toBe('fulfilled');
    expect(read).toHaveBeenCalledTimes(2);
    expect(writes.write).toHaveBeenCalledTimes(2);
    expect(await deviceOnlyStorage.retrieveSeed()).toEqual(differentSeed);
  });

  it('does not poison later writes after a failed read', async () => {
    const writes = watchMutations();
    vi.spyOn(nativeVault, 'retrieveSeedDeviceOnly').mockRejectedValueOnce({ code: 'UNKNOWN' });
    const { deviceOnlyStorage } = await coldStart();
    const [first, second] = await Promise.allSettled([
      deviceOnlyStorage.storeSeed(differentSeed), deviceOnlyStorage.storeSeed(originalSeed),
    ]);
    expect(first).toMatchObject({ status: 'rejected', reason: { code: 'UNKNOWN' } });
    expect(second.status).toBe('fulfilled');
    expectUnchanged(writes);
  });

  it('queues explicit clear after an in-flight create so the old write cannot resurrect a seed', async () => {
    vault.deviceOnly = null;
    const started = deferred();
    const finish = deferred();
    const writes = watchMutations();
    writes.write.mockImplementationOnce(async ({ seed }) => {
      started.resolve();
      await finish.promise;
      vault.deviceOnly = seed;
    });
    const { deviceOnlyStorage } = await coldStart();
    const pendingStore = deviceOnlyStorage.storeSeed(originalSeed);
    await started.promise;
    const pendingClear = deviceOnlyStorage.clearSeed();
    await Promise.resolve();
    await Promise.resolve();
    const clearsWhilePending = writes.clearDevice.mock.calls.length;
    finish.resolve();
    await Promise.all([pendingStore, pendingClear]);
    expect(clearsWhilePending).toBe(0);
    expect(writes.clearDevice).toHaveBeenCalledTimes(1);
    expect(vault.deviceOnly).toBeNull();
    expect(vault.bound).toBe(originalBound);
    await deviceOnlyStorage.storeSeed(differentSeed);
    expect(await deviceOnlyStorage.retrieveSeed()).toEqual(differentSeed);
  });

  it('retains the winning record if an explicit clear fails before a different queued create', async () => {
    const writes = watchMutations();
    writes.clearDevice.mockRejectedValueOnce({ code: 'UNKNOWN' });
    const { deviceOnlyStorage } = await coldStart();
    const [clear, create] = await Promise.allSettled([
      deviceOnlyStorage.clearSeed(), deviceOnlyStorage.storeSeed(differentSeed),
    ]);
    expect(clear).toMatchObject({ status: 'rejected', reason: { code: 'UNKNOWN' } });
    expect(create).toMatchObject({ status: 'rejected', reason: { code: 'SEED_CONFLICT' } });
    expect(vault.deviceOnly).toBe(original);
    expect(vault.bound).toBe(originalBound);
    expect(writes.write).not.toHaveBeenCalled();
    expect(writes.clearBound).not.toHaveBeenCalled();
  });
});
