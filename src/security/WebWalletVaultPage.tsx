import {useState,type FormEvent} from 'react';
import {usePresentation} from '../hooks/usePresentation';
type Props={mode:'enroll'|'unlock';isLoading:boolean;onSubmit:(password:string)=>Promise<void>;error?:string|null;onBack?:()=>void;onRecover?:()=>void;legacy?:boolean;passkey?:boolean};
const copy={
 en:{title:'Protect your wallet',unlock:'Unlock your wallet',body:'Create a password to encrypt your existing recovery phrase on this device. Your Bitcoin wallet and recovery words will not change.',return:'Enter the password you created for this wallet on this browser.',password:'Wallet password',again:'Confirm password',submit:'Encrypt and continue',open:'Unlock wallet',minimum:'Use at least 12 characters.',mismatch:'Passwords do not match.',help:'If you forget this password, you can restore the same wallet using your recovery phrase. Never store the phrase in screenshots or messages.',back:'Back',forgot:'Recover with recovery words'},
 hi:{title:'वॉलेट सुरक्षित करें',unlock:'वॉलेट अनलॉक करें',body:'इस डिवाइस पर रिकवरी शब्दों को एन्क्रिप्ट करने के लिए पासवर्ड बनाएँ। आपका वॉलेट और रिकवरी शब्द नहीं बदलेंगे।',return:'इस ब्राउज़र के वॉलेट का पासवर्ड दर्ज करें।',password:'वॉलेट पासवर्ड',again:'पासवर्ड की पुष्टि करें',submit:'सुरक्षित करके आगे बढ़ें',open:'वॉलेट खोलें',minimum:'कम से कम 12 अक्षर लिखें।',mismatch:'पासवर्ड मेल नहीं खाते।',help:'पासवर्ड भूलने पर अपने रिकवरी शब्दों से इसी वॉलेट को पुनः प्राप्त करें। रिकवरी शब्द किसी को न भेजें।',back:'वापस',forgot:'रिकवरी शब्दों से पुनर्स्थापित करें'},
 es:{title:'Protege tu cartera',unlock:'Desbloquear cartera',body:'Crea una contraseña para cifrar la frase de recuperación en este dispositivo. La cartera y la frase seguirán siendo las mismas.',return:'Introduce la contraseña de esta cartera en este navegador.',password:'Contraseña de la cartera',again:'Confirmar contraseña',submit:'Cifrar y continuar',open:'Desbloquear',minimum:'Usa al menos 12 caracteres.',mismatch:'Las contraseñas no coinciden.',help:'Si olvidas la contraseña, recupera esta cartera con la frase original. Nunca compartas la frase.',back:'Volver',forgot:'Recuperar con la frase original'},
 pt:{title:'Proteja a sua carteira',unlock:'Desbloquear carteira',body:'Crie uma palavra-passe para cifrar a frase de recuperação neste dispositivo. A carteira e as palavras de recuperação não mudam.',return:'Introduza a palavra-passe desta carteira neste navegador.',password:'Palavra-passe da carteira',again:'Confirmar palavra-passe',submit:'Cifrar e continuar',open:'Desbloquear',minimum:'Use pelo menos 12 caracteres.',mismatch:'As palavras-passe não coincidem.',help:'Se esquecer a palavra-passe, recupere a carteira com a frase original. Nunca partilhe a frase.',back:'Voltar',forgot:'Recuperar com a frase original'},
} as const;
export default function WebWalletVaultPage({mode,isLoading,onSubmit,error,onBack,onRecover,passkey=false}:Props){
 const {language}=usePresentation();const c=copy[language as keyof typeof copy]??copy.en;
 const [password,setPassword]=useState('');const [confirm,setConfirm]=useState('');const [localError,setLocalError]=useState('');
 const [submitting,setSubmitting]=useState(false);
 const enroll=mode==='enroll';
 async function submit(e:FormEvent){e.preventDefault();if(submitting)return;setLocalError('');
  if(enroll&&password.length<12){setLocalError(c.minimum);return;}
  if(enroll&&password!==confirm){setLocalError(c.mismatch);return;}
  setSubmitting(true);
  try{await onSubmit(password);setPassword('');setConfirm('');}
  catch(err){setLocalError(err instanceof Error?err.message:'Could not unlock wallet');}
  finally{setSubmitting(false);}
 }
 return <main className="min-h-dvh w-full flex items-center justify-center px-4 py-8 bg-spark-dark text-spark-text-primary">
  <section className="w-full max-w-md space-y-5 rounded-2xl border border-spark-border bg-spark-surface p-6">
   <img src="/brand/wordmark-stacked-dark.svg" alt="GetYourSats" className="w-36 h-auto" />
   <h1 className="font-display text-2xl font-bold">{enroll?c.title:c.unlock}</h1>
   <p className="text-sm leading-relaxed text-spark-text-secondary">{passkey?'Use the passkey for this wallet to continue.':enroll?c.body:c.return}</p>
   <form onSubmit={e=>void submit(e)} className="space-y-4">
    {!passkey&&<label className="block space-y-2 text-sm">
     <span>{c.password}</span>
     <input type="password" autoComplete={enroll?'new-password':'current-password'} autoCapitalize="none"
      spellCheck={false} value={password} onChange={e=>setPassword(e.target.value)}
      className="block w-full rounded-xl border border-spark-border bg-spark-dark p-3"
      minLength={enroll?12:1} required disabled={isLoading}/>
    </label>}
    {enroll&&<label className="block space-y-2 text-sm">
      <span>{c.again}</span>
      <input type="password" autoComplete="new-password" value={confirm} onChange={e=>setConfirm(e.target.value)}
       className="block w-full rounded-xl border border-spark-border bg-spark-dark p-3"
       minLength={12} required disabled={isLoading}/>
    </label>}
    {(localError||error)&&<p role="alert" className="text-sm text-spark-warning">{localError||error}</p>}
    <button type="submit" disabled={isLoading||submitting} className="w-full rounded-xl min-h-12 bg-[#F7931A] font-bold text-black disabled:opacity-40">
      {isLoading||submitting?'Checking…':passkey?'Unlock with passkey':enroll?c.submit:c.open}
    </button>
   </form>
   {!passkey&&<p className="text-xs leading-relaxed text-spark-text-secondary">{c.help}</p>}
   {!enroll&&onRecover&&<button type="button" onClick={onRecover} className="block min-h-11 text-sm text-spark-primary">{c.forgot}</button>}
   {onBack&&<button onClick={onBack} type="button" className="min-h-10 text-sm text-spark-text-secondary">{c.back}</button>}
  </section>
 </main>;
}
