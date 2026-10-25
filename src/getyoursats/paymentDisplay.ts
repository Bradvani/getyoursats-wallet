import type {Payment} from '@breeztech/breez-sdk-spark';
import {getTokenAmountFromPayment} from '../utils/tokenFormatting';
import {formatMoney} from './money';
export function displayPaymentAmount(payment:Payment):string {
 const token=getTokenAmountFromPayment(payment);
 return token?formatMoney({kind:'token',amount:token.amount,decimals:token.metadata.decimals,ticker:token.metadata.ticker}):formatMoney({kind:'sats',amount:payment.amount});
}
