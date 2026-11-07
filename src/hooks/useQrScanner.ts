import { useCallback, useEffect, useRef, useState } from 'react';
import QrScanner from '@/utils/qrScanner';
import { logger, LogCategory } from '@/services/logger';
import { formatError } from '@/utils/formatError';
import { hapticLight } from '@/utils/haptics';

export type FacingMode = 'environment' | 'user';

export interface UseQrScannerOptions {
  onScan: (data: string) => void;
  onError?: (error: string) => void;
}

export interface UseQrScannerReturn {
  videoRef: React.RefObject<HTMLVideoElement>;
  error: string | null;
  isScanning: boolean;
  isInitializing: boolean;
  facingMode: FacingMode;
  hasMultipleCameras: boolean;
  startScanning: () => Promise<void>;
  stopScanning: () => void;
  toggleCamera: () => void;
  hasTorch:boolean;
  torchOn:boolean;
  toggleTorch:()=>Promise<void>;
  clearError: () => void;
}

/** qr-scanner's default region (a centered square two thirds of the shorter
 *  side), decoded at full resolution. The default shrinks it to 400px, which
 *  leaves too few pixels per module to read a long bolt11 invoice. */
export function fullResolutionScanRegion(video: HTMLVideoElement): QrScanner.ScanRegion {
  const size = Math.round((2 / 3) * Math.min(video.videoWidth, video.videoHeight));
  return {
    x: Math.round((video.videoWidth - size) / 2),
    y: Math.round((video.videoHeight - size) / 2),
    width: size,
    height: size,
    downScaledWidth: size,
    downScaledHeight: size,
  };
}

const CAMERA_CHOICE='gys:scanner-facing:v1';
function savedCamera():FacingMode{try{return localStorage.getItem(CAMERA_CHOICE)==='user'?'user':'environment';}catch{return 'environment';}}

export const useQrScanner = ({onScan,onError}:UseQrScannerOptions):UseQrScannerReturn => {
  const videoRef=useRef<HTMLVideoElement>(null!);
  const qrScannerRef=useRef<QrScanner|null>(null);
  const streamRef=useRef<MediaStream|null>(null);
  const scanSession=useRef(0),starting=useRef(false);
  const [error,setError]=useState<string|null>(null);
  const [isScanning,setIsScanning]=useState(false);
  const [isInitializing,setIsInitializing]=useState(false);
  const [facingMode,setFacingMode]=useState<FacingMode>(savedCamera);
  const [hasMultipleCameras,setHasMultipleCameras]=useState(false);
  const [hasTorch,setHasTorch]=useState(false),[torchOn,setTorchOn]=useState(false);
  const clearError=useCallback(()=>setError(null),[]);
  const stopScanning=useCallback(()=>{
    scanSession.current++;
    starting.current=false;
    qrScannerRef.current?.stop();
    qrScannerRef.current?.destroy();
    qrScannerRef.current=null;
    streamRef.current?.getTracks().forEach(track=>track.stop());
    streamRef.current=null;
    if(videoRef.current)videoRef.current.srcObject=null;
    setIsScanning(false);setIsInitializing(false);setTorchOn(false);setHasTorch(false);
  },[]);
  useEffect(()=>{
    const hidden=()=>{if(document.visibilityState==='hidden')stopScanning();};
    document.addEventListener('visibilitychange',hidden);
    return()=>{document.removeEventListener('visibilitychange',hidden);stopScanning();};
  },[stopScanning]);
  const startScanning=useCallback(async(mode:FacingMode=facingMode)=>{
    if(starting.current||qrScannerRef.current||document.visibilityState==='hidden')return;
    const session=++scanSession.current;
    starting.current=true;setError(null);setIsInitializing(true);
    let stream:MediaStream|undefined;
    try{
      const video=videoRef.current;
      if(!video||!navigator.mediaDevices?.getUserMedia)throw new DOMException('Unavailable','NotFoundError');
      let permission:PermissionState|undefined;
      try{permission=(await navigator.permissions?.query({name:'camera' as PermissionName}))?.state;}catch{/* Not exposed by every browser. */}
      if(session!==scanSession.current)return;
      if(permission==='denied')throw new DOMException('Denied','NotAllowedError');
      // One permissive request avoids the scanner library retrying denied access with six constraint sets.
      stream=await navigator.mediaDevices.getUserMedia({audio:false,video:{facingMode:{ideal:mode},width:{ideal:1280}}});
      if(session!==scanSession.current){stream.getTracks().forEach(track=>track.stop());return;}
      streamRef.current=stream;video.srcObject=stream;
      const track=stream.getVideoTracks()[0];
      const actual=track?.getSettings?.().facingMode;
      const selected=actual==='user'||actual==='environment'?actual:mode;
      setFacingMode(selected);
      try{localStorage.setItem(CAMERA_CHOICE,selected);}catch{/* Optional camera preference. */}
      setHasTorch(!!(track?.getCapabilities?.() as MediaTrackCapabilities&{torch?:boolean})?.torch);
      const scanner=new QrScanner(video,result=>{
        if(session!==scanSession.current)return;
        void hapticLight();stopScanning();onScan(result.data);
      },{onDecodeError:()=>{},highlightScanRegion:false,highlightCodeOutline:false,
        calculateScanRegion:fullResolutionScanRegion,preferredCamera:selected,maxScansPerSecond:5});
      qrScannerRef.current=scanner;
      await scanner.start();
      if(session!==scanSession.current){scanner.stop();scanner.destroy();return;}
      setIsScanning(true);setIsInitializing(false);
      const cameras=await QrScanner.listCameras(false).catch(()=>[]);
      if(session===scanSession.current)setHasMultipleCameras(new Set(cameras.map(camera=>camera.id)).size>1);
    }catch(err){
      stream?.getTracks().forEach(track=>track.stop());
      if(session!==scanSession.current)return;
      qrScannerRef.current?.destroy();qrScannerRef.current=null;streamRef.current=null;
      if(videoRef.current)videoRef.current.srcObject=null;
      const message=err instanceof Error&&err.name==='NotAllowedError'?'denied':err instanceof Error&&err.name==='NotReadableError'?'busy':'unavailable';
      setError(message);onError?.(message);setIsScanning(false);setIsInitializing(false);
      logger.warn(LogCategory.UI,'Camera could not start',{error:formatError(err)});
    }finally{if(session===scanSession.current)starting.current=false;}
  },[facingMode,onScan,onError,stopScanning]);
  const toggleCamera=useCallback(()=>{const next=facingMode==='environment'?'user':'environment';stopScanning();void startScanning(next);},[facingMode,startScanning,stopScanning]);
  const toggleTorch=useCallback(async()=>{
    const track=streamRef.current?.getVideoTracks()[0],session=scanSession.current;
    if(!track)return;
    try{await track.applyConstraints({advanced:[{torch:!torchOn} as MediaTrackConstraintSet]});if(session===scanSession.current)setTorchOn(!torchOn);}catch{if(session===scanSession.current)setHasTorch(false);}
  },[torchOn]);
  return {videoRef,error,isScanning,isInitializing,facingMode,hasMultipleCameras,startScanning,stopScanning,toggleCamera,clearError,hasTorch,torchOn,toggleTorch};
};
