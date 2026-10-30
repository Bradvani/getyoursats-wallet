import {afterEach,describe,expect,it,vi} from 'vitest';
import type {InputType,PrepareSendPaymentResponse} from '@breeztech/breez-sdk-spark';
import {gysRecipient,resolveGysRecipient,revalidateGysRecipient,validateGysQuote} from './gysDirectPayments';

const key='0279be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798';
const address='alice@getyoursats.com';
const spark='spark1synthetic';
const details={domain:'getyoursats.com',url:'https://getyoursats.com/.well-known/lnurlp/alice',
  callback:'https://getyoursats.com/lnurlp/alice/invoice',minSendable:1000,maxSendable:100000000000,
  metadataStr:JSON.stringify([['text/identifier',address]]),commentAllowed:255};
const input={type:'lightningAddress',address,payRequest:details} as Extract<InputType,{type:'lightningAddress'}>;
const candidate={address,minSats:1,maxSats:100000000};
const parsed={type:'sparkAddress',address:spark,network:'bitcoin',identityPublicKey:key,source:{type:'string'}} as Extract<InputType,{type:'sparkAddress'}>;
const payload=()=>({available:true,lightningAddress:address,identityPublicKey:key,sparkAddress:spark,bindingId:'a'.repeat(64),expiresAt:Date.now()+60000});
const parse=vi.fn(async()=>parsed);
const fetcher=(value:unknown)=>vi.fn<typeof fetch>().mockImplementation(async()=>new Response(JSON.stringify(value)));
afterEach(()=>vi.unstubAllGlobals());

describe('verified native recipient routing',()=>{
  it('recognizes the same recipient from an address and native receive QR',()=>{
    expect(gysRecipient(input)).toEqual(candidate);
    expect(gysRecipient({type:'lnurlPay',...details,url:'lnurlp://getyoursats.com/lnurlp/alice'})).toEqual(candidate);
  });
  it.each([
    {domain:'attacker.example'},
    {url:'https://attacker.example/lnurlp/alice'},
    {url:'https://getyoursats.com@attacker.example/lnurlp/alice'},
    {url:'https://getyoursats.com/lnurlp/alice?name=bob'},
    {url:'https://getyoursats.com/lnurlp/alice/invoice'},
    {callback:'https://attacker.example/invoice'},
    {metadataStr:'[["text/identifier","bob@getyoursats.com"]]'},
    {minSendable:NaN},
    {address:'bob@getyoursats.com'},
  ])('rejects ambiguous or substituted LNURL metadata %j',patch=>{
    expect(gysRecipient({type:'lnurlPay',...details,...patch})).toBeNull();
  });
  it('does not reinterpret a merchant invoice or another domain',()=>{
    expect(gysRecipient({type:'bolt11Invoice'} as InputType)).toBeNull();
    expect(gysRecipient({...input,address:'alice@breez.tips'} as InputType)).toBeNull();
  });
  it('requires the SDK to confirm the mainnet destination and public identity',async()=>{
    const fetch=fetcher(payload());
    const result=await resolveGysRecipient(candidate,parse,fetch);
    expect(result).toMatchObject({lightningAddress:address,identityPublicKey:key,sparkAddress:spark});
    expect(fetch).toHaveBeenCalledWith('https://getyoursats.com/.well-known/gys/alice',expect.objectContaining({credentials:'omit',redirect:'error',cache:'no-store'}));
    expect(await resolveGysRecipient(candidate,async()=>({...parsed,network:'regtest'} as InputType),fetch)).toBeNull();
    expect(await resolveGysRecipient(candidate,async()=>({...parsed,identityPublicKey:'03'+'1'.repeat(64)} as InputType),fetch)).toBeNull();
  });
  it.each([{available:false},{lightningAddress:'bob@getyoursats.com'},{expiresAt:0},
    {expiresAt:Number.MAX_SAFE_INTEGER},{bindingId:'invalid'},{sparkAddress:7},{identityPublicKey:'not-a-key'}])(
    'ignores unavailable, expired or malformed directory responses %j',async patch=>{
      expect(await resolveGysRecipient(candidate,parse,fetcher({...payload(),...patch}))).toBeNull();
    });
  it('allows the original Lightning workflow when discovery is unavailable',async()=>{
    expect(await resolveGysRecipient(candidate,parse,vi.fn().mockRejectedValue(new Error('offline')))).toBeNull();
  });
  it('blocks an already-reviewed direct transfer on revocation or binding changes',async()=>{
    const recipient=(await resolveGysRecipient(candidate,parse,fetcher(payload())))!;
    vi.stubGlobal('fetch',fetcher({...payload(),bindingId:'b'.repeat(64)}));
    await expect(revalidateGysRecipient(recipient,parse)).rejects.toThrow('Recipient unavailable');
    vi.stubGlobal('fetch',fetcher({available:false}));
    await expect(revalidateGysRecipient(recipient,parse)).rejects.toThrow('Recipient unavailable');
  });
  it('validates the actual prepared destination, asset, amount and fee',async()=>{
    const recipient=(await resolveGysRecipient(candidate,parse,fetcher(payload())))!;
    const quote={amount:100n,paymentMethod:{type:'sparkAddress',address:spark,fee:0n},feePolicy:'feesExcluded'} as PrepareSendPaymentResponse;
    expect(()=>validateGysQuote(recipient,quote)).not.toThrow();
    for(const patch of [{address:'spark1other'},{tokenIdentifier:'token'},{fee:1n},{fee:-1n},{fee:BigInt(Number.MAX_SAFE_INTEGER)+1n}]){
      expect(()=>validateGysQuote(recipient,{...quote,paymentMethod:{...quote.paymentMethod,...patch}} as PrepareSendPaymentResponse)).toThrow();
    }
    expect(()=>validateGysQuote(recipient,{...quote,amount:0n})).toThrow();
    expect(()=>validateGysQuote(recipient,{...quote,amount:100000001n})).toThrow();
  });
});
