/** Test-only ceremony simulator. Uses real Web Crypto signatures/PRF-shaped
 * keys but is NOT a platform authenticator or physical biometric acceptance. */
import {b64,bytes,sha,unb64,source} from '../security/linkedPasskeyProtocol';
const enc=new TextEncoder();
const buffer=(value:Uint8Array):ArrayBuffer=>value.slice().buffer as ArrayBuffer;
export function toDer(signature:ArrayBuffer):ArrayBuffer{
  const data=new Uint8Array(signature);
  const parts=[data.slice(0,32),data.slice(32)].map(part=>{
    let start=0;while(start<31&&part[start]===0)start++;
    let n=part.slice(start);if(n[0]&128){const padded=new Uint8Array(n.length+1);padded.set(n,1);n=padded;}
    return new Uint8Array([2,n.length,...n]);
  });
  return buffer(new Uint8Array([48,parts[0].length+parts[1].length,...parts[0],...parts[1]]));
}
export type AuthFault='none'|'wrong-id'|'wrong-user'|'wrong-origin'|'wrong-challenge'|'cross-origin'|'no-uv'|'bad-signature'|'wrong-prf'|'missing-prf'|'unsupported-prf';
export async function fixtureAuthenticator(){
  const key=await crypto.subtle.generateKey({name:'ECDSA',namedCurve:'P-256'},false,['sign','verify']) as CryptoKeyPair;
  const publicKey=await crypto.subtle.exportKey('spki',key.publicKey);
  const root=await crypto.subtle.importKey('raw',crypto.getRandomValues(new Uint8Array(32)),{name:'HMAC',hash:'SHA-256'},false,['sign']);
  const id=crypto.getRandomValues(new Uint8Array(32));
  let userHandle=new Uint8Array(0),rpId='',counter=0;
  const state={fault:'none' as AuthFault,createCalls:0,getCalls:0,beforeCreate:null as (()=>Promise<void>)|null,beforeGet:null as (()=>Promise<void>)|null,created:false};
  const client=(challenge:BufferSource,type:string)=>buffer(enc.encode(JSON.stringify({type,
    challenge:state.fault==='wrong-challenge'?b64(new Uint8Array(32)):b64(bytes(challenge)),
    origin:state.fault==='wrong-origin'?'https://invalid.example':location.origin,
    crossOrigin:state.fault==='cross-origin',
  })));
  async function authData(registration=false){
    const data=new Uint8Array(registration?55+id.length:37);data.set(unb64(await sha(rpId),32,32));
    data[32]=(state.fault==='no-uv'?1:5)|(registration?64:0);
    new DataView(data.buffer).setUint32(33,++counter,false);
    if(registration){data[53]=0;data[54]=id.length;data.set(id,55);}
    return data;
  }
  const methods={
    create:async(options:CredentialCreationOptions):Promise<Credential|null>=>{
      state.createCalls++;if(state.beforeCreate)await state.beforeCreate();options.signal?.throwIfAborted();
      const request=options.publicKey!;userHandle=new Uint8Array(bytes(request.user.id));rpId=request.rp.id!;
      const auth=await authData(true),data=client(request.challenge,'webauthn.create');state.created=true;
      return {type:'public-key',id:b64(id),rawId:buffer(id),response:{clientDataJSON:data,
        getPublicKey:()=>publicKey,getPublicKeyAlgorithm:()=>-7,getAuthenticatorData:()=>buffer(auth)},
        getClientExtensionResults:()=>({prf:{enabled:state.fault!=='unsupported-prf'}})} as unknown as PublicKeyCredential;
    },
    get:async(options:CredentialRequestOptions):Promise<Credential|null>=>{
      state.getCalls++;if(state.beforeGet)await state.beforeGet();options.signal?.throwIfAborted();
      const request=options.publicKey!;if(!state.created)throw new DOMException('No test credential','NotAllowedError');
      if(request.rpId!==rpId)throw new DOMException('Wrong RP','NotAllowedError');
      if(request.allowCredentials?.length&&!request.allowCredentials.some(c=>b64(bytes(c.id))===b64(id)))throw new DOMException('Wrong test credential','NotAllowedError');
      const data=client(request.challenge,'webauthn.get'),auth=await authData();
      const hash=new Uint8Array(await crypto.subtle.digest('SHA-256',data));
      const payload=new Uint8Array(auth.length+hash.length);payload.set(auth);payload.set(hash,auth.length);
      const raw=await crypto.subtle.sign({name:'ECDSA',hash:'SHA-256'},key.privateKey,source(payload));
      const signature=new Uint8Array(toDer(raw));if(state.fault==='bad-signature')signature[signature.length-1]^=1;
      const ext=request.extensions as unknown as {prf:{eval:{first:BufferSource}}};
      const prf=await crypto.subtle.sign('HMAC',root,ext.prf.eval.first);
      const prfBytes=new Uint8Array(prf);if(state.fault==='wrong-prf')prfBytes[0]^=1;
      return {type:'public-key',id:b64(id),rawId:buffer(state.fault==='wrong-id'?new Uint8Array(32):id),
        response:{clientDataJSON:data,authenticatorData:buffer(auth),signature:buffer(signature),userHandle:buffer(state.fault==='wrong-user'?new Uint8Array(45):userHandle)},
        getClientExtensionResults:()=>state.fault==='missing-prf'?{}:{prf:{results:{first:buffer(prfBytes)}}}} as unknown as PublicKeyCredential;
    },
  };
  return {state,methods,install(){Object.defineProperty(navigator,'credentials',{configurable:true,value:methods});Object.defineProperty(window,'isSecureContext',{configurable:true,value:true});}};
}
