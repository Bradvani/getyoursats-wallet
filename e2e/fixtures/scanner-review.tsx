// Dev-only visual fixture. No camera permission, wallet or payment is used.
import {useState} from 'react';
import {createRoot} from 'react-dom/client';
import '../../src/index.css';
import '../../src/getyoursats/premium.css';
import '../../src/getyoursats/appearance.css';
import QrScannerDialog from '../../src/components/QrScannerDialog';
import {initPresentation} from '../../src/services/presentationPreferences';
import AppShell from '../../src/components/layout/AppShell';
const query = new URLSearchParams(location.search);
if (query.has('theme')) localStorage.setItem('gys:appearance:v1',query.get('theme')!);
if (query.has('lang')) localStorage.setItem('gys:language:v1',query.get('lang')!);
HTMLMediaElement.prototype.play = async () => {};
Object.defineProperty(navigator,'permissions',{configurable:true,value:{query:async()=>({state:'granted'})}});
Object.defineProperty(navigator,'mediaDevices',{configurable:true,value:{
  getUserMedia:async()=>{
    if(query.has('denied')) throw new DOMException('Fixture denied','NotAllowedError');
    const track={stop:()=>{},getSettings:()=>({facingMode:'environment'}),getCapabilities:()=>({torch:true}),applyConstraints:async()=>{}};
    return Object.assign(new MediaStream(),{getTracks:()=>[track],getVideoTracks:()=>[track]});
  },
  enumerateDevices:async()=>[{kind:'videoinput',deviceId:'fixture-back'},{kind:'videoinput',deviceId:'fixture-front'}],
}});
initPresentation();
function Fixture(){
  const [open,setOpen]=useState(true);
  return <AppShell><button onClick={()=>setOpen(true)}>Open scanner preview</button>
    <QrScannerDialog isOpen={open} onClose={()=>setOpen(false)} onScan={()=>setOpen(false)}/></AppShell>;
}
createRoot(document.getElementById('root')!).render(<Fixture/>);
