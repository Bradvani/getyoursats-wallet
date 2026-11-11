import type {Network} from '@breeztech/breez-sdk-spark';

export type BrowserSdkStorageErrorCode = 'LEGACY_SHARED_STORAGE' | 'STORAGE_PRESENCE_UNKNOWN';

export class BrowserSdkStorageError extends Error {
  constructor(readonly code: BrowserSdkStorageErrorCode) {
    super(code === 'LEGACY_SHARED_STORAGE'
      ? 'Existing wallet records need a recovery review before this wallet can connect. Your saved records have been preserved.'
      : 'Saved wallet records could not be checked. Keep this browser data and try again before connecting.');
    this.name = 'BrowserSdkStorageError';
  }
}

/**
 * Pinned SDK 57c5 and candidate patches through 0006 used empty seed material
 * for external-signer storage. These are its default-account path suffixes.
 * The successor SDK restores the actual identity's existing seeded namespace.
 * A shared candidate database cannot safely be assigned to the current seed.
 * Do not open it, infer ownership, delete it, or silently choose a fresh path.
 *
 * This metadata read is not an atomic fence against an older tab creating a
 * legacy database later. It is a conservative startup preflight, not migration.
 */
export async function assertNoLegacyExternalSignerStorage(storageDir: string, network: Network): Promise<void> {
  if (typeof storageDir !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(storageDir)) {
    throw new BrowserSdkStorageError('STORAGE_PRESENCE_UNKNOWN');
  }
  const suffix = network === 'mainnet' ? '9ce7940a'
    : network === 'regtest' || network === 'signet' ? '2687e55a' : null;
  if (suffix === null) throw new BrowserSdkStorageError('STORAGE_PRESENCE_UNKNOWN');
  const legacy = `${storageDir}/${network}/${suffix}`;
  let databases: unknown;
  try {
    if (typeof indexedDB === 'undefined' || typeof indexedDB.databases !== 'function') {
      throw new BrowserSdkStorageError('STORAGE_PRESENCE_UNKNOWN');
    }
    databases = await indexedDB.databases();
  } catch {
    throw new BrowserSdkStorageError('STORAGE_PRESENCE_UNKNOWN');
  }
  if (!Array.isArray(databases)) throw new BrowserSdkStorageError('STORAGE_PRESENCE_UNKNOWN');
  for (const database of databases) {
    if (database === null || typeof database !== 'object' || Array.isArray(database)
      || typeof database.name !== 'string') {
      throw new BrowserSdkStorageError('STORAGE_PRESENCE_UNKNOWN');
    }
    if (database.name === legacy || database.name === `${legacy}-tree`) {
      throw new BrowserSdkStorageError('LEGACY_SHARED_STORAGE');
    }
  }
}
