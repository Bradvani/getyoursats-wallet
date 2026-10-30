import React from 'react';
import {afterEach,describe,expect,it,vi} from 'vitest';
import {act,renderHook,waitFor} from '@testing-library/react';
import type {PrepareSendPaymentResponse} from '@breeztech/breez-sdk-spark';
import {WalletProvider} from '@/contexts/WalletContext';
import {FiatDataProvider} from '@/contexts/FiatDataContext';
import {StableBalanceProvider} from '@/contexts/StableBalanceContext';
import {createMockClient,createMockPayment} from '@/test/mocks/mockWalletApi';
import {useSendPayment} from './useSendPayment';
import {getSendLightningAddress,getLnurlPayRequestDetails,getPaymentMethodName} from '../utils';

const key='0279be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798';
const spark='spark1synthetic';
const address='alice@getyoursats.com';
const details={domain:'getyoursats.com',url:'https://getyoursats.com/.well-known/lnurlp/alice',
  callback:'https://getyoursats.com/lnurlp/alice/invoice',minSendable:1000,maxSendable:100000000000,
  metadataStr:JSON.stringify([['text/identifier',address]]),commentAllowed:255};
const quote={amount:100n,paymentMethod:{type:'sparkAddress',address:spark,fee:0n},feePolicy:'feesExcluded'} as PrepareSendPaymentResponse;
const payload=()=>({available:true,lightningAddress:address,identityPublicKey:key,sparkAddress:spark,bindingId:'a'.repeat(64),expiresAt:Date.now()+60000});
function deferred<T>(){
  let resolve!:(value:T)=>void;
  const promise=new Promise<T>(done=>{resolve=done;});
  return {resolve,promise};
}
function setup(){
  Object.defineProperty(navigator,'locks',{configurable:true,value:{request:async(_key:string,_options:unknown,run:()=>Promise<unknown>)=>run()}});
  const fetch=vi.fn<typeof globalThis.fetch>().mockImplementation(async()=>Response.json(payload()));
  vi.stubGlobal('fetch',fetch);
  const client=createMockClient({
    getInfo:vi.fn(async()=>({identityPubkey:key,balanceSats:10000,recoverableFundsSats:0,tokenBalances:new Map()})),
    parse:vi.fn(async(input:string)=>input===spark?
      {type:'sparkAddress',address:spark,identityPublicKey:key,network:'bitcoin',source:{type:'string'}}:
      input.startsWith('lnurl')?{type:'lnurlPay',...details}:{type:'lightningAddress',address:input,payRequest:details}) as never,
    prepareSendPayment:vi.fn(async()=>quote),
    sendPayment:vi.fn(async request=>({payment:createMockPayment('send',{id:request.idempotencyKey,amount:100n,fees:0n})})),
  });
  const wrapper=({children}:{children:React.ReactNode})=><WalletProvider client={client} isConnected>
    <FiatDataProvider><StableBalanceProvider>{children}</StableBalanceProvider></FiatDataProvider>
  </WalletProvider>;
  return {client,fetch,...renderHook(()=>useSendPayment(),{wrapper})};
}
afterEach(()=>vi.unstubAllGlobals());

describe('automatic GYS payments',()=>{
  it.each([address,'lnurl1synthetic-native-qr'])('routes %s through the verified zero-fee prepare/send path',async raw=>{
    const {client,result,fetch}=setup();
    await act(()=>result.current.processInput(raw));
    expect(result.current.currentStep).toBe('amount');
    expect(getSendLightningAddress(result.current.paymentInput)).toBe(address);
    expect(getPaymentMethodName(result.current.paymentInput)).toBe('Pay');
    expect(getLnurlPayRequestDetails(result.current.paymentInput)).toBeNull();
    expect(result.current.paymentInput?.rawInput).toBe(raw);
    await act(()=>result.current.onAmountNext(100n));
    expect(client.prepareSendPayment).toHaveBeenCalledWith(expect.objectContaining({paymentRequest:{type:'input',input:spark},amount:100n}));
    expect(result.current.prepareResponse?.paymentMethod).toMatchObject({fee:0n});
    await act(()=>result.current.handleSend());
    expect(fetch).toHaveBeenCalledTimes(3);
    expect(client.sendPayment).toHaveBeenCalledWith(expect.objectContaining({prepareResponse:quote,idempotencyKey:expect.any(String)}));
    expect(client.lnurlPay).not.toHaveBeenCalled();
    expect(result.current.paymentResult).toBe('success');
    expect(result.current.completedPayment?.fees).toBe(0n);
  });
  it('retains the ordinary LNURL quote when no verified direct route exists',async()=>{
    const {client,result,fetch}=setup();
    fetch.mockImplementation(async()=>Response.json({available:false}));
    await act(()=>result.current.processInput(address));
    expect(result.current.currentStep).toBe('workflow');
    expect(getLnurlPayRequestDetails(result.current.paymentInput)).toEqual(details);
    expect(client.prepareSendPayment).not.toHaveBeenCalled();
    expect(result.current.paymentInput?.directRecipient).toBeUndefined();
  });
  it.each(['prepare','send'])('blocks a revoked binding before %s without a paid fallback',async stage=>{
    const {client,result,fetch}=setup();
    await act(()=>result.current.processInput(address));
    if(stage==='send')await act(()=>result.current.onAmountNext(100n));
    fetch.mockImplementation(async()=>Response.json({available:false}));
    await act(()=>stage==='prepare'?result.current.onAmountNext(100n):result.current.handleSend());
    expect(result.current.currentStep).toBe('amount');
    expect(result.current.error).toBe('Recipient unavailable. Review the payment again.');
    expect(result.current.prepareResponse).toBeNull();
    expect(client.sendPayment).not.toHaveBeenCalled();
    expect(client.lnurlPay).not.toHaveBeenCalled();
    expect(result.current.paymentResult).toBeNull();
  });
  it('rejects an SDK destination substitution before review',async()=>{
    const {client,result}=setup();
    vi.mocked(client.prepareSendPayment).mockResolvedValue({...quote,paymentMethod:{type:'sparkAddress',address:'spark1other',fee:0n}});
    await act(()=>result.current.processInput(address));
    await act(()=>result.current.onAmountNext(100n));
    expect(result.current.prepareResponse).toBeNull();
    expect(client.sendPayment).not.toHaveBeenCalled();
  });
  it('ignores a cancelled directory response and never prepares the old recipient',async()=>{
    const {client,result,fetch}=setup();
    const response=deferred<Response>();fetch.mockReturnValueOnce(response.promise);
    let operation!:Promise<void>;
    act(()=>{operation=result.current.processInput(address);});
    await waitFor(()=>expect(fetch).toHaveBeenCalledOnce());
    act(()=>result.current.cancelPendingInput());
    await act(async()=>{response.resolve(Response.json(payload()));await operation;});
    expect(result.current.paymentInput).toBeNull();
    expect(client.prepareSendPayment).not.toHaveBeenCalled();
  });
  it('does not send if the wallet view unmounts during final verification',async()=>{
    const {client,result,fetch,unmount}=setup();
    await act(()=>result.current.processInput(address));await act(()=>result.current.onAmountNext(100n));
    const response=deferred<Response>();fetch.mockReturnValueOnce(response.promise);
    let operation!:Promise<void>;act(()=>{operation=result.current.handleSend();});
    unmount();
    await act(async()=>{response.resolve(Response.json(payload()));await operation;});
    expect(client.sendPayment).not.toHaveBeenCalled();
  });
  it('suppresses duplicate confirmations and keeps interrupted settlement unknown',async()=>{
    const {client,result}=setup();
    const payment=deferred<never>();vi.mocked(client.sendPayment).mockReturnValueOnce(payment.promise);
    await act(()=>result.current.processInput(address));await act(()=>result.current.onAmountNext(100n));
    let operation!:Promise<void>;act(()=>{operation=result.current.handleSend();});
    await waitFor(()=>expect(client.sendPayment).toHaveBeenCalledOnce());
    await act(()=>result.current.handleSend());
    await act(async()=>{payment.resolve(undefined as never);await operation;});
    expect(result.current.paymentResult).toBe('unknown');
    expect(result.current.completedPayment).toBeNull();
    await act(()=>result.current.handleSend());
    expect(client.sendPayment).toHaveBeenCalledOnce();
  });
});
