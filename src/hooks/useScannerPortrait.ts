import {useEffect,useState,type CSSProperties} from 'react';

type LockableOrientation = ScreenOrientation & {lock?:(value:string)=>Promise<void>};
type PortraitFrame = {angle:number;width:number;height:number};
export function scannerPortraitFrame(width:number,height:number,angle:number,phone:boolean):PortraitFrame {
  const normalized=((angle%360)+360)%360;
  if(!phone||width<=height||![90,270].includes(normalized))return {angle:0,width,height};
  return {angle:normalized===270?90:-90,width:height,height:width};
}

function frame():PortraitFrame {
  const viewport=window.visualViewport;
  const width=viewport?.width??window.innerWidth;const height=viewport?.height??window.innerHeight;
  const angle=screen.orientation?.angle??Number((window as Window & {orientation?:number}).orientation??0);
  const phone=matchMedia('(pointer: coarse)').matches&&Math.min(screen.width,screen.height)<=600;
  return scannerPortraitFrame(width,height,angle,phone);
}

/** Retain a portrait scanning surface on phones, including browsers without orientation locking.
 * Transforms affect presentation only. The decoder continues reading the unchanged video frame.
 */
export function useScannerPortrait(active:boolean):CSSProperties {
  const [geometry,setGeometry]=useState(frame);
  useEffect(()=>{
    if(!active)return;
    const orientation=screen.orientation as LockableOrientation|undefined;
    let disposed=false;let locked=false;
    const update=()=>setGeometry(frame());
    const first=requestAnimationFrame(update);
    window.addEventListener('resize',update);
    window.addEventListener('orientationchange',update);
    window.visualViewport?.addEventListener('resize',update);
    orientation?.addEventListener('change',update);
    if(matchMedia('(pointer: coarse)').matches&&Math.min(screen.width,screen.height)<=600&&orientation?.lock){
      void orientation.lock('portrait-primary').then(()=>{
        if(disposed)orientation.unlock();else {locked=true;update();}
      }).catch(()=>{/* The portrait surface handles browsers without a native lock. */});
    }
    return()=>{
      disposed=true;cancelAnimationFrame(first);
      window.removeEventListener('resize',update);window.removeEventListener('orientationchange',update);
      window.visualViewport?.removeEventListener('resize',update);orientation?.removeEventListener('change',update);
      if(locked)orientation?.unlock();
    };
  },[active]);
  return geometry.angle?{position:'absolute',left:'50%',top:'50%',width:geometry.width,height:geometry.height,
    transform:`translate(-50%, -50%) rotate(${geometry.angle}deg)`,transformOrigin:'center',
    padding:'max(16px, env(safe-area-inset-top), env(safe-area-inset-right), env(safe-area-inset-bottom), env(safe-area-inset-left))'}:{};
}
