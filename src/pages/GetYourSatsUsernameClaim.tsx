import {useEffect,useState} from 'react';
import {useWallet} from '../contexts/WalletContext';
import {selectedNetwork} from '../services/sdkConnect';

interface Reply{error?:string}
interface Challenge{challengeId:string;message:string}
interface Claimed{claimed:boolean;username:string|null;lightningAddress:string|null;sourceAddress?:string|null}
async function post<T>(body:Record<string,unknown>):Promise<T>{
 const response=await fetch('/api/account/handle',{method:'POST',headers:{'Content-Type':'application/json'},
   body:JSON.stringify(body),cache:'no-store',credentials:'omit'});
 const result=await response.json() as Reply;
 if(!response.ok)throw new Error(result.error||'Lightning username service unavailable');
 return result as T;
}

export default function GetYourSatsUsernameClaim(){
 const sdk=useWallet();
 const [available,setAvailable]=useState(false);
 const [loading,setLoading]=useState(true);
 const [username,setUsername]=useState('');
 const [claimed,setClaimed]=useState<Claimed|null>(null);
 const [message,setMessage]=useState('');
 const [busy,setBusy]=useState(false);

 useEffect(()=>{
   let live=true;
   void fetch('/api/account/handle',{cache:'no-store'})
     .then(r=>r.json() as Promise<{available:boolean;domain:string}>)
     .then(r=>{if(live)setAvailable(r.available===true&&r.domain==='getyoursats.com')})
     .catch(()=>{if(live)setAvailable(false)})
     .finally(()=>{if(live)setLoading(false)});
   return()=>{live=false};
 },[]);

 async function sign(purpose:'status'|'claim',name='',address=''){
   if(selectedNetwork()!=='mainnet')throw new Error('Lightning username claims require mainnet');
   const info=await sdk.getInfo({ensureSynced:false});
   const pub=info.identityPubkey;
   if(!pub)throw new Error('Wallet identity not available');
   const challenge=await post<Challenge>({action:'challenge',purpose,walletPubkey:pub,
     ...(purpose==='claim'?{username:name,sourceAddress:address}:{})});
   const proof=await sdk.signMessage({message:challenge.message,compact:true});
   if(proof.pubkey.toLowerCase()!==pub.toLowerCase())throw new Error('Wallet identity changed');
   return {challengeId:challenge.challengeId,signature:proof.signature};
 }
 async function check(){
   setBusy(true);setMessage('');
   try{
     const proof=await sign('status');
     setClaimed(await post<Claimed>({action:'status',...proof}));
   }catch(e){setMessage(e instanceof Error?e.message:'Cannot check claim');}
   finally{setBusy(false);}
 }
 async function claim(){
   if(busy)return;
   setBusy(true);setMessage('');
   try{
     const name=username.trim().toLowerCase();
     if(!/^[a-z][a-z0-9]{2,23}$/.test(name))throw new Error('Enter 3–24 lowercase letters and numbers, starting with a letter');
     // Source comes directly from this connected wallet's SDK. Never let a user
     // type an arbitrary third-party payout address in the claim UI.
     const addressInfo=await sdk.getLightningAddress();
     const source=addressInfo?.lightningAddress;
     if(!source||!source.toLowerCase().endsWith('@breez.tips'))
       throw new Error('Open Receive first to activate your anonymous Lightning Address');
     const proof=await sign('claim',name,source);
     const result=await post<Claimed>({action:'claim',...proof});
     setClaimed(result);
     // Claim storage alone does not prove that the root LNURL endpoint works.
     const verify=await fetch('https://getyoursats.com/.well-known/lnurlp/'+encodeURIComponent(name),
       {cache:'no-store'});
     const lookup=await verify.json() as {tag?:string};
     setMessage(verify.ok&&lookup.tag==='payRequest'
       ? 'Address resolves. Confirm with a small external payment before sharing.'
       : 'Username reserved but network resolution is not ready. Do not share it yet.');
   }catch(e){setMessage(e instanceof Error?e.message:'Unable to claim username');}
   finally{setBusy(false);}
 }
 return <section aria-label="Your Lightning username" className="bg-spark-dark border border-spark-border rounded-2xl p-5 space-y-3">
   <h2 className="font-display text-xl font-semibold text-spark-text-primary">Choose your Lightning name</h2>
   <p className="text-sm text-spark-text-secondary">
     Keep your anonymous Breez address and claim a memorable GetYourSats name after verifying email.
     No payment, transaction count or activity threshold is required.
   </p>
   {loading?<p role="status" className="text-sm text-spark-text-muted">Checking availability…</p>
    :!available?<p role="status" className="text-sm text-spark-text-muted">
       Custom usernames are not active yet. Domain and verified-email services must be enabled first.
     </p>
    :claimed?.claimed?<div className="rounded-xl border border-spark-border bg-spark-surface p-3 space-y-1">
       <p className="text-xs text-spark-text-muted">Reserved GetYourSats name</p>
       <strong className="break-all">{claimed.lightningAddress}</strong>
       <p className="text-xs text-spark-text-muted">Payments forward to your existing Lightning wallet.</p>
     </div>
    :<>
       <label className="block text-sm text-spark-text-secondary" htmlFor="gys-claim-name">Username</label>
       <div className="flex items-center rounded-xl bg-spark-surface border border-spark-border overflow-hidden">
         <input id="gys-claim-name" className="flex-1 min-w-0 p-3 bg-transparent outline-none"
           value={username} disabled={busy} maxLength={24} autoComplete="off"
           autoCapitalize="none" spellCheck={false} placeholder="yourname"
           onChange={e=>setUsername(e.target.value.toLowerCase().replace(/[^a-z0-9]/g,''))}/>
         <span className="text-xs shrink-0 text-spark-text-muted pr-3">@getyoursats.com</span>
       </div>
       <button type="button" className="w-full rounded-xl bg-spark-primary text-spark-dark p-3 font-semibold"
         disabled={busy||!username} onClick={()=>void claim()}>
         {busy?'Verifying wallet…':'Claim username'}
       </button>
     </>}
   {available&&<button type="button" className="text-sm underline text-spark-primary" disabled={busy}
      onClick={()=>void check()}>Check existing username</button>}
   {!!message&&<p role="status" className="text-xs text-spark-text-secondary">{message}</p>}
   <p className="text-xs text-spark-text-muted">Email identifies your account; it cannot restore Bitcoin without your wallet recovery keys.</p>
 </section>;
}
