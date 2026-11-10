import type {Payment} from '@breeztech/breez-sdk-spark';
import {selectedNetwork} from './sdkConnect';

const ROOT = 'gys:payment-recipient:v1:';
const GYS_ADDRESS = /^[a-z][a-z0-9]{2,23}@getyoursats\.com$/;
const validIdentity = (identity?: string) => !!identity && /^(02|03)[a-f0-9]{64}$/i.test(identity);
const keyFor = (identity: string, id: string) => `${ROOT}${selectedNetwork()}:${identity.toLowerCase()}:${encodeURIComponent(id)}`;

/** Local address-book metadata only. It never creates a payment or establishes settlement.
 * Save the reviewed recipient against the exact reserved ID, including uncertain sends.
 * A storage failure must not alter authorization, reconciliation or payment outcome. */
export function rememberGysRecipient(identity: string, id: string, recipient: string, amount: string): void {
  if (!validIdentity(identity) || !id || id.length > 256 || !GYS_ADDRESS.test(recipient) || !/^\d+$/.test(amount)) return;
  try { localStorage.setItem(keyFor(identity, id), JSON.stringify({recipient, amount})); } catch { /* best effort display metadata */ }
}

export function paymentRecipient(payment: Payment, identity?: string): string | undefined {
  // LNURL receive descriptions, comments and destinationPubkey identify neither
  // a sender nor a sender's wallet. Never present them as a verified counterparty.
  if (payment.paymentType !== 'send') return;
  if (payment.details?.type === 'lightning') {
    const address = payment.details.lnurlPayInfo?.lnAddress;
    if (address && address.length <= 254 && /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(address)) return address;
  }
  if (payment.method !== 'spark' || payment.details?.type !== 'spark' || payment.details.conversionInfo || payment.conversionDetails || !validIdentity(identity)) return;
  try {
    const value = JSON.parse(localStorage.getItem(keyFor(identity!, payment.id)) ?? 'null');
    if (value && typeof value.recipient === 'string' && GYS_ADDRESS.test(value.recipient) && value.amount === payment.amount.toString()) return value.recipient;
  } catch { /* Missing or invalid metadata never prevents history loading. */ }
}
