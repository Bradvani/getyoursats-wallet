import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import type {InputType,Payment} from '@breeztech/breez-sdk-spark';
import {matchingPosPayment,readPosOrders,reconcilePosOrders,savePosOrders,type PosOrder} from './posLedger';
import {validatePosInvoiceResponse,verifyPosInvoiceIntent} from './posInvoice';

const identityA = 'a'.repeat(66);
const identityB = 'b'.repeat(66);
const invoice='lnbc10n1' + 'q'.repeat(32);
const order:PosOrder={id:'order-a',invoice,amountSats:1000,unit:'INR',description:'Tea',createdAt:1720000000000,feeSats:1};
const payment=(patch:Record<string,unknown>={}):Payment=>({
  id:'settled-1',paymentType:'receive',status:'completed',method:'lightning',
  amount:1000n,fees:0n,timestamp:1720000100,
  details:{type:'lightning',invoice:invoice.toUpperCase()},
  ...patch
}) as unknown as Payment;

beforeEach(()=>localStorage.clear());
afterEach(()=>vi.unstubAllGlobals());

describe('POS invoice safety and local reconciliation',()=>{
  it('validates response before the QR mounts',()=>{
    expect(validatePosInvoiceResponse({paymentRequest:invoice,fee:1n})).toEqual({invoice,feeSats:1});
    expect(()=>validatePosInvoiceResponse({paymentRequest:'not-an-invoice',fee:0})).toThrow('invalid Lightning invoice');
    expect(()=>validatePosInvoiceResponse({paymentRequest:invoice,fee:NaN})).toThrow('invalid receiver fee');
  });
  it('isolates device orders by wallet identity and never persists a paid flag',()=>{
    expect(savePosOrders(identityA,[order])).toBe(true);
    expect(readPosOrders(identityA)).toEqual([order]);
    expect(readPosOrders(identityB)).toEqual([]);
    expect(localStorage.getItem('gys:merchant:orders:v1:'+identityA)).not.toContain('"paid"');
    expect(savePosOrders('invalid',[order])).toBe(false);
  });
  it('accepts only completed incoming exact-invoice matches',()=>{
    expect(matchingPosPayment(payment(),order)).toBe(true);
    for(const p of [
      payment({status:'pending'}),payment({paymentType:'send'}),payment({amount:999n}),
      payment({details:{type:'lightning',invoice:undefined}}),
      payment({details:{type:'spark'}})
    ])expect(matchingPosPayment(p,order)).toBe(false);
  });
  it('reconciles after restart without recording duplicate paid orders',()=>{
    savePosOrders(identityA,[order]);
    const result=reconcilePosOrders(readPosOrders(identityA),[payment(),payment()]);
    expect(result.size).toBe(1);
    expect(result.get(order.id)?.id).toBe('settled-1');
  });
  it('discards corrupt, unexpected or malicious storage data',()=>{
    localStorage.setItem('gys:merchant:orders:v1:'+identityA,'not-json');
    expect(readPosOrders(identityA)).toEqual([]);
    localStorage.setItem('gys:merchant:orders:v1:'+identityA,JSON.stringify([{...order,amountSats:-1},order]));
    expect(readPosOrders(identityA)).toEqual([order]);
  });
});


describe('merchant invoice and durable order closure',()=>{
 it('rejects a payable invoice with changed amount, network, expiry or payment hash',()=>{
  const base={type:'bolt11Invoice',invoice:{bolt11:invoice,source:{type:'bolt11'}},
   network:'bitcoin',amountMsat:1000000,timestamp:Math.floor(Date.now()/1000),expiry:900,
   paymentHash:'a'.repeat(64),payeePubkey:'02'+'11'.repeat(32),
   minFinalCltvExpiryDelta:18,paymentSecret:'b'.repeat(64),routingHints:[]} as unknown as InputType;
  const expected={invoice,amountSats:1000,network:'mainnet' as const};
  expect(verifyPosInvoiceIntent(base,expected)).toBeGreaterThan(Date.now());
  expect(()=>verifyPosInvoiceIntent({...base,amountMsat:999000} as InputType,expected)).toThrow(/does not match/);
  expect(()=>verifyPosInvoiceIntent({...base,network:'regtest'} as InputType,expected)).toThrow(/does not match/);
  expect(()=>verifyPosInvoiceIntent({...base,expiry:1} as InputType,expected)).toThrow(/does not match/);
  expect(()=>verifyPosInvoiceIntent({...base,paymentHash:'invalid'} as InputType,expected)).toThrow(/does not match/);
  expect(()=>verifyPosInvoiceIntent({...base,invoice:{bolt11:'lnbc1notreal',source:{type:'bolt11'}}} as InputType,expected)).toThrow(/does not match/);
  expect(()=>verifyPosInvoiceIntent(base,{...expected,amountSats:1001})).toThrow(/does not match/);
 });
 it('does not silently omit invalid or duplicate orders',()=>{
  expect(savePosOrders(identityA,[order])).toBe(true);
  const previous=localStorage.getItem('gys:merchant:orders:v1:'+identityA);
  expect(savePosOrders(identityA,[order,{...order,amountSats:-1}])).toBe(false);
  expect(savePosOrders(identityA,[order,{...order,id:'other',invoice:invoice.toUpperCase()}])).toBe(false);
  expect(savePosOrders(identityA,[order,{...order,id:order.id,invoice:'lnbc1a'+'r'.repeat(35)}])).toBe(false);
  expect(localStorage.getItem('gys:merchant:orders:v1:'+identityA)).toBe(previous);
 });
 it('rejects damaged historical journal and preserves it for recovery',()=>{
  const key='gys:merchant:orders:v1:'+identityA;
  localStorage.setItem(key,'not-json');
  expect(savePosOrders(identityA,[order])).toBe(false);
  expect(localStorage.getItem(key)).toBe('not-json');
 });
 it('detects silently ignored storage writes',()=>{
  const actual=localStorage;
  vi.stubGlobal('localStorage',new Proxy(actual,{get(target,k){
   if(k==='setItem')return ()=>{};
   const value=Reflect.get(target,k);return typeof value==='function'?value.bind(target):value;
  }}));
  expect(savePosOrders(identityA,[order])).toBe(false);
 });
});
