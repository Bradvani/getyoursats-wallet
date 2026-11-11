/**
 * Disposable regtest acceptance of ordinary (non-HODL) BOLT11 invoices.
 * This is not payment, claim or settlement authorization. The caller is
 * responsible for excluding this capability from real-funds deployments.
 */
import type {BreezSdk,Network,ReceivePaymentResponse} from '@breeztech/breez-sdk-spark';

export const REGTEST_STANDARD_INVOICE=Symbol('GetYourSats disposable standard Lightning invoice');
export type StandardInvoiceIntent=Readonly<{amountSats:number;description:string;expirySecs?:number}>;
export interface StandardRegtestInvoiceReceipt {
  readonly identityPubkey:string;
  readonly paymentRequest:string;
  readonly paymentHash:string;
  readonly amountSats:number;
  readonly expiresAt:number;
  readonly quotedFeeSats:string;
}
export interface StandardRegtestInvoiceIssuer {
  issue:(intent:StandardInvoiceIntent)=>Promise<StandardRegtestInvoiceReceipt>;
}
const unsafe=(reason:string)=>new Error('Regtest standard invoice refused: '+reason);
const isKey=(s:string)=>/^(02|03)[a-f0-9]{64}$/i.test(s);
const isHash=(s:string)=>/^[a-f0-9]{64}$/i.test(s);
function copyIntent(input:StandardInvoiceIntent):Required<StandardInvoiceIntent>{
  if(!input||typeof input!=='object'||Array.isArray(input))throw unsafe('invalid request');
  const keys=Object.keys(input);
  if(keys.some(k=>!['amountSats','description','expirySecs'].includes(k))||
    !Object.prototype.hasOwnProperty.call(input,'amountSats')||
    !Object.prototype.hasOwnProperty.call(input,'description'))
    throw unsafe('custom hashes, receiver overrides or unknown fields are prohibited');
  const amountSats=input.amountSats,description=input.description,expirySecs=input.expirySecs??600;
  if(!Number.isSafeInteger(amountSats)||amountSats<100||amountSats>10_000)
    throw unsafe('amount must be 100 to 10000 valueless regtest sats');
  if(typeof description!=='string'||description.length>100||!description.length||/[^\x20-\x7e]/.test(description))
    throw unsafe('description must be printable ASCII');
  if(!Number.isSafeInteger(expirySecs)||expirySecs<60||expirySecs>3600)
    throw unsafe('expiry must be between 60 and 3600 seconds');
  return Object.freeze({amountSats,description,expirySecs});
}
/** The facade's epoch/lifetime checks must run after EVERY remote await. */
export function createStandardRegtestInvoiceIssuer(options:{
  network:Network;
  raw:()=>Pick<BreezSdk,'getInfo'|'receivePayment'|'parse'>;
  assertCurrent:()=>void;
}):StandardRegtestInvoiceIssuer{
  const {network,raw,assertCurrent}=options;
  return Object.freeze({issue:async(request:StandardInvoiceIntent)=>{
    assertCurrent();
    if(network!=='regtest')throw unsafe('mainnet and signet are not supported');
    const intent=copyIntent(request);
    assertCurrent();
    const sdk=raw();
    const before=await sdk.getInfo({ensureSynced:false});
    assertCurrent();
    if(!before||!isKey(before.identityPubkey))throw unsafe('missing canonical signer identity');
    const createdAt=Math.floor(Date.now()/1000);
    const response:ReceivePaymentResponse=await sdk.receivePayment({paymentMethod:{
      type:'bolt11Invoice',description:intent.description,amountSats:intent.amountSats,
      expirySecs:intent.expirySecs,
      // Never supply paymentHash: that creates a HODL invoice requiring preimage release.
      // Never supply receiverIdentityPublicKey: this test must issue for its own signer.
    }});
    assertCurrent();
    if(!response||typeof response.paymentRequest!=='string'||
      !/^lnbcrt[0-9a-z]{20,}$/i.test(response.paymentRequest)||
      typeof response.fee!=='bigint'||response.fee<0n||response.fee>BigInt(intent.amountSats))
      throw unsafe('SDK returned malformed regtest invoice or fee');
    const parsed=await sdk.parse(response.paymentRequest);
    assertCurrent();
    const after=await sdk.getInfo({ensureSynced:false});
    assertCurrent();
    if(!after||after.identityPubkey!==before.identityPubkey)throw unsafe('signer identity changed');
    if(parsed.type!=='bolt11Invoice'||parsed.network!=='regtest'||
      parsed.invoice.bolt11.toLowerCase()!==response.paymentRequest.toLowerCase()||
      parsed.amountMsat!==intent.amountSats*1000||
      !isHash(parsed.paymentHash)||
      !Number.isSafeInteger(parsed.timestamp)||!Number.isSafeInteger(parsed.expiry)||
      parsed.timestamp+parsed.expiry<=createdAt-30||
      parsed.timestamp>Math.floor(Date.now()/1000)+30||
      parsed.expiry!==intent.expirySecs)
      throw unsafe('decoded invoice differs from exact approved regtest intent');
    return Object.freeze({identityPubkey:before.identityPubkey,paymentRequest:response.paymentRequest,
      paymentHash:parsed.paymentHash,amountSats:intent.amountSats,
      expiresAt:parsed.timestamp+parsed.expiry,quotedFeeSats:response.fee.toString()});
  }});
}

/** Avoid treating an SDK proxy synthesizing methods as this capability. */
export function getRegtestStandardInvoiceIssuer(wallet:BreezSdk):StandardRegtestInvoiceIssuer|null{
 const obj:unknown=Reflect.get(wallet,REGTEST_STANDARD_INVOICE);
 return obj&&typeof obj==='object'&&typeof Reflect.get(obj,'issue')==='function'?obj as StandardRegtestInvoiceIssuer:null;
}
