import {loadLocaleFonts} from '@/locales/loadFonts';
import {usePresentation} from '@/hooks/usePresentation';
import {homeCopy,APP_LANGUAGES,setAppLanguage,type AppLanguage} from '@/services/presentationPreferences';
import {useId,useRef} from 'react';
import InstallPrompt from '../components/InstallPrompt';
import BrandIntro from '../components/BrandIntro';
import {ChevronRightIcon} from '../components/Icons';

type Props = {
  onRestoreWallet: () => void;
  onCreateNewWallet: () => void;
  onCreateManualWallet: () => void;
  onUsePasskey: () => void;
  onCreatePasskey: () => void;
  prfAvailable: boolean;
  setupIssue?: string | null;
};
/** The visual morph never delays the original Start handler: delaying a
 * WebAuthn ceremony would lose the browser's transient user activation. */
export default function HomePage({onCreateNewWallet,onRestoreWallet,setupIssue}:Props){
  const {language}=usePresentation();
  const tr=homeCopy(language);
  const errorId=useId();
  const heroRef=useRef<HTMLImageElement>(null);
  const onStart=()=>{
    const mark=heroRef.current;
    if(mark && !window.matchMedia('(prefers-reduced-motion: reduce)').matches){
      const box=mark.getBoundingClientRect();
      if(box.width>0 && box.height>0){
        const header=document.querySelector('.gys-welcome__header')?.getBoundingClientRect();
        const left=(header?.left??18)+6,top=(header?.top??18)+5;
        const image=mark.cloneNode(true) as HTMLImageElement;
        image.removeAttribute('id');
        image.setAttribute('aria-hidden','true');
        image.style.cssText=`position:fixed;left:${box.left}px;top:${box.top}px;width:${box.width}px;height:${box.height}px;object-fit:contain;transform-origin:top left;pointer-events:none;z-index:100001;filter:none`;
        document.body.append(image);
        const anim=image.animate([
          {transform:'translate(0,0) scale(1)',opacity:1},
          {transform:`translate(${left-box.left}px,${top-box.top}px) scale(${Math.min(108/box.width,60/box.height)})`,opacity:.93}
        ],{duration:640,easing:'cubic-bezier(.22,.85,.2,1)',fill:'forwards'});
        void anim.finished.then(()=>image.remove(),()=>image.remove());
      }
    }
    onCreateNewWallet();
  };
  return <main className="gys-welcome">
    <BrandIntro />
    <div className="gys-welcome__atmosphere" aria-hidden="true"/>
    <header className="gys-welcome__header">
      <span className="gys-welcome__scarcity-pill">{tr.scarcity}</span>
      <label className="gys-language-picker"><span className="sr-only">Language</span><select onFocus={()=>void loadLocaleFonts()} onPointerEnter={()=>void loadLocaleFonts()} aria-label="Language" value={language} onChange={event=>setAppLanguage(event.target.value as AppLanguage)}>{APP_LANGUAGES.map(item=><option lang={item.code} dir={item.code==='ar'?'rtl':'ltr'} key={item.code} value={item.code}>{item.name}</option>)}</select></label>
    </header>
    <div className="gys-welcome__stage">
      <div className="gys-welcome__content">
        <div className="gys-welcome__eyebrow"><span aria-hidden="true"/> {tr.eyebrow}</div>
        <h1>{tr.heading} <em>{tr.emphasis}</em></h1>
        <p className="gys-welcome__subtitle">{tr.subtitle}</p>
        <div className="gys-welcome__actions" aria-label="Wallet setup">
          <InstallPrompt />
          <button className="gys-welcome__start" type="button" onClick={onStart}
            aria-describedby={setupIssue?errorId:undefined}>
            <span>{tr.start}</span><ChevronRightIcon size="lg"/>
          </button>
          <button className="gys-welcome__restore" type="button" onClick={onRestoreWallet} aria-label="Restore existing wallet">
            {tr.restoreQuestion} <strong>{tr.restore} <span aria-hidden="true">↗</span></strong>
          </button>
          <p className="gys-welcome__passkey-explainer">
            {tr.passkey}
          </p>
          {setupIssue&&<div id={errorId} role="alert" className="gys-welcome__error">{setupIssue}</div>}
        </div>
      </div>
      <div className="gys-welcome__visual" aria-hidden="true">
        {/* Never recolour, invert, rotate or replace the approved cream 3D artwork. */}
        <img ref={heroRef} className="gys-welcome__hero-mark" src="/brand/wordmark-3d-transparent.png"
          width={720} height={540} alt=""/>
      </div>
    </div>
    <footer className="gys-welcome__footer">
      <span>{tr.footOne}</span><span>{tr.footTwo}</span>
    </footer>
  </main>;
}
