/** Dev-only real-network acceptance fixture. No production wallet or raw SDK capability. */
import {defaultConfig,type BreezSdk} from '@breeztech/breez-sdk-spark';
import {entropyToMnemonic} from 'bip39';
import {sdkReady} from '../../src/services/sdkReady';
import {connectSdk} from '../../src/services/sdkConnect';
import {enrollWebWallet,unlockWebWallet} from '../../src/security/webWalletVault';
import {stopBrowserSdk} from '../../src/security/browserSdkLifetime';
import {getIncomingClaims} from '../../src/security/incomingClaimController';
import {getOperationReconciliation} from '../../src/security/operationGateway';
import {getSpendingRequest,finishSpendingApproval} from '../../src/security/spendApproval';
const password='only-valueless-disposable-regtest-wallet';
const marker='gys:disposable-acceptance:v1';
let wallet:BreezSdk|null=null;
let connecting=false;
function assertRegtest(){if(!import.meta.env.DEV||new URLSearchParams(location.search).get('network')!=='regtest')throw Error('Explicit development regtest is required');}
function current(){assertRegtest();if(!wallet)throw Error('Connect disposable wallet first');return wallet;}
const fixture={
 async connect(resume=false){
  assertRegtest();if(wallet||connecting)throw Error('Already connected');connecting=true;
  try{
   await sdkReady();let mnemonic:string,storageDir:string;
   if(resume){
    storageDir=localStorage.getItem(marker)??'';
    if(!/^gys-acceptance-[0-9a-f-]{36}$/.test(storageDir))throw Error('No disposable test identity');
    mnemonic=await unlockWebWallet(password);
   }else{
    if(localStorage.length!==0)throw Error('A completely empty disposable profile is required');
    const bytes=crypto.getRandomValues(new Uint8Array(16));
    mnemonic=entropyToMnemonic(Array.from(bytes,b=>b.toString(16).padStart(2,'0')).join(''));bytes.fill(0);
    await enrollWebWallet(mnemonic,password);
    storageDir='gys-acceptance-'+crypto.randomUUID();localStorage.setItem(marker,storageDir);
   }
   const config=defaultConfig('regtest');config.apiKey=undefined;config.maxDepositClaimFee=undefined;
   wallet=await connectSdk({config,seed:{type:'mnemonic',mnemonic},storageDir});mnemonic='';
   const info=await wallet.getInfo({ensureSynced:true});
   const address=await wallet.receivePayment({paymentMethod:{type:'sparkAddress'}});
   if(!address.paymentRequest.startsWith('sparkrt1'))throw Error('Wrong network');
   return {identity:info.identityPubkey,balance:String(info.balanceSats),address:address.paymentRequest,receiveFee:String(address.fee)};
  }finally{connecting=false;}
 },
 async status(){
  const w=current();await w.syncWallet({});const info=await w.getInfo({ensureSynced:false});
  return {identity:info.identityPubkey,balance:String(info.balanceSats),payments:(await w.listPayments({limit:100})).payments.map(p=>({id:p.id,amount:String(p.amount),fee:String(p.fees),status:p.status,type:p.paymentType,method:p.method})),
   incoming:await getIncomingClaims(w)!.list(),outgoing:await getOperationReconciliation(w)!.status()};
 },
 async discover(){return (await getIncomingClaims(current())!.discover()).map(p=>({id:p.id,amount:String(p.amount),fee:String(p.fees)}));},
 async claim(id:string){return getIncomingClaims(current())!.claim(id);},
 async send(address:string,amount:number){
  const w=current();if(!address.startsWith('sparkrt1')||!Number.isSafeInteger(amount)||amount<=0||amount>1000)throw Error('Invalid disposable test transfer');
  const prepared=await w.prepareSendPayment({paymentRequest:{type:'input',input:address},amount:BigInt(amount)});
  if(prepared.paymentMethod.type!=='sparkAddress'||prepared.paymentMethod.fee!==0n)throw Error('Direct Spark fee was not zero');
  const result=await w.sendPayment({prepareResponse:prepared});return {id:result.payment.id,status:result.payment.status,amount:String(result.payment.amount),fee:String(result.payment.fees)};
 },
 approval(){const r=getSpendingRequest();return r?{id:r.id,intent:r.intent}:null;},
 approve(id:number){assertRegtest();const r=getSpendingRequest();if(!r||r.id!==id||r.intent?.Network!=='regtest')throw Error('Wrong disposable approval');finishSpendingApproval(id,true);},
 async reconcile(){const w=current();return {incoming:await getIncomingClaims(w)!.reconcile(),outgoing:await getOperationReconciliation(w)!.reconcile()};},
 async stop(){if(wallet){await stopBrowserSdk(wallet);wallet=null;}},
};
Object.assign(window,{gysDisposableAcceptance:fixture});
