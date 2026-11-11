// Shared with the writers so removal protection follows the persisted schema.
export const EXIT_PLAN_STORAGE_PREFIX='recovery-plan:';
export const EXIT_PENDING_STORAGE_PREFIX='unilateral-exit-pending:';

/**
 * Removal wipes the whole origin, so check every wallet and network. Do not use
 * loadPlan/loadPendingExit: their tolerant readers hide damaged or empty records.
 * An unarchived plan remains recovery evidence even if its phase says complete.
 */
export function assertNoExitRecordsForRemoval(storage:Pick<Storage,'length'|'key'>=localStorage):void {
 const count=storage.length;
 for(let index=0;index<count;index++){
  const key=storage.key(index);
  if(key===null)throw new Error('Recovery records changed while checking removal. Wallet data was preserved.');
  if(key.startsWith(EXIT_PLAN_STORAGE_PREFIX)||key.startsWith(EXIT_PENDING_STORAGE_PREFIX))
   throw new Error('An unfinished or unverified Bitcoin recovery exists on this device. Complete or recover it before removing wallet data.');
 }
 if(storage.length!==count)throw new Error('Recovery records changed while checking removal. Wallet data was preserved.');
}
