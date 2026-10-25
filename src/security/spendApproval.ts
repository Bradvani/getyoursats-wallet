/**
 * SDK PaymentObserver gate. A rejected promise aborts the SDK's send pathway.
 * Defense-in-depth only: a compromised page could still misuse the connected
 * in-memory signer. Production signer isolation requires ExternalSparkSigner.
 */
import type { PaymentObserver, ProvisionalPayment, Seed } from '@breeztech/breez-sdk-spark';
import { Capacitor } from '@capacitor/core';

export type SpendingRequest = Readonly<{ id: number; payments: ProvisionalPayment[] }>;
type Pending = { request:SpendingRequest; resolve:()=>void; reject:(e:Error)=>void; timeout:ReturnType<typeof setTimeout> };
let pending: Pending|null = null;
let version = 0;
const subscribers = new Set<()=>void>();
let expectedSeedFingerprint: string|null = null;
const emit = () => subscribers.forEach(fn=>fn());
export const subscribeSpendingApproval = (listener:()=>void) => {
  subscribers.add(listener); return () => { subscribers.delete(listener); };
};
export const getSpendingRequest = (): SpendingRequest|null => pending?.request??null;
export const getSpendingRequestServerSnapshot = ():SpendingRequest|null => null;

function fingerprintInput(seed:Seed): string {
  if(seed.type==='mnemonic')return 'mnemonic:'+seed.mnemonic+':'+(seed.passphrase??'');
  return seed.type==='entropy'?'entropy:'+Array.from(seed).join(','):'unknown';
}
async function fingerprint(seed:Seed):Promise<string> {
  const encoded = new TextEncoder().encode(fingerprintInput(seed));
  const hash = new Uint8Array(await crypto.subtle.digest('SHA-256',encoded));
  return Array.from(hash,x=>x.toString(16).padStart(2,'0')).join('');
}
/** In-memory only. No sensitive key or digest is persisted. */
export async function rememberSignerIdentity(seed:Seed):Promise<void> {
  expectedSeedFingerprint=await fingerprint(seed);
}
export function clearSignerIdentity():void {
  expectedSeedFingerprint=null;
  cancelSpendingApproval('Wallet session ended');
}
export async function matchesSignerIdentity(seed:Seed):Promise<boolean> {
  return expectedSeedFingerprint!==null && await fingerprint(seed)===expectedSeedFingerprint;
}
export function finishSpendingApproval(id:number, approved:boolean, reason?:string):void {
  const item=pending;
  if(!item||item.request.id!==id)return;
  pending=null;clearTimeout(item.timeout);emit();
  if(approved)item.resolve();
  else item.reject(new Error(reason??'Payment authorization cancelled'));
}
export function cancelSpendingApproval(reason='Payment authorization cancelled'):void {
  if(pending)finishSpendingApproval(pending.request.id,false,reason);
}
export async function requestSpendingApproval(payments:ProvisionalPayment[]):Promise<void> {
  if(pending)throw new Error('Another transaction is awaiting approval');
  if(!Array.isArray(payments)||payments.length===0)throw new Error('Transaction approval details missing');
  if(document.visibilityState==='hidden')throw new Error('Wallet is not in the foreground');
  // Native auth prompt and passkey ceremony are triggered by the explicit
  // button in SpendingApprovalDialog rather than by an SDK callback.
  const id=++version;
  return new Promise<void>((resolve,reject)=>{
    const timeout=setTimeout(()=>finishSpendingApproval(id,false,'Approval timed out'),90_000);
    pending={request:{id,payments},resolve,reject,timeout};emit();
  });
}
export function createPaymentApprovalObserver():PaymentObserver {
  return {
    beforeSend: async (payments) => {
      if(!Capacitor.isNativePlatform() && !expectedSeedFingerprint)
        throw new Error('Wallet authorization is unavailable');
      await requestSpendingApproval(payments);
    },
    afterSend: async () => {},
  };
}
if(typeof document!=='undefined'){
  document.addEventListener('visibilitychange',()=>{
    if(document.visibilityState==='hidden')cancelSpendingApproval('Wallet backgrounded during approval');
  });
}
