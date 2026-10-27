import {describe,it,expect,vi} from 'vitest';
import type {ClaimDepositRequest,ClaimDepositResponse,FetchClaimDepositQuoteResponse} from '@breeztech/breez-sdk-spark';
import {prepareDepositClaim,verifyClaimReceipt,executeDepositClaim,type ClaimRecord} from './depositClaimAuthorization';
const txid='a'.repeat(64);
const request=():ClaimDepositRequest=>({txid,vout:1,maxFee:{onchain:{type:'fixed',amount:20}}});
const quote=():FetchClaimDepositQuoteResponse=>({amountSats:1000,confirmations:3,mature:{confirmationsRequired:3,creditAmountSats:990,feeSats:10,isEstimate:false}});
const intent=()=>prepareDepositClaim('mainnet',request(),quote(),1000);
const receipt=():ClaimDepositResponse=>({outcome:{type:'settled',payment:{id:'claim-id',paymentType:'receive',method:'deposit',status:'completed',amount:990n,fees:10n,timestamp:1,details:{type:'deposit',txId:txid,vout:1}}}});
function harness(){
 const records:ClaimRecord[]=[];
 return {records,assertLive:vi.fn(),assertNoPending:vi.fn(),approve:vi.fn(async()=>{}),persist:vi.fn(async(r:ClaimRecord)=>{records.push(r)}),execute:vi.fn(async()=>receipt()),now:()=>1001};
}
describe('bounded incoming deposit claim authorization',()=>{
 it('freezes outpoint, ceiling and minimum credit independently of input mutations',()=>{
  const r=request(),q=quote(),p=prepareDepositClaim('mainnet',r,q,1000);r.vout=2;q.amountSats=9000;
  expect(p).toMatchObject({vout:1,amountSats:1000,maxFeeSats:20,minimumCreditSats:980});expect(Object.isFrozen(p)).toBe(true);
 });
 it.each([undefined,{onchain:{type:'rate',satPerVbyte:2}},{onchain:{type:'fixed',amount:20},proportionalPpm:0}])('rejects missing, rate and mixed fee authority %#',fee=>{
  expect(()=>prepareDepositClaim('mainnet',{...request(),maxFee:fee} as ClaimDepositRequest,quote(),1000)).toThrow(/fixed/);
 });
 it.each([NaN,-1,1000,Number.MAX_SAFE_INTEGER])('rejects invalid/economically destructive ceilings %s',amount=>{
  expect(()=>prepareDepositClaim('mainnet',{...request(),maxFee:{onchain:{type:'fixed',amount}}},quote(),1000)).toThrow();
 });
 it.each([{confirmations:2},{mature:{...quote().mature,isEstimate:true}},{mature:{...quote().mature,creditAmountSats:999}},{mature:{...quote().mature,feeSats:21}}])('rejects immature, estimated and contradictory quotes %#',change=>{
  expect(()=>prepareDepositClaim('mainnet',request(),{...quote(),...change},1000)).toThrow();
 });
 it('persists before SDK invocation and checks its terminal receipt',async()=>{
  const h=harness();h.execute.mockImplementation(async()=>{expect(h.records[0].state).toBe('submitting');return receipt()});
  await executeDepositClaim(intent(),h);expect(h.records.map(r=>r.state)).toEqual(['submitting','settled']);
  expect(h.execute).toHaveBeenCalledWith(request());
 });
 it('cancellation consumes preparation but never calls SDK or writes',async()=>{
  const h=harness(),p=intent();h.approve.mockRejectedValue(Error('cancel'));
  await expect(executeDepositClaim(p,h)).rejects.toThrow('cancel');expect(h.execute).not.toHaveBeenCalled();expect(h.persist).not.toHaveBeenCalled();
  await expect(executeDepositClaim(p,h)).rejects.toThrow(/new claim/);
 });
 it('rejects forged/cloned intent',async()=>{await expect(executeDepositClaim({...intent()},harness())).rejects.toThrow(/new claim/)});
 it('storage failure prevents SDK invocation',async()=>{
  const h=harness();h.persist.mockRejectedValue(Error('quota'));await expect(executeDepositClaim(intent(),h)).rejects.toThrow('quota');expect(h.execute).not.toHaveBeenCalled();
 });
 it('expiry or lock during approval prevents execution',async()=>{
  const h=harness();let now=1001;h.now=()=>now;h.approve.mockImplementation(async()=>{now=62000});
  await expect(executeDepositClaim(intent(),h)).rejects.toThrow('expired');expect(h.execute).not.toHaveBeenCalled();
 });
 it.each(['timeout','submitted','deferred','wrong-receipt','lock-after-send','save-failed'])('retains uncertainty after %s',async mode=>{
  const h=harness();h.execute.mockImplementation(async()=>{
   if(mode==='timeout')throw Error('lost acknowledgement');
   if(mode==='submitted')return {outcome:{type:'submitted'}};
   if(mode==='deferred')return {outcome:{type:'deferred',reason:{type:'maxFeeExceeded'}}} as ClaimDepositResponse;
   if(mode==='lock-after-send')h.assertLive.mockImplementation(()=>{throw Error('locked')});
   const r=receipt();if(mode==='wrong-receipt'&&r.outcome.type==='settled')r.outcome.payment.amount=999n;
   return r;
  });
  if(mode==='save-failed')h.persist.mockImplementation(async r=>{if(r.state!=='submitting')throw Error('quota');h.records.push(r)});
  await expect(executeDepositClaim(intent(),h)).rejects.toThrow('reconciliation');
  expect(h.records[h.records.length-1]?.state).toBe(mode==='save-failed'?'submitting':'uncertain');
 });
 it.each(['outpoint','fee','type','status'])('rejects a mismatched %s in settlement',async kind=>{
  const r=receipt();if(r.outcome.type!=='settled')throw Error();const p=r.outcome.payment;
  if(kind==='outpoint')p.details={type:'deposit',txId:txid,vout:0};if(kind==='fee')p.fees=21n;
  if(kind==='type')p.paymentType='send';if(kind==='status')p.status='pending';
  expect(()=>verifyClaimReceipt(intent(),r)).toThrow();
 });
});
