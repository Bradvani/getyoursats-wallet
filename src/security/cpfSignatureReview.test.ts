import {describe,it,expect,vi} from 'vitest';
import {inspectCpfpPsbt,guardedCpfpSigner} from './cpfSignatureReview';
const txid='11'.repeat(32),other='22'.repeat(32),script='0014'+'33'.repeat(20);
const le32=(n:number)=>[n&255,(n>>>8)&255,(n>>>16)&255,(n>>>24)&255];
const le64=(n:number)=>Array.from({length:8},(_,i)=>Math.floor(n/2**(8*i))&255);
const field=(k:number[],v:number[])=>[k.length,...k,v.length,...v];
function make({value=10000,output=9600,outScript=script,wrong=false,badHash=false}:{value?:number;output?:number;outScript?:string;wrong?:boolean;badHash?:boolean}={}):Uint8Array{
 const bytes=(s:string)=>Array.from({length:s.length/2},(_,i)=>parseInt(s.slice(i*2,i*2+2),16));
 const ins=[...(wrong?[bytes(other)]:[bytes(txid)])],scriptBytes=bytes(outScript);
 const tx=[2,0,0,0,1,...ins[0].reverse(),...le32(1),0,...le32(0xffffffff),1,...le64(output),scriptBytes.length,...scriptBytes,0,0,0,0];
 const witness=[...le64(value),bytes(script).length,...bytes(script)];
 const inMap=[...field([1],witness),...(badHash?field([3],le32(0x81)):[]),0];
 return Uint8Array.from([112,115,98,116,255, ...[1,0,tx.length,...tx],0,...inMap,0]);
}
function h(custom:{}={}){
 const signer={signPsbt:vi.fn(async(v:Uint8Array)=>v)};
 const authorize=vi.fn(async()=>{}),persist=vi.fn(async()=>{});
 const guard=guardedCpfpSigner({signer,funded:[{txid,vout:1,valueSats:10000,scriptPubkeyHex:script}],allowedOutputs:[script],maxFeeSats:700n,expiresAt:Date.now()+60000,
  assertCurrent:()=>{},authorize,persist,...custom});
 return {guard,signer,authorize,persist};
}
describe('funding-key PSBT signing restrictions',()=>{
 it('checks a known input, fee and destination before ever signing',async()=>{
  const test=h();const psbt=make();expect(inspectCpfpPsbt(psbt).feeSats).toBe(400n);
  await expect(test.guard.signPsbt(psbt)).resolves.toEqual(psbt);
  expect(test.authorize).toHaveBeenCalledOnce();expect(test.persist).toHaveBeenCalledOnce();
  expect(test.signer.signPsbt).toHaveBeenCalledOnce();
  expect(test.authorize.mock.invocationCallOrder[0]).toBeLessThan(test.persist.mock.invocationCallOrder[0]);
  expect(test.persist.mock.invocationCallOrder[0]).toBeLessThan(test.signer.signPsbt.mock.invocationCallOrder[0]);
 });
 it.each([make({wrong:true}),make({value:9000}),make({output:10001}),make({output:8000}),make({outScript:'0014'+'44'.repeat(20)}),make({badHash:true}),make().slice(0,10)])('rejects an unauthorized or malformed PSBT before signing',async psbt=>{
  const t=h();await expect(t.guard.signPsbt(psbt)).rejects.toThrow(/Exit signature denied/);expect(t.signer.signPsbt).not.toHaveBeenCalled();
 });
 it('rejects repeated signing after a durable approval',async()=>{const t=h();await t.guard.signPsbt(make());await expect(t.guard.signPsbt(make())).rejects.toThrow(/repeat/);expect(t.signer.signPsbt).toHaveBeenCalledOnce();});
 it('refuses cancellation or lost durable write',async()=>{
  const a=h({authorize:async()=>{throw Error('cancelled')}});await expect(a.guard.signPsbt(make())).rejects.toThrow(/cancelled/);expect(a.signer.signPsbt).not.toHaveBeenCalled();
  const b=h({persist:async()=>{throw Error('write failed')}});await expect(b.guard.signPsbt(make())).rejects.toThrow(/write failed/);expect(b.signer.signPsbt).not.toHaveBeenCalled();
 });
});
