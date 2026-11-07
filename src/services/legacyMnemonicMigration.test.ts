/**
 * Guard for the drain: a vault that already holds the seed used to make
 * startup return early and leave the legacy copy behind.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { Seed } from '@breeztech/breez-sdk-spark';

const vault = vi.hoisted(() => ({ seed: null as Seed | null }));
const methods = vi.hoisted(() => ({ has: vi.fn(), read: vi.fn(), write: vi.fn() }));

vi.mock('./secureStorage', async importOriginal => ({
  SecureStorageError: (await importOriginal<typeof import('./secureStorage')>()).SecureStorageError,
  deviceOnlyStorage: {
    isSupported: () => true,
    hasStoredSeed: methods.has,
    retrieveSeed: methods.read,
    storeSeed: methods.write,
  },
}));

import { migrateLegacyMnemonicIfNeeded, getSavedMnemonic, saveMnemonic } from './legacyMnemonicMigration';
import { SecureStorageError } from './secureStorage';

const MNEMONIC = 'abandon abandon ability';
const OTHER = 'zoo zoo wrong';

describe('migrateLegacyMnemonicIfNeeded', () => {
  beforeEach(() => {
    vault.seed = null;
    methods.has.mockReset().mockImplementation(async () => vault.seed !== null);
    methods.read.mockReset().mockImplementation(async () => {
      if (!vault.seed) throw new SecureStorageError('NO_STORED_SEED', 'No saved fixture');
      return vault.seed;
    });
    methods.write.mockReset().mockImplementation(async (seed: Seed) => { vault.seed = seed; });
    localStorage.clear();
  });

  it('moves the plaintext mnemonic into an empty vault', async () => {
    saveMnemonic(MNEMONIC);
    await migrateLegacyMnemonicIfNeeded();
    expect(vault.seed).toEqual({ type: 'mnemonic', mnemonic: MNEMONIC });
    expect(getSavedMnemonic()).toBeNull();
  });

  it('deletes the plaintext mnemonic when the vault already holds the same seed', async () => {
    vault.seed = { type: 'mnemonic', mnemonic: MNEMONIC };
    saveMnemonic(MNEMONIC);
    await migrateLegacyMnemonicIfNeeded();
    expect(getSavedMnemonic()).toBeNull();
  });

  it('keeps a plaintext mnemonic that differs from the vault seed', async () => {
    vault.seed = { type: 'mnemonic', mnemonic: OTHER };
    saveMnemonic(MNEMONIC);
    await migrateLegacyMnemonicIfNeeded();
    expect(getSavedMnemonic()).toBe(MNEMONIC);
    expect(vault.seed).toEqual({ type: 'mnemonic', mnemonic: OTHER });
  });

  it('treats a vault passphrase as a different wallet', async () => {
    vault.seed = { type: 'mnemonic', mnemonic: MNEMONIC, passphrase: 'x' };
    saveMnemonic(MNEMONIC);
    await migrateLegacyMnemonicIfNeeded();
    expect(getSavedMnemonic()).toBe(MNEMONIC);
  });

  it('retains the source when a successful write has no matching readback', async () => {
    saveMnemonic(MNEMONIC);
    methods.write.mockResolvedValue(undefined);
    await migrateLegacyMnemonicIfNeeded();
    expect(getSavedMnemonic()).toBe(MNEMONIC);
  });

  it.each(['read', 'write', 'has'] as const)('retains the source after a %s failure', async method => {
    saveMnemonic(MNEMONIC);
    methods[method].mockRejectedValue(new Error('storage unavailable'));
    await migrateLegacyMnemonicIfNeeded();
    expect(getSavedMnemonic()).toBe(MNEMONIC);
  });

  it('retains a newer source written while vault readback was pending', async () => {
    vault.seed = { type: 'mnemonic', mnemonic: MNEMONIC };
    saveMnemonic(MNEMONIC);
    methods.read.mockImplementation(async () => {
      saveMnemonic(OTHER);
      return vault.seed;
    });
    await migrateLegacyMnemonicIfNeeded();
    expect(getSavedMnemonic()).toBe(OTHER);
    expect(methods.write).not.toHaveBeenCalled();
  });

  it('does not write a stale source after the presence check', async () => {
    saveMnemonic(MNEMONIC);
    methods.has.mockImplementation(async () => { saveMnemonic(OTHER); return false; });
    await migrateLegacyMnemonicIfNeeded();
    expect(getSavedMnemonic()).toBe(OTHER);
    expect(methods.write).not.toHaveBeenCalled();
  });

  it('retains both distinct sources after mismatched vault readback', async () => {
    saveMnemonic(MNEMONIC);
    methods.read.mockRejectedValueOnce(new SecureStorageError('NO_STORED_SEED', 'No saved fixture'))
      .mockResolvedValueOnce({ type: 'mnemonic', mnemonic: OTHER });
    await migrateLegacyMnemonicIfNeeded();
    expect(getSavedMnemonic()).toBe(MNEMONIC);
  });

  it('retries an uncertain write by reading the persisted seed', async () => {
    saveMnemonic(MNEMONIC);
    methods.write.mockImplementation(async (seed: Seed) => {
      vault.seed = seed;
      throw new Error('acknowledgement lost');
    });
    await migrateLegacyMnemonicIfNeeded();
    expect(getSavedMnemonic()).toBe(MNEMONIC);
    await migrateLegacyMnemonicIfNeeded();
    expect(getSavedMnemonic()).toBeNull();
    expect(methods.write).toHaveBeenCalledTimes(1);
  });

  it('shares a single migration when startup callers overlap', async () => {
    saveMnemonic(MNEMONIC);
    await Promise.all([migrateLegacyMnemonicIfNeeded(), migrateLegacyMnemonicIfNeeded()]);
    expect(methods.write).toHaveBeenCalledTimes(1);
    expect(methods.read).toHaveBeenCalledTimes(2);
    expect(getSavedMnemonic()).toBeNull();
  });

  it.each([false, 0, [], {}])('retains the source with malformed passphrase %#', async passphrase => {
    saveMnemonic(MNEMONIC);
    methods.has.mockResolvedValue(true);
    methods.read.mockResolvedValue({ type: 'mnemonic', mnemonic: MNEMONIC, passphrase });
    await migrateLegacyMnemonicIfNeeded();
    expect(getSavedMnemonic()).toBe(MNEMONIC);
  });

  it('does not overwrite a destination when a false presence check disagrees with a read', async () => {
    saveMnemonic(MNEMONIC);
    vault.seed = { type: 'mnemonic', mnemonic: OTHER };
    methods.has.mockResolvedValue(false);
    await migrateLegacyMnemonicIfNeeded();
    expect(methods.write).not.toHaveBeenCalled();
    expect(vault.seed.mnemonic).toBe(OTHER);
    expect(getSavedMnemonic()).toBe(MNEMONIC);
  });

  it.each(['UNKNOWN', 'KEY_INVALIDATED', 'USER_CANCELLED'] as const)(
    'does not treat a %s read error as an empty destination', async code => {
      saveMnemonic(MNEMONIC);
      methods.read.mockRejectedValue(new SecureStorageError(code, 'Unavailable fixture'));
      await migrateLegacyMnemonicIfNeeded();
      expect(methods.write).not.toHaveBeenCalled();
      expect(getSavedMnemonic()).toBe(MNEMONIC);
    },
  );

});
