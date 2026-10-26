import {beforeEach,it,expect,vi} from 'vitest';
import {saveDepositClaim,readDepositClaims,CLAIM_JOURNAL_PREFIX} from './depositClaimJournal';
import {assertNoUnresolvedRecovery} from './signedRecoveryJournal';
import type {ClaimRecord} from './depositClaimAuthorization';
const wallet='b'.repeat(64);
const record=():ClaimRecord=>({state:'submitting',intent:{network:'mainnet',txid:'a'.repeat(64),vout:0,amountSats:1000,maxFeeSats:10,minimumCreditSats:990,expiresAt:61000}});
beforeEach(()=>{localStorage.clear();vi.restoreAllMocks()});
it('preserves submitting intent across reload and blocks creating another attempt',()=>{
 const r=saveDepositClaim(wallet,record(),null);expect(readDepositClaims()).toEqual([r]);
 expect(()=>saveDepositClaim(wallet,record(),null)).toThrow();
 expect(()=>saveDepositClaim(wallet,record(),r)).toThrow();
});
it('rejects stale writers, altered bounds and terminal state reversal',()=>{
 const r=saveDepositClaim(wallet,record(),null),u=saveDepositClaim(wallet,{...record(),state:'uncertain'},r);
 expect(()=>saveDepositClaim(wallet,{...record(),state:'uncertain'},r)).toThrow();
 expect(()=>saveDepositClaim(wallet,{...record(),state:'uncertain',intent:{...r.intent,maxFeeSats:11,minimumCreditSats:989}},u)).toThrow();
 const done=saveDepositClaim(wallet,{...record(),state:'settled',paymentId:'receipt'},u);
 expect(()=>saveDepositClaim(wallet,{...record(),state:'uncertain'},done)).toThrow();
});
it('retains the prior guard if storage fails after submission',()=>{
 const r=saveDepositClaim(wallet,record(),null);const failing=new Proxy(localStorage,{get:(target,key)=>key==='setItem'?()=>{throw Error('quota')}:typeof Reflect.get(target,key)==='function'?Reflect.get(target,key).bind(target):Reflect.get(target,key)});
 expect(()=>saveDepositClaim(wallet,{...record(),state:'settled',paymentId:'receipt'},r,failing)).toThrow('quota');
 expect(readDepositClaims()).toEqual([r]);
});
it('fails closed on corrupted and future-version records',()=>{
 localStorage.setItem(CLAIM_JOURNAL_PREFIX+'bad','null');expect(()=>readDepositClaims()).toThrow();
 localStorage.clear();localStorage.setItem('gys:deposit-claim:v2:future','{}');expect(()=>readDepositClaims()).toThrow();
});
it.each(['walletKey','txid'] as const)('rejects array-valued deposit %s before filtering wallet records',field=>{
 const r=saveDepositClaim(wallet,record(),null);
 const malformed=field==='walletKey'?{...r,walletKey:[r.walletKey]}:{...r,intent:{...r.intent,txid:[r.intent.txid]}};
 const storageKey=CLAIM_JOURNAL_PREFIX+wallet+':'+r.intent.txid+':'+r.intent.vout,bytes=JSON.stringify(malformed);
 localStorage.setItem(storageKey,bytes);
 expect(()=>readDepositClaims()).toThrow(/incompatible/);
 expect(()=>assertNoUnresolvedRecovery(wallet)).toThrow(/incompatible/);
 expect(localStorage.getItem(storageKey)).toBe(bytes);
});
it('strips extra fields and freezes read-back intent',()=>{
 const r=saveDepositClaim(wallet,{...record(),secret:'must not persist'} as ClaimRecord,null);
 expect(JSON.stringify(localStorage)).not.toContain('secret');expect(Object.isFrozen(r.intent)).toBe(true);
});

it('pending claims block wallet operations and origin removal',()=>{
 saveDepositClaim(wallet,record(),null);expect(()=>assertNoUnresolvedRecovery(wallet)).toThrow(/claim/);expect(()=>assertNoUnresolvedRecovery()).toThrow(/claim/);expect(()=>assertNoUnresolvedRecovery('c'.repeat(64))).not.toThrow();
});
