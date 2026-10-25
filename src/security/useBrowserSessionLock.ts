/**
 * Privacy screen for a browser mnemonic wallet. This only protects the UI on
 * background/idle; the Breez SDK remains connected for incoming payments.
 * Never describe this as key-isolated biometric signing.
 */
import {useEffect,useRef,useState} from 'react';
import {Capacitor} from '@capacitor/core';
import {isPasskeyMode} from '../services/passkeyService';
import {hasWebWalletVault,unlockWebWallet,clearUnlockedWebMnemonic} from './webWalletVault';
import {lockSpendingSession,unlockSpendingSession,assertCurrentSession} from './spendApproval';

export function useBrowserSessionLock(isConnected:boolean){
 const [locked,setLocked]=useState(false);
 const lastActive=useRef(0);
 useEffect(()=>{
   if(Capacitor.isNativePlatform()||isPasskeyMode()||!hasWebWalletVault()||!isConnected)return;
   lastActive.current=Date.now();
   const active=()=>{lastActive.current=Date.now()};
   const lock=()=>{lockSpendingSession('Wallet session locked');clearUnlockedWebMnemonic();setLocked(true)};
   const onVisibility=()=>document.visibilityState==='hidden'?lock():active();
   document.addEventListener('visibilitychange',onVisibility);
   window.addEventListener('pointerdown',active);
   window.addEventListener('keydown',active);
   const timer=window.setInterval(()=>{
      if(document.visibilityState==='visible'&&Date.now()-lastActive.current>=5*60*1000)lock();
   },15_000);
   return()=>{
      document.removeEventListener('visibilitychange',onVisibility);
      window.removeEventListener('pointerdown',active);
      window.removeEventListener('keydown',active);
      window.clearInterval(timer);
   };
 },[isConnected]);
 const unlock=async(password:string)=>{
   try {
     const mnemonic=await unlockWebWallet(password);
     const epoch=await unlockSpendingSession({type:'mnemonic',mnemonic});
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
