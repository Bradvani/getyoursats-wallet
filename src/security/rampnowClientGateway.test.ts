import {ECDH, generateKeyPairSync, sign, webcrypto} from 'node:crypto';
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import type {BreezSdk, Network, SignMessageRequest} from '@breeztech/breez-sdk-spark';
import {createRampnowBrowserClient, type RampnowBuyInput} from '../services/rampnow';
import {createOperationGateway} from './operationGateway';
import {clearSignerIdentity, getSpendingRequest, rememberSignerIdentity} from './spendApproval';

// Import the actual Node server contract; it deliberately has no browser-facing
// TypeScript declaration. Only its Redis transport is replaced below.
const serverModule = '../../server/rampnowAuth.mjs';
const {createRampnowAuth, hashRampnowPayload} = await import(serverModule);
const ORIGIN = 'https://getyoursats-wallet-git-feat-rampnow-integr-d20510-bradvani-8798.vercel.app';
const ORDER = '12345678-1234-4234-9234-123456789abc';
const QUOTE_HASH = 'cd'.repeat(32);
const INPUT: RampnowBuyInput = {
  srcAmount: '1000', destination: 'tb1qdisposabletestdestination', network: 'signet',
  user: {firstName: 'Test', lastName: 'Buyer', email: 'test@example.invalid', phone: '+919876543210',
    dateOfBirth: '1990-01-02', gender: 'unknown', country: 'IN'},
};
const PREPARED = {
  externalOrderUid: ORDER, quoteHash: QUOTE_HASH, destination: INPUT.destination, network: 'signet',
  expiresAt: 1_900_000_000_000,
  quote: {orderType: 'buy', srcCurrency: 'INR', srcChain: 'fiat', dstCurrency: 'BTC', dstChain: 'bitcoin',
    srcAmount: '1000', dstAmount: '0.0001', paymentMode: 'bank_transfer', feeDetails: []},
};
const STATUS = {
  externalOrderUid: ORDER, phase: 'bound', orderUid: 'disposable_provider_order',
  checkoutUrl: 'https://app.sandbox.rampnow.io/checkout?order=disposable',
  providerStatus: 'created', dstFillAmount: '0', needsReconciliation: true, walletReceiptVerified: false,
};
const json = (value: unknown) => new Response(JSON.stringify(value), {headers: {'content-type': 'application/json'}});

beforeEach(async () => {
  localStorage.clear();
  vi.spyOn(window, 'location', 'get').mockReturnValue({origin: ORIGIN} as Location);
  vi.stubGlobal('crypto', webcrypto);
  await rememberSignerIdentity({type: 'mnemonic', mnemonic: 'disposable gateway contract fixture'});
});
afterEach(() => {clearSignerIdentity(); vi.restoreAllMocks(); vi.unstubAllGlobals();});

function harness(network: Network = 'signet') {
  // Ephemeral keys sign real compact ECDSA proofs without a wallet, provider,
  // storage migration, payment, or network connection. The production gateway,
  // browser client, payload hashing and server proof verifier remain unmocked.
  const {publicKey, privateKey} = generateKeyPairSync('ec', {namedCurve: 'secp256k1'});
  const uncompressed = publicKey.export({format: 'der', type: 'spki'}).subarray(-65);
  const walletPubkey = ECDH.convertKey(uncompressed, 'secp256k1', undefined, undefined, 'compressed').toString('hex');
  const records = new Map<string, string>();
  const redis = vi.fn(async (command: string, ...args: unknown[]) => {
    if (command === 'EVAL') return 1;
    if (command === 'SET') {
      expect(args.slice(2)).toEqual(['EX', 300, 'NX']);
      const key = String(args[0]);
      if (records.has(key)) return null;
      records.set(key, String(args[1]));
      return 'OK';
    }
    if (command === 'GETDEL') {
      const key = String(args[0]), record = records.get(key) ?? null;
      records.delete(key);
      return record;
    }
    throw new Error('Unexpected Redis command');
  });
  const auth = createRampnowAuth({redis, secret: 'disposable-contract-test-secret', origin: ORIGIN});
  const raw = {
    getInfo: vi.fn(async () => ({identityPubkey: walletPubkey})),
    signMessage: vi.fn(async (request: SignMessageRequest) => {
      expect(request.compact).toBe(true);
      return {pubkey: walletPubkey,
        signature: sign('sha256', Buffer.from(request.message), {key: privateKey, dsaEncoding: 'ieee-p1363'}).toString('hex')};
    }),
    sendPayment: vi.fn(),
  };
  const wallet = createOperationGateway(network).protect(raw as unknown as BreezSdk);
  const authenticated: string[] = [];
  const fetchImpl = vi.fn<typeof fetch>(async (url, init) => {
    expect(url).toBe(ORIGIN + '/api/rampnow/checkout');
    const posted = JSON.parse(String(init?.body));
    if (posted.action === 'challenge') return json(await auth.issue({walletPubkey: posted.walletPubkey,
      action: posted.purpose, payloadHash: hashRampnowPayload(posted.payload), clientKey: 'fixture-client'}));
    const proof = await auth.consume({challengeId: posted.challengeId, signature: posted.signature,
      action: posted.action, payloadHash: hashRampnowPayload(posted.payload)});
    expect(proof.walletPubkey).toBe(walletPubkey);
    expect(proof.action).toBe(posted.action);
    authenticated.push(proof.action);
    return json(posted.action === 'prepare' ? PREPARED : STATUS);
  });
  const client = createRampnowBrowserClient({walletPubkey, fetchImpl,
    signMessage: message => wallet.signMessage({message, compact: true})});
  return {client, raw, redis, auth, fetchImpl, authenticated};
}

describe('actual sandbox client through the protected gateway and server proof contract', () => {
  it('authenticates all four checkout operations with verified, single-use compact proofs', async () => {
    const {client, raw, redis, auth, fetchImpl, authenticated} = harness();
    await expect(client.prepare(INPUT)).resolves.toEqual(PREPARED);
    await expect(client.submit({externalOrderUid: ORDER, input: INPUT, quoteHash: QUOTE_HASH})).resolves.toEqual(STATUS);
    await expect(client.status(ORDER)).resolves.toEqual(STATUS);
    await expect(client.reconcile(ORDER)).resolves.toEqual(STATUS);
    expect(authenticated).toEqual(['prepare', 'submit', 'status', 'reconcile']);
    expect(raw.signMessage).toHaveBeenCalledTimes(4);
    expect(redis.mock.calls.filter(([command]) => command === 'GETDEL')).toHaveLength(4);
    expect(raw.sendPayment).not.toHaveBeenCalled();
    expect(getSpendingRequest()).toBeNull();

    const submitted = JSON.parse(String(fetchImpl.mock.calls[fetchImpl.mock.calls.length - 1]?.[1]?.body));
    await expect(auth.consume({challengeId: submitted.challengeId, signature: submitted.signature,
      action: submitted.action, payloadHash: hashRampnowPayload(submitted.payload)})).rejects.toThrow();
  });

  it('keeps the same actual client unable to obtain a mainnet checkout proof', async () => {
    const {client, raw, authenticated} = harness('mainnet');
    await expect(client.status(ORDER)).rejects.toMatchObject({code: 'RAMPNOW_SIGNING_FAILED'});
    expect(raw.signMessage).not.toHaveBeenCalled();
    expect(authenticated).toEqual([]);
  });
});
