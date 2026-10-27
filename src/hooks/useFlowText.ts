import {usePresentation} from './usePresentation';
import {flowText} from '../locales/flowText';
export function useFlowText(){
 const {language}=usePresentation();
 return (text:string,values?:Record<string,string|number>)=>flowText(language,text,values);
}
