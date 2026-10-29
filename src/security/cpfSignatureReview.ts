import type {CpfpSigner} from '@breeztech/breez-sdk-spark';

const deny=(reason:string):never=>{throw new Error('Exit signature denied: '+reason);};
type Funding=Readonly<{txid:string;vout:number;valueSats:number;scriptPubkeyHex:string}>;
export type SignedPsbtReview=Readonly<{unsignedTxHex:string;inputOutpoints:readonly string[];feeSats:bigint;outputs:readonly Readonly<{scriptHex:string;valueSats:bigint}>[]}>;
class Cursor{
  pos=0;constructor(readonly bytes:Uint8Array){}
  read(n:number):Uint8Array{if(!Number.isSafeInteger(n)||n<0||this.pos+n>this.bytes.length)deny('truncated data');const a=this.bytes.slice(this.pos,this.pos+n);this.pos+=n;return a;}
  u8():number{return this.read(1)[0];}
  u32():number{const a=this.read(4);return new DataView(a.buffer,a.byteOffset,4).getUint32(0,true);}
  u64():bigint{const a=this.read(8);const v=new DataView(a.buffer,a.byteOffset,8).getBigUint64(0,true);if(v>2100000000000000n)deny('value out of range');return v;}
  compact():number{const b=this.u8();if(b<253)return b;if(b===253){const a=this.read(2);const n=new DataView(a.buffer,a.byteOffset,2).getUint16(0,true);if(n<253)deny('noncanonical compact length');return n;}if(b===254){const n=this.u32();if(n<65536)deny('noncanonical compact length');return n;}return deny('unsupported compact length');}
  varBytes(max=1048576):Uint8Array{const n=this.compact();if(n>max)deny('oversized field');return this.read(n);}
  end():void{if(this.pos!==this.bytes.length)deny('trailing bytes');}
}
const hex=(b:Uint8Array):string=>Array.from(b,x=>x.toString(16).padStart(2,'0')).join('');
function map(c:Cursor):Map<string,Uint8Array>{
 const result=new Map<string,Uint8Array>();while(true){const k=c.varBytes(1000);if(!k.length)break;const id=hex(k);if(result.has(id)||result.size>500)deny('duplicate or excessive PSBT key');result.set(id,c.varBytes());}return result;
}
export function inspectCpfpPsbt(bytes:Uint8Array):SignedPsbtReview{
 if(!(bytes instanceof Uint8Array)||bytes.length<10||bytes.length>1048576)deny('invalid PSBT');
 const c=new Cursor(bytes);if(hex(c.read(5))!=='70736274ff')deny('invalid PSBT header');
 const global=map(c);
 if(global.has('fb')||!global.has('00'))deny('only PSBT version zero is supported');
 const tx=global.get('00')!,r=new Cursor(tx);r.u32();
 const count=r.compact();if(!count||count>64)deny('unsupported number of inputs');
 const inputs:string[]=[];for(let i=0;i<count;i++){const txid=hex(r.read(32).reverse()),vout=r.u32();if(r.varBytes(10000).length)deny('unsigned transaction contains scriptSig');r.u32();inputs.push(txid+':'+vout);}
 const n=r.compact();if(!n||n>64)deny('unsupported number of outputs');
 const outputs:{scriptHex:string;valueSats:bigint}[]=[];
 for(let i=0;i<n;i++){const valueSats=r.u64(),scriptHex=hex(r.varBytes(10000));outputs.push({valueSats,scriptHex});}
 r.u32();r.end();
 let totalIn=0n;for(let i=0;i<inputs.length;i++){
  const fields=map(c);const witness=fields.get('01');
  if(!witness)deny('missing witness UTXO');
  const w=new Cursor(witness);const value=w.u64();w.varBytes(10000);w.end();totalIn+=value;
  const sighash=fields.get('03');
  if(sighash){const x=new Cursor(sighash);if(x.u32()!==1)deny('only SIGHASH_ALL permitted');x.end();}
 }
 for(let i=0;i<outputs.length;i++)map(c);c.end();
 const totalOut=outputs.reduce((a,o)=>a+o.valueSats,0n);
 if(totalOut>totalIn||totalIn>2100000000000000n)deny('invalid input/output values');
 return Object.freeze({unsignedTxHex:hex(tx),inputOutpoints:Object.freeze(inputs),outputs:Object.freeze(outputs),feeSats:totalIn-totalOut});
}
export function guardedCpfpSigner(args:{
 readonly signer:CpfpSigner;
 readonly funded:readonly Funding[];
 readonly allowedOutputs:readonly string[];
 readonly maxFeeSats:bigint;
 readonly expiresAt:number;
 readonly assertCurrent:()=>void;
 readonly authorize:(review:SignedPsbtReview)=>Promise<void>;
 readonly persist:(review:SignedPsbtReview)=>Promise<void>;
}):CpfpSigner{
 const {signer,funded,allowedOutputs,maxFeeSats,expiresAt,assertCurrent,authorize,persist}=args;
 if(!Number.isSafeInteger(expiresAt)||expiresAt<=Date.now()||maxFeeSats<0n||maxFeeSats>2100000000000000n)deny('invalid authorization');
 if(!funded.length||!allowedOutputs.length)deny('missing approved inputs or outputs');
 const allowed=new Map<string,Funding>();for(const input of funded){
  const key=input.txid.toLowerCase()+':'+input.vout;
  if(!/^[a-f0-9]{64}$/.test(input.txid.toLowerCase())||!Number.isSafeInteger(input.vout)||input.vout<0||
    input.vout>0xffffffff||!Number.isSafeInteger(input.valueSats)||input.valueSats<=0||
    !/^[a-f0-9]{4,160}$/.test(input.scriptPubkeyHex.toLowerCase())||allowed.has(key))deny('invalid or repeated funding input');
  allowed.set(key,input);
 }
 const scripts=new Set(allowedOutputs.map(s=>s.toLowerCase()));
 if([...scripts].some(s=>!/^[a-f0-9]{4,160}$/.test(s)||s.length%2))deny('invalid approved outputs');
 let busy=false,spent=0n;const used=new Set<string>();
 return {signPsbt:async psbt=>{
  assertCurrent();if(busy||Date.now()>=expiresAt)deny('session unavailable or signing in progress');
  busy=true;
  try{
   const review=inspectCpfpPsbt(psbt);if(used.has(review.unsignedTxHex))deny('repeat signing requires recovery review');
   const c=new Cursor(psbt);c.read(5);const global=map(c),tx=global.get('00')!;
   const r=new Cursor(tx);r.u32();const inCount=r.compact();
   for(let i=0;i<inCount;i++){r.read(32);r.u32();r.varBytes(10000);r.u32();}
   const outCount=r.compact();for(let i=0;i<outCount;i++){r.u64();r.varBytes(10000);}r.u32();
   let known=0,unknown=0;
   for(const outpoint of review.inputOutpoints){
    const fields=map(c),w=fields.get('01')!,reader=new Cursor(w);
    const value=reader.u64(),script=hex(reader.varBytes(10000));
    const entry=allowed.get(outpoint);
    if(entry){known++;if(value!==BigInt(entry.valueSats)||script!==entry.scriptPubkeyHex.toLowerCase())deny('funding mismatch');}
    else if(++unknown>1||[...allowed.values()].some(a=>a.scriptPubkeyHex.toLowerCase()===script))deny('unapproved wallet-owned input');
   }
   if(!known||review.outputs.some(o=>!scripts.has(o.scriptHex)))deny('unapproved funding or payout');
   if(spent+review.feeSats>maxFeeSats)deny('total fee exceeds ceiling');
   await authorize(review);assertCurrent();if(Date.now()>=expiresAt)deny('approval expired');
   await persist(review);assertCurrent();
   used.add(review.unsignedTxHex);spent+=review.feeSats;
   const signed=await signer.signPsbt(psbt);assertCurrent();
   if(inspectCpfpPsbt(signed).unsignedTxHex!==review.unsignedTxHex)deny('signer altered unsigned transaction');
   return signed;
  }finally{busy=false;}
 }};
}
