import {createHash, webcrypto} from 'node:crypto';
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import {createRampnowBrowserClient, RampnowClientError, type RampnowBuyInput} from './rampnow';

const ORIGIN = 'https://getyoursats-wallet-git-feat-rampnow-integr-d20510-bradvani-8798.vercel.app';
const PUBKEY = '0279be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798';
const SIGNATURE = 'ab'.repeat(64);
const CHALLENGE_ID = '12'.repeat(18);
const ORDER_ID = '12345678-1234-4234-9234-123456789abc';
const QUOTE_HASH = 'cd'.repeat(32);
const INPUT: RampnowBuyInput = {
  srcAmount: '1000', destination: 'tb1qtestdestination', network: 'testnet',
  user: {firstName: 'Test', lastName: 'Buyer', email: 'test@example.invalid', phone: '+919876543210',
    dateOfBirth: '1990-01-02', gender: 'unknown', country: 'IN'},
};
const PREPARED = {
  externalOrderUid: ORDER_ID, quoteHash: QUOTE_HASH, destination: INPUT.destination, network: 'testnet',
  expiresAt: 1_900_000_000_000,
  quote: {orderType: 'buy', srcCurrency: 'INR', srcChain: 'fiat', dstCurrency: 'BTC', dstChain: 'bitcoin',
    srcAmount: '1000.00', dstAmount: '0.0001', paymentMode: 'bank_transfer',
    feeDetails: [{type: 'platform', fee: '1', currency: 'INR', isInclusive: true}]},
};
const STATUS = {
  externalOrderUid: ORDER_ID, phase: 'bound', orderUid: 'provider_order_1',
  checkoutUrl: 'https://app.sandbox.rampnow.io/checkout?order=test',
  providerStatus: 'created', dstFillAmount: '0', needsReconciliation: true, walletReceiptVerified: false,
};

const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), {
  status, headers: {'content-type': 'application/json'},
});

function sorted(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sorted);
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0)
      .map(([key, entry]) => [key, sorted(entry)]));
  }
  return value;
}

type Posted = {action: string; purpose?: string; walletPubkey?: string; payload: Record<string, unknown>};

function challengeFor(posted: Posted) {
  const digest = createHash('sha256').update(JSON.stringify(sorted(posted.payload))).digest('hex');
  return {
    challengeId: CHALLENGE_ID, expiresIn: 300,
    message: 'gys-rampnow-v1:' + JSON.stringify(['sandbox', ORIGIN, posted.purpose, digest, CHALLENGE_ID, PUBKEY]),
  };
}

function harness(options: {
  challenge?: (value: ReturnType<typeof challengeFor>) => unknown;
  response?: unknown;
  signMessage?: (message: string) => Promise<{pubkey: string; signature: string}>;
} = {}) {
  const fetchImpl = vi.fn<typeof fetch>(async (_url, init) => {
    if (init?.method === 'GET') {
      return json({available: true, reason: 'ready', network: 'testnet', environment: 'sandbox', buyOnly: true});
    }
    const posted: Posted = JSON.parse(String(init?.body));
    if (posted.action === 'challenge') {
      const challenge = challengeFor(posted);
      return json(options.challenge ? options.challenge(challenge) : challenge);
    }
    return json(options.response ?? (posted.action === 'prepare' ? PREPARED : STATUS));
  });
  const signMessage = vi.fn(options.signMessage ?? (async () => ({pubkey: PUBKEY, signature: SIGNATURE})));
  const client = createRampnowBrowserClient({walletPubkey: PUBKEY, signMessage, fetchImpl, origin: ORIGIN});
  return {client, fetchImpl, signMessage};
}

beforeEach(() => {
  vi.stubGlobal('window', {location: {origin: ORIGIN}});
  vi.stubGlobal('crypto', webcrypto);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('RampNow sandbox browser client', () => {
  it('uses only the pinned same-origin endpoint with bounded, non-cacheable requests', async () => {
    const {client, fetchImpl, signMessage} = harness();
    await expect(client.availability()).resolves.toEqual({
      available: true, reason: 'ready', network: 'testnet', environment: 'sandbox', buyOnly: true,
    });
    expect(signMessage).not.toHaveBeenCalled();
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe(ORIGIN + '/api/rampnow/checkout');
    expect(init).toMatchObject({method: 'GET', credentials: 'same-origin', cache: 'no-store', redirect: 'error'});
    expect(init?.signal).toBeInstanceOf(AbortSignal);
  });

  it.each([
    'https://wallet.getyoursats.com', 'http://localhost:3000', 'https://unrelated.vercel.app',
    'https://getyoursats-wallet-git-feat-rampnow-integr-d20510-bradvani-8798.vercel.app.evil.invalid',
  ])('rejects an untrusted current origin: %s', origin => {
    vi.stubGlobal('window', {location: {origin}});
    expect(() => harness()).toThrowError(expect.objectContaining({code: 'RAMPNOW_ORIGIN_INVALID'}));
  });

  it('does not allow a configured origin to override the current origin', () => {
    expect(() => createRampnowBrowserClient({walletPubkey: PUBKEY, signMessage: vi.fn(), origin: 'https://evil.invalid'}))
      .toThrowError(expect.objectContaining({code: 'RAMPNOW_ORIGIN_INVALID'}));
  });

  it.each([
    {environment: 'production'}, {buyOnly: false}, {network: 'mainnet'}, {reason: 'arbitrary provider text'},
    {available: true, reason: 'checkout_disabled'},
  ])('rejects availability that changes the sandbox contract: %j', altered => {
    const fetchImpl = vi.fn<typeof fetch>(async () => json({
      available: true, reason: 'ready', network: 'testnet', environment: 'sandbox', buyOnly: true, ...altered,
    }));
    const client = createRampnowBrowserClient({walletPubkey: PUBKEY, signMessage: vi.fn(), fetchImpl});
    return expect(client.availability()).rejects.toMatchObject({code: 'RAMPNOW_RESPONSE_INVALID'});
  });

  it('validates the exact server challenge and signs the reconstructed payload-bound message', async () => {
    const {client, fetchImpl, signMessage} = harness();
    await expect(client.prepare(INPUT)).resolves.toEqual(PREPARED);
    const challengeRequest = JSON.parse(String(fetchImpl.mock.calls[0][1]?.body));
    expect(challengeRequest).toEqual({action: 'challenge', purpose: 'prepare', walletPubkey: PUBKEY, payload: {input: INPUT}});
    expect(signMessage).toHaveBeenCalledExactlyOnceWith(challengeFor(challengeRequest).message);
    expect(JSON.parse(String(fetchImpl.mock.calls[1][1]?.body))).toEqual({
      action: 'prepare', payload: {input: INPUT}, challengeId: CHALLENGE_ID, signature: SIGNATURE,
    });
  });

  it.each([
    [0, 'production'], [1, 'https://evil.invalid'], [2, 'submit'], [3, 'ff'.repeat(32)],
    [4, 'ff'.repeat(18)], [5, '03' + 'ff'.repeat(32)],
  ])('never signs a server challenge with substituted tuple field %s', async (index, replacement) => {
    const {client, fetchImpl, signMessage} = harness({challenge: challenge => {
      const tuple = JSON.parse(challenge.message.slice('gys-rampnow-v1:'.length));
      tuple[index] = replacement;
      return {...challenge, message: 'gys-rampnow-v1:' + JSON.stringify(tuple)};
    }});
    await expect(client.prepare(INPUT)).rejects.toMatchObject({code: 'RAMPNOW_AUTH_INVALID'});
    expect(signMessage).not.toHaveBeenCalled();
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it.each([
    {message: 'Please send funds to this address'}, {challengeId: 'AB'.repeat(18)},
    {expiresIn: 301}, {expiresIn: '300'}, {unexpected: 'field'},
  ])('rejects malformed or extended challenges before signing: %j', async changes => {
    const {client, signMessage} = harness({challenge: challenge => ({...challenge, ...changes})});
    await expect(client.prepare(INPUT)).rejects.toMatchObject({code: 'RAMPNOW_AUTH_INVALID'});
    expect(signMessage).not.toHaveBeenCalled();
  });

  it('rejects a semantically equivalent challenge with non-canonical whitespace', async () => {
    const {client, signMessage} = harness({challenge: challenge => ({...challenge, message: challenge.message.replace('[', '[ ')})});
    await expect(client.prepare(INPUT)).rejects.toMatchObject({code: 'RAMPNOW_AUTH_INVALID'});
    expect(signMessage).not.toHaveBeenCalled();
  });

  it('pins the payload across mutations while wallet signing is pending', async () => {
    let release!: (value: {pubkey: string; signature: string}) => void;
    let reached!: () => void;
    const signingReached = new Promise<void>(resolve => { reached = resolve; });
    const {client, fetchImpl} = harness({signMessage: () => {
      reached();
      return new Promise(resolve => { release = resolve; });
    }});
    const input = structuredClone(INPUT);
    const pending = client.prepare(input);
    await signingReached;
    input.srcAmount = '99999';
    input.destination = 'tb1qchanged';
    input.user.email = 'changed@example.invalid';
    release({pubkey: PUBKEY, signature: SIGNATURE});
    await expect(pending).resolves.toEqual(PREPARED);
    expect(JSON.parse(String(fetchImpl.mock.calls[1][1]?.body)).payload).toEqual({input: INPUT});
  });

  it('does not invoke getters or toJSON while constructing a signed payload', async () => {
    const {client, fetchImpl, signMessage} = harness();
    const getter = vi.fn(() => INPUT.srcAmount);
    const badInput = {...INPUT};
    Object.defineProperty(badInput, 'srcAmount', {enumerable: true, get: getter});
    await expect(client.prepare(badInput)).rejects.toMatchObject({code: 'RAMPNOW_PAYLOAD_INVALID'});
    const toJSON = vi.fn(() => INPUT);
    await expect(client.prepare({...INPUT, toJSON} as RampnowBuyInput)).rejects.toMatchObject({code: 'RAMPNOW_PAYLOAD_INVALID'});
    expect(getter).not.toHaveBeenCalled();
    expect(toJSON).not.toHaveBeenCalled();
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(signMessage).not.toHaveBeenCalled();
  });

  it.each([
    {pubkey: '03' + 'ff'.repeat(32), signature: SIGNATURE},
    {pubkey: PUBKEY, signature: 'ab'.repeat(63)},
    {pubkey: PUBKEY, signature: 'not-a-signature'},
  ])('rejects a changed wallet or malformed signature before submission', async signed => {
    const {client, fetchImpl} = harness({signMessage: async () => signed});
    await expect(client.submit({externalOrderUid: ORDER_ID, input: INPUT, quoteHash: QUOTE_HASH}))
      .rejects.toMatchObject({code: 'RAMPNOW_AUTH_INVALID'});
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('expires a challenge after a long wallet prompt', async () => {
    const now = Date.now();
    const {client, fetchImpl} = harness({signMessage: async () => {
      vi.spyOn(Date, 'now').mockReturnValue(now + 300_001);
      return {pubkey: PUBKEY, signature: SIGNATURE};
    }});
    vi.spyOn(Date, 'now').mockReturnValue(now);
    await expect(client.prepare(INPUT)).rejects.toMatchObject({code: 'RAMPNOW_AUTH_CHALLENGE_EXPIRED'});
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it.each(['submit', 'status', 'reconcile'] as const)('purpose-binds %s and never claims wallet receipt', async action => {
    const response = action === 'reconcile' ? {...STATUS, reconciliation: 'matched'} : STATUS;
    const {client, fetchImpl} = harness({response});
    const submit = {externalOrderUid: ORDER_ID, input: INPUT, quoteHash: QUOTE_HASH};
    const result = await (action === 'submit' ? client.submit(submit) : client[action](ORDER_ID));
    expect(result).toEqual(response);
    expect(JSON.parse(String(fetchImpl.mock.calls[0][1]?.body))).toMatchObject({
      action: 'challenge', purpose: action, payload: action === 'submit' ? submit : {externalOrderUid: ORDER_ID},
    });
    expect(JSON.parse(String(fetchImpl.mock.calls[1][1]?.body)).action).toBe(action);
  });

  it.each([
    'http://app.sandbox.rampnow.io/checkout', 'https://app.rampnow.io/checkout',
    'https://app.sandbox.rampnow.io.evil.invalid/checkout', 'https://app.sandbox.rampnow.io:443/checkout',
    'https://app.sandbox.rampnow.io:8443/checkout', 'https://user@app.sandbox.rampnow.io/checkout',
    'https://app.sandbox.rampnow.io/checkout#fragment', 'https://app.sandbox.rampnow.io/checkout#',
    'https://app.sandbox.rampnow.io\\@evil.invalid/checkout', 'javascript:alert(1)',
  ])('rejects an unsafe checkout URL: %s', async checkoutUrl => {
    const {client} = harness({response: {...STATUS, checkoutUrl}});
    await expect(client.status(ORDER_ID)).rejects.toMatchObject({code: 'RAMPNOW_RESPONSE_INVALID'});
  });

  it.each([
    {externalOrderUid: '99999999-1234-4234-9234-123456789abc'}, {walletReceiptVerified: true},
    {phase: 'completed'}, {phase: 'uncertain'}, {dstFillAmount: '0.000000001'},
  ])('rejects a status response outside the bound order contract: %j', async changes => {
    const {client} = harness({response: {...STATUS, ...changes}});
    await expect(client.status(ORDER_ID)).rejects.toMatchObject({code: 'RAMPNOW_RESPONSE_INVALID'});
  });

  it.each([
    {network: 'signet'}, {destination: 'tb1qother'}, {quoteHash: 'bad'},
    {quote: {...PREPARED.quote, dstCurrency: 'USDT'}}, {quote: {...PREPARED.quote, srcAmount: '999'}},
  ])('rejects mismatched quote, destination or network: %j', async changes => {
    const {client} = harness({response: {...PREPARED, ...changes}});
    await expect(client.prepare(INPUT)).rejects.toMatchObject({code: 'RAMPNOW_RESPONSE_INVALID'});
  });

  it('returns only fixed safe errors and never retains provider details', async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => json({error: 'private customer text', message: INPUT.user.email}, 500));
    const client = createRampnowBrowserClient({walletPubkey: PUBKEY, signMessage: vi.fn(), fetchImpl});
    const error = await client.availability().catch(error => error);
    expect(error).toBeInstanceOf(RampnowClientError);
    expect(error).toMatchObject({code: 'RAMPNOW_UNAVAILABLE', message: 'Sandbox checkout is unavailable. Please check again later.'});
    expect(JSON.stringify(error)).not.toContain(INPUT.user.email);
    expect(JSON.stringify(error)).not.toContain('private customer text');
  });

  it('uses a fixed message for an allowlisted server error', async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => json({error: 'RAMPNOW_AUTH_RATE_LIMITED', message: INPUT.user.email}, 429));
    const client = createRampnowBrowserClient({walletPubkey: PUBKEY, signMessage: vi.fn(), fetchImpl});
    await expect(client.availability()).rejects.toMatchObject({
      code: 'RAMPNOW_AUTH_RATE_LIMITED', message: 'Too many checkout requests. Please wait before continuing.',
    });
  });

  it('bounds response bodies even without content-length', async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => json({data: 'x'.repeat(64 * 1024)}));
    const client = createRampnowBrowserClient({walletPubkey: PUBKEY, signMessage: vi.fn(), fetchImpl});
    await expect(client.availability()).rejects.toMatchObject({code: 'RAMPNOW_RESPONSE_TOO_LARGE'});
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('rejects an oversized declared response before reading it', async () => {
    const cancel = vi.fn();
    const body = new ReadableStream({cancel});
    const fetchImpl = vi.fn<typeof fetch>(async () => new Response(body, {
      headers: {'content-type': 'application/json', 'content-length': '65537'},
    }));
    const client = createRampnowBrowserClient({walletPubkey: PUBKEY, signMessage: vi.fn(), fetchImpl});
    await expect(client.availability()).rejects.toMatchObject({code: 'RAMPNOW_RESPONSE_TOO_LARGE'});
    expect(cancel).toHaveBeenCalled();
  });

  it('times out a stalled response stream and cancels it', async () => {
    vi.useFakeTimers();
    const cancel = vi.fn();
    const fetchImpl = vi.fn<typeof fetch>(async () => new Response(new ReadableStream({cancel}), {
      headers: {'content-type': 'application/json'},
    }));
    const client = createRampnowBrowserClient({walletPubkey: PUBKEY, signMessage: vi.fn(), fetchImpl});
    const check = expect(client.availability()).rejects.toMatchObject({code: 'RAMPNOW_REQUEST_TIMEOUT'});
    await vi.advanceTimersByTimeAsync(15_000);
    await check;
    expect(cancel).toHaveBeenCalled();
    expect(fetchImpl.mock.calls[0][1]?.signal?.aborted).toBe(true);
  });

  it('does not retry an uncertain create request or leak network errors', async () => {
    const {client, fetchImpl} = harness();
    fetchImpl.mockImplementationOnce(async (_url, init) => json(challengeFor(JSON.parse(String(init?.body)))));
    fetchImpl.mockImplementationOnce(async () => { throw new Error(INPUT.user.email); });
    await expect(client.submit({externalOrderUid: ORDER_ID, input: INPUT, quoteHash: QUOTE_HASH}))
      .rejects.toMatchObject({code: 'RAMPNOW_REQUEST_FAILED', message: 'Could not confirm checkout. Check its status before continuing.'});
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });
});
