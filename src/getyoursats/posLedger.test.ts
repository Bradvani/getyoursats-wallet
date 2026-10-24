import {beforeEach,describe,expect,it} from 'vitest';
import type {Payment} from '@breeztech/breez-sdk-spark';
import {matchingPosPayment,readPosOrders,reconcilePosOrders,savePosOrders,type PosOrder} from './posLedger';
import {validatePosInvoiceResponse} from './posInvoice';

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
