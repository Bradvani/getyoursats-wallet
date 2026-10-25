import {useEffect,useState} from 'react';
import {useWallet} from '../contexts/WalletContext';
import {invoiceExpiresAt} from '../getyoursats/invoiceExpiry';
/** Fail closed for a malformed/unparsed/expired payment request. Settlement stays SDK-driven. */
export function useInvoiceExpiry(invoice:string){
 const sdk=useWallet();
 const [resolved,setResolved]=useState<{invoice:string;at:number|null}|null>(null);
 const [now,setNow]=useState(Date.now);
 useEffect(()=>{let active=true;if(!invoice)return;
  void sdk.parse(invoice).then(parsed=>{if(active)setResolved({invoice,at:invoiceExpiresAt(parsed)});}).catch(()=>{if(active)setResolved({invoice,at:null});});
  return()=>{active=false;};
 },[sdk,invoice]);
 useEffect(()=>{if(!invoice)return;const id=setInterval(()=>setNow(Date.now()),1000);return()=>clearInterval(id);},[invoice]);
 const current=resolved?.invoice===invoice?resolved:null;
 return {expiresAt:current?.at??null,checking:!!invoice&&!current,usable:!!current?.at&&current.at>now};
}
