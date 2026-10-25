import {useEffect,useRef,useState,type FormEvent} from 'react';
import {usePresentation} from '../hooks/usePresentation';
import {lockSpendingSession} from './spendApproval';
type Props={onSubmit:(mnemonic:string,password:string)=>Promise<void>;onBack:()=>void;busy:boolean};
const copy={
 en:{title:'Recover your protected wallet',body:'Enter the original recovery words for this same wallet. If they match, you can choose a new password without changing your balance or identity.',words:'Recovery words',password:'New wallet password',again:'Confirm new password',action:'Restore protection',back:'Back',error:'Use 12 or 24 recovery words and a password of at least 12 characters.'},
 hi:{title:'सुरक्षित वॉलेट पुनः प्राप्त करें',body:'इसी वॉलेट के मूल रिकवरी शब्द दर्ज करें। मिलान होने पर नया पासवर्ड बना सकते हैं।',words:'रिकवरी शब्द',password:'नया पासवर्ड',again:'पासवर्ड दोबारा',action:'सुरक्षा पुनः स्थापित करें',back:'वापस',error:'12 या 24 शब्द और कम से कम 12 अक्षरों का पासवर्ड दर्ज करें।'},
 es:{title:'Recuperar cartera protegida',body:'Introduce las palabras originales de esta misma cartera. Si coinciden, podrás cambiar la contraseña sin cambiar el saldo.',words:'Frase de recuperación',password:'Nueva contraseña',again:'Confirma la contraseña',action:'Restaurar protección',back:'Volver',error:'Usa 12 o 24 palabras y una contraseña de al menos 12 caracteres.'},
 pt:{title:'Recuperar carteira protegida',body:'Introduza as palavras originais desta carteira. Se corresponderem, pode definir outra palavra-passe sem alterar o saldo.',words:'Frase de recuperação',password:'Nova palavra-passe',again:'Confirme a palavra-passe',action:'Restaurar proteção',back:'Voltar',error:'Use 12 ou 24 palavras e uma palavra-passe de pelo menos 12 caracteres.'}
} as const;
const recoveryHelp={
 en:{title:'If this browser cannot verify your original wallet',keep:'Keep this browser profile and its wallet data. Do not remove the wallet or clear site data.',restore:'Open wallet.getyoursats.com on another trusted device or in a separate browser profile. Choose Restore and enter the original recovery words there.',verify:'Check the restored wallet identity, balance and payment history before making changes to the original browser.',privacy:'Your recovery words stay on your device. Never send them to support. Restoring cannot recover words that you no longer have.'},
 hi:{title:'यदि यह ब्राउज़र आपके मूल वॉलेट की पहचान सत्यापित नहीं कर सकता',keep:'इस ब्राउज़र प्रोफ़ाइल और वॉलेट डेटा को सुरक्षित रखें। वॉलेट न हटाएँ और साइट डेटा साफ़ न करें।',restore:'किसी अन्य भरोसेमंद डिवाइस या अलग ब्राउज़र प्रोफ़ाइल में wallet.getyoursats.com खोलें। Restore चुनें और वहाँ मूल रिकवरी शब्द दर्ज करें।',verify:'मूल ब्राउज़र में बदलाव करने से पहले पुनर्स्थापित वॉलेट की पहचान, बैलेंस और भुगतान इतिहास जाँचें।',privacy:'रिकवरी शब्द आपके डिवाइस पर रहते हैं। उन्हें सहायता टीम को कभी न भेजें। खोए हुए रिकवरी शब्द पुनर्स्थापन से वापस नहीं मिल सकते।'},
 es:{title:'Si este navegador no puede verificar tu cartera original',keep:'Conserva este perfil del navegador y los datos de la cartera. No elimines la cartera ni borres los datos del sitio.',restore:'Abre wallet.getyoursats.com en otro dispositivo de confianza o en un perfil de navegador independiente. Elige Restaurar e introduce allí las palabras de recuperación originales.',verify:'Comprueba la identidad, el saldo y el historial de pagos de la cartera restaurada antes de modificar el navegador original.',privacy:'Las palabras de recuperación permanecen en tu dispositivo. Nunca las envíes a soporte. La restauración no permite recuperar palabras que has perdido.'},
 pt:{title:'Se este navegador não conseguir verificar a carteira original',keep:'Mantenha este perfil do navegador e os dados da carteira. Não remova a carteira nem limpe os dados do site.',restore:'Abra wallet.getyoursats.com noutro dispositivo de confiança ou num perfil de navegador separado. Escolha Restaurar e introduza as palavras de recuperação originais.',verify:'Verifique a identidade, o saldo e o histórico de pagamentos da carteira restaurada antes de alterar o navegador original.',privacy:'As palavras de recuperação ficam no seu dispositivo. Nunca as envie ao suporte. O restauro não recupera palavras que já perdeu.'},
} as const;
export default function WebVaultRecoveryPage({onSubmit,onBack,busy}:Props){
 const {language}=usePresentation(),c=copy[language]??copy.en,help=recoveryHelp[language]??recoveryHelp.en;
 const [words,setWords]=useState(''),[password,setPassword]=useState(''),[confirm,setConfirm]=useState(''),[error,setError]=useState('');
 const inFlight=useRef(false);
 const [submitting,setSubmitting]=useState(false);
 useEffect(()=>{
  const clear=()=>{setWords('');setPassword('');setConfirm('');lockSpendingSession('Recovery screen backgrounded');};
  const visibility=()=>{if(document.visibilityState==='hidden')clear();};
  document.addEventListener('visibilitychange',visibility);window.addEventListener('pagehide',clear);
  return()=>{document.removeEventListener('visibilitychange',visibility);window.removeEventListener('pagehide',clear);};
 },[]);
 async function submit(e:FormEvent){e.preventDefault();if(inFlight.current||busy)return;setError('');
  const phrase=words.toLowerCase().trim().replace(/\s+/g,' ');
  if(![12,24].includes(phrase.split(' ').length)||password.length<12||password.length>256||password!==confirm){setError(c.error);return;}
  inFlight.current=true;setSubmitting(true);
  try{await onSubmit(phrase,password);setWords('');setPassword('');setConfirm('');}
  catch(err){setError(err instanceof Error?err.message:c.error);}
  finally{inFlight.current=false;setSubmitting(false);}
 }
 return <main className="min-h-dvh flex items-center justify-center bg-spark-dark px-4 py-8">
  <section className="w-full max-w-md rounded-2xl border border-spark-border bg-spark-surface p-6 space-y-4 text-spark-text-primary">
   <h1 className="text-xl font-bold">{c.title}</h1><p className="text-sm text-spark-text-secondary">{c.body}</p>
   <form onSubmit={e=>void submit(e)} className="space-y-4">
    <label className="block text-sm space-y-1"><span>{c.words}</span><textarea autoComplete="off" spellCheck={false} rows={3} required value={words} onChange={e=>setWords(e.target.value)} className="w-full rounded-xl border border-spark-border bg-spark-dark p-3"/></label>
    <label className="block text-sm space-y-1"><span>{c.password}</span><input type="password" autoComplete="new-password" required minLength={12} value={password} onChange={e=>setPassword(e.target.value)} className="w-full rounded-xl border border-spark-border bg-spark-dark p-3"/></label>
    <label className="block text-sm space-y-1"><span>{c.again}</span><input type="password" autoComplete="new-password" required minLength={12} value={confirm} onChange={e=>setConfirm(e.target.value)} className="w-full rounded-xl border border-spark-border bg-spark-dark p-3"/></label>
    {error&&<p role="alert" className="text-sm text-spark-warning">{error}</p>}
    <button disabled={busy||submitting} className="w-full min-h-12 rounded-xl bg-[#F7931A] font-bold text-black disabled:opacity-40">{busy||submitting?'Checking…':c.action}</button>
   </form>
   <details className="text-sm text-spark-text-secondary space-y-2">
    <summary className="cursor-pointer min-h-11 py-2">{help.title}</summary>
    <ol className="list-decimal pl-5 space-y-2">
     <li>{help.keep}</li>
     <li>{help.restore}</li>
     <li>{help.verify}</li>
    </ol>
    <p>{help.privacy}</p>
   </details>
   <button onClick={()=>{if(inFlight.current)lockSpendingSession('Recovery cancelled');setWords('');setPassword('');setConfirm('');onBack();}} className="min-h-10 text-sm text-spark-text-secondary">{c.back}</button>
  </section>
 </main>;
}
