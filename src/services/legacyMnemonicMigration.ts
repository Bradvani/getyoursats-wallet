/** Legacy seed compatibility. Native cleanup requires exact vault readback. */
import { deviceOnlyStorage, SecureStorageError } from './secureStorage';
import { logger, LogCategory } from './logger';

const MNEMONIC_KEY = 'walletMnemonic';
let pendingMigration: Promise<void> | null = null;

export const saveMnemonic = (m: string) => localStorage.setItem(MNEMONIC_KEY, m);
export const getSavedMnemonic = () => localStorage.getItem(MNEMONIC_KEY);
export const clearMnemonic = () => localStorage.removeItem(MNEMONIC_KEY);

/** Deduplicate startup migration within this process. A failed read or write
 * retains the legacy copy for retry. This is not a native cross-process lock. */
export function migrateLegacyMnemonicIfNeeded(): Promise<void> {
  if (!pendingMigration) {
    pendingMigration = migrateLegacyMnemonic().finally(() => { pendingMigration = null; });
  }
  return pendingMigration;
}

async function migrateLegacyMnemonic(): Promise<void> {
  if (!deviceOnlyStorage.isSupported()) return;
  try {
    const legacy = getSavedMnemonic();
    if (!legacy) return;
    if (!await deviceOnlyStorage.hasStoredSeed()) {
      // Some legacy presence adapters map plugin failures to false. Only an
      // explicit missing-record read permits writing into the destination.
      try {
        await deviceOnlyStorage.retrieveSeed();
        return;
      } catch (error) {
        if (!(error instanceof SecureStorageError) || error.code !== 'NO_STORED_SEED') return;
      }
      if (getSavedMnemonic() !== legacy) return;
      await deviceOnlyStorage.storeSeed({ type: 'mnemonic', mnemonic: legacy });
    }
    const stored = await deviceOnlyStorage.retrieveSeed();
    const sameSeed = stored.type === 'mnemonic'
      && stored.mnemonic === legacy
      && (stored.passphrase == null || stored.passphrase === '');
    if (!sameSeed || getSavedMnemonic() !== legacy) return;
    clearMnemonic();
    logger.info(LogCategory.AUTH, 'Removed legacy mnemonic after matching secure storage readback');
  } catch {
    // A failed acknowledgement may follow a committed write. Retain the source.
  }
}
