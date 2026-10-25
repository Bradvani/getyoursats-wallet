import {useState,type FormEvent} from 'react';
import {usePresentation} from '../hooks/usePresentation';
type Props={onSubmit:(mnemonic:string,password:string)=>Promise<void>;onBack:()=>void;busy:boolean};
const copy={
 en:{title:'Recover your protected wallet',body:'Enter the original recovery words for this same wallet. If they match, you can choose a new password without changing your balance or identity.',words:'Recovery words',password:'New wallet password',again:'Confirm new password',action:'Restore protection',back:'Back',error:'Use 12 or 24 recovery words and a password of at least 12 characters.'},
 hi:{title:'सुरक्षित वॉलेट पुनः प्राप्त करें',body:'इसी वॉलेट के मूल रिकवरी शब्द दर्ज करें। मिलान होने पर नया पासवर्ड बना सकते हैं।',words:'रिकवरी शब्द',password:'नया पासवर्ड',again:'पासवर्ड दोबारा',action:'सुरक्षा पुनः स्थापित करें',back:'वापस',error:'12 या 24 शब्द और कम से कम 12 अक्षरों का पासवर्ड दर्ज करें।'},
 es:{title:'Recuperar cartera protegida',body:'Introduce las palabras originales de esta misma cartera. Si coinciden, podrás cambiar la contraseña sin cambiar el saldo.',words:'Frase de recuperación',password:'Nueva contraseña',again:'Confirma la contraseña',action:'Restaurar protección',back:'Volver',error:'Usa 12 o 24 palabras y una contraseña de al menos 12 caracteres.'},
 pt:{title:'Recuperar carteira protegida',body:'Introduza as palavras originais desta carteira. Se corresponderem, pode definir outra palavra-passe sem alterar o saldo.',words:'Frase de recuperação',password:'Nova palavra-passe',again:'Confirme a palavra-passe',action:'Restaurar proteção',back:'Voltar',error:'Use 12 ou 24 palavras e uma palavra-passe de pelo menos 12 caracteres.'}
} as const;
export default function WebVaultRecoveryPage({onSubmit,onBack,busy}:Props){
 const {language}=usePresentation(),c=copy[language]??copy.en;
 const [words,setWords]=useState(''),[password,setPassword]=useState(''),[confirm,setConfirm]=useState(''),[error,setError]=useState('');
 async function submit(e:FormEvent){e.preventDefault();setError('');
  const phrase=words.toLowerCase().trim().replace(/\s+/g,' ');
  if(![12,24].includes(phrase.split(' ').length)||password.length<12||password!==confirm){setError(c.error);return;}
  try{await onSubmit(phrase,password);}catch(err){setError(err instanceof Error?err.message:c.error);}
 }
 return <main className="min-h-dvh flex items-center justify-center bg-spark-dark px-4 py-8">
  <section className="w-full max-w-md rounded-2xl border border-spark-border bg-spark-surface p-6 space-y-4 text-spark-text-primary">
   <h1 className="text-xl font-bold">{c.title}</h1><p className="text-sm text-spark-text-secondary">{c.body}</p>
   <form onSubmit={e=>void submit(e)} className="space-y-4">
    <label className="block text-sm space-y-1"><span>{c.words}</span><textarea autoComplete="off" spellCheck={false} rows={3} required value={words} onChange={e=>setWords(e.target.value)} className="w-full rounded-xl border border-spark-border bg-spark-dark p-3"/></label>
    <label className="block text-sm space-y-1"><span>{c.password}</span><input type="password" autoComplete="new-password" required minLength={12} value={password} onChange={e=>setPassword(e.target.value)} className="w-full rounded-xl border border-spark-border bg-spark-dark p-3"/></label>
    <label className="block text-sm space-y-1"><span>{c.again}</span><input type="password" autoComplete="new-password" required minLength={12} value={confirm} onChange={e=>setConfirm(e.target.value)} className="w-full rounded-xl border border-spark-border bg-spark-dark p-3"/></label>
    {error&&<p role="alert" className="text-sm text-spark-warning">{error}</p>}
    <button disabled={busy} className="w-full min-h-12 rounded-xl bg-[#F7931A] font-bold text-black disabled:opacity-40">{busy?'Checking…':c.action}</button>
   </form>
   <button onClick={onBack} className="min-h-10 text-sm text-spark-text-secondary">{c.back}</button>
  </section>
 </main>;
}
