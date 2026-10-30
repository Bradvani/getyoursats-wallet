import type {BreezSdk} from '@breeztech/breez-sdk-spark';
import {pushOperationPayload,pushAuthorizationMessage} from '../../shared/pushAuthorization.mjs';

export const PUSH_ORIGIN='https://wallet.getyoursats.com';
export type PushAction='subscribe'|'activate'|'status'|'unsubscribe';
export type PushStatus={enabled:boolean;webhookRegistered:boolean};

async function request<T>(body:Record<string,unknown>):Promise<T>{
  const response=await fetch('/api/notifications/device',{
    method:'POST',headers:{'Content-Type':'application/json'},
    body:JSON.stringify(body),credentials:'omit',cache:'no-store',redirect:'error',
    signal:AbortSignal.timeout(15_000),
  });
  const data=await response.json() as T&{error?:string};
  if(!response.ok)throw new Error(data.error||'Could not update notification settings.');
  return data;
}

export async function signedPushOperation<T>(
  sdk:Pick<BreezSdk,'signMessage'>,pub:string,action:PushAction,
  extra:Record<string,unknown>,checkCurrent:()=>void=()=>{},
):Promise<T>{
  checkCurrent();
  const bytes=new TextEncoder().encode(pushOperationPayload(action,extra));
  const hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),
    byte=>byte.toString(16).padStart(2,'0')).join('');
  const challenge=await request<{challengeId:string;message:string}>({
    ...extra,action:'challenge',purpose:action,walletPubkey:pub,
  });
  checkCurrent();
  const wanted=pushAuthorizationMessage(action,pub,challenge.challengeId,hash);
  if(challenge.message!==wanted||!/^[0-9a-f]{32}$/.test(challenge.challengeId))
    throw new Error('Notification authorization did not match this device.');
  const signed=await sdk.signMessage({message:wanted,compact:true});
  checkCurrent();
  if(signed.pubkey?.toLowerCase()!==pub)
    throw new Error('Wallet identity changed. Please reopen Settings.');
  return request<T>({...extra,action,walletPubkey:pub,challengeId:challenge.challengeId,
    signature:signed.signature});
}

export function validateInvoiceWebhook(pub:string,enrolled:{webhookUrl:string;webhookSecret:string}):void{
  if(enrolled.webhookUrl!==PUSH_ORIGIN+'/api/notifications/spark?wallet='+pub ||
    typeof enrolled.webhookSecret!=='string'||!/^[a-f0-9]{64}$/.test(enrolled.webhookSecret))
    throw new Error('Lightning notification registration was invalid.');
}
