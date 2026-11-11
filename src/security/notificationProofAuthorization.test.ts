import {ECDH, generateKeyPairSync, sign, webcrypto} from 'node:crypto';
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import type {BreezSdk, Network} from '@breeztech/breez-sdk-spark';
import {pushAuthorizationMessage, pushOperationPayload} from '../../shared/pushAuthorization.mjs';
import {signedPushOperation, type PushAction} from '../services/paymentPush';
import {createOperationGateway} from './operationGateway';
import {clearSignerIdentity, getSpendingRequest, lockSpendingSession, rememberSignerIdentity} from './spendApproval';

const serverModule = '../../server/pushCore.mjs';
const {verifyOwnership, digest} = await import(serverModule);
const ORIGIN = 'https://wallet.getyoursats.com';
const identity = '02' + '11'.repeat(32), other = '03' + '22'.repeat(32);
const nonce = 'a'.repeat(32), hash = 'b'.repeat(64);
const seed = {type:'mnemonic' as const, mnemonic:'disposable notification proof fixture'};
const message = (action:PushAction = 'status', pub = identity, challenge = nonce, payloadHash = hash) =>
  pushAuthorizationMessage(action, pub, challenge, payloadHash);
const proof = (pub = identity) => ({pubkey:pub, signature:'f'.repeat(128)});
function harness(network:Network = 'mainnet', pub = identity) {
  const raw = {getInfo:vi.fn(async () => ({identityPubkey:pub})),
    signMessage:vi.fn(async (_request:{message:string;compact?:boolean}) => proof(pub)), sendPayment:vi.fn()};
  const wallet = createOperationGateway(network).protect(raw as unknown as BreezSdk);
  return {raw, wallet};
}
beforeEach(async () => {
  localStorage.clear();
  vi.spyOn(window, 'location', 'get').mockReturnValue({origin:ORIGIN} as Location);
  vi.stubGlobal('crypto', webcrypto);
  await rememberSignerIdentity(seed);
});
afterEach(() => {clearSignerIdentity(); vi.restoreAllMocks(); vi.unstubAllGlobals();});

describe('scoped device-notification proof capability', () => {
  it.each(['subscribe','activate','status','unsubscribe'] as const)('signs the exact shared %s contract without a spending permit', async action => {
    const {raw, wallet} = harness();
    await expect(wallet.signMessage({message:message(action), compact:true})).resolves.toEqual(proof());
    expect(raw.signMessage).toHaveBeenCalledExactlyOnceWith({message:message(action), compact:true});
    expect(raw.sendPayment).not.toHaveBeenCalled(); expect(getSpendingRequest()).toBeNull();
  });
  it.each(['signet','regtest'] as const)('refuses notification proofs on %s', async network => {
    const {raw, wallet} = harness(network);
    await expect(wallet.signMessage({message:message(), compact:true})).rejects.toThrow(/scoped/);
    expect(raw.getInfo).not.toHaveBeenCalled(); expect(raw.signMessage).not.toHaveBeenCalled();
  });
  it.each(['https://other.example',ORIGIN + '.evil.example',ORIGIN + '/', 'http://wallet.getyoursats.com'])('refuses runtime origin %s', async origin => {
    vi.spyOn(window, 'location', 'get').mockReturnValue({origin} as Location);
    const {raw, wallet} = harness();
    await expect(wallet.signMessage({message:message(), compact:true})).rejects.toThrow(/scoped/);
    expect(raw.signMessage).not.toHaveBeenCalled();
  });
  it.each([
    message().replace('gys-push-v2','gys-push-v1'), message().replace('https:','http:'),
    message().replace('wallet.getyoursats.com','wallet.getyoursats.com.evil.example'),
    message().replace(':status:',':spend:'), message().replace(':status:',':Status:'),
    message('status', '04' + '11'.repeat(32)), message('status', '02' + 'AB'.repeat(32)),
    message('status', identity, 'a'.repeat(31)), message('status', identity, 'A'.repeat(32)),
    message('status', identity, nonce, 'b'.repeat(63)), message('status', identity, nonce, 'B'.repeat(64)),
    message('status', identity, nonce, 'b'.repeat(513)), message() + ':extra', message() + '\n',
    'arbitrary signing bytes', 'gys-native-lnurl-session-v1',
    'gys-rampnow-v1:' + JSON.stringify(['production',ORIGIN,'status',hash,'a'.repeat(36),identity]),
  ])('rejects malformed or unrelated proof %# before raw signing', async value => {
    const {raw, wallet} = harness();
    await expect(wallet.signMessage({message:value, compact:true})).rejects.toThrow(/scoped/);
    expect(raw.getInfo).not.toHaveBeenCalled(); expect(raw.signMessage).not.toHaveBeenCalled();
  });
  it('requires compact signatures and retains the SDK webhook registration denial', async () => {
    const {raw, wallet} = harness();
    await expect(wallet.signMessage({message:message(), compact:false})).rejects.toThrow(/scoped/);
    expect(() => wallet.registerWebhook({url:ORIGIN + '/api/notifications/spark?wallet=' + identity,
      secret:hash,eventTypes:[{type:'lightningReceiveFinished'}]})).toThrow(/review|unavailable/);
    expect(raw.signMessage).not.toHaveBeenCalled();
  });
  it('checks both challenge and returned owner; ambiguous signatures remain consumed', async () => {
    const {raw, wallet} = harness();
    await expect(wallet.signMessage({message:message('status',other), compact:true})).rejects.toThrow(/different wallet/);
    expect(raw.signMessage).not.toHaveBeenCalled();
    raw.signMessage.mockResolvedValueOnce(proof(other));
    await expect(wallet.signMessage({message:message(), compact:true})).rejects.toThrow(/different wallet/);
    await expect(wallet.signMessage({message:message(), compact:true})).rejects.toThrow(/already used/);
    expect(raw.signMessage).toHaveBeenCalledTimes(1);
  });
  it('reserves the nonce atomically even when purpose and payload change', async () => {
    const {raw, wallet} = harness();
    const result = await Promise.allSettled([wallet.signMessage({message:message(), compact:true}),
      wallet.signMessage({message:message('unsubscribe',identity,nonce,'c'.repeat(64)), compact:true})]);
    expect(result.filter(value => value.status === 'fulfilled')).toHaveLength(1);
    expect(result.filter(value => value.status === 'rejected')).toHaveLength(1);
    expect(raw.signMessage).toHaveBeenCalledTimes(1);
  });
  it('keeps failed signing consumed but permits a fresh challenge', async () => {
    const {raw, wallet} = harness(); raw.signMessage.mockRejectedValueOnce(new Error('uncertain signer'));
    await expect(wallet.signMessage({message:message(), compact:true})).rejects.toThrow(/uncertain/);
    await expect(wallet.signMessage({message:message(), compact:true})).rejects.toThrow(/already used/);
    await expect(wallet.signMessage({message:message('status',identity,'c'.repeat(32)), compact:true})).resolves.toEqual(proof());
    expect(raw.signMessage).toHaveBeenCalledTimes(2);
  });
  it('enforces reservation capacity and TTL without another raw signature on refusal', async () => {
    const now = vi.spyOn(Date,'now').mockReturnValue(1_000_000);
    const {raw, wallet} = harness();
    for(let index=0;index<1024;index++) await wallet.signMessage({
      message:message('status',identity,index.toString(16).padStart(32,'0')),compact:true});
    now.mockReturnValue(1_299_999);
    await expect(wallet.signMessage({message:message('status',identity,'0'.repeat(32)),compact:true})).rejects.toThrow(/already used/);
    await expect(wallet.signMessage({message:message(),compact:true})).rejects.toThrow(/Too many/);
    expect(raw.signMessage).toHaveBeenCalledTimes(1024);
    now.mockReturnValue(1_300_000);
    await expect(wallet.signMessage({message:message(),compact:true})).resolves.toEqual(proof());
    expect(raw.signMessage).toHaveBeenCalledTimes(1025);
  });
  it.each(['lock','signer','storage'] as const)('refuses %s changes during identity lookup', async change => {
    const {raw, wallet} = harness(); raw.getInfo.mockImplementationOnce(async () => {
      if(change === 'lock') lockSpendingSession();
      if(change === 'signer') await rememberSignerIdentity({...seed,mnemonic:'other disposable identity'});
      if(change === 'storage') localStorage.clear();
      return {identityPubkey:identity};
    });
    await expect(wallet.signMessage({message:message(),compact:true})).rejects.toThrow(/session|identity changed/);
    expect(raw.signMessage).not.toHaveBeenCalled();
  });
  it.each(['lock','signer','storage'] as const)('discards results after %s changes during signing', async change => {
    const {raw, wallet} = harness(); raw.signMessage.mockImplementationOnce(async () => {
      if(change === 'lock') lockSpendingSession();
      if(change === 'signer') await rememberSignerIdentity({...seed,mnemonic:'other disposable identity'});
      if(change === 'storage') localStorage.clear();
      return proof();
    });
    await expect(wallet.signMessage({message:message(),compact:true})).rejects.toThrow(/session|identity changed/);
    expect(raw.signMessage).toHaveBeenCalledTimes(1);
  });
});

describe('actual notification client through the gateway and server verifier', () => {
  it.each(['subscribe','activate','status','unsubscribe'] as const)('verifies real compact %s proofs bound to the device payload', async action => {
    const {publicKey,privateKey} = generateKeyPairSync('ec',{namedCurve:'secp256k1'});
    const pub = ECDH.convertKey(publicKey.export({format:'der',type:'spki'}).subarray(-65),
      'secp256k1',undefined,undefined,'compressed').toString('hex');
    const {raw,wallet} = harness('mainnet',pub);
    raw.signMessage.mockImplementation(async request => ({pubkey:pub,
      signature:sign('sha256',Buffer.from(request.message),{key:privateKey,dsaEncoding:'ieee-p1363'}).toString('hex')}));
    const extra = {endpoint:'https://fcm.googleapis.com/device/disposable',webhookId:'opaque:id=',
      subscription:{endpoint:'https://fcm.googleapis.com/device/disposable',keys:{p256dh:'disposable-key',auth:'disposable-auth'}}};
    let consumed = false;
    vi.stubGlobal('fetch',vi.fn(async (_url:unknown, init:RequestInit) => {
      const posted = JSON.parse(String(init.body));
      const wanted = message(action,pub,nonce,digest(pushOperationPayload(action,extra)));
      if(posted.action === 'challenge') return new Response(JSON.stringify({challengeId:nonce,message:wanted,expiresIn:300}));
      expect(consumed).toBe(false); consumed = true;
      expect(posted.action).toBe(action); expect(posted.walletPubkey).toBe(pub);
      expect(digest(pushOperationPayload(action,posted))).toBe(digest(pushOperationPayload(action,extra)));
      expect(verifyOwnership(wanted,pub,posted.signature)).toBe(true);
      const changed = message(action,pub,nonce,digest(pushOperationPayload(action,{...extra,endpoint:extra.endpoint + '/changed',
        subscription:{...extra.subscription,endpoint:extra.endpoint + '/changed'}})));
      expect(verifyOwnership(changed,pub,posted.signature)).toBe(false);
      return new Response(JSON.stringify({enabled:action !== 'unsubscribe'}));
    }));
    await expect(signedPushOperation(wallet,pub,action,extra)).resolves.toEqual({enabled:action !== 'unsubscribe'});
    expect(consumed).toBe(true); expect(raw.signMessage).toHaveBeenCalledTimes(1);
  });
  it('rejects a server challenge bound to another device before entering the signer', async () => {
    const {raw,wallet} = harness();
    vi.stubGlobal('fetch',vi.fn(async () => new Response(JSON.stringify({challengeId:nonce,message:message()}))));
    await expect(signedPushOperation(wallet,identity,'status',{endpoint:'https://fcm.googleapis.com/device/disposable'}))
      .rejects.toThrow(/did not match this device/);
    expect(raw.signMessage).not.toHaveBeenCalled();
  });
});
