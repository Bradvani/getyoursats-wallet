import {useEffect,useRef,useState} from 'react';
import {useFlowText} from '../hooks/useFlowText';
import {walletProtectionErrorMessage} from '../utils/passkeyUnlockFeedback';
export default function LinkedPasskeyBackupRestore({onRestore}:{onRestore:(text:string,signal:AbortSignal,password?:string)=>Promise<void>}){
  const t=useFlowText(),[file,setFile]=useState<File|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState('');
  const [password,setPassword]=useState(''),[passwordMode,setPasswordMode]=useState(false);
  const abort=useRef<AbortController|null>(null),mounted=useRef(true),inFlight=useRef(false);
  useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;abort.current?.abort();};},[]);
  async function restore(){
    if(!file||inFlight.current)return;inFlight.current=true;setBusy(true);setError('');abort.current=new AbortController();
    try{
      if(file.size>32_768)throw new Error('Recovery file is too large.');
      const content=await file.text();abort.current.signal.throwIfAborted();await onRestore(content,abort.current.signal,passwordMode?password:undefined);
    }catch(err){if(mounted.current)setError(walletProtectionErrorMessage(err));}
    finally{inFlight.current=false;if(mounted.current){setBusy(false);setPassword('');}}
  }
  return <details className="rounded-2xl border border-spark-border bg-spark-dark p-5 space-y-3">
    <summary className="cursor-pointer min-h-10 font-semibold text-spark-text-primary">{t('Restore an encrypted recovery file')}</summary>
    <p className="text-sm text-spark-text-secondary">{t('For a wallet protected after importing recovery words, choose its encrypted file and verify the linked passkey. Existing wallets on this browser are never replaced.')}</p>
    <label className="block text-sm text-spark-text-secondary">{t('Encrypted recovery file')}<input type="file" accept="application/json,.json" disabled={busy} onChange={e=>setFile(e.target.files?.[0]??null)} className="mt-2 block w-full"/></label>
    <label className="flex gap-3 text-sm text-spark-text-secondary"><input type="checkbox" checked={passwordMode} disabled={busy} onChange={e=>setPasswordMode(e.target.checked)}/>{t('Use my wallet password instead')}</label>
    {passwordMode&&<label className="block text-sm text-spark-text-secondary">{t('Wallet password')}<input type="password" value={password} disabled={busy} onChange={e=>setPassword(e.target.value)} autoComplete="current-password" className="mt-2 block w-full rounded-xl border border-spark-border bg-spark-surface p-3"/></label>}
    {busy?<button type="button" onClick={()=>abort.current?.abort()} className="min-h-12 w-full rounded-xl border border-spark-border text-spark-text-secondary">{t('Cancel')}</button>
    :<button type="button" disabled={!file||(passwordMode&&!password)} onClick={()=>void restore()} className="min-h-12 w-full rounded-xl bg-spark-primary px-3 text-spark-dark font-semibold disabled:opacity-40">{passwordMode?t('Restore with file and password'):t('Restore with file and passkey')}</button>}
    {error&&<p role="alert" className="text-sm text-spark-warning">{error}</p>}
  </details>;
}
