import {useState,useSyncExternalStore} from 'react';
import {Capacitor} from '@capacitor/core';
import {authenticateDeviceOwner} from '../services/secureStorage';
import {getPasskeyLabel,isPasskeyMode,signInPinnedToActiveCredential} from '../services/passkeyService';
import {checkWebWalletPassword} from './webWalletVault';
import {finishSpendingApproval,getSpendingRequest,getSpendingRequestServerSnapshot,matchesSignerIdentity,subscribeSpendingApproval,type SpendingRequest} from './spendApproval';

function ApprovalPrompt({pending}:{pending:SpendingRequest}){
 // A new component instance is mounted for every request ID; cancelled or
 // externally expired requests cannot leave a password in the next prompt.
 const [password,setPassword]=useState('');
 const [error,setError]=useState('');
 const [busy,setBusy]=useState(false);
 const id=pending.id;
 const native=Capacitor.isNativePlatform(),passkey=!native&&isPasskeyMode();
 const submit=async()=>{
  if(busy)return;
  setBusy(true);setError('');
  try{
   if(native)await authenticateDeviceOwner('Approve this GetYourSats transfer');
   else if(passkey){
    const response=await signInPinnedToActiveCredential(getPasskeyLabel()??undefined);
    if(!await matchesSignerIdentity(response.wallet.seed))
      throw new Error('The selected passkey does not match the connected wallet');
   }else if(!await checkWebWalletPassword(password)){
    throw new Error('Incorrect wallet password');
   }
   setPassword('');
   // The operation state verifies the session epoch and wall-clock deadline.
   finishSpendingApproval(id,true);
  }catch(e){
   setPassword('');
   setError(e instanceof Error?e.message:'Approval failed');
  }finally{setBusy(false);}
 };
 return <div className="fixed inset-0 z-[100000] flex items-center justify-center bg-black/85 p-4" role="presentation">
   <section role="dialog" aria-modal="true" aria-labelledby="gys-approve-title"
      className="w-full max-w-md rounded-2xl border border-spark-border bg-spark-surface p-6 shadow-2xl space-y-4">
    <header className="space-y-2">
     <h2 id="gys-approve-title" className="text-xl font-bold text-spark-text-primary">Approve transaction</h2>
     <p className="text-sm text-spark-text-secondary">Check the amount and full destination. This verification is an additional safeguard, not hardware-backed signing.</p>
    </header>
    <div className="max-h-56 overflow-y-auto space-y-3 rounded-xl bg-spark-dark p-3">
      {pending.payments.map(p=><div key={p.paymentId} className="space-y-2 text-spark-text-secondary">
       <p className="text-sm font-semibold text-spark-text-primary">{p.amount.toString()} {p.details.type==='token'?'token base units':'sats'} · {p.details.type}</p>
       {'tokenId' in p.details && <p className="text-xs break-all"><strong>Token:</strong> {p.details.tokenId}</p>}
       <p className="text-xs break-all">
        <strong>Destination:</strong> {'withdrawalAddress' in p.details ? p.details.withdrawalAddress
        : 'invoice' in p.details ? p.details.invoice
        : 'payRequest' in p.details ? p.details.payRequest:'Unavailable'}
       </p>
      </div>)}
    </div>
    {!native&&!passkey&&<label className="block space-y-2 text-sm text-spark-text-primary">
      <span>Wallet password</span>
      <input type="password" autoComplete="off" autoCapitalize="off" spellCheck={false}
        value={password} onChange={e=>setPassword(e.target.value)}
        className="w-full rounded-xl border border-spark-border bg-spark-dark p-3 text-spark-text-primary"/>
    </label>}
    {error&&<p role="alert" className="text-sm text-spark-warning">{error}</p>}
    <div className="grid grid-cols-2 gap-3">
     <button type="button" disabled={busy} onClick={()=>{setPassword('');finishSpendingApproval(id,false);}}
       className="min-h-12 rounded-xl border border-spark-border text-spark-text-secondary font-semibold">Cancel</button>
     <button type="button" disabled={busy||(!native&&!passkey&&!password)} onClick={()=>void submit()}
       className="min-h-12 rounded-xl bg-[#F7931A] text-black font-bold disabled:opacity-40">
      {busy?'Checking…':native?'Device approval':passkey?'Use passkey':'Authorize'}
     </button>
    </div>
   </section>
 </div>;
}
export default function SpendingApprovalDialog(){
 const pending=useSyncExternalStore(subscribeSpendingApproval,getSpendingRequest,getSpendingRequestServerSnapshot);
 return pending?<ApprovalPrompt key={pending.id} pending={pending}/>:null;
}
