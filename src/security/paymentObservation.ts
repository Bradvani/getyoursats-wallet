/** Fresh status evidence, not cached `getPayment` and never a retry instruction. */
import type {BreezSdk,GetInfoResponse,Network,Payment} from '@breeztech/breez-sdk-spark';
import {operationWalletKey,updateOperation,type OperationRecord,type OperationState} from './operationJournal';

export type PaymentObservation=Readonly<{
 paymentId:string; recipientCommitment?:string; identityPubkey:string; network:Network; observedAt:number;
 outcome:'completed'|'returned'|'unresolved'|'notFound'; payment?:Payment;
}>;
export type ObservationSdk=BreezSdk&{
 observeWalletState:()=>Promise<GetInfoResponse>;
 observePayment:(request:{paymentId:string;recipientCommitment:string})=>Promise<PaymentObservation>;
};
/** Refuse old SDK binaries. Do not silently substitute effectful syncWallet. */
export function observationSdk(raw:BreezSdk):ObservationSdk{
 if(typeof Reflect.get(raw,'observeWalletState')!=='function'||typeof Reflect.get(raw,'observePayment')!=='function')
  throw new Error('This SDK does not support observation-only wallet status. Spending remains paused.');
 return raw as ObservationSdk;
}
export async function verifyObservationWithoutCommit(record:OperationRecord,observation:PaymentObservation,requestedAt:number):Promise<OperationState|null>{
 if(observation.paymentId!==record.paymentId||observation.network!==record.network||
    await operationWalletKey(observation.network,observation.identityPubkey)!==record.walletKey)
  throw new Error('Payment observation belongs to another wallet, network or operation');
 const observedAt=observation.observedAt*1000;
 if(!Number.isSafeInteger(observedAt)||observedAt<requestedAt-1000||observedAt>Date.now()+1000)
  throw new Error('Payment observation is not fresh');
 // Missing records and generic failure cannot establish funds returned.
 if(observation.outcome==='notFound'){
  if(observation.payment)throw new Error('Contradictory payment observation');
  return null;
 }
 const p=observation.payment,method=record.route==='bitcoin'?'withdraw':record.route;
 if(!p||p.id!==record.paymentId||p.paymentType!=='send'||p.method!==method||
    p.amount.toString()!==record.amountSats||p.fees<0n||p.fees>BigInt(record.feeLimitSats)||p.conversionDetails)
  throw new Error('Payment observation differs from the approved transaction');
 if(!record.recipientHash||observation.recipientCommitment!==record.recipientHash)
  throw new Error('Fresh payment evidence is not bound to the approved recipient');
 if(observation.outcome==='completed'&&p.status==='completed')return 'completed';
 // The SDK only returns this outcome after the route-specific returned-ownership
 // checks. Unsupported routes/withdrawals stay unresolved, even if called failed.
 if(observation.outcome==='returned'&&p.status==='failed'&&['spark','lightning'].includes(record.route))
  return 'returned';
 if(observation.outcome==='unresolved')return p.status==='pending'?'pending':'unknown';
 throw new Error('Payment observation does not contain a supported terminal proof');
}

/** Convenience for isolated tests; production gateway rechecks the session
 * between validation and the synchronous durable commit. */
export async function applyPaymentObservation(record:OperationRecord,observation:PaymentObservation,requestedAt:number):Promise<OperationRecord>{
 const state=await verifyObservationWithoutCommit(record,observation,requestedAt);
 return state===null?record:updateOperation(record,{state});
}
