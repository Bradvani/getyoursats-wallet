/**
 * Browser privacy lock plus same-wallet reauthentication and SDK reconnection.
 * SDK lifetime revocation is owned by the connection service.
 * Never describe this as key-isolated biometric signing.
 */
import {useEffect,useRef,useState} from 'react';
import type {Seed} from '@breeztech/breez-sdk-spark';
import {Capacitor} from '@capacitor/core';
import {isPasskeyMode,getPasskeyLabel,signInPinnedToActiveCredential} from '../services/passkeyService';
import {hasWebWalletVault,unlockWebWallet,clearUnlockedWebMnemonic} from './webWalletVault';
import {lockSpendingSession,unlockSpendingSession,assertCurrentSession,getSpendingSessionEpoch,isSpendingSessionLocked} from './spendApproval';

export function useBrowserSessionLock(isConnected:boolean,resume?:(seed:Seed)=>Promise<number>){
 const [locked,setLocked]=useState(false);
 const lastActive=useRef(0);
 useEffect(()=>{
   if(Capacitor.isNativePlatform()||(!isPasskeyMode()&&!hasWebWalletVault())||!isConnected)return;
   lastActive.current=Date.now();
   const active=()=>{lastActive.current=Date.now()};
   const lock=()=>{lockSpendingSession('Wallet session locked');clearUnlockedWebMnemonic();setLocked(true)};
   const onVisibility=()=>document.visibilityState==='hidden'?lock():active();
   const onStorage=(event:StorageEvent)=>{
    if(event.key===null || event.key.startsWith('gys:wallet-vault:') || event.key==='walletMnemonic')lock();
   };
   document.addEventListener('visibilitychange',onVisibility);
   window.addEventListener('pagehide',lock);
   window.addEventListener('storage',onStorage);
   window.addEventListener('pointerdown',active);
   window.addEventListener('keydown',active);
   if(document.visibilityState==='hidden'||isSpendingSessionLocked())lock();
   const timer=window.setInterval(()=>{
      if(document.visibilityState==='visible'&&Date.now()-lastActive.current>=5*60*1000)lock();
   },15_000);
   return()=>{
      document.removeEventListener('visibilitychange',onVisibility);
      window.removeEventListener('pagehide',lock);
      window.removeEventListener('storage',onStorage);
      window.removeEventListener('pointerdown',active);
      window.removeEventListener('keydown',active);
      window.clearInterval(timer);
   };
 },[isConnected]);
 const unlock=async(password:string)=>{
   try {
     const startedEpoch=getSpendingSessionEpoch();
     const seed=isPasskeyMode()
       ? (await signInPinnedToActiveCredential(getPasskeyLabel()??undefined)).wallet.seed
       : {type:'mnemonic' as const,mnemonic:await unlockWebWallet(password)};
     assertCurrentSession(startedEpoch);
     const verifiedEpoch=await unlockSpendingSession(seed);
     assertCurrentSession(verifiedEpoch);
     const epoch=resume?await resume(seed):verifiedEpoch;
     assertCurrentSession(epoch);
     lastActive.current=Date.now();
     setLocked(false);
   } catch(error) {
     clearUnlockedWebMnemonic();
     lockSpendingSession('Unlock did not complete');
     setLocked(true);
     throw error;
   }
 };
 return {locked,unlock};
}
