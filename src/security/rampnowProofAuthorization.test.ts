import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import type {BreezSdk,Network} from '@breeztech/breez-sdk-spark';
import {createOperationGateway} from './operationGateway';
import {clearSignerIdentity,lockSpendingSession,rememberSignerIdentity,getSpendingRequest} from './spendApproval';

const origin='https://getyoursats-wallet-git-feat-rampnow-integr-d20510-bradvani-8798.vercel.app';
const identity='02'+'11'.repeat(32),other='03'+'22'.repeat(32),nonce='a'.repeat(36);
const seed={type:'mnemonic' as const,mnemonic:'disposable-checkout-proof-fixture'};
const fields=()=>['sandbox',origin,'prepare','b'.repeat(64),nonce,identity];
const message=(values=fields())=>'gys-rampnow-v1:'+JSON.stringify(values);
const proof=()=>({pubkey:identity,signature:'f'.repeat(128)});
function harness(network:Network='signet') {
  const raw={getInfo:vi.fn(async()=>({identityPubkey:identity})),signMessage:vi.fn(async()=>proof()),sendPayment:vi.fn()};
  const wallet=createOperationGateway(network).protect(raw as unknown as BreezSdk);
  return {raw,wallet};
}
beforeEach(async()=>{
  localStorage.clear();
  vi.spyOn(window,'location','get').mockReturnValue({origin} as Location);
  await rememberSignerIdentity(seed);
});
afterEach(()=>{clearSignerIdentity();vi.restoreAllMocks();});

describe('sandbox checkout proof capability on the guarded wallet',()=>{
  it.each(['prepare','submit','status','reconcile'])('signs the exact canonical %s owner proof without opening a spending permit',async purpose=>{
    const {raw,wallet}=harness();const values=fields();values[2]=purpose;
    await expect(wallet.signMessage({message:message(values),compact:true})).resolves.toEqual(proof());
    expect(raw.signMessage).toHaveBeenCalledExactlyOnceWith({message:message(values),compact:true});
    expect(raw.sendPayment).not.toHaveBeenCalled();expect(getSpendingRequest()).toBeNull();
  });
  it.each(['mainnet','regtest'] as const)('refuses checkout proof signing on %s',async network=>{
    const {raw,wallet}=harness(network);
    await expect(wallet.signMessage({message:message(),compact:true})).rejects.toThrow(/scoped/);
    expect(raw.getInfo).not.toHaveBeenCalled();expect(raw.signMessage).not.toHaveBeenCalled();
  });
  it.each(['https://wallet.getyoursats.com','https://untrusted.example',origin+'.evil.example',origin+'/path'])('refuses an unapproved runtime origin %s',async currentOrigin=>{
    vi.spyOn(window,'location','get').mockReturnValue({origin:currentOrigin} as Location);
    const {raw,wallet}=harness();
    await expect(wallet.signMessage({message:message(),compact:true})).rejects.toThrow(/scoped/);
    expect(raw.signMessage).not.toHaveBeenCalled();
  });
  it.each([
    [0,'production'],[0,'Sandbox'],[1,'https://untrusted.example'],[1,origin+'/'],
    [2,'withdraw'],[2,'challenge'],[3,'c'.repeat(63)],[3,'C'.repeat(64)],
    [4,'a'.repeat(35)],[4,'A'.repeat(36)],[5,'04'+'11'.repeat(32)],[5,'02'+'11'.repeat(31)],
  ] as const)('rejects malformed or foreign-scope field %s=%s before signing',async(index,value)=>{
    const values=fields();values[index]=value;const {raw,wallet}=harness();
    await expect(wallet.signMessage({message:message(values),compact:true})).rejects.toThrow(/scoped/);
    expect(raw.getInfo).not.toHaveBeenCalled();expect(raw.signMessage).not.toHaveBeenCalled();
  });
  it.each([
    {message:'arbitrary bytes',compact:true},
    {message:'gys-rampnow-v1:'+JSON.stringify(['sandbox',origin,'prepare','b'.repeat(1025),nonce,identity]),compact:true},
    {message:'gys-native-lnurl-session-v1',compact:true},
    {message:'gys-push-v1:'+JSON.stringify(fields()),compact:true},
    {message:message(fields().slice(0,5)),compact:true},
    {message:message([...fields(),'extra']),compact:true},
    {message:'gys-rampnow-v1:'+JSON.stringify(fields(),null,2),compact:true},
    {message:message().replace('sandbox','\\u0073andbox'),compact:true},
    {message:message()+'\n',compact:true},
    {message:'gys-rampnow-v1:'+JSON.stringify({fields:fields()}),compact:true},
    {message:'gys-rampnow-v1:'+JSON.stringify([...fields().slice(0,5),null]),compact:true},
    {message:message(),compact:false},
  ])('refuses generic, noncanonical or malformed proof requests %#',async request=>{
    const {raw,wallet}=harness();
    await expect(wallet.signMessage(request)).rejects.toThrow(/scoped/);
    expect(raw.signMessage).not.toHaveBeenCalled();
  });
  it('refuses a challenge for another wallet and rejects a mismatched signer response',async()=>{
    const {raw,wallet}=harness();const values=fields();values[5]=other;
    await expect(wallet.signMessage({message:message(values),compact:true})).rejects.toThrow(/different wallet/);
    expect(raw.signMessage).not.toHaveBeenCalled();
    raw.signMessage.mockResolvedValueOnce({...proof(),pubkey:other});
    await expect(wallet.signMessage({message:message(),compact:true})).rejects.toThrow(/different wallet/);
    await expect(wallet.signMessage({message:message(),compact:true})).rejects.toThrow(/already used/);
    expect(raw.signMessage).toHaveBeenCalledTimes(1);
  });
  it('consumes a nonce atomically across concurrent signing calls and changed scopes',async()=>{
    const {raw,wallet}=harness();
    const results=await Promise.allSettled([wallet.signMessage({message:message(),compact:true}),wallet.signMessage({message:message(),compact:true})]);
    expect(results.filter(result=>result.status==='fulfilled')).toHaveLength(1);
    expect(results.filter(result=>result.status==='rejected')).toHaveLength(1);
    const changed=fields();changed[2]='submit';changed[3]='c'.repeat(64);
    await expect(wallet.signMessage({message:message(changed),compact:true})).rejects.toThrow(/already used/);
    expect(raw.signMessage).toHaveBeenCalledTimes(1);
  });
  it('never retries an uncertain signing attempt but permits a fresh server challenge',async()=>{
    const {raw,wallet}=harness();raw.signMessage.mockRejectedValueOnce(new Error('ambiguous signer response'));
    await expect(wallet.signMessage({message:message(),compact:true})).rejects.toThrow(/ambiguous/);
    await expect(wallet.signMessage({message:message(),compact:true})).rejects.toThrow(/already used/);
    const fresh=fields();fresh[4]='c'.repeat(36);
    await expect(wallet.signMessage({message:message(fresh),compact:true})).resolves.toEqual(proof());
    expect(raw.signMessage).toHaveBeenCalledTimes(2);
  });
  it('retains reservations through the TTL, refuses a full cache and prunes expired entries',async()=>{
    const now=vi.spyOn(Date,'now').mockReturnValue(1_000_000);
    const {raw,wallet}=harness();
    for(let index=0;index<1024;index++){
      const values=fields();values[4]=index.toString(16).padStart(36,'0');
      await wallet.signMessage({message:message(values),compact:true});
    }
    now.mockReturnValue(1_299_999);
    const duplicate=fields();duplicate[4]='0'.repeat(36);
    await expect(wallet.signMessage({message:message(duplicate),compact:true})).rejects.toThrow(/already used/);
    const fresh=fields();fresh[4]='f'.repeat(36);
    await expect(wallet.signMessage({message:message(fresh),compact:true})).rejects.toThrow(/Too many/);
    expect(raw.signMessage).toHaveBeenCalledTimes(1024);
    now.mockReturnValue(1_300_000);
    await expect(wallet.signMessage({message:message(fresh),compact:true})).resolves.toEqual(proof());
    expect(raw.signMessage).toHaveBeenCalledTimes(1025);
  });
  it.each(['lock','signer','storage'] as const)('refuses a %s change during identity lookup',async change=>{
    const {raw,wallet}=harness();raw.getInfo.mockImplementationOnce(async()=>{
      if(change==='lock')lockSpendingSession();
      if(change==='signer')await rememberSignerIdentity({...seed,mnemonic:'different disposable identity'});
      if(change==='storage')localStorage.clear();
      return {identityPubkey:identity};
    });
    await expect(wallet.signMessage({message:message(),compact:true})).rejects.toThrow(/session|identity changed/);
    expect(raw.signMessage).not.toHaveBeenCalled();
  });
  it.each(['lock','signer','storage'] as const)('discards a proof after a %s change during signing',async change=>{
    const {raw,wallet}=harness();raw.signMessage.mockImplementationOnce(async()=>{
      if(change==='lock')lockSpendingSession();
      if(change==='signer')await rememberSignerIdentity({...seed,mnemonic:'different disposable identity'});
      if(change==='storage')localStorage.clear();
      return proof();
    });
    await expect(wallet.signMessage({message:message(),compact:true})).rejects.toThrow(/session|identity changed/);
    expect(raw.signMessage).toHaveBeenCalledTimes(1);
  });
});
