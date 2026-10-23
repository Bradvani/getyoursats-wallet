import {beforeEach,describe,expect,it} from 'vitest';
import type {Payment} from '@breeztech/breez-sdk-spark';
import {matchingPosPayment,readPosOrders,reconcilePosOrders,savePosOrders,type PosOrder} from './posLedger';

const identityA = 'a'.repeat(66);
const identityB = 'b'.repeat(66);
const order:PosOrder={
  id:'order-a',invoice:'lnbc10n1validinvoice',amountSats:1000,
  unit:'sats',description:'Tea',createdAt:1720000000000,feeSats:1,
};
const payment=(patch:Record<string,unknown>={}):Payment=>({
  id:'settled-1',paymentType:'receive',status:'completed',method:'lightning',
  amount:1000n,fees:0n,timestamp:1720000100,
  details:{type:'lightning',invoice:'LNBC10N1VALIDINVOICE'},
  ...patch
}) as unknown as Payment;

beforeEach(()=>localStorage.clear());

describe('self-custodial merchant POS journal and reconciliation',()=>{
  it('stores invoices only for their own wallet identity, without paid flags',()=>{
    expect(savePosOrders(identityA,[order])).toBe(true);
    expect(readPosOrders(identityA)).toEqual([order]);
    expect(readPosOrders(identityB)).toEqual([]);
    expect(localStorage.getItem('gys:merchant:orders:v1:'+identityA)).not.toContain('privateKey');
    expect(localStorage.getItem('gys:merchant:orders:v1:'+identityA)).not.toContain('paid');
  });
  it('only confirms a matching inbound, settled, sufficiently funded Lightning invoice',()=>{
    expect(matchingPosPayment(payment(),order)).toBe(true);
    for(const p of [
      payment({paymentType:'send'}),
      payment({status:'pending'}),
      payment({status:'failed'}),
      payment({amount:999n}),
      payment({details:{type:'lightning',invoice:'lnbc-other'}}),
      payment({details:{type:'spark'}}),
    ]) expect(matchingPosPayment(p,order)).toBe(false);
  });
  it('rechecks confirmed transactions from current wallet SDK history after a reload',()=>{
    const restored=readPosOrders(identityA);
    expect(restored).toHaveLength(0);
    savePosOrders(identityA,[order]);
    expect(reconcilePosOrders(readPosOrders(identityA),[payment()]).get(order.id)?.id).toBe('settled-1');
    expect(reconcilePosOrders(readPosOrders(identityA),[payment({status:'pending'})]).size).toBe(0);
  });
  it('rejects invalid, empty and corrupt browser storage instead of trusting it',()=>{
    localStorage.setItem('gys:merchant:orders:v1:'+identityA,'not-json');
    expect(readPosOrders(identityA)).toEqual([]);
    expect(savePosOrders('',[order])).toBe(false);
    expect(readPosOrders('bad')).toEqual([]);
    localStorage.setItem('gys:merchant:orders:v1:'+identityA,
      JSON.stringify([{...order,amountSats:-500},{...order,id:'valid-order'}]));
    expect(readPosOrders(identityA)).toHaveLength(1);
  });
});
