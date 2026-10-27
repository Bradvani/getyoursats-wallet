import {TRUST_COPY} from '../getyoursats/trustCopy';
import type {AppLanguage} from '../services/presentationPreferences';
import completion from './flowCompletion.json';
import {PAYMENT_UX} from './paymentUx';
import {PAYMENT_EXPERIENCE} from './paymentExperience';

const aliases:Record<string,string>={
 'Scan':'Scan QR','Enter amount in sats':'Enter amount in {currency}',
 'Processing...':'Processing…','Search contacts...':'Search contacts','Lightning Address':'Lightning address','Lightning Invoice':'Lightning invoice',
 'Authenticated!':'Signed in','Refund Sent!':'Refund sent','Refund Failed':'Refund failed','Payment Sent!':'Payment sent','Payment Failed':'Payment failed',
 'Your payment has been successfully sent to the recipient.':'Your payment has been sent to the recipient.',
 'There was an error processing your refund. Please try again.':'The payment could not be completed. Check payment history before trying again.',
 'There was an error processing your payment. Please try again.':'The payment could not be completed. Check payment history before trying again.',
 'Converting the amount before your payment is sent.':'Converting the amount before sending your payment.',
 'Your payment is processing. We’ll show the result when the network responds.':'Your payment is processing. The result will appear when the network responds.',
 'Check your activity before attempting another payment.':'Check payment history before sending again.',
 'Bitcoin in motion':'Preparing your transfer',
 'Failed to parse payment input':'Invalid payment destination','Failed to prepare LNURL Pay':'Failed to prepare payment',
 'Failed to prepare cross-chain payment':'Failed to prepare payment','Failed to get quote.':'Couldn’t get a quote',
 'Failed to fetch cross-chain routes':'Couldn’t get a quote',
 'Unknown error':'Unable to complete this request. Check the details before trying again.',
 'Failed to save contact':'Unable to complete this request. Check the details before trying again.',
 'Failed to update contact':'Unable to complete this request. Check the details before trying again.',
 'Failed to add contact':'Unable to complete this request. Check the details before trying again.'
};
const dictionaries:Record<AppLanguage,Record<string,string>>={...completion};
for(const catalog of [PAYMENT_UX,PAYMENT_EXPERIENCE,TRUST_COPY]){
 for(const [key,english] of Object.entries(catalog.en)){
  for(const language of Object.keys(dictionaries) as AppLanguage[]){
   const translated=(catalog[language] as Record<string,string>)[key];
   if(translated)dictionaries[language][english]=translated;
  }
 }
}
export function isLocalizedFlowText(language:AppLanguage,text:string):boolean{return Object.values(dictionaries[language]).includes(text);}
export function hasFlowText(text:string):boolean{return Boolean(dictionaries.en[aliases[text]||text]);}
export function flowText(language:AppLanguage,text:string,values:Record<string,string|number>={}):string{
 // Preserve protocol/user/provider data. Only known application copy is translated.
 const key=aliases[text]||text;
 const result=language==='en'?text:dictionaries[language]?.[key]||text;
 return result.replace(/\{([A-Za-z]+)\}/g,(match,name)=>Object.prototype.hasOwnProperty.call(values,name)?String(values[name]):match);
}
