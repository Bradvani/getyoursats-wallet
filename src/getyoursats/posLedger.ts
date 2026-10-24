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
const walletKey = (key: string): string | null =>
  /^[0-9a-f]{64,130}$/i.test(key) ? PREFIX + key.toLowerCase() : null;

export function isPosOrder(value: unknown): value is PosOrder {
  if (!value || typeof value !== 'object') return false;
  const x = value as Partial<PosOrder>;
  return typeof x.id === 'string' && x.id.length > 0 && x.id.length <= 120 &&
    typeof x.invoice === 'string' && /^ln(bc|tb|bcrt|sb)[0-9a-z]{20,}$/i.test(x.invoice) &&
    typeof x.amountSats === 'number' && Number.isSafeInteger(x.amountSats) && x.amountSats > 0 &&
    (x.unit === 'sats' || x.unit === 'BTC' || (typeof x.unit === 'string' && /^[A-Z]{3}$/.test(x.unit))) &&
    typeof x.description === 'string' && x.description.length <= 200 &&
    typeof x.createdAt === 'number' && Number.isSafeInteger(x.createdAt) && x.createdAt > 0 &&
    typeof x.feeSats === 'number' && Number.isFinite(x.feeSats) && x.feeSats >= 0;
}

/** The local journal is an untrusted convenience, not merchant accounting.
 * The identity is public and scopes device history; localStorage cannot assert "paid".
 * Never store a seed, spending authority, payment preimage or signed-in account token. */
export function readPosOrders(identityPubkey: string): PosOrder[] {
  const key = walletKey(identityPubkey);
  if (!key) return [];
  try {
    const raw = localStorage.getItem(key);
    const data: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(data) ? data.filter(isPosOrder).slice(0, MAX_ORDERS) : [];
  } catch { return []; }
}

export function savePosOrders(identityPubkey: string, orders: PosOrder[]): boolean {
  const key = walletKey(identityPubkey);
  if (!key) return false;
  try {
    localStorage.setItem(key, JSON.stringify(orders.filter(isPosOrder).slice(0, MAX_ORDERS)));
    return true;
  } catch { return false; }
}

/** Only completed incoming SDK payments that exactly match an invoice are evidence.
 * Spark transfers that lose the originating invoice association are intentionally NOT
 * inferred as paid from amount/time: they require additional authenticated correlation. */
export function matchingPosPayment(payment: Payment, order: PosOrder): boolean {
  if (payment.paymentType !== 'receive' || payment.status !== 'completed') return false;
  const details = payment.details;
  if (!details || details.type !== 'lightning' || typeof details.invoice !== 'string') return false;
  if (details.invoice.toLowerCase() !== order.invoice.toLowerCase()) return false;
  try { return BigInt(payment.amount) >= BigInt(order.amountSats); }
  catch { return false; }
}

export function reconcilePosOrders(orders: PosOrder[], payments: Payment[]): Map<string, Payment> {
  const confirmed = new Map<string, Payment>();
  for (const order of orders) {
    const matching = payments.find(payment => matchingPosPayment(payment, order));
    if (matching) confirmed.set(order.id, matching);
  }
  return confirmed;
}
