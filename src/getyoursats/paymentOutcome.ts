import type {Payment} from '@breeztech/breez-sdk-spark';
export type PaymentExecutionResult = {payment: Payment} | void;
export type PaymentOutcome = 'success' | 'failure' | 'unknown';
/** A resolved call is not a settlement event. Missing or pending status stays uncertain. */
export function paymentOutcome(response: PaymentExecutionResult): PaymentOutcome {
 if(response?.payment?.status==='completed')return 'success';
 if(response?.payment?.status==='failed')return 'failure';
 return 'unknown';
}
