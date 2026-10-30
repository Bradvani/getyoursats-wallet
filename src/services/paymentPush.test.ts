import {afterEach,expect,it,vi} from 'vitest';
import {createHash} from 'node:crypto';
import {signedPushOperation,validateInvoiceWebhook} from './paymentPush';
import {pushAuthorizationMessage,pushOperationPayload} from '../../shared/pushAuthorization.mjs';

const pub='02'+'12'.repeat(32),nonce='34'.repeat(16);
const endpoint='https://web.push.apple.com/test-device-endpoint';
afterEach(()=>vi.unstubAllGlobals());

it('signs only the canonical origin and exact device operation, including the payload hash',async()=>{
  const extra={endpoint,webhookId:'provider-id-12345'};
  const message=pushAuthorizationMessage('activate',pub,nonce,
    createHash('sha256').update(pushOperationPayload('activate',extra)).digest('hex'));
  const fetch=vi.fn().mockResolvedValueOnce(Response.json({challengeId:nonce,message}))
    .mockResolvedValueOnce(Response.json({enabled:true}));
  vi.stubGlobal('fetch',fetch);
  const sdk={signMessage:vi.fn().mockResolvedValue({pubkey:pub,signature:'56'.repeat(64)})};
  await expect(signedPushOperation(sdk,pub,'activate',extra)).resolves.toEqual({enabled:true});
  expect(sdk.signMessage).toHaveBeenCalledWith({message,compact:true});
  expect(JSON.parse(fetch.mock.calls[0][1].body)).toMatchObject({...extra,action:'challenge',purpose:'activate'});
  expect(JSON.parse(fetch.mock.calls[1][1].body)).toMatchObject({...extra,action:'activate',signature:'56'.repeat(64)});
});

it('refuses a challenge for another endpoint before signing',async()=>{
  const message=pushAuthorizationMessage('unsubscribe',pub,nonce,
    createHash('sha256').update(pushOperationPayload('unsubscribe',{endpoint:endpoint+'other'})).digest('hex'));
  vi.stubGlobal('fetch',vi.fn().mockResolvedValue(Response.json({challengeId:nonce,message})));
  const sdk={signMessage:vi.fn()};
  await expect(signedPushOperation(sdk,pub,'unsubscribe',{endpoint})).rejects.toThrow('this device');
  expect(sdk.signMessage).not.toHaveBeenCalled();
});

it('a wallet/session change stops enrollment before a stale signature is submitted',async()=>{
  const message=pushAuthorizationMessage('status',pub,nonce,
    createHash('sha256').update(pushOperationPayload('status',{endpoint})).digest('hex'));
  const fetch=vi.fn().mockResolvedValue(Response.json({challengeId:nonce,message}));
  vi.stubGlobal('fetch',fetch);
  let current=true;
  const sdk={signMessage:vi.fn().mockImplementation(async()=>{current=false;return {pubkey:pub,signature:'56'.repeat(64)};})};
  await expect(signedPushOperation(sdk,pub,'status',{endpoint},()=>{
    if(!current)throw new Error('Wallet changed');
  })).rejects.toThrow('Wallet changed');
  expect(fetch).toHaveBeenCalledTimes(1);
});

it('never registers an invoice callback for a foreign URL or wallet',()=>{
  const valid={webhookUrl:'https://wallet.getyoursats.com/api/notifications/spark?wallet='+pub,
    webhookSecret:'ab'.repeat(32)};
  expect(()=>validateInvoiceWebhook(pub,valid)).not.toThrow();
  for(const webhookUrl of ['https://evil.example/hook',valid.webhookUrl+'&other=true',valid.webhookUrl.replace(pub,'03'+'45'.repeat(32))])
    expect(()=>validateInvoiceWebhook(pub,{...valid,webhookUrl})).toThrow();
});
