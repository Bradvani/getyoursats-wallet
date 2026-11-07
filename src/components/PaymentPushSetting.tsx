import {useEffect,useId,useRef,useState} from 'react';
import {Capacitor} from '@capacitor/core';
import {useWallet} from '../contexts/WalletContext';
import {selectedNetwork} from '../services/sdkConnect';
import {signedPushOperation,validateInvoiceWebhook,type PushStatus} from '../services/paymentPush';
import {isProviderWebhookId} from '../../shared/pushAuthorization.mjs';
import {usePresentation} from '../hooks/usePresentation';
import {CUSTOMER_SETTINGS} from '../locales/customerSettings';
import {Switch} from './ui';

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
function readableError(value:unknown,copy:typeof CUSTOMER_SETTINGS.en):string{
  if(value instanceof Error&&value.name==='NotAllowedError')
    return copy.blocked;
  return copy.updateError;
}
export default function PaymentPushSetting(){
  const sdk=useWallet();
  const {language}=usePresentation();
  const copy=CUSTOMER_SETTINGS[language];
  const id=useId();
  const [config,setConfig]=useState<Config|null>(null);
  const [enabled,setEnabled]=useState(false);
  const [busy,setBusy]=useState(true);
  const [loadFailed,setLoadFailed]=useState(false);
  const [retryCount,setRetryCount]=useState(0);
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
    setEnabled(false);setPub(null);setConfig(null);setBusy(supported&&canInstall&&mainnet);setMessage('');setInvoiceEnabled(false);setLoadFailed(false);
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
      }catch{if(generation.current===current)setLoadFailed(true);}
      finally{if(generation.current===current)setBusy(false);}
    })();
    return()=>{generation.current=current+1;};
  },[sdk,supported,canInstall,mainnet,retryCount]);

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
      if(permission!=='granted')throw new DOMException('Notification permission not granted','NotAllowedError');
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
          if(!isProviderWebhookId(registered.webhookId))
            throw new Error('Lightning notification registration was not confirmed.');
          webhookId=registered.webhookId;
        }catch(error){
          // The domain-level Breez hook works independently of Spark invoice
          // registration. Report the exact enabled coverage after activation.
          if(!config.lightningAddressPushAvailable)throw error;
        }
      }
      const status=await signedPushOperation<PushStatus>(sdk,pub,'activate',
        {endpoint:subscription.endpoint,webhookId},checkCurrent);
      checkCurrent();setEnabled(status.enabled);setInvoiceEnabled(status.webhookRegistered);
    }catch(error){
      // Revoke the actual endpoint if setup fails or the wallet changes.
      await subscription?.unsubscribe().catch(()=>{});
      if(current===generation.current){setMessage(readableError(error,copy));setEnabled(false);}
    }finally{if(current===generation.current)setBusy(false);}
  };

  const disable=async()=>{
    if(!pub||busy)return;
    setBusy(true);setMessage('');
    const current=generation.current;
    const checkCurrent=()=>{if(current!==generation.current)throw new Error('Wallet settings changed. Please try again.');};
    try{
      const registration=await navigator.serviceWorker.getRegistration('/sw.js');
      const subscription=await registration?.pushManager.getSubscription();
      checkCurrent();
      if(subscription){
        await subscription.unsubscribe();
        checkCurrent();
        setEnabled(false);
        await signedPushOperation(sdk,pub,'unsubscribe',{endpoint:subscription.endpoint},checkCurrent);
      }
      checkCurrent();
      setEnabled(false);
      setMessage(copy.disabled);
    }catch(error){
      if(current===generation.current)setMessage(readableError(error,copy));
    }finally{if(current===generation.current)setBusy(false);}
  };
  const blocked=supported&&Notification.permission==='denied';
  const ready=mainnet&&supported&&canInstall&&config?.available&&!loadFailed&&!blocked;
  const status=!mainnet?copy.network:!canInstall?copy.install:!supported?(native()?copy.native:copy.unsupported)
    :loadFailed?copy.loadError:blocked?copy.blocked:busy&&!config?copy.checking:!config?.available?copy.unavailable:null;
  const retryable=mainnet&&supported&&canInstall&&!busy&&(loadFailed||blocked||!config?.available);
  return <section className="space-y-3" aria-labelledby={id}>
    <div className="gys-setting-toggle">
      <div className="min-w-0">
        <h4 id={id} className="text-sm font-semibold text-spark-text-primary">{copy.alerts}</h4>
        <p id={`${id}-detail`} className="mt-1 text-xs text-spark-text-muted leading-relaxed">{copy.alertsDetail}</p>
      </div>
      {ready&&<Switch checked={enabled} disabled={busy||!pub} aria-labelledby={id} aria-describedby={`${id}-detail`}
        onChange={()=>{void(enabled?disable():enable());}}/>}
    </div>
    {status&&<p role="status" className="text-xs leading-relaxed text-spark-text-muted">{status}</p>}
    {retryable&&<button type="button" className="gys-setting-action" onClick={()=>setRetryCount(value=>value+1)}>{copy.retry}</button>}
    {ready&&<p role="status" className="text-xs leading-relaxed text-spark-text-muted">
      {busy?copy.updating:enabled?config.lightningAddressPushAvailable
        ?invoiceEnabled?copy.allPayments:copy.addressPayments:copy.invoicePayments:copy.off}
    </p>}
    {message&&<p role="status" className="text-xs text-spark-text-secondary">{message}</p>}
  </section>;
}
