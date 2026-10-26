/** Claim policy prototype. Not exposed by the browser gateway until restart
 * reconciliation and rollback/removal integration have acceptance evidence. */
import type {ClaimDepositRequest,ClaimDepositResponse,FetchClaimDepositQuoteResponse,Network} from '@breeztech/breez-sdk-spark';

export interface ClaimIntent {
 readonly network:Network; readonly txid:string; readonly vout:number;
 readonly amountSats:number; readonly maxFeeSats:number; readonly minimumCreditSats:number;
 readonly expiresAt:number;
}
const prepared=new WeakSet<object>();
const consumed=new WeakSet<object>();
const MAX_SATS=2_100_000_000_000_000;
function sats(value:number):number{
 if(!Number.isSafeInteger(value)||value<0||value>MAX_SATS)throw Error('Invalid deposit amount or fee');
 return value;
}
export function prepareDepositClaim(network:Network,request:ClaimDepositRequest,quote:FetchClaimDepositQuoteResponse,now=Date.now()):ClaimIntent{
 if(!['mainnet','regtest','signet'].includes(network)||!/^[0-9a-f]{64}$/.test(request.txid)||
    !Number.isSafeInteger(request.vout)||request.vout<0||request.vout>0xffffffff)
  throw Error('Invalid deposit network or outpoint');
 if(!request.maxFee||request.maxFee.onchain.type!=='fixed'||request.maxFee.proportionalPpm!==undefined)
  throw Error('An explicit fixed claim fee ceiling is required');
 const amount=sats(quote.amountSats),fee=sats(request.maxFee.onchain.amount);
 if(amount===0||fee>=amount)throw Error('Claim fee consumes the deposit');
 // Only matured claims in this first policy. Deferred instructions and early
 // provider credit require a separate durable mandate, not a one-shot approval.
 if(!Number.isSafeInteger(quote.confirmations)||quote.confirmations<0||
    !Number.isSafeInteger(quote.mature.confirmationsRequired)||quote.mature.confirmationsRequired<0||
    quote.confirmations<quote.mature.confirmationsRequired||quote.mature.isEstimate!==false)
  throw Error('An exact mature-deposit quote is required');
 if(sats(quote.mature.feeSats)>fee||sats(quote.mature.creditAmountSats)!==amount-quote.mature.feeSats)
  throw Error('Deposit quote exceeds the ceiling or has inconsistent credit');
 if(!Number.isSafeInteger(now)||now<0||!Number.isSafeInteger(now+60_000))throw Error('Invalid claim time');
 const intent=Object.freeze({network,txid:request.txid,vout:request.vout,amountSats:amount,maxFeeSats:fee,minimumCreditSats:amount-fee,expiresAt:now+60_000});
 prepared.add(intent);return intent;
}
export function claimRequest(intent:ClaimIntent):ClaimDepositRequest{
 return {txid:intent.txid,vout:intent.vout,maxFee:{onchain:{type:'fixed',amount:intent.maxFeeSats}}};
}
export function verifyClaimReceipt(intent:ClaimIntent,response:ClaimDepositResponse):string{
 if(response.outcome.type!=='settled')throw Error('Claim has no terminal settlement receipt');
 const p=response.outcome.payment,d=p.details;
 if(!p.id||p.paymentType!=='receive'||p.method!=='deposit'||p.status!=='completed'||p.conversionDetails||
    d?.type!=='deposit'||d.txId!==intent.txid||d.vout!==intent.vout||
    p.fees<0n||p.fees>BigInt(intent.maxFeeSats)||p.amount<BigInt(intent.minimumCreditSats)||
    p.amount+p.fees!==BigInt(intent.amountSats))throw Error('Claim receipt differs from authorized deposit');
 return p.id;
}
export type ClaimRecord=Readonly<{intent:ClaimIntent;state:'submitting'|'uncertain'|'settled';paymentId?:string}>;
/** Dependencies must be owned by the operation gateway. Persistence MUST commit
 * before execute. Any post-invocation anomaly retains uncertainty, including a
 * deferred result: the SDK may already have persisted a standing fee mandate. */
export async function executeDepositClaim(intent:ClaimIntent,deps:{
 assertLive:()=>void;assertNoPending:()=>void;
 approve:(intent:ClaimIntent)=>Promise<void>;
 persist:(record:ClaimRecord)=>Promise<void>;
 execute:(request:ClaimDepositRequest)=>Promise<ClaimDepositResponse>;
 now?:()=>number;
}):Promise<ClaimDepositResponse>{
 if(!prepared.has(intent)||consumed.has(intent))throw Error('Prepare a new claim before authorizing');
 consumed.add(intent);
 const now=deps.now??Date.now;
 const live=()=>{deps.assertLive();if(now()>=intent.expiresAt)throw Error('Claim approval expired');};
 live();deps.assertNoPending();await deps.approve(intent);live();deps.assertNoPending();
 await deps.persist({intent,state:'submitting'});
 try{
  live();
  const response=await deps.execute(claimRequest(intent));
  const paymentId=verifyClaimReceipt(intent,response);
  live();await deps.persist({intent,state:'settled',paymentId});return response;
 }catch{
  // If this save fails, the previously committed submitting record must remain.
  try{await deps.persist({intent,state:'uncertain'});}catch{/* never erase intent */}
  throw new Error('Claim outcome requires reconciliation. Do not retry this deposit.');
 }
}
