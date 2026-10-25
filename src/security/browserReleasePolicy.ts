import type {BreezSdk,InputType} from '@breeztech/breez-sdk-spark';

// Only the guarded browser facade exposes this marker. Native wallets retain
// their own policy; the interface is also safe for read-only test SDK doubles.
export const BROWSER_SPENDING_POLICY=Symbol('GetYourSats browser spending policy');
export const isRestrictedBrowserWallet=(wallet:BreezSdk):boolean=>Reflect.get(wallet,BROWSER_SPENDING_POLICY)===true;
export const UNAVAILABLE_PAYMENT_MESSAGE='This payment type is temporarily unavailable in this preview. No payment has been submitted.';
export const UNAVAILABLE_MAX_MESSAGE='Send All is temporarily unavailable. Enter an amount and leave room for the displayed fee.';
export function browserPaymentRestriction(wallet:BreezSdk,input:InputType):string|null {
 if(!isRestrictedBrowserWallet(wallet))return null;
 if(['bitcoinAddress','bolt11Invoice','sparkAddress','lnurlPay','lightningAddress'].includes(input.type))return null;
 return UNAVAILABLE_PAYMENT_MESSAGE;
}
