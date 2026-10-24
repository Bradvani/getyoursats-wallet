import type {Payment} from '@breeztech/breez-sdk-spark';
import {isConversionPayment} from '../utils/paymentDescription';

/** Per-active-wallet-session de-duplication. Never persist payment secrets. */
export function rememberPaymentId(seen:Set<string>, id:string, limit=500):boolean {
  const alreadySeen=seen.has(id);
  if(alreadySeen) return false;
  seen.add(id);
  while(seen.size>limit){
    const first=seen.values().next().value;
    if(first===undefined) break;
    seen.delete(first);
  }
  return true;
}

/**
 * On first connection, accept completed payment history silently. On later
 * syncs, surface only the most recent newly completed *incoming* payment.
 *
 * The live SDK event and snapshot both use the same session-scoped Set, so
 * event + sync delivery of a single invoice never flashes twice. A snapshot
 * of an outgoing payment cannot produce a false receipt celebration.
 */
export function newlyCompletedReceive(
  payments:Payment[],
  seen:Set<string>,
  hasSnapshotBaseline:boolean,
):Payment|null {
  let recent:Payment|null=null;
  for(const payment of payments){
    if(!payment.id || payment.status!=='completed') continue;
    const isNew=rememberPaymentId(seen,payment.id);
    if(!hasSnapshotBaseline || !isNew || payment.paymentType!=='receive' ||
       isConversionPayment(payment)) continue;
    if(!recent || payment.timestamp>recent.timestamp) recent=payment;
  }
  return recent;
}
