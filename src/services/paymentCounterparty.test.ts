import {beforeEach, describe, expect, it, vi} from 'vitest';
import type {Payment} from '@breeztech/breez-sdk-spark';
import {paymentRecipient, rememberGysRecipient} from './paymentCounterparty';
import {getPaymentDescription, paymentMethodLabel} from '../utils/paymentDescription';

const identity='02'+'1'.repeat(64);
const another='03'+'2'.repeat(64);
const payment={id:'reserved-payment',paymentType:'send',status:'completed',amount:100n,fees:0n,timestamp:1,method:'spark',details:{type:'spark'}} as Payment;
beforeEach(()=>{localStorage.clear();localStorage.setItem('gys:language:v1','en');window.history.replaceState({},'','/');});
describe('payment counterparties',()=>{
  it('keeps the reviewed recipient bound to a payment, wallet, network and amount',()=>{
    rememberGysRecipient(identity,payment.id,'shiv@getyoursats.com','100');
    expect(paymentRecipient({...payment},identity)).toBe('shiv@getyoursats.com');
    expect(paymentRecipient(payment,another)).toBeUndefined();
    expect(paymentRecipient({...payment,id:'different'},identity)).toBeUndefined();
    expect(paymentRecipient({...payment,amount:101n},identity)).toBeUndefined();
    expect(paymentRecipient({...payment,paymentType:'receive'},identity)).toBeUndefined();
    window.history.replaceState({},'','/?network=signet');
    expect(paymentRecipient(payment,identity)).toBeUndefined();
  });
  it('shows the chosen contact and route without exposing Spark or mislabelling direct sends as Lightning',()=>{
    rememberGysRecipient(identity,payment.id,'shiv@getyoursats.com','100');
    expect(getPaymentDescription(payment,()=>({name:'Shiv'}),null,identity)).toBe('Pay to Shiv');
    expect(paymentMethodLabel(payment,identity)).toBe('GetYourSats payment');
    expect(getPaymentDescription(payment)).toBe('Bitcoin payment');
    expect(paymentMethodLabel(payment)).toBe('Bitcoin payment');
  });
  it('uses an outgoing LNURL address but never calls the receiver address or comment a sender',()=>{
    const lightning={...payment,method:'lightning',details:{type:'lightning',invoice:'lnbc1',destinationPubkey:'receiver-node',htlcDetails:{},lnurlPayInfo:{lnAddress:'alice@example.com'},lnurlReceiveMetadata:{senderComment:'I am bob@getyoursats.com'}}} as Payment;
    expect(paymentRecipient(lightning,identity)).toBe('alice@example.com');
    expect(paymentRecipient({...lightning,paymentType:'receive'},identity)).toBeUndefined();
  });
  it('does not attach a user payment identity to conversions',()=>{
    rememberGysRecipient(identity,payment.id,'shiv@getyoursats.com','100');
    expect(paymentRecipient({...payment,conversionDetails:{status:'completed',conversions:[]}},identity)).toBeUndefined();
  });
  it('ignores malformed data and never lets display storage failure change a payment outcome',()=>{
    rememberGysRecipient(identity,payment.id,'bad@getyoursats.com\nspoof','100');
    expect(paymentRecipient(payment,identity)).toBeUndefined();
    const store=vi.spyOn(Storage.prototype,'setItem').mockImplementation(()=>{throw new Error('Quota');});
    expect(()=>rememberGysRecipient(identity,payment.id,'shiv@getyoursats.com','100')).not.toThrow();
    store.mockRestore();
  });
});
