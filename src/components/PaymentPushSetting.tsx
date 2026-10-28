import {useCallback,useEffect,useState} from 'react';
import {Capacitor} from '@capacitor/core';
import {useWallet} from '../contexts/WalletContext';

type Config={available:boolean;vapidPublicKey:string|null;lightningInvoicePushAvailable:boolean;lightningAddressPushAvailable:boolean};
type Challenge={challengeId:string;message:string};
type Enroll={webhookRegistered:boolean;webhookUrl:string;webhookSecret:string;eventTypes:Array<{type:string}>};
const PREF='gys:push:active-wallet:v1:';
const native=()=>Capacitor.isNativePlatform();
const supportsPush=()=>typeof window!=='undefined'&&window.isSecureContext
  &&'Notification' in window&&'serviceWorker' in navigator&&'PushManager' in window&&!native();
function isInstalledIos(){
  const ios=/iPad|iPhone|iPod/i.test(navigator.userAgent);
  const standalone=window.matchMedia('(display-mode: standalone)').matches||
    (navigator as Navigator & {standalone?:boolean}).standalone===true;
  return !ios||standalone;
}
function decodePublicKey(value:string):Uint8Array<ArrayBuffer>{
  const bytes=atob(value.replace(/-/g,'+').replace(/_/g,'/'));
  const key=new Uint8Array(new ArrayBuffer(bytes.length));
  for(let i=0;i<bytes.length;i++)key[i]=bytes.charCodeAt(i);
  if(key.length!==65||key[0]!==4)throw new Error('Push service configuration is invalid.');
  return key;
}
async function request<T>(body:Record<string,unknown>):Promise<T>{
  const response=await fetch('/api/notifications/device',{
    method:'POST',headers:{'Content-Type':'application/json'},
    body:JSON.stringify(body),credentials:'omit',cache:'no-store',
  });
  const data=await response.json() as T&{error?:string};
  if(!response.ok)throw new Error(data.error||'Could not update notification settings.');
  return data;
}
function readableError(value:unknown):string{
  if(value instanceof Error){
    if(value.name==='NotAllowedError')return 'Notifications were blocked by your device. Enable them in system settings.';
    return value.message;
  }
  return 'Could not enable payment notifications.';
}
export default function PaymentPushSetting(){
  const sdk=useWallet();
  const [config,setConfig]=useState<Config|null>(null);
  const [enabled,setEnabled]=useState(false);
  const [busy,setBusy]=useState(false);
  const [message,setMessage]=useState('');
  const [pub,setPub]=useState<string|null>(null);
  const supported=supportsPush();
  const canInstall=isInstalledIos();

  useEffect(()=>{
    let alive=true;
    void (async()=>{
      try{
        const [response,info]=await Promise.all([
          fetch('/api/notifications/device',{cache:'no-store'}).then(res=>res.json() as Promise<Config>),
          sdk.getInfo({ensureSynced:false}),
        ]);
        if(!alive)return;
        const wallet=info.identityPubkey?.toLowerCase()??null;
        setPub(wallet);
        setConfig(response);
        const subscribed=!!(wallet&&localStorage.getItem(PREF+wallet)==='true');
        // Never report enabled without permission. A dismissed/expired browser
        // subscription will fail on delivery and be repaired by opting in again.
        setEnabled(subscribed&&supported&&Notification.permission==='granted');
      }catch{if(alive)setConfig({available:false,vapidPublicKey:null,
        lightningInvoicePushAvailable:false,lightningAddressPushAvailable:false});}
    })();
    return()=>{alive=false;};
  },[sdk,supported]);

  const signed=useCallback(async <T,>(action:'subscribe'|'activate'|'status'|'unsubscribe',extra:Record<string,unknown>)=>{
    if(!pub)throw new Error('Wallet is not ready.');
    const challenge=await request<Challenge>({action:'challenge',purpose:action,walletPubkey:pub});
    const wanted='gys-push-v1:'+action+':'+pub+':'+challenge.challengeId;
    if(challenge.message!==wanted||!/^[0-9a-f]{32}$/.test(challenge.challengeId))
      throw new Error('Notification authorization did not match this wallet.');
    const response=await sdk.signMessage({message:wanted,compact:true});
    if(response.pubkey?.toLowerCase()!==pub)
      throw new Error('Wallet identity changed. Please reopen Settings.');
    return request<T>({action,walletPubkey:pub,challengeId:challenge.challengeId,
      signature:response.signature,...extra});
  },[pub,sdk]);

  const enable=async()=>{
    if(busy||!supported||!canInstall||!config?.available||!config.vapidPublicKey||!pub)return;
    setBusy(true);setMessage('');
    let subscription:PushSubscription|null=null;
    try{
      // Request permission directly from this tap, before other awaits.
      const permission=await Notification.requestPermission();
      if(permission!=='granted')throw new Error('Allow GetYourSats notifications in your device settings.');
      const registration=await navigator.serviceWorker.register('/sw.js');
      subscription=await registration.pushManager.getSubscription();
      if(subscription){
        const existing=subscription.options.applicationServerKey;
        const target=decodePublicKey(config.vapidPublicKey);
        const same=existing&&new Uint8Array(existing).length===target.length
          &&new Uint8Array(existing).every((value,index)=>value===target[index]);
        if(!same){await subscription.unsubscribe();subscription=null;}
      }
      if(!subscription)subscription=await registration.pushManager.subscribe({
        userVisibleOnly:true,applicationServerKey:decodePublicKey(config.vapidPublicKey)
      });
      const enrolled=await signed<Enroll>('subscribe',{subscription:subscription.toJSON()});
      let webhookId='';
      if(!enrolled.webhookRegistered){
        // Spark invoices created by this wallet are notified through this
        // registered hook. Lightning Address payments need Breez LNURL setup.
        const registered=await sdk.registerWebhook({
          url:enrolled.webhookUrl,secret:enrolled.webhookSecret,eventTypes:enrolled.eventTypes
        });
        webhookId=registered.webhookId;
        if(!webhookId)throw new Error('Lightning notification registration was not confirmed.');
      }
      await signed('activate',{endpoint:subscription.endpoint,webhookId});
      localStorage.setItem(PREF+pub,'true');
      setEnabled(true);
      setMessage('Lightning invoice alerts enabled for this device.');
    }catch(error){
      setMessage(readableError(error));
      setEnabled(false);
      localStorage.removeItem(PREF+pub);
      // Do not leave a pending subscription capable of sending a false
      // success. A failed registration is inactive on the server.
    }finally{setBusy(false);}
  };

  const disable=async()=>{
    if(!pub||busy)return;
    setBusy(true);setMessage('');
    try{
      const registration=await navigator.serviceWorker.getRegistration('/sw.js');
      const subscription=await registration?.pushManager.getSubscription();
      if(subscription){
        await signed('unsubscribe',{endpoint:subscription.endpoint});
        await subscription.unsubscribe();
      }
      localStorage.removeItem(PREF+pub);
      setEnabled(false);
      setMessage('Payment alerts disabled on this device.');
    }catch(error){
      setMessage(readableError(error));
    }finally{setBusy(false);}
  };
  const preview=async()=>{
    try{
      const registration=await navigator.serviceWorker.ready;
      await registration.showNotification('GetYourSats',{
        body:'This is only a notification preview, not a real payment.',
        icon:'/brand/app-icon-192.png',
      });
      setMessage('Preview displayed. Live delivery requires a real settled payment.');
    }catch(error){setMessage(readableError(error));}
  };
  return <section className="mt-4 border-t border-spark-border pt-4 space-y-3" aria-label="Payment notifications">
    <div>
      <h4 className="text-sm font-semibold text-spark-text-primary">Lightning payment notifications</h4>
      <p className="mt-1 text-xs text-spark-text-muted leading-relaxed">
        Receive a private alert when a supported Lightning invoice is paid, even when your installed wallet is closed.
        Your keys stay on your device.
      </p>
    </div>
    {!supported||!canInstall?
      <p role="status" className="text-xs text-spark-text-muted">
        {native()?'Background push notifications are currently available in the installed web app only.'
          :!canInstall?'On iPhone, add GetYourSats to your Home Screen before enabling notifications.'
          :'This browser does not support background payment notifications.'}
      </p>
      :!config?.available?
      <p role="status" className="text-xs text-spark-text-muted">Payment notifications are not enabled on this server yet.</p>
      :<>
        <button type="button" role="switch" aria-checked={enabled} disabled={busy||!pub}
          onClick={()=>{void (enabled?disable():enable());}}
          className="flex w-full items-center justify-between gap-4 rounded-xl border border-spark-border px-4 py-3 text-sm font-medium text-spark-text-primary">
          <span>Payment received alerts</span>
          <span className="text-spark-text-muted">{busy?'Updating…':enabled?'On':'Off'}</span>
        </button>
        {enabled&&<button type="button" onClick={()=>{void preview();}}
          className="min-h-11 rounded-xl border border-spark-border px-4 text-sm text-spark-text-secondary">
          Preview notification
        </button>}
        <p className="text-xs text-spark-text-muted">Lightning Address notifications need separate provider activation. Amounts are hidden from the lock screen.</p>
      </>}
    {message&&<p role="status" className="text-xs text-spark-text-secondary">{message}</p>}
  </section>;
}
