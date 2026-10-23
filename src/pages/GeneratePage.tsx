import {useState,useEffect} from 'react';
import {createRecoveryChallenge, type RecoveryChallenge} from '../getyoursats/recoveryChallenge';
import * as bip39 from 'bip39';
import {PrimaryButton} from '../components/ui';
import LoadingSpinner from '../components/LoadingSpinner';
import PageLayout from '../components/layout/PageLayout';
import {AlertCard} from '../components/AlertCard';
import {WebSecurityNotice} from '../components/WebSecurityNotice';
import {logger,LogCategory} from '@/services/logger';
import {useScreenCaptureProtection} from '@/utils/screenSecurity';

interface GeneratePageProps {
 onMnemonicConfirmed:(mnemonic:string)=>void;
 onBack:()=>void;
 error:string|null;
 onClearError:()=>void;
 recommendPasskey?:boolean;
}
type Stage='show'|'verify';
export default function GeneratePage({
 onMnemonicConfirmed,onBack,onClearError,recommendPasskey=false,
}:GeneratePageProps){
 const [mnemonic,setMnemonic]=useState('');
 const [isLoading,setIsLoading]=useState(true);
 const [generationError,setGenerationError]=useState('');
 const [stage,setStage]=useState<Stage>('show');
 const [challenge,setChallenge]=useState<RecoveryChallenge|null>(null);
 const [answers,setAnswers]=useState<[string,string]>(['','']);
 const [validationError,setValidationError]=useState('');
 useScreenCaptureProtection(true);
 useEffect(()=>{
   try{
     // BIP39 uses a cryptographically secure random source, not Math.random.
     const phrase=bip39.generateMnemonic(128);
     setMnemonic(phrase);
   }catch(error){
     logger.error(LogCategory.AUTH,'Failed to generate recovery phrase',{error:error instanceof Error?error.message:String(error)});
     setGenerationError('Secure wallet key generation is unavailable on this device.');
   }finally{setIsLoading(false)}
 },[]);
 const words=mnemonic.split(' ');
 const advanceToVerification=()=>{
   // Returning to the phrase and continuing must ask for two *new* positions.
   // Do not regenerate wallet keys or carry over typed answers.
   setChallenge(previous=>createRecoveryChallenge(words.length,previous??undefined));
   setAnswers(['','']);
   setValidationError('');
   setStage('verify');
 };
 const verify=()=>{
   if(!challenge)return;
   const a=answers[0].trim().toLowerCase(),b=answers[1].trim().toLowerCase();
   if(a!==words[challenge[0]]||b!==words[challenge[1]]){
     setValidationError('Those words do not match. Check your offline backup and try again.');
     return;
   }
   setValidationError('');
   onMnemonicConfirmed(mnemonic);
 };
 if(isLoading)return <PageLayout onBack={onBack} footer={<div/>} title="Secure wallet setup" onClearError={onClearError}>
   <div className="flex justify-center p-12"><LoadingSpinner text="Creating wallet keys…"/></div>
 </PageLayout>;
 if(generationError)return <PageLayout onBack={onBack} footer={<div/>} title="Secure wallet setup" onClearError={onClearError}>
   <AlertCard variant="error" title="Setup unavailable">{generationError}</AlertCard>
 </PageLayout>;
 const footer=<div className="max-w-xl mx-auto">
  {stage==='show'?<PrimaryButton className="w-full" onClick={advanceToVerification}>I've written the words down</PrimaryButton>:
   <PrimaryButton className="w-full" onClick={verify} disabled={!answers[0].trim()||!answers[1].trim()}>Verify offline backup</PrimaryButton>}
 </div>;
 return <PageLayout onBack={stage==='verify'?()=>{setStage('show');setAnswers(['','']);setValidationError('')}:onBack}
 footer={footer} title="Manual recovery" onClearError={onClearError}>
 <div className="max-w-xl mx-auto w-full space-y-5">
  {stage==='show'?<>
    <p className="text-spark-text-secondary text-center">Write these words on paper in order. Never screenshot, photograph, email or paste them into another app.</p>
    <div className="grid grid-cols-3 gap-2 bg-spark-dark border border-spark-border rounded-2xl p-4 select-none" aria-label="Recovery phrase">
      {words.map((word,index)=><div key={index} className="flex gap-2 items-center rounded-lg bg-spark-surface p-2">
        <span className="font-mono text-xs text-spark-text-muted">{index+1}.</span>
        <span className="font-mono text-sm font-medium text-spark-text-primary">{word}</span>
      </div>)}
    </div>
    <AlertCard variant="warning" title="Offline only">
      Nobody at GetYourSats can recover your private keys for you. Store your handwritten backup securely and separately from your phone.
    </AlertCard>
    <WebSecurityNotice recommendPasskey={recommendPasskey}/>
  </>:<>
    <p className="text-spark-text-secondary text-center">Confirm two words from your handwritten backup. The recovery phrase is hidden during this check.</p>
    {challenge?.map((index,i)=><label key={index} className="block space-y-2">
      <span className="text-sm font-medium text-spark-text-secondary">Word {index+1}</span>
      <input type="text" autoComplete="off" autoCapitalize="none" spellCheck={false}
       className="w-full bg-spark-surface border border-spark-border rounded-xl p-3 text-spark-text-primary"
       value={answers[i]} onChange={e=>{setAnswers(prev=>i===0?[e.target.value,prev[1]]:[prev[0],e.target.value]);setValidationError('')}}/>
    </label>)}
    {validationError&&<AlertCard variant="error" title="Try again">{validationError}</AlertCard>}
    <p className="text-xs text-spark-text-muted text-center">Verification happens on your device. Your recovery words are never sent to GetYourSats.</p>
  </>}
 </div>
 </PageLayout>;
}
