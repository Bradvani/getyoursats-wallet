import {describe,it,expect} from 'vitest';
import type {Payment} from '@breeztech/breez-sdk-spark';
import {newlyCompletedReceive,rememberPaymentId} from './paymentMomentPolicy';

const payment=(id:string,paymentType:'send'|'receive'='receive',status:'completed'|'pending'='completed',timestamp=100):Payment=>
  ({id,paymentType,status,timestamp,amount:5000n,fees:0n,method:'lightning',
    details:{type:'lightning'}} as unknown as Payment);

describe('payment settlement animation policy',()=>{
  it('seeds old wallet history silently on the first snapshot',()=>{
    const seen=new Set<string>();
    expect(newlyCompletedReceive([payment('old')],seen,false)).toBeNull();
    expect(newlyCompletedReceive([payment('old')],seen,true)).toBeNull();
  });
  it('flashes only a new confirmed incoming SDK payment, once',()=>{
    const seen=new Set<string>(['old']);
    expect(newlyCompletedReceive([payment('new'),payment('old')],seen,true)?.id).toBe('new');
    expect(newlyCompletedReceive([payment('new')],seen,true)).toBeNull();
    expect(rememberPaymentId(seen,'new')).toBe(false);
  });
  it('does not show success for pending payments, outgoing payments or conversions',()=>{
    const seen=new Set<string>();
    const conversion={...payment('conversion'),conversionDetails:{type:'amm'}} as unknown as Payment;
    expect(newlyCompletedReceive([payment('pending','receive','pending'),payment('send','send'),conversion],seen,true)).toBeNull();
  });
  it('picks the newest new incoming payment after foreground resync',()=>{
    const seen=new Set<string>();
    expect(newlyCompletedReceive([payment('a','receive','completed',100),payment('b','receive','completed',200)],seen,true)?.id).toBe('b');
  });
  it('bounds the tracked ID set without retaining payment payloads',()=>{
    const seen=new Set<string>();
    for(let i=0;i<510;i++)rememberPaymentId(seen,'p-'+i);
    expect(seen.size).toBe(500);
    expect(seen.has('p-0')).toBe(false);
    expect(seen.has('p-509')).toBe(true);
  });
});
