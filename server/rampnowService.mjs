/** Authenticated sandbox buy orchestration. No wallet credit or automatic retry. */
import {randomUUID} from 'node:crypto';
import {createRampnowClient, decimalAmount, RampnowError, rampnowOrderState} from './rampnow.mjs';
import {hashRampnowPayload} from './rampnowAuth.mjs';
import {createRampnowCheckoutClient, normalizeRampnowBuyInput} from './rampnowCheckout.mjs';
import {createRampnowStore, RAMPNOW_STORE_PREFIX} from './rampnowStore.mjs';

const BRANCH = 'feat/rampnow-integration-20261028';
const RETURN = 'https://getyoursats-wallet-git-feat-rampnow-integr-d20510-bradvani-8798.vercel.app/rampnow/return';
const ROUTE = {orderType: 'buy', srcCurrency: 'INR', srcChain: 'fiat', dstCurrency: 'BTC', dstChain: 'bitcoin'};
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const need = (value, code) => {if (!value) throw new RampnowError(code);};
const identifier = value => typeof value === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(value);
const canonicalDecimal = value => value.includes('.') ? value.replace(/0+$/, '').replace(/\.$/, '') : value;
function amount(value, precision = 18) {
  need(decimalAmount(value, false, precision), 'RAMPNOW_QUOTE_INVALID');
  const [whole, part = ''] = value.split('.');
  return BigInt(whole) * 10n ** BigInt(precision) + BigInt(part.padEnd(precision, '0'));
}
function quoteView(quote) {
  need(object(quote) && Object.entries(ROUTE).every(([key, value]) => quote[key] === value)
    && decimalAmount(quote.srcAmount) && decimalAmount(quote.dstAmount, true, 8)
    && typeof quote.paymentMode === 'string' && /^[a-z][a-z0-9_]{0,63}$/.test(quote.paymentMode)
    && quote.paymentMode !== 'unknown' && Array.isArray(quote.feeDetails) && quote.feeDetails.length <= 20,
  'RAMPNOW_QUOTE_INVALID');
  const feeDetails = quote.feeDetails.map(fee => {
    need(object(fee) && typeof fee.type === 'string' && /^[a-z][a-z0-9_]{0,63}$/.test(fee.type)
      && decimalAmount(fee.fee, false) && typeof fee.currency === 'string' && /^[A-Z]{3,6}$/.test(fee.currency)
      && typeof fee.isInclusive === 'boolean', 'RAMPNOW_QUOTE_INVALID');
    return {type: fee.type, fee: canonicalDecimal(fee.fee), currency: fee.currency, isInclusive: fee.isInclusive};
  });
  return {...ROUTE, srcAmount: canonicalDecimal(quote.srcAmount), dstAmount: canonicalDecimal(quote.dstAmount),
    paymentMode: quote.paymentMode, feeDetails};
}
function checkScope(env) {
  need(env.VERCEL_ENV === 'preview' && env.VERCEL_PROJECT_ID === 'prj_kVMt4cd9k0WsufaoRCVCH2bpPtWa'
    && env.VERCEL_GIT_COMMIT_REF === BRANCH && env.RAMPNOW_ENVIRONMENT === 'sandbox', 'RAMPNOW_SANDBOX_ONLY');
}

export function createRampnowService({env = process.env, store, now = Date.now,
  client = createRampnowClient({environment: 'sandbox', apiKey: env.RAMPNOW_API_KEY, apiSecret: env.RAMPNOW_API_SECRET}),
  checkout = createRampnowCheckoutClient({apiKey: env.RAMPNOW_API_KEY, apiSecret: env.RAMPNOW_API_SECRET}),
  webhookStore = createRampnowStore({env, now})} = {}) {
  checkScope(env);
  need(store && typeof store.redis === 'function', 'RAMPNOW_STORE_UNAVAILABLE');
  function configuredNetwork() {
    need(env.RAMPNOW_CHECKOUT_ENABLED === 'true', 'RAMPNOW_CHECKOUT_DISABLED');
    need(['testnet', 'signet'].includes(env.RAMPNOW_BITCOIN_TEST_NETWORK), 'RAMPNOW_NETWORK_CONFIRMATION_REQUIRED');
    return env.RAMPNOW_BITCOIN_TEST_NETWORK;
  }
  async function eligible(input) {
    const network = configuredNetwork();
    if (input) need(input.network === network, 'RAMPNOW_NETWORK_MISMATCH');
    const [chain, asset, countries] = await Promise.all([
      client.getBitcoinNetwork(), client.getBitcoinAsset('INR'), client.getBlockedCurrencies('IN'),
    ]);
    need(chain.chain === 'bitcoin' && chain.isTestnet === true && chain.networkClassification === 'testnet_unspecified',
      'RAMPNOW_NETWORK_CONFIRMATION_REQUIRED');
    const rule = Array.isArray(countries.countries) && countries.countries.find(item => item?.country === 'IN');
    need(asset.currency === 'BTC' && asset.chain === 'bitcoin' && asset.orderCurrency === 'INR'
      && asset.status === 'active' && asset.buyOrderRange?.status === 'active'
      && Array.isArray(asset.payinModes) && asset.payinModes.length > 0
      && rule && Array.isArray(rule.blockedCurrencies) && !rule.blockedCurrencies.includes('BTC'), 'RAMPNOW_ROUTE_UNAVAILABLE');
    if (input) {
      need(asset.buyOrderRange.currency === 'INR' && decimalAmount(asset.buyOrderRange.minAmount, false)
        && decimalAmount(asset.buyOrderRange.maxAmount, false), 'RAMPNOW_ROUTE_UNAVAILABLE');
      const source = amount(input.srcAmount);
      const maximum = amount(asset.buyOrderRange.maxAmount);
      need(source >= amount(asset.buyOrderRange.minAmount) && (maximum === 0n || source <= maximum), 'RAMPNOW_AMOUNT_OUT_OF_RANGE');
    }
    return {network, asset};
  }
  async function freshQuote(input, asset) {
    const quote = quoteView(await client.getBitcoinQuote({orderType: 'buy', fiatCurrency: 'INR', srcAmount: input.srcAmount}));
    need(quote.srcAmount === input.srcAmount && asset.payinModes.includes(quote.paymentMode), 'RAMPNOW_QUOTE_MISMATCH');
    return quote;
  }
  async function owned(id, pub) {
    const intent = await store.get(id, pub);
    need(intent, 'RAMPNOW_INTENT_NOT_FOUND');
    return intent;
  }
  async function statusView(intent) {
    let state = null;
    if (intent.phase === 'bound') {
      const raw = await store.redis('GET', RAMPNOW_STORE_PREFIX + 'state:' + intent.externalOrderUid);
      if (raw !== null) {
        try {state = JSON.parse(raw);} catch {throw new RampnowError('RAMPNOW_STORE_UNAVAILABLE');}
        need(object(state) && state.orderUid === intent.orderUid && state.externalOrderUid === intent.externalOrderUid
          && typeof state.status === 'string' && /^[a-z_]{1,64}$/.test(state.status)
          && decimalAmount(state.dstFillAmount, state.status === 'completed', 8)
          && Number.isSafeInteger(state.updatedAt) && state.phase === rampnowOrderState(state.status).phase,
        'RAMPNOW_STORE_UNAVAILABLE');
      }
    }
    return {externalOrderUid: intent.externalOrderUid, phase: intent.phase,
      orderUid: intent.orderUid ?? null, checkoutUrl: intent.checkoutUrl ?? null,
      providerStatus: state?.status ?? null, dstFillAmount: state?.dstFillAmount ?? null,
      needsReconciliation: true, walletReceiptVerified: false};
  }
  return Object.freeze({
    async availability() {
      try {const {network} = await eligible(); return {available: true, reason: 'ready', network, environment: 'sandbox', buyOnly: true};}
      catch {return {available: false, reason: env.RAMPNOW_CHECKOUT_ENABLED === 'true' ? 'network_or_route_unavailable' : 'checkout_disabled',
        network: null, environment: 'sandbox', buyOnly: true};}
    },
    async prepare(pub, rawInput) {
      const input = normalizeRampnowBuyInput(rawInput);
      const {asset} = await eligible(input);
      const quote = await freshQuote(input, asset);
      const clock = now();
      need(Number.isSafeInteger(clock) && clock > 0, 'RAMPNOW_STORE_UNAVAILABLE');
      const record = {externalOrderUid: randomUUID(), walletPubkey: pub, requestHash: hashRampnowPayload(input),
        sourceAmount: input.srcAmount, ...ROUTE, network: input.network,
        destinationHash: hashRampnowPayload(input.destination), quoteHash: hashRampnowPayload(quote),
        createdAt: clock, expiresAt: clock + 120000};
      await store.prepare(record);
      return {externalOrderUid: record.externalOrderUid, quoteHash: record.quoteHash, quote,
        expiresAt: record.expiresAt, destination: input.destination, network: input.network};
    },
    async submit(pub, payload) {
      need(object(payload), 'RAMPNOW_INTENT_INVALID');
      const input = normalizeRampnowBuyInput(payload.input);
      const intent = await owned(payload.externalOrderUid, pub);
      need(intent.requestHash === hashRampnowPayload(input) && payload.quoteHash === intent.quoteHash, 'RAMPNOW_INTENT_CONFLICT');
      if (intent.phase === 'bound') return statusView(intent);
      need(intent.phase === 'prepared', 'RAMPNOW_RECONCILIATION_REQUIRED');
      need(now() < intent.expiresAt, 'RAMPNOW_INTENT_EXPIRED');
      const {asset} = await eligible(input);
      const quote = await freshQuote(input, asset);
      need(hashRampnowPayload(quote) === intent.quoteHash, 'RAMPNOW_QUOTE_CHANGED');
      const reservation = await store.reserve(intent.externalOrderUid, pub, intent.requestHash);
      if (!reservation.reserved) {
        if (reservation.intent.phase === 'bound') return statusView(reservation.intent);
        throw new RampnowError('RAMPNOW_RECONCILIATION_REQUIRED');
      }
      try {
        // A delayed worker consumes its reservation but never submits an expired review.
        need(now() < intent.expiresAt, 'RAMPNOW_INTENT_EXPIRED');
        const result = await checkout.createBuyOrder({externalOrderUid: intent.externalOrderUid, input,
          paymentMode: quote.paymentMode, returnUrl: RETURN + '?intent=' + intent.externalOrderUid});
        const bound = await store.bind(intent.externalOrderUid, pub, intent.requestHash,
          {orderUid: result.orderUid, checkoutUrl: result.redirectUrl});
        return statusView(bound);
      } catch {
        // Even a known HTTP error is conservative here: no second create call.
        try {await store.markUncertain(intent.externalOrderUid, pub, intent.requestHash);} catch { /* Reservation remains consumed. */ }
        throw new RampnowError('RAMPNOW_RECONCILIATION_REQUIRED');
      }
    },
    async status(pub, id) {return statusView(await owned(id, pub));},
    async reconcile(pub, id) {
      let intent = await owned(id, pub);
      if (intent.phase === 'prepared') return {...await statusView(intent), reconciliation: 'not_submitted'};
      const orders = await client.findOrders(id);
      need(Array.isArray(orders) && orders.length <= 100, 'RAMPNOW_RESPONSE_INVALID');
      if (orders.length !== 1) return {...await statusView(intent), reconciliation: orders.length ? 'ambiguous' : 'not_found'};
      const order = orders[0];
      const matches = object(order) && identifier(order.uid) && (!intent.orderUid || order.uid === intent.orderUid)
        && Object.entries(ROUTE).every(([key, value]) => order[key] === value)
        && decimalAmount(order.srcAmount) && canonicalDecimal(order.srcAmount) === intent.sourceAmount
        && typeof order.walletAddress === 'string' && order.walletAddress.length <= 128
        && hashRampnowPayload(order.walletAddress) === intent.destinationHash;
      if (!matches) return {...await statusView(intent), reconciliation: 'mismatch'};
      const updateTime = order.updatedAt;
      need(typeof updateTime === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(updateTime)
        && Number.isFinite(Date.parse(updateTime)) && typeof order.status === 'string'
        && /^[a-z_]{1,64}$/.test(order.status) && decimalAmount(order.dstFillAmount, order.status === 'completed', 8), 'RAMPNOW_RESPONSE_INVALID');
      if (intent.phase !== 'bound') intent = await store.bind(id, pub, intent.requestHash, {orderUid: order.uid, checkoutUrl: null});
      const payload = {orderUid: order.uid, externalOrderUid: id, ...ROUTE, orderStatus: order.status, updateTime, dstFillAmount: order.dstFillAmount};
      await webhookStore.ingest({eventUid: 'lookup-' + hashRampnowPayload(payload), eventType: 'ramp_order.status_change', payload});
      return {...await statusView(intent), reconciliation: 'matched'};
    },
  });
}
