import type {BreezSdk, Payment} from '@breeztech/breez-sdk-spark';
import {journalDigest} from './operationJournal';

export const RECOVERY_HISTORY_PAGE_SIZE = 100;
// A refusal is explicit, never a silently truncated "complete" recovery.
export const RECOVERY_HISTORY_MAX_ROWS = 100_000;
export type RecoveryHistory = Readonly<{payments:Payment[];count:number;digest:string}>;

function validatePayment(value:unknown):asserts value is Payment {
  if(!value||typeof value!=='object'||Array.isArray(value))throw new Error('Wallet history contains an invalid record. Keep the original wallet data.');
  const p=value as Payment;
  if(typeof p.id!=='string'||p.id.length<1||p.id.length>256||!['send','receive'].includes(p.paymentType)
      ||!['completed','pending','failed'].includes(p.status)
      ||!['lightning','spark','token','deposit','withdraw','unknown'].includes(p.method)
      ||typeof p.amount!=='bigint'||p.amount<0n||typeof p.fees!=='bigint'||p.fees<0n
      ||!Number.isSafeInteger(p.timestamp)||p.timestamp<0)
    throw new Error('Wallet history contains an invalid record. Keep the original wallet data.');
}

/** Enumerate all locally returned payments. No sync, signing, provider query or
 * settlement decision is requested. A terminal empty/short page is required.
 * The digest is evidence of a read, not proof of provider completeness. */
export async function readRecoveryHistory(
  sdk:Pick<BreezSdk,'listPayments'>,
  assertCurrent:()=>void,
):Promise<RecoveryHistory>{
  const rows:Payment[]=[],seen=new Set<string>();
  for(let offset=0;offset<=RECOVERY_HISTORY_MAX_ROWS;offset+=RECOVERY_HISTORY_PAGE_SIZE){
    assertCurrent();
    const page=await sdk.listPayments({offset,limit:RECOVERY_HISTORY_PAGE_SIZE});
    assertCurrent();
    if(!page||!Array.isArray(page.payments)||page.payments.length>RECOVERY_HISTORY_PAGE_SIZE)
      throw new Error('Wallet history pagination is invalid. No recovery data was changed.');
    for(const row of page.payments){
      validatePayment(row);
      if(seen.has(row.id))throw new Error('Wallet history changed or repeated a page. Retry without removing wallet data.');
      seen.add(row.id);rows.push(structuredClone(row));
      if(rows.length>RECOVERY_HISTORY_MAX_ROWS)
        throw new Error('Wallet history exceeds the automatic recovery-check limit. Preserve the original data for an extended recovery review.');
    }
    if(page.payments.length<RECOVERY_HISTORY_PAGE_SIZE){
      const digest=await journalDigest([...rows].sort((a,b)=>a.id.localeCompare(b.id)));
      assertCurrent();return Object.freeze({payments:rows,count:rows.length,digest});
    }
  }
  throw new Error('Wallet history did not reach a final page. Recovery remains unverified.');
}
