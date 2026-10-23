import type {Payment} from '@breeztech/breez-sdk-spark';
import type {Denomination} from './denomination';

export interface PosOrder {
  id: string;
  invoice: string;
  amountSats: number;
  unit: Denomination;
  description: string;
  createdAt: number;
  feeSats: number;
}

const PREFIX = 'gys:merchant:orders:v1:';
const MAX_ORDERS = 50;

/**
 * Store only public payment requests and merchant-entered order metadata.
 * The storage key is scoped to the Spark wallet identity public key, so
 * switching wallets in one browser cannot show another wallet's invoice.
 * Never store mnemonic, signer state or payment-success assertions here.
 */
export function readPosOrders(identityPubkey: string): PosOrder[] {
  if (!identityPubkey || !/^[a-fA-F0-9]{64,130}$/.test(identityPubkey)) return [];
  try {
    const raw = localStorage.getItem(PREFIX + identityPubkey.toLowerCase());
    const data: unknown = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(data)) return [];
    return data.filter((value): value is PosOrder =>
      typeof value === 'object' && value !== null &&
      typeof value.id === 'string' &&
      typeof value.invoice === 'string' && /^ln(bc|tb|bcrt)/i.test(value.invoice) &&
      Number.isSafeInteger(value.amountSats) && value.amountSats > 0 &&
      ['sats','BTC','INR'].includes(value.unit) &&
      typeof value.description === 'string' &&
      Number.isFinite(value.createdAt) &&
      Number.isFinite(value.feeSats)
    ).slice(0, MAX_ORDERS);
  } catch { return []; }
}

export function savePosOrders(identityPubkey: string, orders: PosOrder[]): boolean {
  if (!identityPubkey || !/^[a-fA-F0-9]{64,130}$/.test(identityPubkey)) return false;
  try {
    localStorage.setItem(PREFIX + identityPubkey.toLowerCase(), JSON.stringify(orders.slice(0, MAX_ORDERS)));
    return true;
  } catch { return false; }
}

/** A localStorage flag can never mark a sale paid. Only the current SDK
 * wallet's confirmed incoming Lightning payment matched by BOLT11 may do so.
 * Reconciles after reloading the browser, including missed live events.
 */
export function matchingPosPayment(payment: Payment, order: PosOrder): boolean {
  return payment.paymentType === 'receive'
    && payment.status === 'completed'
    && payment.details?.type === 'lightning'
    && payment.details.invoice.toLowerCase() === order.invoice.toLowerCase()
    && BigInt(payment.amount) >= BigInt(order.amountSats);
}

export function reconcilePosOrders(orders: PosOrder[], payments: Payment[]): Map<string,Payment> {
  const confirmed = new Map<string, Payment>();
  for (const order of orders) {
    const payment = payments.find(p => matchingPosPayment(p, order));
    if (payment) confirmed.set(order.id, payment);
  }
  return confirmed;
}
