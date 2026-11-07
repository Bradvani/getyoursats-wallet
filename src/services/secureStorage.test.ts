/**
 * Native initialization must preserve existing vault records. Bookkeeping
 * may be missing or unavailable independently of the Keychain / Keystore;
 * it cannot authorize deletion or prove a cryptographic migration.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Preferences } from '@capacitor/preferences';
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
      retrieveSeedDeviceOnly: async () => ({ seed: vault.deviceOnly! }),
      clearSeedDeviceOnly: async () => { vault.deviceOnly = null; },
      // Retired bound tier: no `storeSeed`, matching the real plugin.
      // A legacy entry only ever comes from an old build, so a test that
      // needs one assigns `vault.bound` directly.
      hasStoredSeed: async () => ({ stored: vault.bound !== null }),
      retrieveSeed: async () => ({ seed: vault.bound! }),
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

describe('retired biometric-bound tier', () => {
  beforeEach(async () => {
    vault.deviceOnly = null;
    vault.bound = null;
    localStorage.clear();
    await Preferences.clear();
  });

  /**
   * What an old build left behind: a blob in the bound slot plus both
   * markers. These values are compatibility bookkeeping, not permission
   * to delete or convert a surviving seed.
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

  it('still drains a legacy seed and can then wipe it', async () => {
    await plantLegacyInstall();

    const { secureStorage, deviceOnlyStorage } = await coldStart();
    expect(await secureStorage.hasStoredSeed()).toBe(true);
    expect(await secureStorage.retrieveSeed()).toEqual(SEED);

    // The drain: forward into device-only, then retire the old slot.
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
