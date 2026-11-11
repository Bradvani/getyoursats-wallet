import {useEffect,useRef,useState} from 'react';
import {useFlowText} from '../hooks/useFlowText';
import {beginWebPasskeyEnrollment,hasLinkedWebPasskey,removeWebPasskeyProtection,exportWebPasskeyBackup,type PendingWebPasskeyEnrollment} from './webWalletVault';
import {walletProtectionErrorMessage} from '../utils/passkeyUnlockFeedback';

/** An alternate local unlock method, never a wallet switch or funds migration. */
export default function WalletPasskeyProtection(){
  const t=useFlowText();
  const [linked,setLinked]=useState(hasLinkedWebPasskey);
  const [mode,setMode]=useState<'idle'|'add'|'verify'|'remove'>('idle');
  const [password,setPassword]=useState(''),[savedWords,setSavedWords]=useState(false);
  const [busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState('');
  const pending=useRef<PendingWebPasskeyEnrollment|null>(null);
  const abort=useRef<AbortController|null>(null),mounted=useRef(true),inFlight=useRef(false);
  useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;abort.current?.abort();pending.current?.cancel();};},[]);
  const close=()=>{abort.current?.abort();pending.current?.cancel();pending.current=null;setPassword('');setSavedWords(false);setMode('idle');setError('');};
  async function submit(){
    if(inFlight.current)return;
    inFlight.current=true;setBusy(true);setError('');setNotice('');
    try{
      if(mode==='add'){
        if(!savedWords)throw new Error(t('Keep your recovery words offline before adding a passkey.'));
        abort.current=new AbortController();
        const prepared=await beginWebPasskeyEnrollment(password,abort.current.signal);
        if(!mounted.current){prepared.cancel();return;}
        pending.current=prepared;setPassword('');setMode('verify');
      }else if(mode==='verify'){
        if(!pending.current)throw new Error(t('Start passkey setup again.'));
        await pending.current.verify();pending.current=null;
        if(mounted.current){setLinked(true);setMode('idle');setNotice(t('Passkey protection added. Your wallet is unchanged.'));}
      }else if(mode==='remove'){
        await removeWebPasskeyProtection(password);
        if(mounted.current){setLinked(false);setMode('idle');setPassword('');}
      }
    }catch(err){
      if(mounted.current){setError(walletProtectionErrorMessage(err));if(mode==='verify'){pending.current?.cancel();pending.current=null;setMode('add');}}
    }finally{inFlight.current=false;if(mounted.current){setBusy(false);setPassword('');}}
  }
  async function backup(){
    if(inFlight.current)return;
    inFlight.current=true;setBusy(true);setError('');
    try{
      const text=await exportWebPasskeyBackup();
      if(!mounted.current)return;
      const url=URL.createObjectURL(new Blob([text],{type:'application/json'}));
      const link=document.createElement('a');link.href=url;link.download='getyoursats-encrypted-recovery.json';link.click();
      setTimeout(()=>URL.revokeObjectURL(url),30_000);
      setNotice(t('Keep this encrypted file with your offline backups.'));
    }catch(err){if(mounted.current)setError(err instanceof Error?err.message:t('Could not export encrypted recovery.'));}
    finally{inFlight.current=false;if(mounted.current)setBusy(false);}
  }
  return <section className="rounded-2xl border border-spark-border bg-spark-dark p-5 space-y-4" aria-label={t('Wallet protection')}>
    <div><h3 className="font-display font-semibold text-spark-text-primary">{t('Wallet protection')}</h3>
      <p className="mt-2 text-sm leading-relaxed text-spark-text-secondary">{t('Your wallet password and original recovery words remain valid. Adding a passkey does not move funds or create another wallet.')}</p></div>
    <p className="text-sm font-medium text-spark-text-primary">{linked?t('Passkey protection is linked on this browser.'):t('Add a passkey to unlock this same wallet.')}</p>
    {mode==='idle'?<div className="space-y-2">
      {linked?<><button type="button" disabled={busy} onClick={()=>void backup()} className="w-full min-h-12 rounded-xl bg-spark-primary px-4 text-spark-dark font-semibold">{t('Save encrypted recovery file')}</button>
        <button type="button" disabled={busy} onClick={()=>{setError('');setMode('remove');}} className="w-full min-h-11 rounded-xl border border-spark-border px-4 text-spark-text-secondary">{t('Remove passkey access on this browser')}</button></>
        :<button type="button" onClick={()=>{setError('');setMode('add');}} className="w-full min-h-12 rounded-xl bg-spark-primary px-4 text-spark-dark font-semibold">{t('Add passkey protection')}</button>}
    </div>:<form className="space-y-3" onSubmit={e=>{e.preventDefault();void submit();}}>
      {mode==='verify'?<p className="text-sm text-spark-text-secondary">{t('Verify the new passkey before it can unlock your wallet. Nothing has changed yet.')}</p>
      :<label className="block text-sm text-spark-text-primary">{t('Wallet password')}<input type="password" autoComplete="current-password" autoCapitalize="none" spellCheck={false} required disabled={busy} value={password} onChange={e=>setPassword(e.target.value)} className="mt-2 w-full rounded-xl border border-spark-border bg-spark-surface p-3"/></label>}
      {mode==='add'&&<label className="flex gap-3 text-sm text-spark-text-secondary"><input type="checkbox" checked={savedWords} onChange={e=>setSavedWords(e.target.checked)} disabled={busy}/>{t('I have saved my recovery words offline.')}</label>}
      {mode==='remove'&&<p className="text-sm text-spark-text-secondary">{t('This removes access here only. It does not delete the passkey from your password manager or invalidate older backup files.')}</p>}
      <div className="grid grid-cols-2 gap-3"><button type="button" onClick={close} className="min-h-12 rounded-xl border border-spark-border text-spark-text-secondary">{t('Cancel')}</button>
        <button type="submit" disabled={busy||(mode==='add'&&!savedWords)} className="min-h-12 rounded-xl bg-spark-primary px-3 text-spark-dark font-semibold disabled:opacity-40">{busy?t('Checking…'):mode==='verify'?t('Verify and finish'):mode==='remove'?t('Remove local access'):t('Create protection passkey')}</button></div>
    </form>}
    {error&&<p role="alert" className="text-sm text-spark-warning">{error}</p>}
    {notice&&<p role="status" className="text-sm text-spark-text-secondary">{notice}</p>}
    <details className="border-t border-spark-border pt-3 text-sm text-spark-text-secondary"><summary className="cursor-pointer min-h-10">{t('Recovery on another device')}</summary>
      <p className="mt-2 leading-relaxed">{t('A synced passkey alone cannot recover this imported wallet. Use its encrypted recovery file with the same passkey on this website, or restore your original recovery words.')}</p>
      <p className="mt-2 leading-relaxed">{t('Passkeys provide another unlock method, not hardware-isolated Bitcoin signing. Your wallet password remains an alternative.')}</p>
    </details>
  </section>;
}
