import {readRecoveryHistory} from './recoveryHistory';
import type {BreezSdk,Network,GetInfoResponse,Payment,DepositInfo} from '@breeztech/breez-sdk-spark';
import {operationWalletKey,readOperations,isUnresolved} from './operationJournal';
import {readRecoveries,recoveryUnresolved} from './signedRecoveryJournal';
import {readIncomingClaims} from './incomingClaimJournal';
import {readDepositClaims} from './depositClaimJournal';

const roots=['gys:payment-journal:','gys:incoming-claim:','gys:deposit-claim:','gys:signed-recovery:'];
function journalBytes():string {
  const entries:Array<[string,string]>=[];
  for(let i=0;i<localStorage.length;i++){
    const key=localStorage.key(i);
    if(key&&roots.some(root=>key.startsWith(root))){
      const value=localStorage.getItem(key);
      if(value===null)throw new Error('Wallet recovery records changed during connection. Retry without removing browser data.');
      entries.push([key,value]);
    }
  }
  return JSON.stringify(entries.sort(([a],[b])=>a.localeCompare(b)));
}
function validateInfo(info:GetInfoResponse):void {
  if(!info||typeof info.identityPubkey!=='string'||!/^(02|03)[0-9a-f]{64}$/i.test(info.identityPubkey)
      ||!Number.isSafeInteger(info.balanceSats)||info.balanceSats<0||info.balanceSats>2_100_000_000_000_000
      ||!Number.isSafeInteger(info.recoverableFundsSats)||info.recoverableFundsSats<0||info.recoverableFundsSats>2_100_000_000_000_000)
    throw new Error('Wallet identity or balance could not be verified. Your saved data is preserved.');
}
export interface BrowserRecoveryReadiness {
  info:GetInfoResponse;
  payments:Payment[];
  deposits:DepositInfo[];
  unresolved:Readonly<{payments:number;incoming:number;deposits:number;recoveries:number}>;
  historyMayHaveMore:boolean;
  localHistoryVerifiedCount:number;
  localHistoryDigest:string;
}
/** Required local reads before publishing a connected/restored browser wallet.
 * This verifies two matching complete LOCAL history reads, NOT provider
 * completeness, settlement evidence, a database snapshot or proof of
 * cross-device exactly-once execution. It never syncs, signs, sends, claims,
 * broadcasts, rewrites a journal or infers failure from a missing payment.
 * Unresolved valid records remain unresolved and accessible for reconciliation.
 */
export async function readBrowserRecoveryReadiness(
  sdk:Pick<BreezSdk,'getInfo'|'listPayments'|'listUnclaimedDeposits'>,
  network:Network,
  assertCurrent:()=>void,
):Promise<BrowserRecoveryReadiness>{
  assertCurrent();
  const original=journalBytes();
  const info=await sdk.getInfo({ensureSynced:false});
  assertCurrent();validateInfo(info);
  const walletKey=await operationWalletKey(network,info.identityPubkey);
  assertCurrent();
  const outgoing=readOperations(walletKey),incoming=readIncomingClaims(walletKey);
  const deposits=readDepositClaims().filter(record=>record.walletKey===walletKey);
  const recoveries=readRecoveries(walletKey);
  if(outgoing.some(r=>r.network!==network)||incoming.some(r=>r.network!==network)
      ||deposits.some(r=>r.intent.network!==network)||recoveries.some(r=>r.network!==network))
    throw new Error('Wallet recovery records do not match the connected network. No records were changed.');
  const [history,unclaimed]=await Promise.all([
    readRecoveryHistory(sdk,assertCurrent),sdk.listUnclaimedDeposits({}),
  ]);
  assertCurrent();
  if(!unclaimed||!Array.isArray(unclaimed.deposits))
    throw new Error('Wallet history or deposits could not be read. Retry without removing browser data.');
  if(journalBytes()!==original)
    throw new Error('Wallet recovery records changed during connection. Retry without removing browser data.');
  const verifiedHistory=await readRecoveryHistory(sdk,assertCurrent);
  if(verifiedHistory.count!==history.count||verifiedHistory.digest!==history.digest)
    throw new Error('Wallet history changed during recovery verification. Retry without removing wallet data.');
  const finalInfo=await sdk.getInfo({ensureSynced:false});
  assertCurrent();validateInfo(finalInfo);
  if(finalInfo.identityPubkey!==info.identityPubkey)
    throw new Error('Wallet identity changed while loading recovery data. No records were changed.');
  if(journalBytes()!==original)
    throw new Error('Wallet recovery records changed during connection. Retry without removing browser data.');
  return {info:finalInfo,payments:history.payments.slice(0,100),deposits:unclaimed.deposits,
    historyMayHaveMore:history.count>100,localHistoryVerifiedCount:history.count,localHistoryDigest:history.digest,
    unresolved:Object.freeze({payments:outgoing.filter(isUnresolved).length,
      incoming:incoming.filter(r=>r.state!=='settled').length,
      deposits:deposits.filter(r=>r.state!=='settled').length,
      recoveries:recoveries.filter(recoveryUnresolved).length})};
}
