import {useEffect,useState} from 'react';
import {appCopy,getAppLanguage,getAppearancePreference,getResolvedAppearance,subscribePresentation,type AppLanguage,type AppearancePreference} from '@/services/presentationPreferences';

export function usePresentation(){
 const [language,setLanguage]=useState<AppLanguage>(getAppLanguage);
 const [appearance,setAppearance]=useState<AppearancePreference>(getAppearancePreference);
 const [resolved,setResolved]=useState(getResolvedAppearance);
 useEffect(()=>subscribePresentation(()=>{
  setLanguage(getAppLanguage());setAppearance(getAppearancePreference());setResolved(getResolvedAppearance());
 }),[]);
 return {language,appearance,resolved,copy:appCopy(language)};
}
