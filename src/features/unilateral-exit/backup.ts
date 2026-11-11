import JSZip from 'jszip';
import { shareOrDownloadZip } from '@/services/logExport';
import type { ExitStateExporter, ExitStateImporter } from './exitState';

const STATE_FILE = 'exit-state.json';

const README = [
  'GetYourSats exit-state backup',
  '',
  'This file holds the data needed to move your Spark balance on-chain without',
  'the operators. It is the one thing they cannot serve you again once they',
  'stop responding.',
  '',
  'To use it: restore your wallet from your recovery phrase, open Settings,',
  'Unilateral Exit, and choose to restore from an exit-state backup.',
  '',
  'This file is not a wallet recovery phrase. Keep the original recovery',
  'method and this exit-state file separately.',
  '',
  'A running exit can also require the signed transactions and operation',
  'journal on the original device. Do not erase that device or assume this',
  'file alone restores a partially completed exit.',
  '',
  'Keep it private. It reveals your balance, how it is split, and its history.',
  '',
].join('\n');

/**
 * Writes the exit state to a file the user keeps. Everything else an exit needs
 * is not always recoverable from the chain. A running exit may also require
 * its saved signed transactions and journal on the original device.
 *
 * `frozen` is the copy an exit under way was built against, which is preferred:
 * once an exit starts, the operators stop reporting the leaves it is moving, so
 * a fresh export would be missing them.
 */
export async function exportUnilateralExitBackup(
  sdk: ExitStateExporter,
  frozen?: string,
): Promise<void> {
  const exitState = frozen ?? (await sdk.exportUnilateralExitState()).exitState;
  if (exitState.length > 64 * 1024 * 1024) throw new Error('Exit-state export is too large for safe browser handling. The original data is preserved.');
  const zip = new JSZip();
  zip.file('README.txt', README);
  zip.file(STATE_FILE, exitState);

  const blob = await zip.generateAsync({ type: 'blob', compression: 'DEFLATE' });
  const timestamp = Math.floor(Date.now() / 1000);
  await shareOrDownloadZip(blob, `${timestamp}_getyoursats_exit_state_backup.zip`, 'GetYourSats Exit-State Backup');
}

/** What a restored file turned out to hold, once the sdk has read it. */
export interface RestoredExitState {
  importedLeaves: number;
  /** Leaves belonging to another wallet, so this file was not this wallet's. */
  skippedForeignLeaves: number;
  skippedConflictingLeaves: number;
  skippedChains: number;
}

export class UnreadableBackupError extends Error {
  constructor() {
    super('That file is not a readable GetYourSats exit-state backup');
    this.name = 'UnreadableBackupError';
  }
}

const exitStateFrom = async (file: File): Promise<string> => {
  if (file.size > 32 * 1024 * 1024) throw new UnreadableBackupError();
  const text = await file.text();
  // A plain export, saved without the zip around it.
  if (text.trimStart().startsWith('{')) {
    try { JSON.parse(text); return text; } catch { throw new UnreadableBackupError(); }
  }
  try {
    const entry = (await JSZip.loadAsync(file)).file(STATE_FILE);
    if (entry) {
      const content = await entry.async('string');
      if (content.length > 64 * 1024 * 1024) throw new UnreadableBackupError();
      try { JSON.parse(content); return content; } catch { throw new UnreadableBackupError(); }
    }
  } catch {
    throw new UnreadableBackupError();
  }
  throw new UnreadableBackupError();
};

/**
 * Reads a backup back into the wallet. Importing only ever adds leaf data the
 * wallet lacks, so a file holding nothing new is harmless rather than an error;
 * the counts say what happened, since a file from another wallet imports
 * nothing and would otherwise look like success.
 */
export async function importUnilateralExitBackup(
  sdk: ExitStateImporter,
  file: File,
): Promise<RestoredExitState> {
  return sdk.importUnilateralExitState({ exitState: await exitStateFrom(file) });
}
