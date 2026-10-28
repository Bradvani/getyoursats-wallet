import type {BreezSdk,InputType,ReceivePaymentRequest} from '@breeztech/breez-sdk-spark';
import {getDepositClaims} from './depositClaimController';

// Only the guarded browser facade exposes this marker. Native wallets retain
// their own policy; the interface is also safe for read-only test SDK doubles.
export const BROWSER_SPENDING_POLICY=Symbol('GetYourSats browser spending policy');
export const isRestrictedBrowserWallet=(wallet:BreezSdk):boolean=>Reflect.get(wallet,BROWSER_SPENDING_POLICY)===true;
export const UNAVAILABLE_PAYMENT_MESSAGE='This payment type is temporarily unavailable in this preview. No payment has been submitted.';
export const UNAVAILABLE_MAX_MESSAGE='Send All is temporarily unavailable. Enter an amount and leave room for the displayed fee.';
export const UNAVAILABLE_LIGHTNING_RECEIVE_MESSAGE='Lightning receiving is unavailable in this security preview. Do not fund existing Lightning addresses or invoices.';
export const UNAVAILABLE_BITCOIN_RECEIVE_MESSAGE='Bitcoin receiving is unavailable in this security preview. Do not fund existing deposit addresses.';
export const REGTEST_DEPOSIT_RECEIVE_MESSAGE='Regtest Bitcoin receive is for valueless test funds only. Deposit claims require an explicit review.';
/** Creating a payable request is only allowed when its matching claim path is exposed. */
export function browserReceivingRouteRestriction(type:ReceivePaymentRequest['paymentMethod']['type'],depositClaimsAvailable:boolean):string|null {
 if(type==='sparkAddress'||type==='sparkInvoice')return null;
 if(type==='bolt11Invoice')return UNAVAILABLE_LIGHTNING_RECEIVE_MESSAGE;
 if(type==='bitcoinAddress')return depositClaimsAvailable?null:UNAVAILABLE_BITCOIN_RECEIVE_MESSAGE;
 return 'This receiving route is unavailable pending security review';
}
export function browserReceivingRestriction(wallet:BreezSdk,type:ReceivePaymentRequest['paymentMethod']['type']):string|null {
 if(!isRestrictedBrowserWallet(wallet))return null;
 return browserReceivingRouteRestriction(type,getDepositClaims(wallet)!==null);
}
export function browserPaymentRestriction(wallet:BreezSdk,input:InputType):string|null {
 if(!isRestrictedBrowserWallet(wallet))return null;
 if(['bitcoinAddress','bolt11Invoice','sparkAddress','lnurlPay','lightningAddress'].includes(input.type))return null;
 return UNAVAILABLE_PAYMENT_MESSAGE;
}
