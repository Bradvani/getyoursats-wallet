/**
 * Browser application authorization boundary. The raw SDK stays in this closure.
 * This does not isolate keys from compromised same-origin JavaScript.
 */
import type {
  BreezSdk, Network, PaymentObserver,
  PrepareLnurlPayResponse, ProvisionalPayment, SendPaymentRequest, LnurlPayRequest,
} from '@breeztech/breez-sdk-spark';
import {
  assertCurrentSession, getSpendingSessionEpoch, isSpendingSessionLocked,
  requestSpendingApproval, getSignerIdentityToken,
} from './spendApproval';

// Explicit capabilities: a new SDK method must be reviewed before being exposed.
const PASS_THROUGH = new Set([
  'getInfo', 'listPayments', 'getPayment', 'listUnclaimedDeposits', 'getTokensMetadata',
  'listContacts', 'addContact', 'updateContact', 'deleteContact', 'parse',
  'listFiatCurrencies', 'listFiatRates', 'getLightningAddress', 'checkLightningAddressAvailable',
  'getUserSettings', 'getCrossChainRoutes', 'fetchConversionLimits', 'recommendedFees',
  'fetchClaimDepositQuote', 'receivePayment', 'lnurlWithdraw',
  'addEventListener', 'removeEventListener', 'syncWallet', 'disconnect', 'free',
]);

type Preparation = {epoch:number; deadline:number; used:boolean; kind:'send'|'lnurl'};
type Authorized = {epoch:number; deadline:number; payment:ProvisionalPayment; observed:boolean};
function frozenCopy<T>(value:T):T {
  const copy = structuredClone(value);
  const freeze = (item:unknown):void => {
    if (item && typeof item === 'object') {
      Object.values(item).forEach(freeze);
      Object.freeze(item);
    }
  };
  freeze(copy);
  return copy;
}
function assertUnlocked(epoch:number):void {
  assertCurrentSession(epoch);
  if (isSpendingSessionLocked()) throw new Error('Wallet session is locked');
}
function invoiceExpiry(invoice:{timestamp:number;expiry:number}):number {
  if (!Number.isFinite(invoice.timestamp) || !Number.isFinite(invoice.expiry) || invoice.expiry <= 0)
    throw new Error('Invalid invoice expiry');
  return (invoice.timestamp + invoice.expiry) * 1000;
}
function sats(value:number):bigint {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error('Invalid quoted fee or amount');
  return BigInt(value);
}
function invoiceString(details:PrepareLnurlPayResponse['invoiceDetails']):string {
  return details.invoice.bolt11;
}

export function createOperationGateway(network:Network) {
  const identity = getSignerIdentityToken();
  const assertConnection = () => {
    if (!identity || identity !== getSignerIdentityToken()) throw new Error('Wallet connection identity changed');
  };
  const preparations = new WeakMap<object,Preparation>();
  let active:Authorized|null = null;
  let busy = false;
  let attached = false;
  const observer:PaymentObserver = {
    beforeSend:async payments => {
      const auth = active;
      assertConnection();
      if (!auth || auth.observed) throw new Error('No single-use operation authorization');
      assertUnlocked(auth.epoch);
      if (Date.now() >= auth.deadline) throw new Error('Transaction authorization expired');
      if (payments.length !== 1 || payments[0].amount !== auth.payment.amount ||
          Object.entries(auth.payment.details).some(([key,value]) => Reflect.get(payments[0].details,key) !== value) ||
          Object.keys(payments[0].details).length !== Object.keys(auth.payment.details).length)
        throw new Error('SDK transfer differs from the authorized transaction');
      auth.observed = true;
    },
    afterSend:async()=>{},
  };
  function remember<T extends object>(response:T,kind:Preparation['kind']):T {
    const copy = frozenCopy(response);
    preparations.set(copy,{epoch:getSpendingSessionEpoch(),deadline:Date.now()+60_000,used:false,kind});
    return copy;
  }
  function sendIntent(request:SendPaymentRequest):{payment:ProvisionalPayment;fields:Record<string,string>;expiry:number} {
    const p = request.prepareResponse;
    if (p.conversionEstimate || p.tokenIdentifier || p.feePolicy !== 'feesExcluded')
      throw new Error('Conversion, token and fees-included authorization requires additional review');
    if (p.amount <= 0n) throw new Error('Amount must be positive');
    const m = p.paymentMethod;
    let details:ProvisionalPayment['details'], fee:bigint, expiry = Infinity;
    if (m.type === 'sparkAddress' && !m.tokenIdentifier && !request.options) {
      details = {type:'spark',payRequest:m.address}; fee = m.fee;
    } else if (m.type === 'bolt11Invoice' &&
        (!request.options || (request.options.type === 'bolt11Invoice' && !request.options.preferSpark))) {
      // Force Lightning: an automatic Spark route changes the observer destination.
      details = {type:'lightning',invoice:invoiceString(m.invoiceDetails)};
      fee = sats(m.lightningFeeSats); expiry = invoiceExpiry(m.invoiceDetails);
      const expectedNetwork = network === 'mainnet' ? 'bitcoin' : network;
      if (m.invoiceDetails.network !== expectedNetwork) throw new Error('Invoice network does not match wallet');
    } else if (m.type === 'bitcoinAddress' &&
        (!request.options || request.options.type === 'bitcoinAddress')) {
      const expectedNetwork = network === 'mainnet' ? 'bitcoin' : network;
      if (m.address.network !== expectedNetwork) throw new Error('Address network does not match wallet');
      if (m.feeQuote.isEstimate || !m.feeQuote.id || !Number.isFinite(m.feeQuote.expiresAt))
        throw new Error('An exact unexpired Bitcoin fee quote is required');
      const speed = request.options?.type === 'bitcoinAddress' ? request.options.confirmationSpeed : 'fast';
      const quoted = speed === 'fast' ? m.feeQuote.speedFast : speed === 'medium' ? m.feeQuote.speedMedium : m.feeQuote.speedSlow;
      fee = sats(quoted.userFeeSat) + sats(quoted.l1BroadcastFeeSat);
      details = {type:'bitcoin',withdrawalAddress:m.address.address};
      // SDK uses a 10-second refresh buffer. Reserve 30 seconds and re-prepare.
      expiry = (m.feeQuote.expiresAt - 30) * 1000;
    } else {
      throw new Error('This payment route requires additional authorization review');
    }
    if (fee < 0n) throw new Error('Invalid quoted fee');
    const destination = 'invoice' in details ? details.invoice : 'payRequest' in details ? details.payRequest : details.withdrawalAddress;
    return {payment:{paymentId:'operation',amount:p.amount,details},expiry,fields:{
      Network:network, Asset:'Bitcoin (sats)', Recipient:destination,
      Amount:p.amount.toString()+' sats', 'Maximum quoted fee':fee.toString()+' sats',
      'Maximum debit':(p.amount+fee).toString()+' sats',
      ...(m.type==='bitcoinAddress'?{'Quote ID':m.feeQuote.id,'Quote expiry':new Date(m.feeQuote.expiresAt*1000).toISOString(),
        'Confirmation speed':request.options?.type==='bitcoinAddress'?request.options.confirmationSpeed:'fast'}:{}),
    }};
  }
  async function execute<T>(kind:Preparation['kind'], input:SendPaymentRequest|LnurlPayRequest,
      run:(request:SendPaymentRequest|LnurlPayRequest)=>Promise<T>):Promise<T> {
    if (busy) throw new Error('Another wallet operation is in progress');
    assertConnection();
    const record = preparations.get(input.prepareResponse);
    if (!record || record.kind !== kind || record.used) throw new Error('Prepare a new transaction before authorizing');
    assertUnlocked(record.epoch);
    if (Date.now() >= record.deadline) throw new Error('Prepared transaction expired');
    // Consume before awaiting approval. Cancellation and uncertain execution never reuse it.
    record.used = true;
    busy = true;
    try {
      const request = frozenCopy(input);
      let intent:ReturnType<typeof sendIntent>;
      if (kind === 'send') intent = sendIntent(request as SendPaymentRequest);
      else {
        const p = (request as LnurlPayRequest).prepareResponse;
        if (p.conversionEstimate || p.feePolicy !== 'feesExcluded')
          throw new Error('LNURL conversion and fees-included authorization requires additional review');
        const amount = sats(p.amountSats), fee = sats(p.feeSats);
        if (amount <= 0n) throw new Error('Amount must be positive');
        const expectedNetwork = network === 'mainnet' ? 'bitcoin' : network;
        if (p.invoiceDetails.network !== expectedNetwork) throw new Error('Invoice network does not match wallet');
        intent = {payment:{paymentId:'operation',amount,details:{type:'lightning',invoice:invoiceString(p.invoiceDetails)}},
          expiry:invoiceExpiry(p.invoiceDetails),fields:{Network:network,Asset:'Bitcoin (sats)',
            Recipient:p.payRequest.address ?? p.payRequest.domain, Invoice:invoiceString(p.invoiceDetails),
            Amount:amount.toString()+' sats','Maximum quoted fee':fee.toString()+' sats',
            'Maximum debit':(amount+fee).toString()+' sats',Comment:p.comment ?? ''}};
      }
      const deadline = Math.min(record.deadline,intent.expiry);
      if (Date.now() >= deadline) throw new Error('Payment quote or invoice expired');
      await requestSpendingApproval([intent.payment],intent.fields);
      assertConnection();
      assertUnlocked(record.epoch);
      if (Date.now() >= deadline) throw new Error('Payment quote or invoice expired during approval');
      active = {epoch:record.epoch,deadline,payment:intent.payment,observed:false};
      // One idempotency key is generated inside the boundary for this execution.
      const executable = {...request,idempotencyKey:crypto.randomUUID()};
      if (kind === 'send' && (request as SendPaymentRequest).prepareResponse.paymentMethod.type === 'bolt11Invoice')
        (executable as SendPaymentRequest).options = {type:'bolt11Invoice',preferSpark:false};
      return await run(executable);
    } finally {active = null; busy = false;}
  }
  function protect(raw:BreezSdk):BreezSdk {
    if (attached) throw new Error('Operation gateway already owns an SDK');
    attached = true;
    // Use an empty facade: prototype lookup, mutation and reflection cannot expose raw methods.
    return new Proxy(Object.create(null) as BreezSdk,{
      get:(_target,key)=>{
        if (key === 'prepareSendPayment' || key === 'prepareLnurlPay') return async (input:never)=>{
          assertConnection();
          const epoch = getSpendingSessionEpoch(); assertUnlocked(epoch);
          const response = await raw[key](frozenCopy(input));
          assertConnection();
          assertUnlocked(epoch);
          return remember(response,key === 'prepareSendPayment'?'send':'lnurl');
        };
        if (key === 'sendPayment') return (r:SendPaymentRequest)=>execute('send',r,q=>raw.sendPayment(q as SendPaymentRequest));
        if (key === 'lnurlPay') return (r:LnurlPayRequest)=>execute('lnurl',r,q=>raw.lnurlPay(q as LnurlPayRequest));
        if (typeof key === 'string' && PASS_THROUGH.has(key)) {
          const method = Reflect.get(raw,key);
          return typeof method === 'function' ? method.bind(raw) : undefined;
        }
        if (typeof key === 'symbol' || key === 'then') return undefined;
        return ()=>{throw new Error(`Wallet capability ${String(key)} is unavailable pending security review`)};
      },
      set:()=>false, defineProperty:()=>false, setPrototypeOf:()=>false,
    });
  }
  return {observer,protect};
}
