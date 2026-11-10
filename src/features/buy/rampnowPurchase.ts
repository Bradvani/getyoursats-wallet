import type {RampnowBuyInput, RampnowCheckoutStatus, RampnowPreparedCheckout, RampnowQuote, createRampnowBrowserClient} from '../../services/rampnow';

export const RAMPNOW_PREVIEW_ORIGIN = 'https://getyoursats-wallet-git-feat-rampnow-integr-d20510-bradvani-8798.vercel.app';
type Client = ReturnType<typeof createRampnowBrowserClient>;
export type PurchaseReference = {id: string; createdAt: number};
const uuid = (v: unknown): v is string => typeof v === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(v);

const FLOW_ERRORS = {
  session: 'Wallet session changed. Reopen the purchase.',
  busy: 'Please wait for the current request.',
  consumed: 'Check the saved purchase status before continuing.',
  expired: 'This quote expired. Check its status to review a new quote.',
  unresolved: 'A saved purchase may already have started. Check its status before reviewing another quote.',
} as const;
export class PurchaseFlowError extends Error {
  constructor(code: keyof typeof FLOW_ERRORS) {super(FLOW_ERRORS[code]);this.name='PurchaseFlowError';}
}

/** An empty lookup or failed provider payment is NOT proof of no dispatch. */
export function canReviewPurchaseAgain(status: RampnowCheckoutStatus): boolean {
  return status.phase === 'prepared' && status.reconciliation === 'not_submitted'
    && status.orderUid === null && status.checkoutUrl === null && status.providerStatus === null
    && status.dstFillAmount === null;
}

/** Do not offer payment again while delivery is processing or reconciliation
 * is missing, ambiguous or mismatched, even if a saved hosted URL exists. */
export function canOpenPurchaseCheckout(status: RampnowCheckoutStatus): boolean {
  return status.phase === 'bound' && status.orderUid !== null && status.checkoutUrl !== null
    && (status.reconciliation === undefined || status.reconciliation === 'matched')
    && (status.providerStatus === null || status.providerStatus === 'created');
}

/** Keep fee currencies separate and never round money through JS floats. */
export function checkoutAmounts(quote: RampnowQuote): {currency: string; amount: string}[] {
  const scale=10n**18n;
  const amount=(value:string)=>{
    if(!/^(0|[1-9]\d*)(\.\d{1,18})?$/.test(value)) throw new Error('Invalid quote amount.');
    const [whole,part='']=value.split('.');return BigInt(whole)*scale+BigInt(part.padEnd(18,'0'));
  };
  const totals=new Map<string,bigint>([[quote.srcCurrency,amount(quote.srcAmount)]]);
  for(const fee of quote.feeDetails) if(!fee.isInclusive) totals.set(fee.currency,(totals.get(fee.currency)??0n)+amount(fee.fee));
  return [...totals].map(([currency,value])=>({currency,amount:(value/scale).toString()+
    (value%scale?'.'+(value%scale).toString().padStart(18,'0').replace(/0+$/,''): '')}));
}

export function rampnowPreviewAccess(origin: string, network: string | undefined): boolean {
  return origin === RAMPNOW_PREVIEW_ORIGIN && network === 'signet';
}

/** Navigation context only. The API must authenticate the owning wallet. */
export function rampnowReturnIntent(url: URL): string | null {
  const intent = url.searchParams.get('intent');
  return rampnowPreviewAccess(url.origin, url.searchParams.get('network') ?? undefined)
    && url.pathname === '/rampnow/return' && !url.hash && [...url.searchParams].length === 2
    && url.searchParams.getAll('intent').length === 1 && url.searchParams.getAll('network').length === 1
    && uuid(intent) ? intent : null;
}

/** No identity/profile, destination, signature, quote or checkout token is stored.
 * Browser references are untrusted hints, never ownership or receipt evidence. */
export function purchaseReferences(storage: Pick<Storage, 'getItem' | 'setItem'>, walletPubkey: string) {
  if (!/^(02|03)[a-f0-9]{64}$/i.test(walletPubkey)) throw new Error('Reconnect your wallet.');
  const key = 'gys:rampnow:sandbox:signet:v1:' + walletPubkey.toLowerCase();
  function list(): PurchaseReference[] {
    const raw = storage.getItem(key);
    if (raw === null) return [];
    if (raw.length > 16384) throw new Error('Purchase history could not be read.');
    const rows: unknown = JSON.parse(raw);
    if (!Array.isArray(rows) || rows.length > 50 || !rows.every(row => row && uuid(row.id)
      && Number.isSafeInteger(row.createdAt) && row.createdAt > 0 && Object.keys(row).length === 2)
      || new Set(rows.map(row => row.id)).size !== rows.length) throw new Error('Purchase history could not be read.');
    return rows;
  }
  return {
    list,
    remember(id: string) {
      if (!uuid(id)) throw new Error('Invalid purchase reference.');
      const rows = list();
      if (rows.some(row => row.id === id)) return;
      if (rows.length >= 50) throw new Error('Purchase history is full. Contact support before starting another purchase.');
      storage.setItem(key, JSON.stringify([{id, createdAt: Date.now()}, ...rows]));
      if (!list().some(row => row.id === id)) throw new Error('Could not save the purchase reference.');
    },
  };
}

/** Each reviewed intent can be submitted once per controller. Persist BEFORE
 * dispatch; after reload only status/reconcile are possible, never resubmission. */
export function createPurchaseController(client: Client, references: ReturnType<typeof purchaseReferences>) {
  let review: {input: RampnowBuyInput; prepared: RampnowPreparedCheckout} | null = null;
  let busy = false;
  let alive = true;
  const check = () => {if (!alive) throw new PurchaseFlowError('session');};
  return {
    dispose() {alive = false; review = null;},
    async prepare(input: RampnowBuyInput) {
      check(); if (busy) throw new PurchaseFlowError('busy');
      busy = true; review = null;
      try {
        const copy: RampnowBuyInput = structuredClone(input);
        // Reloaded references are hints only. Authenticate every saved intent
        // before replacing an unsubmitted review with a new quote. Never clear
        // old references or reuse a submitted/uncertain intent's create action.
        for (const reference of references.list()) {
          const status = await client.reconcile(reference.id); check();
          if (status.externalOrderUid !== reference.id || !canReviewPurchaseAgain(status)) {
            throw new PurchaseFlowError('unresolved');
          }
        }
        const prepared = await client.prepare(copy); check();
        references.remember(prepared.externalOrderUid);
        review = {input: copy, prepared: structuredClone(prepared)};
        return prepared;
      } finally {busy = false;}
    },
    async submit(): Promise<RampnowCheckoutStatus> {
      check(); if (busy || !review) throw new PurchaseFlowError('consumed');
      const reviewed = review;
      if (Date.now() >= reviewed.prepared.expiresAt) {review = null; throw new PurchaseFlowError('expired');}
      references.remember(reviewed.prepared.externalOrderUid);
      busy = true; review = null; // consumed before the first await, including failures
      try {
        const result = await client.submit({externalOrderUid: reviewed.prepared.externalOrderUid,
          quoteHash: reviewed.prepared.quoteHash, input: reviewed.input});
        check(); return result;
      } finally {busy = false;}
    },
    async reconcile(id: string) {
      check(); if (busy) throw new PurchaseFlowError('busy');
      busy = true; review = null;
      try {
        const result = await client.reconcile(id); check();
        references.remember(result.externalOrderUid); return result;
      } finally {busy = false;}
    },
  };
}

export function purchaseStatusText(status: RampnowCheckoutStatus): string {
  if (status.reconciliation === 'not_found') return 'The provider has not confirmed this purchase. Keep this reference and check again before making another payment.';
  if (status.reconciliation === 'ambiguous' || status.reconciliation === 'mismatch') return 'This purchase needs support review. Do not make another payment for it.';
  if (status.providerStatus === 'completed') return 'The payment provider reports completion. Bitcoin receipt in your wallet is still unverified.';
  if (status.providerStatus === 'payment_failed') return 'The payment was declined. Late updates are still being checked.';
  if (status.providerStatus === 'expired') return 'Checkout expired. Check again if you already paid.';
  if (status.providerStatus === 'failed') return 'Delivery is delayed. Keep this reference while the purchase is checked.';
  if (status.phase === 'prepared') return 'No checkout was submitted for this reference. Review a fresh quote to continue.';
  if (status.phase !== 'bound') return 'Checkout could not be confirmed. Check its status before starting another purchase.';
  return 'Your purchase is awaiting a verified payment and wallet receipt.';
}
