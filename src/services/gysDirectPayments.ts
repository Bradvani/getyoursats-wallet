import type {InputType,PrepareSendPaymentResponse} from '@breeztech/breez-sdk-spark';

const ORIGIN='https://getyoursats.com';
const ADDRESS=/^([a-z][a-z0-9]{2,23})@getyoursats\.com$/;
export const DIRECT_UNAVAILABLE='Recipient unavailable. Review the payment again.';

export interface GysDirectRecipient {
  lightningAddress:string;
  identityPublicKey:string;
  sparkAddress:string;
  bindingId:string;
  expiresAt:number;
  minSats:number;
  maxSats:number;
}

/** Require the native endpoint as well as the identifier. Foreign LNURL metadata is untrusted. */
export function gysRecipient(input:InputType):{address:string;minSats:number;maxSats:number}|null{
  const details=input.type==='lightningAddress'?input.payRequest:input.type==='lnurlPay'?input:null;
  if(!details||details.domain!=='getyoursats.com')return null;
  try{
    const url=new URL(details.url);
    if(!['https:','lnurlp:'].includes(url.protocol)||url.host!=='getyoursats.com'||
        url.username||url.password||url.search||url.hash)return null;
    const match=url.pathname.match(/^\/(?:\.well-known\/)?lnurlp\/([a-z][a-z0-9]{2,23})$/);
    if(!match)return null;
    const address=match[1]+'@getyoursats.com';
    if(details.callback!==`${ORIGIN}/lnurlp/${match[1]}/invoice`||
        (input.type==='lightningAddress'&&input.address!==address)||
        (details.address!==undefined&&details.address!==address))return null;
    const metadata:unknown=JSON.parse(details.metadataStr);
    if(!Array.isArray(metadata)||!metadata.some(entry=>Array.isArray(entry)&&
        entry[0]==='text/identifier'&&entry[1]===address))return null;
    if(!Number.isSafeInteger(details.minSendable)||!Number.isSafeInteger(details.maxSendable)||
        details.minSendable<=0||details.maxSendable<details.minSendable)return null;
    return {address,minSats:Math.ceil(details.minSendable/1000),maxSats:Math.floor(details.maxSendable/1000)};
  }catch{return null;}
}

export async function resolveGysRecipient(candidate:{address:string;minSats:number;maxSats:number},
  parse:(input:string)=>Promise<InputType>,fetchImpl:typeof fetch=globalThis.fetch):Promise<GysDirectRecipient|null>{
  const name=candidate.address.match(ADDRESS)?.[1];
  if(!name)return null;
  try{
    const response=await fetchImpl(`${ORIGIN}/.well-known/gys/${name}`,{
      method:'GET',credentials:'omit',redirect:'error',cache:'no-store',signal:AbortSignal.timeout(5000)
    });
    if(!response.ok)return null;
    const value=await response.json();
    if(value?.available!==true||value.lightningAddress!==candidate.address||
        !/^(02|03)[0-9a-f]{64}$/.test(value.identityPublicKey)||
        !/^[0-9a-f]{64}$/.test(value.bindingId)||typeof value.sparkAddress!=='string'||
        value.sparkAddress.length>128||!Number.isSafeInteger(value.expiresAt)||
        value.expiresAt<=Date.now()||value.expiresAt>Date.now()+120_000)return null;
    const parsed=await parse(value.sparkAddress);
    if(parsed.type!=='sparkAddress'||parsed.network!=='bitcoin'||parsed.address!==value.sparkAddress||
        parsed.identityPublicKey.toLowerCase()!==value.identityPublicKey)return null;
    return {lightningAddress:value.lightningAddress,identityPublicKey:value.identityPublicKey,
      sparkAddress:value.sparkAddress,bindingId:value.bindingId,expiresAt:value.expiresAt,
      minSats:candidate.minSats,maxSats:candidate.maxSats};
  }catch{return null;}
}

export async function revalidateGysRecipient(recipient:GysDirectRecipient,parse:(input:string)=>Promise<InputType>):Promise<void>{
  const current=await resolveGysRecipient({address:recipient.lightningAddress,minSats:recipient.minSats,maxSats:recipient.maxSats},parse);
  if(!current||current.bindingId!==recipient.bindingId||current.sparkAddress!==recipient.sparkAddress||
      current.identityPublicKey!==recipient.identityPublicKey)throw new Error(DIRECT_UNAVAILABLE);
}

export function validateGysQuote(recipient:GysDirectRecipient,response:PrepareSendPaymentResponse):void{
  const method=response.paymentMethod;
  if(method.type!=='sparkAddress'||method.address!==recipient.sparkAddress||method.tokenIdentifier||
      method.fee!==0n||response.tokenIdentifier||response.conversionEstimate||
      response.amount<BigInt(recipient.minSats)||response.amount>BigInt(recipient.maxSats))throw new Error(DIRECT_UNAVAILABLE);
}
