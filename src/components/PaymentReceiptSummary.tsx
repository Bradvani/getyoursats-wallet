import type {Payment} from '@breeztech/breez-sdk-spark';
import {usePresentation} from '../hooks/usePresentation';
import {trustCopy} from '../getyoursats/trustCopy';
import {PAYMENT_UX} from '../locales/paymentUx';
import {buildTokenDisplayConfig,formatTokenAmount,withAssetDecimals} from '../utils/tokenFormatting';
import {SatAmount} from './SatAmount';
export default function PaymentReceiptSummary({payment,destination}:{payment:Payment;destination?:string}){
 const {language}=usePresentation(),copy=trustCopy(language),ux=PAYMENT_UX[language];
 if(payment.status!=='completed')return null;
 const metadata=payment.details?.type==='token'?payment.details.metadata:null;
 const fee=metadata?formatTokenAmount(payment.fees,withAssetDecimals(buildTokenDisplayConfig(metadata,[]),metadata.decimals),{fullPrecision:true}):<SatAmount sats={payment.fees}/>;
 const recipient=destination??(payment.details?.type==='lightning'?payment.details.lnurlPayInfo?.lnAddress:undefined);
 return <dl className="gys-sequence__receipt" data-testid="payment-receipt-summary">
  {recipient&&payment.paymentType==='send'&&<div><dt>{ux.recipient}</dt><dd dir="auto">{recipient}</dd></div>}
  <div><dt>{copy.networkFee}</dt><dd>{fee}</dd></div>
 </dl>;
}
