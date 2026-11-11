import {useState,useEffect} from 'react';
import {createRoot} from 'react-dom/client';
import {generateMnemonic} from 'bip39';
import WalletPasskeyProtection from '../../src/security/WalletPasskeyProtection';
import LinkedPasskeyBackupRestore from '../../src/security/LinkedPasskeyBackupRestore';
import {hasWebWalletVault,enrollWebWallet,unlockWebWallet,unlockWebWalletWithPasskey,hasLinkedWebPasskey,restoreWebPasskeyBackup,restoreWebPasswordBackup,clearUnlockedWebMnemonic} from '../../src/security/webWalletVault';
import {rememberSignerIdentity,lockSpendingSession} from '../../src/security/spendApproval';
import {useBrowserSessionLock} from '../../src/security/useBrowserSessionLock';
import {walletProtectionErrorMessage} from '../../src/utils/passkeyUnlockFeedback';
import {sha} from '../../src/security/linkedPasskeyProtocol';
import '../../src/index.css';
import './style.css';
declare const __PROTECTION_REVISION__:string;
export function Lab(){
 const [exists,setExists]=useState(hasWebWalletVault),[active,setActive]=useState(false),[password,setPassword]=useState('');
 const [accepted,setAccepted]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState(''),[fingerprint,setFingerprint]=useState(''),[words,setWords]=useState('');
 const session=useBrowserSessionLock(active);
 useEffect(()=>{const hide=()=>{if(document.visibilityState==='hidden')setWords('');};document.addEventListener('visibilitychange',hide);return()=>document.removeEventListener('visibilitychange',hide);},[]);
 async function identify(mnemonic:string){await rememberSignerIdentity({type:'mnemonic',mnemonic});setFingerprint((await sha(mnemonic)).slice(0,16));setExists(true);setActive(true);setPassword('');}
 async function create(){if(busy||!accepted||password.length<12)return;setBusy(true);setError('');try{const seed=generateMnemonic(128);await enrollWebWallet(seed,password);await identify(seed);setWords(seed);}catch(e){setError(walletProtectionErrorMessage(e));}finally{setBusy(false);setPassword('');}}
 async function unlock(linked=false){if(busy)return;setBusy(true);setError('');try{
  if(active){if(linked)await session.unlockWithLinkedPasskey();else await session.unlock(password);}
  else await identify(linked?await unlockWebWalletWithPasskey():await unlockWebWallet(password));
 }catch(e){setError(walletProtectionErrorMessage(e));}finally{setBusy(false);setPassword('');}}
 async function restore(text:string,signal:AbortSignal,pass?:string){const seed=pass===undefined?await restoreWebPasskeyBackup(text,signal):await restoreWebPasswordBackup(text,pass,signal);await identify(seed);}
 const locked=active&&session.locked;
 return <main className="lab-shell">
  <header><p className="lab-brand">getyour<span>sats</span></p><h1>Same wallet. Another way to unlock.</h1>
   <p className="lab-warning">PROTECTION TEST ONLY · NO PAYMENTS · NO REAL FUNDS</p>
   <p>This isolated page uses the candidate’s actual protection components. It never connects a wallet SDK, payment service or blockchain. Do not enter a production recovery phrase.</p>
   <p className="lab-build">Build {__PROTECTION_REVISION__} · fingerprint is a test identifier, not a Bitcoin address.</p>
  </header>
  {!exists?<section className="lab-card">
   <h2>Create a disposable test wallet</h2><label>New test password, at least 12 characters<input type="password" autoComplete="new-password" value={password} onChange={e=>setPassword(e.target.value)} disabled={busy}/></label>
   <label className="lab-check"><input type="checkbox" checked={accepted} onChange={e=>setAccepted(e.target.checked)}/>I will not use this test wallet for funds.</label>
   <button disabled={busy||!accepted||password.length<12} onClick={()=>void create()}>Create disposable wallet</button>
   <LinkedPasskeyBackupRestore onRestore={restore}/>
  </section>:!active||locked?<section className="lab-card"><h2>Test wallet locked</h2>
   <label>Wallet password<input type="password" autoComplete="current-password" value={password} onChange={e=>setPassword(e.target.value)} disabled={busy}/></label>
   <button disabled={busy||!password} onClick={()=>void unlock()}>Unlock with password</button>
   {hasLinkedWebPasskey()&&<button disabled={busy} onClick={()=>void unlock(true)}>Unlock with linked passkey</button>}
  </section>:<><section className="lab-card"><h2>Your test wallet</h2><p>Fingerprint: <strong>{fingerprint}</strong></p>
   <p>Record this identifier. It must stay the same after adding protection, closing and reopening, or restoring the encrypted file on a clean device.</p>
   {words&&<details><summary>Show disposable recovery words privately</summary><p className="lab-secret">{words}</p><button onClick={()=>setWords('')}>Hide and clear words from this page</button></details>}
   <button onClick={()=>{setWords('');clearUnlockedWebMnemonic();lockSpendingSession('Owner test lock');}}>Lock test wallet</button>
  </section><WalletPasskeyProtection/></>}
  {error&&<p role="alert" className="lab-error">{error}</p>}
  <footer>Use this exact test URL on both devices. A passkey alone is not a backup of imported wallet data. Keep the encrypted recovery file and your offline words private. This page cannot certify funded-wallet history, pending-payment recovery, hardware isolation or final Gate 1 approval.</footer>
 </main>;
}
createRoot(document.getElementById('root')!).render(<Lab/>);
