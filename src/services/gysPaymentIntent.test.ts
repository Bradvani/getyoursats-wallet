import {beforeEach,describe,expect,it,vi} from 'vitest';
import type {Payment} from '@breeztech/breez-sdk-spark';
import {checkGysPaymentIntent,reserveGysPaymentIntent,finishGysPaymentIntent} from './gysPaymentIntent';

const identity='0279be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798';
const intent={id:'8a9aeed5-9b3d-4cb6-8ab5-ceba896b890f',recipient:'alice@getyoursats.com',amount:'100',createdAt:1000};
const missing=vi.fn(async()=>{throw new Error('Not found');});
beforeEach(()=>{
  localStorage.clear();
  let queue=Promise.resolve();
  Object.defineProperty(navigator,'locks',{configurable:true,value:{request:(_key:string,_options:unknown,run:()=>Promise<unknown>)=>{
    const current=queue.then(run);queue=current.then(()=>{},()=>{});return current;
  }}});
});
describe('durable direct payment authorization',()=>{
  it('keeps uncertain sends blocked across a new invocation and a different recipient',async()=>{
    await reserveGysPaymentIntent(identity,intent,missing);
    await expect(checkGysPaymentIntent(identity,missing)).rejects.toThrow('Check payment history');
    await expect(reserveGysPaymentIntent(identity,{...intent,id:'another',recipient:'bob@getyoursats.com'},missing)).rejects.toThrow();
  });
  it('accepts only a terminal SDK receipt with the reserved payment ID',async()=>{
    await reserveGysPaymentIntent(identity,intent,missing);
    await finishGysPaymentIntent(identity,intent.id,{id:'other',status:'completed'} as Payment);
    await expect(checkGysPaymentIntent(identity,missing)).rejects.toThrow();
    await finishGysPaymentIntent(identity,intent.id,{id:intent.id,status:'pending'} as Payment);
    await expect(checkGysPaymentIntent(identity,missing)).rejects.toThrow();
    await finishGysPaymentIntent(identity,intent.id,{id:intent.id,status:'completed'} as Payment);
    await expect(checkGysPaymentIntent(identity,missing)).resolves.toBeUndefined();
  });
  it.each(['completed','failed'] as const)('reconciles %s after restart and pauses before a fresh approval',async status=>{
    await reserveGysPaymentIntent(identity,intent,missing);
    const found=vi.fn(async()=>({payment:{id:intent.id,status} as Payment}));
    await expect(checkGysPaymentIntent(identity,found)).rejects.toThrow('Check payment history');
    await expect(checkGysPaymentIntent(identity,found)).resolves.toBeUndefined();
    expect(found).toHaveBeenCalledOnce();
  });
  it('reserves only one of two concurrent confirmations',async()=>{
    const results=await Promise.allSettled([
      reserveGysPaymentIntent(identity,intent,missing),
      reserveGysPaymentIntent(identity,{...intent,id:'second'},missing),
    ]);
    expect(results.map(value=>value.status)).toEqual(['fulfilled','rejected']);
  });
  it('does not treat corrupt or unwritable state as permission to send',async()=>{
    localStorage.setItem('gys:payment-intent:v1:'+identity,'broken');
    await expect(reserveGysPaymentIntent(identity,intent,missing)).rejects.toThrow();
    localStorage.clear();
    const write=vi.spyOn(localStorage,'setItem').mockImplementation(()=>{throw new Error('Quota exceeded');});
    await expect(reserveGysPaymentIntent(identity,intent,missing)).rejects.toThrow();
    write.mockRestore();
  });
});
