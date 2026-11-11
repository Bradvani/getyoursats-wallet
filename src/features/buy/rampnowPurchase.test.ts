import {beforeEach, describe, expect, it, vi} from 'vitest';
import type {RampnowBuyInput, RampnowPreparedCheckout, RampnowCheckoutStatus, createRampnowBrowserClient} from '../../services/rampnow';
import {canOpenPurchaseCheckout, canReviewPurchaseAgain, checkoutAmounts, createPurchaseController, purchaseReferences, purchaseStatusText, rampnowReturnIntent, rampnowPreviewAccess, RAMPNOW_PREVIEW_ORIGIN} from './rampnowPurchase';

const pub='02'+'a'.repeat(64), other='03'+'b'.repeat(64), id='12345678-1234-4234-9234-123456789abc';
const input: RampnowBuyInput={srcAmount:'1000',destination:'tb1qexample',network:'signet',user:{firstName:'Private',lastName:'Buyer',email:'private@example.invalid',phone:'+447700900123',dateOfBirth:'1990-01-01',gender:'unknown',country:'IN'}};
const prepared: RampnowPreparedCheckout={externalOrderUid:id,destination:input.destination,network:'signet',quoteHash:'ab'.repeat(32),expiresAt:Date.now()+120000,
  quote:{orderType:'buy',srcCurrency:'INR',srcChain:'fiat',dstCurrency:'BTC',dstChain:'bitcoin',srcAmount:'1000',dstAmount:'0.0001',paymentMode:'card',feeDetails:[]}};
const status: RampnowCheckoutStatus={externalOrderUid:id,phase:'bound',orderUid:'order1',checkoutUrl:null,providerStatus:'completed',dstFillAmount:'0.0001',needsReconciliation:true,walletReceiptVerified:false};
const unsubmitted: RampnowCheckoutStatus={...status,phase:'prepared',orderUid:null,checkoutUrl:null,providerStatus:null,dstFillAmount:null,reconciliation:'not_submitted'};
function fixture() {
  const client={prepare:vi.fn(async()=>prepared),submit:vi.fn(async()=>status),reconcile:vi.fn(async()=>status)} as unknown as ReturnType<typeof createRampnowBrowserClient>;
  const references=purchaseReferences(localStorage,pub);
  return {client,references,controller:createPurchaseController(client,references)};
}
beforeEach(()=>localStorage.clear());
describe('purchase recovery',()=>{
  it('isolates wallets and persists only minimal references before submission',async()=>{
    const f=fixture();await f.controller.prepare(input);
    expect(f.references.list()).toEqual([{id,createdAt:expect.any(Number)}]);
    expect(purchaseReferences(localStorage,other).list()).toEqual([]);
    const raw=JSON.stringify(localStorage);
    for(const secret of [input.user.email,input.destination,input.user.firstName,prepared.quoteHash]) expect(raw).not.toContain(secret);
    await f.controller.submit();expect(f.client.submit).toHaveBeenCalledOnce();
  });
  it('does not submit after a storage failure',async()=>{
    const f=fixture();const storage={getItem:()=>null,setItem:()=>{throw new Error('quota');}};
    const c=createPurchaseController(f.client,purchaseReferences(storage,pub));
    await expect(c.prepare(input)).rejects.toThrow('quota');await expect(c.submit()).rejects.toThrow();
    expect(f.client.submit).not.toHaveBeenCalled();
  });
  it('freezes reviewed input, consumes before dispatch and never retries an uncertain response',async()=>{
    const f=fixture(),copy=structuredClone(input);await f.controller.prepare(copy);copy.user.firstName='Changed';
    vi.mocked(f.client.submit).mockRejectedValue(new Error('timeout'));
    await expect(f.controller.submit()).rejects.toThrow('timeout');
    await expect(f.controller.submit()).rejects.toThrow();
    expect(f.client.submit).toHaveBeenCalledTimes(1);
    expect(vi.mocked(f.client.submit).mock.calls[0][0].input.user.firstName).toBe('Private');
    const resumed=createPurchaseController(f.client,f.references);
    await expect(resumed.submit()).rejects.toThrow();
    await resumed.reconcile(id);expect(f.client.reconcile).toHaveBeenCalledWith(id);
  });
  it('does not permit simultaneous submit or a session change to continue',async()=>{
    const f=fixture();await f.controller.prepare(input);
    let resolve!: (value:RampnowCheckoutStatus)=>void;
    vi.mocked(f.client.submit).mockImplementation(()=>new Promise(r=>{resolve=r;}));
    const pending=f.controller.submit();await expect(f.controller.submit()).rejects.toThrow();
    f.controller.dispose();resolve(status);await expect(pending).rejects.toThrow('Wallet session changed');
    expect(f.client.submit).toHaveBeenCalledTimes(1);
  });
  it('rejects an expired quote without dispatch',async()=>{
    const f=fixture();vi.mocked(f.client.prepare).mockResolvedValue({...prepared,expiresAt:1});
    await f.controller.prepare(input);await expect(f.controller.submit()).rejects.toThrow('expired');expect(f.client.submit).not.toHaveBeenCalled();
  });
  it('rejects malformed saved history rather than silently discarding it',()=>{
    localStorage.setItem('gys:rampnow:sandbox:signet:v1:'+pub,'[{"id":"garbage"}]');
    expect(()=>purchaseReferences(localStorage,pub).list()).toThrow();
  });
  it('reviews a fresh intent only after authenticated no-submission evidence and retains history',async()=>{
    const f=fixture();f.references.remember(id);
    vi.mocked(f.client.reconcile).mockResolvedValue(unsubmitted);
    const nextId='22345678-1234-4234-9234-123456789abc';
    vi.mocked(f.client.prepare).mockResolvedValue({...prepared,externalOrderUid:nextId});
    await f.controller.prepare(input);
    expect(f.client.reconcile).toHaveBeenCalledWith(id);
    expect(f.references.list().map(row=>row.id)).toEqual([nextId,id]);
    await f.controller.submit();
    expect(vi.mocked(f.client.submit).mock.calls[0][0].externalOrderUid).toBe(nextId);
  });
  it('does not prepare another quote for any submitted, uncertain or unresolved saved intent',async()=>{
    for(const previous of [status,{...unsubmitted,phase:'uncertain' as const},
      {...unsubmitted,reconciliation:'not_found' as const},{...unsubmitted,reconciliation:'ambiguous' as const},
      {...unsubmitted,reconciliation:'mismatch' as const},{...unsubmitted,externalOrderUid:'22345678-1234-4234-9234-123456789abc'}]) {
      localStorage.clear();const f=fixture();f.references.remember(id);vi.mocked(f.client.reconcile).mockResolvedValue(previous);
      await expect(f.controller.prepare(input)).rejects.toThrow('saved purchase may already have started');
      expect(f.client.prepare).not.toHaveBeenCalled();expect(f.client.submit).not.toHaveBeenCalled();
      expect(f.references.list().map(row=>row.id)).toEqual([id]);
    }
  });
  it('checks all saved references and stops if one is unresolved or lookup fails',async()=>{
    const f=fixture(),second='22345678-1234-4234-9234-123456789abc';
    f.references.remember(id);f.references.remember(second);
    vi.mocked(f.client.reconcile).mockResolvedValueOnce({...unsubmitted,externalOrderUid:second}).mockRejectedValueOnce(new Error('offline'));
    await expect(f.controller.prepare(input)).rejects.toThrow('offline');expect(f.client.prepare).not.toHaveBeenCalled();
    expect(f.references.list()).toHaveLength(2);
  });
  it('does not authorize a fresh quote after the wallet session changes during history lookup',async()=>{
    const f=fixture();f.references.remember(id);
    let resolve!: (value:RampnowCheckoutStatus)=>void;
    vi.mocked(f.client.reconcile).mockImplementation(()=>new Promise(r=>{resolve=r;}));
    const pending=f.controller.prepare(input);f.controller.dispose();resolve(unsubmitted);
    await expect(pending).rejects.toThrow('Wallet session changed');expect(f.client.prepare).not.toHaveBeenCalled();
  });
  it('keeps the submitted review independent of the returned UI object',async()=>{
    const f=fixture();vi.mocked(f.client.prepare).mockResolvedValue(structuredClone(prepared));
    const uiReview=await f.controller.prepare(input);uiReview.quoteHash='ef'.repeat(32);uiReview.expiresAt=1;
    await f.controller.submit();expect(vi.mocked(f.client.submit).mock.calls[0][0].quoteHash).toBe(prepared.quoteHash);
  });
});
describe('returns and provider completion',()=>{
  it('permits a new review only for an authenticated unsubmitted intent',()=>{
    expect(canReviewPurchaseAgain(unsubmitted)).toBe(true);
    for(const patch of [{reconciliation:undefined},{checkoutUrl:'https://app.sandbox.rampnow.io/checkout'},
      {providerStatus:'expired'},{dstFillAmount:'0'},{orderUid:'order1'}]) expect(canReviewPurchaseAgain({...unsubmitted,...patch})).toBe(false);
  });
  it('offers hosted handoff only for a verified awaiting-payment checkout',()=>{
    const waiting={...status,checkoutUrl:'https://app.sandbox.rampnow.io/checkout',providerStatus:'created'};
    expect(canOpenPurchaseCheckout(waiting)).toBe(true);expect(canOpenPurchaseCheckout({...waiting,providerStatus:null})).toBe(true);
    expect(canOpenPurchaseCheckout({...waiting,reconciliation:'matched'})).toBe(true);
    for(const reconciliation of ['not_found','mismatch','ambiguous','not_submitted'] as const) expect(canOpenPurchaseCheckout({...waiting,reconciliation})).toBe(false);
    for(const providerStatus of ['processing','completed','payment_failed','expired','failed','blocked','unknown','canceled','partially_failed']) expect(canOpenPurchaseCheckout({...waiting,providerStatus})).toBe(false);
  });
  it('includes exclusive fees exactly and keeps currencies separate',()=>{
    expect(checkoutAmounts({...prepared.quote,srcAmount:'1000.10',feeDetails:[
      {type:'a',fee:'10',currency:'INR',isInclusive:true},
      {type:'b',fee:'0.20',currency:'INR',isInclusive:false},
      {type:'c',fee:'0.000000000000000001',currency:'USDT',isInclusive:false},
    ]})).toEqual([{currency:'INR',amount:'1000.3'},{currency:'USDT',amount:'0.000000000000000001'}]);
  });
  it('accepts only the exact preview and explicit signet intent return',()=>{
    const valid=RAMPNOW_PREVIEW_ORIGIN+'/rampnow/return?intent='+id+'&network=signet';
    expect(rampnowReturnIntent(new URL(valid))).toBe(id);
    for(const url of [valid+'&network=signet',valid+'&paid=true',valid+'#paid',valid.replace('signet','mainnet'),valid.replace(RAMPNOW_PREVIEW_ORIGIN,'https://wallet.getyoursats.com'),valid.replace(id,'other')]) expect(rampnowReturnIntent(new URL(url))).toBeNull();
    expect(rampnowPreviewAccess(RAMPNOW_PREVIEW_ORIGIN,'mainnet')).toBe(false);
  });
  it('never represents provider completion as wallet receipt',()=>{
    expect(purchaseStatusText(status)).toContain('still unverified');
    expect(purchaseStatusText({...status,reconciliation:'not_found'})).toContain('before making another payment');
    expect(purchaseStatusText({...status,reconciliation:'mismatch'})).toContain('support review');
    expect(purchaseStatusText({...status,providerStatus:'expired'})).toContain('already paid');
  });
});
