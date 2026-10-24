import {useEffect,useState} from 'react';
import {DownloadIcon,CloseIcon} from './Icons';

const DISMISS_KEY='gys:install:welcome-dismissed:v1';
interface BeforeInstallPromptEvent extends Event {
  prompt:()=>Promise<void>;
  userChoice:Promise<{outcome:'accepted'|'dismissed'}>;
}
const standalone=()=>window.matchMedia('(display-mode: standalone)').matches
  || (navigator as Navigator & {standalone?:boolean}).standalone===true;
const isIos=()=>/iPhone|iPad|iPod/i.test(navigator.userAgent)
  || (navigator.platform==='MacIntel'&&navigator.maxTouchPoints>1);

export default function InstallPrompt(){
  const [dismissed,setDismissed]=useState(()=>{
    try{return localStorage.getItem(DISMISS_KEY)==='1'}catch{return false}
  });
  const [installed,setInstalled]=useState(standalone);
  const [deferred,setDeferred]=useState<BeforeInstallPromptEvent|null>(null);
  const [busy,setBusy]=useState(false);
  const ios=isIos();
  const safari=ios && /Safari/i.test(navigator.userAgent)
    && !/CriOS|FxiOS|EdgiOS|OPiOS/i.test(navigator.userAgent);
  useEffect(()=>{
    const offered=(event:Event)=>{event.preventDefault();setDeferred(event as BeforeInstallPromptEvent)};
    const complete=()=>setInstalled(true);
    window.addEventListener('beforeinstallprompt',offered);
    window.addEventListener('appinstalled',complete);
    return ()=>{
      window.removeEventListener('beforeinstallprompt',offered);
      window.removeEventListener('appinstalled',complete);
    };
  },[]);
  if(installed||dismissed||(!ios&&!deferred))return null;
  const close=()=>{
    setDismissed(true);
    try{localStorage.setItem(DISMISS_KEY,'1')}catch{/* optional preference */}
  };
  const install=async()=>{
    if(!deferred||busy)return;
    setBusy(true);
    try{
      await deferred.prompt();
      if((await deferred.userChoice).outcome==='accepted')setInstalled(true);
    }catch{/* On Android install availability can change; main Start stays active. */}
    finally{setBusy(false);setDeferred(null)}
  };
  return <section className="gys-inline-install" aria-label="Optional home-screen installation">
    <DownloadIcon size="sm" className="gys-inline-install__icon"/>
    <div className="gys-inline-install__body">
      <strong>Keep GetYourSats a tap away</strong>
      {ios?<p>{safari?
        'On iPhone: tap Share in Safari, choose Add to Home Screen, then Add.':
        'On iPhone: open this wallet in Safari, tap Share, then Add to Home Screen.'}
        {' '}You can also start in your browser.</p>:
        <p>Install from your browser for quick access. It is optional and does not change wallet custody.</p>}
      {!!deferred&&<button type="button" className="gys-inline-install__action"
        onClick={()=>void install()} disabled={busy}>{busy?'Opening…':'Install app'}</button>}
    </div>
    <button type="button" onClick={close} className="gys-inline-install__close" aria-label="Dismiss installation guidance">
      <CloseIcon size="sm"/>
    </button>
  </section>;
}
