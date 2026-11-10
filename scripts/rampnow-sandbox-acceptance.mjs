/** Explicit operator-only sandbox acceptance. Never imported by an HTTP route or
 * normal build. Requires the integration Preview and dedicated sandbox storage.
 * Usage: node scripts/rampnow-sandbox-acceptance.mjs [inspect|diagnose|create accepted|create declined|create expired]
 * Create is one dispatch per fixed case, durably reserved BEFORE the API call.
 * Customer fields are fictitious and contacts use reserved example/fiction ranges.
 * Credentials and recipient private keys never enter the report or build logs.
 */
import {createECDH} from 'node:crypto';
import {mkdir, writeFile} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import {rampnowSignature, decimalAmount} from '../server/rampnow.mjs';
import {sandboxRampnowConfig, normalizeRampnowEvent, RAMPNOW_STORE_PREFIX} from '../server/rampnowStore.mjs';

export const CAMPAIGN = 'gys-sandbox-20261109-ethereum-card-v1';
export const ENABLEMENT_CAMPAIGN = 'gys-sandbox-20261110-checkout-v2';
export const CONFIRMED_CAMPAIGN = 'gys-sandbox-20261110-enabled-v3';
export const CASES = Object.freeze(['accepted', 'declined', 'expired']);
const ROOT = '/api/partner/v1/ext/ramp_order';
const API = 'https://api.sandbox.rampnow.io';
const ROUTE = Object.freeze({orderType: 'buy', srcCurrency: 'EUR', srcChain: 'fiat',
  srcAmount: '50', dstCurrency: 'ETH', dstChain: 'ethereum', paymentMode: 'card'});
const object = x => x !== null && typeof x === 'object' && !Array.isArray(x);
const identifier = x => typeof x === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(x);
const need = (x, code) => { if (!x) throw new Error(code); };
const sameAmount = (x, y) => decimalAmount(x) && decimalAmount(y)
  && x.replace(/(\.\d*?)0+$/, '$1').replace(/\.$/, '') === y.replace(/(\.\d*?)0+$/, '$1').replace(/\.$/, '');

export function requireAcceptanceEnvironment(env) {
  need(env.VERCEL_ENV === 'preview' && env.VERCEL_PROJECT_ID === 'prj_kVMt4cd9k0WsufaoRCVCH2bpPtWa'
    && env.VERCEL_GIT_COMMIT_REF === 'feat/rampnow-integration-20261028'
    && env.RAMPNOW_ENVIRONMENT === 'sandbox' && env.RAMPNOW_STORAGE_SOURCE === 'upstash_sandbox', 'SANDBOX_GUARD');
  need(typeof env.RAMPNOW_API_KEY === 'string' && env.RAMPNOW_API_KEY.length > 0
    && !/[\r\n]/.test(env.RAMPNOW_API_KEY)
    && typeof env.RAMPNOW_API_SECRET === 'string' && env.RAMPNOW_API_SECRET.length > 0, 'SANDBOX_CREDENTIALS_REQUIRED');
  return sandboxRampnowConfig(env);
}

async function boundedJSON(response, max = 2 * 1024 * 1024) {
  need(!response.redirected && response.body, 'RESPONSE_INVALID');
  const reader = response.body.getReader(); const chunks = []; let size = 0;
  try {
    for (;;) {
      const {done, value} = await reader.read(); if (done) break;
      size += value.length;
      if (size > max) { await reader.cancel(); throw new Error('RESPONSE_TOO_LARGE'); }
      chunks.push(Buffer.from(value));
    }
  } finally { reader.releaseLock(); }
  return JSON.parse(new TextDecoder('utf-8', {fatal: true}).decode(Buffer.concat(chunks)));
}

export function safeCheckoutURL(value) {
  need(typeof value === 'string' && value.length <= 4096, 'CHECKOUT_URL_INVALID');
  const url = new URL(value);
  need(url.origin === 'https://app.sandbox.rampnow.io' && !url.username && !url.password && !url.hash,
    'CHECKOUT_URL_INVALID');
  return url.href;
}

export function matchedOrder(order, record) {
  // Get Order scopes the response by external ID in the authenticated request
  // path. Its OrderSummary uses uid; unlike checkout/webhooks, it need not echo
  // externalOrderUid. Reject a contradictory echo if the provider includes one.
  if (!object(order) || (Object.hasOwn(order, 'externalOrderUid')
    && order.externalOrderUid !== record.externalOrderUid)) return false;
  for (const key of ['orderType', 'srcCurrency', 'srcChain', 'dstCurrency', 'dstChain']) {
    if (order[key] !== ROUTE[key]) return false;
  }
  return sameAmount(order.srcAmount, ROUTE.srcAmount)
    && typeof order.walletAddress === 'string' && order.walletAddress.toLowerCase() === record.address.toLowerCase()
    && identifier(order.uid) && (!record.orderUid || order.uid === record.orderUid);
}

async function newRecipient() {
  // This dependency already exists in the unchanged lockfile.
  const {keccak_256} = await import('@noble/hashes/sha3');
  const ecdh = createECDH('secp256k1'); const publicKey = ecdh.generateKeys();
  return {address: '0x' + Buffer.from(keccak_256(publicKey.subarray(1))).subarray(-20).toString('hex'),
    privateKey: ecdh.getPrivateKey().toString('hex')};
}

const RESERVE = `
if redis.call('EXISTS', KEYS[1]) == 1 then return 0 end
redis.call('SET', KEYS[1], 'dispatch_reserved')
redis.call('SET', KEYS[2], ARGV[1], 'EX', 2592000)
return 1
`;

export async function runAcceptance({env = process.env, mode = 'inspect', scenario,
  campaign = CAMPAIGN, fetchImpl = fetch, recipientFactory = newRecipient, now = Date.now} = {}) {
  const config = requireAcceptanceEnvironment(env);
  need([CAMPAIGN, ENABLEMENT_CAMPAIGN, CONFIRMED_CAMPAIGN].includes(campaign), 'CAMPAIGN_INVALID');
  const PREFIX = RAMPNOW_STORE_PREFIX + 'acceptance:' + campaign + ':';
  const externalId = name => campaign + '-' + name;
  need(['inspect','diagnose'].includes(mode) || (mode === 'create' && CASES.includes(scenario)), 'ACTION_INVALID');
  async function redis(command) {
    const response = await fetchImpl(config.url, {method: 'POST', redirect: 'error', cache: 'no-store',
      signal: AbortSignal.timeout(10000), headers: {Authorization: 'Bearer ' + config.token,
        'Content-Type': 'application/json'}, body: JSON.stringify(command)});
    const data = await boundedJSON(response);
    need(response.ok && object(data) && !Object.hasOwn(data, 'error') && Object.hasOwn(data, 'result'), 'STORE_UNAVAILABLE');
    return data.result;
  }
  async function provider(method, path, payload) {
    const body = payload === undefined ? '' : JSON.stringify(payload);
    const timestamp = String(Math.floor(now() / 1000));
    const response = await fetchImpl(API + path, {method, redirect: 'error', signal: AbortSignal.timeout(15000),
      headers: {'Content-Type': 'application/json', 'X-RAMPNOW-API-KEY': env.RAMPNOW_API_KEY,
        'X-RAMPNOW-TIMESTAMP': timestamp,
        'X-RAMPNOW-SIGN': rampnowSignature(env.RAMPNOW_API_SECRET, timestamp, method, path, body)},
      ...(payload === undefined ? {} : {body})});
    const data = await boundedJSON(response);
    if (!response.ok || data?.code !== 0 || !object(data.data)) {
      const error = new Error('PROVIDER_REJECTED');
      error.httpStatus = response.status;
      // Never copy arbitrary provider messages, echoed requests or customer data.
      error.providerCode = typeof data?.code === 'number' && Number.isFinite(data.code) ? data.code : null;
      error.stage = path.endsWith('/quote') ? 'quote' : path.endsWith('/checkout') ? 'checkout'
        : path.endsWith('/chain_config') ? 'chain_config' : path.includes('/asset_config?') ? 'asset_config' : 'lookup';
      error.traceId = typeof data?.traceId === 'string' && /^[A-Za-z0-9_-]{8,128}$/.test(data.traceId) ? data.traceId : null;
      // Documented end-user display text only, bounded and scrubbed of credentials.
      error.displayError = typeof data?.displayError === 'string' && data.displayError.length <= 300
        ? [env.RAMPNOW_API_KEY,env.RAMPNOW_API_SECRET,config.token].reduce((text,secret)=>text.split(secret).join('[redacted]'),data.displayError).replace(/[\u0000-\u001f]/g,' ') : null;
      throw error;
    }
    return data.data;
  }
  const load = async name => {
    const raw = await redis(['GET', PREFIX + name]);
    if (raw === null) return null;
    need(typeof raw === 'string' && Buffer.byteLength(raw) < 16384, 'RECORD_INVALID');
    const record = JSON.parse(raw);
    need(record.externalOrderUid === externalId(name) && /^0x[0-9a-f]{40}$/.test(record.address), 'RECORD_INVALID');
    return record;
  };
  if (mode === 'create' && !(await load(scenario))) {
    const predecessors = campaign === CONFIRMED_CAMPAIGN ? [CAMPAIGN, ENABLEMENT_CAMPAIGN]
      : campaign === ENABLEMENT_CAMPAIGN ? [CAMPAIGN] : [];
    for (const predecessor of predecessors) {
      // Do not replay or erase the first dispatch. A new campaign is allowed
      // only after a fresh, successful lookup proves the explicit entitlement
      // rejection created no order. A timeout or any other failure is not proof.
      const previousId = predecessor + '-accepted';
      const previousRaw = await redis(['GET', RAMPNOW_STORE_PREFIX + 'acceptance:' + predecessor + ':accepted']);
      need(typeof previousRaw === 'string' && Buffer.byteLength(previousRaw) < 16384, 'PREVIOUS_ATTEMPT_UNRESOLVED');
      const previous = JSON.parse(previousRaw);
      need(previous.externalOrderUid === previousId && previous.phase === 'dispatch_requires_reconciliation'
        && previous.failure === 'provider_rejected' && previous.httpStatus === 400 && previous.providerCode === 100004
        && !previous.orderUid && !previous.redirectUrl, 'PREVIOUS_ATTEMPT_UNRESOLVED');
      const lookup = await provider('GET', ROOT + '/' + previousId);
      need(Array.isArray(lookup.orderList) && lookup.orderList.length === 0, 'PREVIOUS_ATTEMPT_UNRESOLVED');
    }
    const chainConfig = await provider('GET', ROOT + '/chain_config');
    need(Array.isArray(chainConfig.chains) && chainConfig.chains.length <= 512, 'CHAIN_UNVERIFIED');
    const chains = chainConfig.chains.filter(c => c?.code === 'ethereum');
    need(chains.length === 1 && Array.isArray(chains[0].supportedAssets)
      && chains[0].supportedAssets.some(a => a === 'ETH' || a === 'ETH:ethereum'), 'CHAIN_UNVERIFIED');
    // Hypermid confirmed simulation is enabled and needs no KYC on 9 Nov.
    // Its sandbox quotes Ethereum/card but not the advertised testnet chains.
    // This disposable fixture is NOT a GYS wallet deposit. Do not infer the
    // delivery network from the chain label. Verify the simulator UI before
    // choosing an outcome and separately inspect any reported transaction.
    const quote = await provider('POST', ROOT + '/quote', ROUTE);
    need(Object.entries(ROUTE).every(([k, v]) => k === 'srcAmount' ? sameAmount(quote[k], v) : quote[k] === v)
      && decimalAmount(quote.dstAmount), 'QUOTE_MISMATCH');
    const recipient = await recipientFactory();
    need(/^0x[0-9a-f]{40}$/.test(recipient.address) && /^[0-9a-f]{64}$/.test(recipient.privateKey), 'RECIPIENT_INVALID');
    const record = {...recipient, externalOrderUid: externalId(scenario), phase: 'dispatch_reserved', createdAt: now()};
    const reserved = await redis(['EVAL', RESERVE, 2, PREFIX + scenario + ':dispatched', PREFIX + scenario, JSON.stringify(record)]);
    need(reserved === 0 || reserved === 1, 'RESERVATION_INVALID');
    if (reserved === 1) {
      try {
        const result = await provider('POST', ROOT + '/checkout', {...ROUTE, externalOrderUid: record.externalOrderUid,
          user: {firstName: 'GetYourSats', lastName: 'Sandbox', email: 'gys-rampnow-20261109@example.invalid',
            phone: '+447700900123', dateOfBirth: '1990-01-01', gender: 'unknown', country: 'GB'},
          wallet: {crytpoAccountDetail: {address: record.address, custodyType: 'unhosted'}}});
        need(identifier(result.orderUid), 'ORDER_RESPONSE_INVALID');
        record.orderUid = result.orderUid;
        record.redirectUrl = safeCheckoutURL(result.redirectUrl);
        record.phase = 'checkout_created';
      } catch (error) {
        record.phase = 'dispatch_requires_reconciliation';
        record.failure = error.message === 'PROVIDER_REJECTED' ? 'provider_rejected' : 'response_unverified';
        record.httpStatus = Number.isInteger(error.httpStatus) ? error.httpStatus : null;
        record.providerCode = typeof error.providerCode === 'number' ? error.providerCode : null;
        record.traceId = error.traceId ?? null;
        record.displayError = error.displayError ?? null;
      }
      // The permanent reservation is intentionally never removed, including on failure.
      need(await redis(['SET', PREFIX + scenario, JSON.stringify(record), 'XX', 'EX', 2592000]) === 'OK', 'STORE_UNAVAILABLE');
    }
  }
  const report = {campaign, checkedAt: new Date(now()).toISOString(), environment: 'sandbox',
    route: ROUTE, realFundsUsed: false, productionReady: false, networkReceiptVerified: false, cases: []};
  if (mode === 'diagnose') {
    report.diagnostics = [];
    const chains = await provider('GET', ROOT + '/chain_config');
    need(Array.isArray(chains.chains) && chains.chains.length <= 512, 'CHAIN_UNVERIFIED');
    const requests = [
      {label:'sepolia_asset',method:'GET',path:ROOT+'/asset_config?currency=ETH&chain=sepolia&orderCurrency=EUR'},
      {label:'sepolia_card',method:'POST',path:ROOT+'/quote',payload:{...ROUTE,dstChain:'sepolia'}},
      {label:'sepolia_default_payment',method:'POST',path:ROOT+'/quote',payload:Object.fromEntries(Object.entries({...ROUTE,dstChain:'sepolia'}).filter(([k])=>k!=='paymentMode'))},
      {label:'base_sepolia_card',method:'POST',path:ROOT+'/quote',payload:{...ROUTE,dstChain:'base-sepolia'}},
      {label:'solana_devnet_card',method:'POST',path:ROOT+'/quote',payload:{...ROUTE,dstCurrency:'SOL',dstChain:'solana-devnet'}},
      // Read-only controls for the sandbox's functioning Ethereum pricing route.
      // No diagnostic result is a wallet network/receipt authorization.
      {label:'ethereum_asset_control',method:'GET',path:ROOT+'/asset_config?currency=ETH&chain=ethereum&orderCurrency=EUR'},
      {label:'ethereum_quote_control',method:'POST',path:ROOT+'/quote',payload:{...ROUTE,dstChain:'ethereum'}},
    ];
    for (const request of requests) {
      const chain=request.payload?.dstChain??'sepolia'; const asset=request.payload?.dstCurrency??'ETH';
      const advertised=chains.chains.filter(c=>c?.code===chain);
      const readOnlyControl=['ethereum_asset_control','ethereum_quote_control'].includes(request.label);
      if(!readOnlyControl && (advertised.length!==1 || advertised[0].isTestnet!==true || !Array.isArray(advertised[0].supportedAssets)
        || !advertised[0].supportedAssets.some(a=>a===asset || a===asset+':'+chain))) {
        report.diagnostics.push({label:request.label,status:'testnet_unverified'});continue;
      }
      try {
        const data=await provider(request.method,request.path,request.payload);
        const row={label:request.label,status:'response_received',creationEligible:false};
        for(const key of ['orderType','srcCurrency','srcChain','dstCurrency','dstChain','paymentMode','currency','chain','orderCurrency','status']) {
          if(typeof data[key]==='string' && /^[A-Za-z0-9_-]{1,64}$/.test(data[key])) row[key]=data[key];
        }
        for(const key of ['srcAmount','dstAmount'])if(decimalAmount(data[key],false))row[key]=data[key];
        if(Array.isArray(data.payinModes))row.payinModes=data.payinModes.filter(x=>typeof x==='string'&&/^[a-z_]{1,64}$/.test(x)).slice(0,32);
        report.diagnostics.push(row);
      } catch(error) {
        report.diagnostics.push({label:request.label,status:'unavailable',stage:error.stage??null,
          httpStatus:error.httpStatus??null,providerCode:error.providerCode??null,traceId:error.traceId??null,displayError:error.displayError??null});
      }
    }
  }
  const rawEvents = await redis(['HGETALL', RAMPNOW_STORE_PREFIX + 'quarantine']);
  need(Array.isArray(rawEvents) && rawEvents.length <= 2000 && rawEvents.length % 2 === 0, 'EVENT_STORE_INVALID');
  for (const name of CASES) {
    const record = await load(name);
    if (!record) { report.cases.push({scenario: name, phase: 'not_created'}); continue; }
    const item = {scenario: name, externalOrderUid: record.externalOrderUid, phase: record.phase,
      orderUid: record.orderUid ?? null, address: record.address,
      failure: record.failure ?? null, httpStatus: record.httpStatus ?? null, providerCode: record.providerCode ?? null,
      traceId: record.traceId ?? null, displayError: record.displayError ?? null,
      redirectUrl: record.redirectUrl ? safeCheckoutURL(record.redirectUrl) : null,
      lookupVerified: false, callbackEvents: [], walletCreditVerified: false};
    try {
      const lookup = await provider('GET', ROOT + '/' + encodeURIComponent(record.externalOrderUid));
      // Bounded diagnostic booleans distinguish contract gaps without copying
      // arbitrary provider fields, customer data or another order's values.
      item.lookupShape = {list: Array.isArray(lookup.orderList), count: Array.isArray(lookup.orderList) ? Math.min(lookup.orderList.length, 1001) : null};
      if (Array.isArray(lookup.orderList) && lookup.orderList.length === 1 && object(lookup.orderList[0])) {
        const candidate = lookup.orderList[0];
        item.lookupShape.fields = Object.fromEntries(['uid','orderUid','externalOrderUid','srcAmount','walletAddress'].map(key =>
          [key, candidate[key] === null ? 'null' : typeof candidate[key]]));
        item.lookupShape.matches = Object.fromEntries(['orderType','srcCurrency','srcChain','dstCurrency','dstChain'].map(key => [key,candidate[key] === ROUTE[key]]));
        item.lookupShape.matches.uid = candidate.uid === record.orderUid;
        item.lookupShape.matches.external = !Object.hasOwn(candidate,'externalOrderUid') || candidate.externalOrderUid === record.externalOrderUid;
        item.lookupShape.matches.amount = Boolean(sameAmount(candidate.srcAmount,ROUTE.srcAmount));
        item.lookupShape.matches.destination = typeof candidate.walletAddress === 'string' && candidate.walletAddress.toLowerCase() === record.address.toLowerCase();
      }
      if (Array.isArray(lookup.orderList) && lookup.orderList.length === 0) item.lookupStatus = 'not_found';
      need(Array.isArray(lookup.orderList) && lookup.orderList.length === 1
        && matchedOrder(lookup.orderList[0], record), 'ORDER_LOOKUP_UNVERIFIED');
      const order = lookup.orderList[0];
      item.orderUid = order.uid; item.lookupVerified = true;
      if (typeof order.status === 'string' && /^[a-z_]{1,64}$/.test(order.status)) item.orderStatus = order.status;
      if (decimalAmount(order.dstFillAmount, false)) item.dstFillAmount = order.dstFillAmount;
      if (Array.isArray(order.transactionHash)) item.transactionHashes = order.transactionHash.filter(x => /^0x[0-9a-fA-F]{64}$/.test(x)).slice(0,10);
    } catch (error) {
      item.lookupStatus ??= 'unverified';
      item.lookupHttpStatus = error.httpStatus ?? null;
      item.lookupProviderCode = error.providerCode ?? null;
    }
    for (let i = 0; i < rawEvents.length; i += 2) {
      try {
        need(typeof rawEvents[i+1] === 'string' && Buffer.byteLength(rawEvents[i+1]) <= 4096, 'EVENT_INVALID');
        const stored = JSON.parse(rawEvents[i+1]); const event = normalizeRampnowEvent(stored.event);
        const p = event.payload;
        if (stored.classification !== 'unbound' || rawEvents[i] !== event.eventUid
          || p.externalOrderUid !== record.externalOrderUid || p.orderUid !== item.orderUid
          || !['orderType','srcCurrency','srcChain','dstCurrency','dstChain'].every(k => p[k] === ROUTE[k])) continue;
        item.callbackEvents.push({eventUid:event.eventUid, status:p.orderStatus, updateTime:p.updateTime,
          dstFillAmount:p.dstFillAmount, receivedAt:stored.receivedAt});
      } catch { /* Unrelated malformed quarantine rows never become evidence. */ }
    }
    report.cases.push(item);
  }
  return report;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const report = await runAcceptance({mode:process.argv[2] ?? 'inspect',scenario:process.argv[3],campaign:process.argv[4] ?? CAMPAIGN});
    await mkdir('dist', {recursive:true});
    await writeFile('dist/rampnow-sandbox-report.json', JSON.stringify(report, null, 2) + '\n');
    console.log(JSON.stringify({check:'rampnow_sandbox_acceptance',campaign:report.campaign,
      cases:report.cases.map(c=>({scenario:c.scenario,phase:c.phase,lookupVerified:c.lookupVerified,
        callbackCount:c.callbackEvents?.length ?? 0})),productionReady:false}));
  } catch (error) {
    const allowed = ['SANDBOX_GUARD','SANDBOX_CREDENTIALS_REQUIRED','ACTION_INVALID','CAMPAIGN_INVALID','PREVIOUS_ATTEMPT_UNRESOLVED','CHAIN_UNVERIFIED',
      'QUOTE_MISMATCH','RECIPIENT_INVALID','RESERVATION_INVALID','STORE_UNAVAILABLE','RECORD_INVALID',
      'EVENT_STORE_INVALID','PROVIDER_REJECTED','RESPONSE_INVALID','RESPONSE_TOO_LARGE'];
    console.error(JSON.stringify({check:'rampnow_sandbox_acceptance',
      failure:allowed.includes(error.message)?error.message:'CHECK_FAILED',
      httpStatus:Number.isInteger(error.httpStatus)?error.httpStatus:null,
      providerCode:typeof error.providerCode==='number'?error.providerCode:null,
      stage:error.stage??null,traceId:error.traceId??null,displayError:error.displayError??null})); process.exitCode=1;
  }
}
