import {openExternalUrl} from '@/utils/externalLink';
import {SUPPORT_URL} from '@/constants/publicPages';
import {PAYMENT_UX} from '@/locales/paymentUx';
import React from 'react';
import {QRCodeContainer,QrPlaceholder,CopyableText} from '../../components/ui';
import {useToast} from '../../contexts/ToastContext';
import {selectedNetwork} from '../../services/sdkConnect';
import {usePresentation} from '../../hooks/usePresentation';
import {trustCopy} from '../../getyoursats/trustCopy';
import {PAYMENT_HISTORY_COPY} from '../../locales/paymentHistoryCopy';
interface Props {address:string|null;isLoading:boolean;error?:string|null;onRetry?:()=>void;section:'qr'|'details';qrSize?:number;qrCardClassName?:string}
const BitcoinAddressDisplay:React.FC<Props>=({address,isLoading,error,onRetry,section,qrSize,qrCardClassName})=>{
 const {showToast}=useToast(); const {language}=usePresentation(); const text=trustCopy(language);
 const network=selectedNetwork();
 const depositCopy=PAYMENT_HISTORY_COPY[language];
 if(section==='qr')return address&&!error?<QRCodeContainer value={address} size={qrSize} cardClassName={qrCardClassName}/>:isLoading?<div role="status" aria-label={text.loadingAddress}><QrPlaceholder size={qrSize} cardClassName={qrCardClassName}/></div>:<div role="alert" className="rounded-xl border border-spark-border p-4 text-sm text-spark-text-secondary"><p>{text.addressFailed}</p><button type="button" onClick={onRetry} disabled={!onRetry} className="mt-3 min-h-11 text-spark-primary">{text.retry}</button></div>;
 return <div className="w-full space-y-3 text-sm text-spark-text-secondary">
   <h3 className="font-semibold text-spark-text-primary">{text.bitcoinDeposit}</h3>
   <p>{text.network}: {network==='mainnet'?'Bitcoin':network}</p>
   {address&&!error&&<CopyableText text={address} truncate showShare label={text.bitcoinDeposit} onCopied={()=>showToast('success',text.copySuccess)} onShareError={()=>showToast('error',text.copyFailure)} data-testid="bitcoin-address-text"/>}
   <div className="gys-deposit-guidance"><p className="font-medium text-spark-text-primary">{depositCopy.depositOnly}</p><p>{depositCopy.depositTiming}</p><p>{depositCopy.depositCosts}</p></div>
   <button type="button" className="min-h-11 text-spark-primary underline" onClick={()=>void openExternalUrl(SUPPORT_URL+'?lang='+language+'#how-your-wallet-works')}>{PAYMENT_UX[language].howWalletWorks}</button>
 </div>;
};
export default BitcoinAddressDisplay;
