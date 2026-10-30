import {useEffect,useRef,useState} from 'react';
import {Capacitor} from '@capacitor/core';
import {useWallet} from '../contexts/WalletContext';
import {selectedNetwork} from '../services/sdkConnect';
import {signedPushOperation,validateInvoiceWebhook,type PushStatus} from '../services/paymentPush';

type Config={available:boolean;vapidPublicKey:string|null;lightningInvoicePushAvailable:boolean;lightningAddressPushAvailable:boolean};
type Enroll={webhookRegistered:boolean;webhookUrl:string;webhookSecret:string};
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
  const [invoiceEnabled,setInvoiceEnabled]=useState(false);
  const generation=useRef(0);
  const supported=supportsPush();
  const canInstall=isInstalledIos();
  const mainnet=selectedNetwork()==='mainnet';

  useEffect(()=>{
    const current=++generation.current;
    const checkCurrent=()=>{if(generation.current!==current)throw new Error('Wallet settings changed. Please try again.');};
    // Reset immediately when the SDK identity changes so another wallet never
    // inherits an enabled switch or a signing identity while status is loading.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setEnabled(false);setPub(null);setConfig(null);setBusy(supported&&canInstall&&mainnet);setMessage('');setInvoiceEnabled(false);
    if(!supported||!canInstall||!mainnet)return;
    void (async()=>{
      try{
        const response=await fetch('/api/notifications/device',{
          cache:'no-store',credentials:'omit',redirect:'error',signal:AbortSignal.timeout(15_000),
        }).then(res=>{if(!res.ok)throw new Error('Notifications unavailable');return res.json() as Promise<Config>;});
        checkCurrent();setConfig(response);
        if(!response.available)return;
        const info=await sdk.getInfo({ensureSynced:false});
        checkCurrent();
        const wallet=info.identityPubkey?.toLowerCase()??null;
        setPub(wallet);
        if(!wallet||Notification.permission!=='granted')return;
        const registration=await navigator.serviceWorker.getRegistration('/sw.js');
        const subscription=await registration?.pushManager.getSubscription();
        if(!subscription)return;
        const status=await signedPushOperation<PushStatus>(sdk,wallet,'status',
          {endpoint:subscription.endpoint},checkCurrent);
        checkCurrent();setEnabled(status.enabled);setInvoiceEnabled(status.webhookRegistered);
      }catch{if(generation.current===current)setMessage('Could not verify notification settings. You can try enabling them again.');}
      finally{if(generation.current===current)setBusy(false);}
    })();
    return()=>{generation.current=current+1;};
  },[sdk,supported,canInstall,mainnet]);

  const enable=async()=>{
    if(busy||!mainnet||!supported||!canInstall||!config?.available||!config.vapidPublicKey||!pub)return;
    setBusy(true);setMessage('');
    const current=generation.current;
    const checkCurrent=()=>{if(current!==generation.current)throw new Error('Wallet settings changed. Please try again.');};
    let subscription:PushSubscription|null=null;
    try{
      // Request permission directly from this tap, before other awaits.
      const permission=await Notification.requestPermission();
      checkCurrent();
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
      checkCurrent();
      const enrolled=await signedPushOperation<Enroll>(sdk,pub,'subscribe',{subscription:subscription.toJSON()},checkCurrent);
      let webhookId='';
      if(!enrolled.webhookRegistered){
        validateInvoiceWebhook(pub,enrolled);checkCurrent();
        try{
          const registered=await sdk.registerWebhook({
            url:enrolled.webhookUrl,secret:enrolled.webhookSecret,
            eventTypes:[{type:'lightningReceiveFinished'}]
          });
          webhookId=registered.webhookId;
          if(!webhookId)throw new Error('Lightning notification registration was not confirmed.');
        }catch(error){
          // The domain-level Breez hook works independently of Spark invoice
          // registration. Report the exact enabled coverage after activation.
          if(!config.lightningAddressPushAvailable)throw error;
        }
      }
      const status=await signedPushOperation<PushStatus>(sdk,pub,'activate',
        {endpoint:subscription.endpoint,webhookId},checkCurrent);
      checkCurrent();setEnabled(status.enabled);setInvoiceEnabled(status.webhookRegistered);
      setMessage(config.lightningAddressPushAvailable
        ?status.webhookRegistered?'Lightning invoice and @getyoursats.com alerts enabled for this device.'
          :'@getyoursats.com alerts enabled. Lightning invoice alerts could not be enabled.'
        :'Lightning invoice alerts enabled for this device.');
    }catch(error){
      // Revoke the actual endpoint if setup fails or the wallet changes.
      await subscription?.unsubscribe().catch(()=>{});
      if(current===generation.current){setMessage(readableError(error));setEnabled(false);}
    }finally{if(current===generation.current)setBusy(false);}
  };

  const disable=async()=>{
    if(!pub||busy)return;
    setBusy(true);setMessage('');
    try{
      const registration=await navigator.serviceWorker.getRegistration('/sw.js');
      const subscription=await registration?.pushManager.getSubscription();
      if(subscription){
        await subscription.unsubscribe();
        setEnabled(false);
        await signedPushOperation(sdk,pub,'unsubscribe',{endpoint:subscription.endpoint});
      }
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
        Receive a private alert for supported Lightning payments, even when your installed wallet is closed.
        Your keys stay on your device.
      </p>
    </div>
    {!mainnet?<p role="status" className="text-xs text-spark-text-muted">Payment notifications are available on mainnet only.</p>
      :!supported||!canInstall?
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
        <p className="text-xs text-spark-text-muted">
          {config.lightningAddressPushAvailable
            ?'Covers registered @getyoursats.com addresses. Payments to @breez.tips are outside this address webhook.'
            :'Lightning Address alerts are not enabled on this server.'}
          {enabled&&!invoiceEnabled?' Invoice alerts are not enabled for this wallet.':''}
          {' Amounts are hidden from the lock screen. Delivery depends on your device and network.'}
        </p>
      </>}
    {message&&<p role="status" className="text-xs text-spark-text-secondary">{message}</p>}
  </section>;
}
