import {usePresentation} from '../hooks/usePresentation';
import {flowText,hasFlowText} from '../locales/flowText';

/** Provider diagnostics retain their exact text under a translated explanation. */
export default function LocalizedErrorText({message}:{message:string}){
 const {language}=usePresentation();
 const providerError=!hasFlowText(message)&&/^(Failed to |Network |Error:|Withdraw failed:|Unknown error)/i.test(message);
 if(language==='en'||!providerError)return <>{flowText(language,message)}</>;
 return <div>
  <p>{flowText(language,'Unable to complete this request. Check the details before trying again.')}</p>
  <details className="mt-2 text-xs"><summary>{flowText(language,'Technical details')}</summary>
   <p className="mt-1 break-words" dir="auto">{message}</p>
  </details>
 </div>;
}
