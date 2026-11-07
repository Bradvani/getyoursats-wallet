import { webcrypto } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { BreezSdk, Seed, SignInResponse } from '@breeztech/breez-sdk-spark';
import { Capacitor } from '@capacitor/core';
import { buildBrowserPasskeyClient, getPasskey } from './passkeyService';
import { withNetworkCheckedParse } from '../utils/destinationAddress';
import {
  cancelSendAuthorization,
  isSendAuthorizationError,
  requiresSendAuthorization,
  sendPaymentWithValidation,
  subscribeSendAuthorization,
  withPasskeySendAuthorization,
} from './sendAuthorization';

vi.mock('@capacitor/core', () => ({ Capacitor: { isNativePlatform: vi.fn(() => false) } }));
vi.mock('./passkeyService', () => ({ buildBrowserPasskeyClient: vi.fn(), getPasskey: vi.fn() }));

const seed: Seed = { type: 'mnemonic', mnemonic: 'disposable test seed fixture', passphrase: '' };
const credentialId = new Uint8Array([1, 2, 3]);
const response = (): SignInResponse => ({
  wallet: { seed: { ...seed }, label: 'Primary' },
  labels: [],
  credential: { credentialId: new Uint8Array(credentialId), userId: new Uint8Array([9]) },
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
}

const signIn = vi.fn();
const free = vi.fn();
const nativeSignIn = vi.fn();

beforeEach(() => {
  vi.stubGlobal('crypto', webcrypto);
  vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible');
  vi.mocked(Capacitor.isNativePlatform).mockReturnValue(false);
  signIn.mockReset().mockImplementation(async () => response());
  nativeSignIn.mockReset().mockImplementation(async () => response());
  free.mockReset();
  vi.mocked(buildBrowserPasskeyClient).mockImplementation(() => ({ signIn, free }) as never);
  vi.mocked(getPasskey).mockReturnValue({ signIn: nativeSignIn } as never);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

async function fixture(isActive?: () => boolean) {
  const raw = {
    sendPayment: vi.fn().mockResolvedValue({ payment: { id: 'test', status: 'completed' } }),
    lnurlPay: vi.fn().mockResolvedValue({ payment: { id: 'lnurl', status: 'completed' } }),
    disconnect: vi.fn().mockResolvedValue(undefined),
    free: vi.fn(),
  };
  const client = await withPasskeySendAuthorization(raw as unknown as BreezSdk, {
    seed, label: 'Primary', rpId: 'wallet.getyoursats.com', credentialId, isActive,
  });
  return { client, raw };
}

function request() {
  return { prepareResponse: { amount: 100n, feeSats: 2, paymentMethod: { type: 'bolt11Invoice', invoice: 'test-invoice' } } };
}

describe('passkey send authorization', () => {
  it('runs a request-bound recipient check after approval and before SDK execution', async () => {
    const {client,raw}=await fixture();
    const ceremony=deferred<SignInResponse>();
    signIn.mockReturnValueOnce(ceremony.promise);
    const validate=vi.fn(async()=>{expect(raw.sendPayment).not.toHaveBeenCalled();});
    const reviewed={...request(),idempotencyKey:'00000000-0000-4000-8000-000000000001'};
    const operation=sendPaymentWithValidation(client,reviewed as never,validate);
    expect(validate).not.toHaveBeenCalled();
    ceremony.resolve(response());
    await operation;
    expect(validate).toHaveBeenCalledOnce();
    expect(raw.sendPayment).toHaveBeenCalledWith(reviewed);
  });

  it('cannot send when cancelled during the final recipient check', async () => {
    const {client,raw}=await fixture();
    const checked=deferred<void>();
    const entered=deferred<void>();
    const operation=sendPaymentWithValidation(client,request() as never,async()=>{
      entered.resolve();await checked.promise;
    }).catch(error=>error);
    await entered.promise;
    cancelSendAuthorization(client);
    expect(await operation).toMatchObject({reason:'cancelled'});
    checked.resolve();await checked.promise;
    expect(raw.sendPayment).not.toHaveBeenCalled();
  });

  it('ignores generic SDK proxy fallbacks for unknown symbol properties', () => {
    const fallback = vi.fn(async () => undefined);
    const client = new Proxy({} as BreezSdk, {
      get: (target, property) => Reflect.get(target, property) ?? fallback,
    });
    const listener = vi.fn();
    expect(requiresSendAuthorization(client)).toBe(false);
    expect(() => subscribeSendAuthorization(client, listener)()).not.toThrow();
    expect(() => cancelSendAuthorization(client)).not.toThrow();
    expect(listener).not.toHaveBeenCalled();
    expect(fallback).not.toHaveBeenCalled();
  });

  it.each(['sendPayment', 'lnurlPay'] as const)('requires a new pinned ceremony for each %s call', async method => {
    const { client, raw } = await fixture();
    const reviewed = request();
    await client[method](reviewed as never);
    await client[method](reviewed as never);
    expect(buildBrowserPasskeyClient).toHaveBeenCalledTimes(2);
    expect(buildBrowserPasskeyClient).toHaveBeenCalledWith({ rpId: 'wallet.getyoursats.com' });
    expect(signIn).toHaveBeenCalledWith({ label: 'Primary', allowCredentials: [credentialId], preferImmediatelyAvailableCredentials: false });
    expect(raw[method]).toHaveBeenCalledTimes(2);
    expect(raw[method].mock.calls[0][0]).toEqual(reviewed);
    expect(raw[method].mock.calls[0][0]).not.toBe(reviewed);
    expect(free).toHaveBeenCalledTimes(2);
  });

  it('never executes after cancellation and permits a fresh successful retry', async () => {
    const { client, raw } = await fixture();
    signIn.mockRejectedValueOnce(new DOMException('Cancelled', 'NotAllowedError'));
    await expect(client.sendPayment(request() as never)).rejects.toMatchObject({ reason: 'cancelled' });
    expect(raw.sendPayment).not.toHaveBeenCalled();
    await client.sendPayment(request() as never);
    expect(raw.sendPayment).toHaveBeenCalledTimes(1);
  });

  it.each(['seed', 'label', 'credential', 'missing credential'] as const)('rejects the wrong %s before payment execution', async mismatch => {
    const { client, raw } = await fixture();
    const wrong = response();
    if (mismatch === 'seed') wrong.wallet.seed = { type: 'mnemonic', mnemonic: 'different disposable fixture' };
    if (mismatch === 'label') wrong.wallet.label = 'Other';
    if (mismatch === 'credential') wrong.credential!.credentialId = new Uint8Array([4, 5, 6]);
    if (mismatch === 'missing credential') wrong.credential = undefined;
    signIn.mockResolvedValueOnce(wrong);
    await expect(client.sendPayment(request() as never)).rejects.toMatchObject({ reason: 'different-wallet' });
    expect(raw.sendPayment).not.toHaveBeenCalled();
  });

  it('blocks a duplicate across payment methods while the ceremony is pending', async () => {
    const { client, raw } = await fixture();
    const auth = deferred<SignInResponse>();
    signIn.mockReturnValueOnce(auth.promise);
    const first = client.sendPayment(request() as never);
    await expect(client.lnurlPay(request() as never)).rejects.toMatchObject({ reason: 'busy' });
    expect(signIn).toHaveBeenCalledTimes(1);
    auth.resolve(response());
    await first;
    expect(raw.sendPayment).toHaveBeenCalledTimes(1);
    expect(raw.lnurlPay).not.toHaveBeenCalled();
  });

  it('blocks a duplicate while the authorized SDK execution remains pending', async () => {
    const { client, raw } = await fixture();
    const settlement = deferred<unknown>();
    raw.sendPayment.mockReturnValueOnce(settlement.promise as never);
    const first = client.sendPayment(request() as never);
    await vi.waitFor(() => expect(raw.sendPayment).toHaveBeenCalledTimes(1));
    await expect(client.sendPayment(request() as never)).rejects.toMatchObject({ reason: 'busy' });
    settlement.resolve({});
    await first;
    expect(signIn).toHaveBeenCalledTimes(1);
  });

  it('expires a pending ceremony and discards its late success', async () => {
    const { client, raw } = await fixture();
    vi.useFakeTimers();
    const auth = deferred<SignInResponse>();
    signIn.mockReturnValueOnce(auth.promise);
    const pending = client.sendPayment(request() as never);
    const rejection = expect(pending).rejects.toMatchObject({ reason: 'expired' });
    await vi.advanceTimersByTimeAsync(60_000);
    await rejection;
    await expect(client.sendPayment(request() as never)).rejects.toMatchObject({ reason: 'busy' });
    auth.resolve(response());
    await Promise.resolve();
    await Promise.resolve();
    expect(raw.sendPayment).not.toHaveBeenCalled();
  });

  it.each(['hidden', 'pagehide', 'close'] as const)('discards a ceremony after %s even if authentication later succeeds', async interruption => {
    const { client, raw } = await fixture();
    const auth = deferred<SignInResponse>();
    signIn.mockReturnValueOnce(auth.promise);
    const pending = client.sendPayment(request() as never);
    const rejection = expect(pending).rejects.toMatchObject({ reason: interruption === 'close' ? 'cancelled' : 'inactive' });
    if (interruption === 'hidden') {
      vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
      document.dispatchEvent(new Event('visibilitychange'));
    } else if (interruption === 'pagehide') {
      window.dispatchEvent(new Event('pagehide'));
    } else cancelSendAuthorization(client);
    await rejection;
    vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible');
    auth.resolve(response());
    await Promise.resolve();
    expect(raw.sendPayment).not.toHaveBeenCalled();
  });

  it('refuses a request changed during authentication', async () => {
    const { client, raw } = await fixture();
    const auth = deferred<SignInResponse>();
    signIn.mockReturnValueOnce(auth.promise);
    const reviewed = request();
    const pending = client.sendPayment(reviewed as never);
    reviewed.prepareResponse.amount = 999n;
    auth.resolve(response());
    await expect(pending).rejects.toMatchObject({ reason: 'changed' });
    expect(raw.sendPayment).not.toHaveBeenCalled();
  });

  it.each(['disconnect', 'free'] as const)('revokes pending and future sends on %s', async method => {
    const { client, raw } = await fixture();
    const auth = deferred<SignInResponse>();
    signIn.mockReturnValueOnce(auth.promise);
    const pending = client.sendPayment(request() as never);
    const rejection = expect(pending).rejects.toMatchObject({ reason: 'inactive' });
    await client[method]();
    await rejection;
    auth.resolve(response());
    await expect(client.sendPayment(request() as never)).rejects.toMatchObject({ reason: 'inactive' });
    expect(raw.sendPayment).not.toHaveBeenCalled();
    expect(raw[method]).toHaveBeenCalledTimes(1);
  });

  it('rechecks the active wallet session before execution', async () => {
    let active = true;
    const { client, raw } = await fixture(() => active);
    const auth = deferred<SignInResponse>();
    signIn.mockReturnValueOnce(auth.promise);
    const pending = client.sendPayment(request() as never);
    active = false;
    auth.resolve(response());
    await expect(pending).rejects.toMatchObject({ reason: 'inactive' });
    expect(raw.sendPayment).not.toHaveBeenCalled();
  });

  it('preserves execution errors without misreporting them as unsent', async () => {
    const { client, raw } = await fixture();
    const error = new Error('Connection lost after submitting');
    raw.sendPayment.mockRejectedValueOnce(error);
    await expect(client.sendPayment(request() as never)).rejects.toBe(error);
    expect(isSendAuthorizationError(error)).toBe(false);
  });

  it('publishes authorization state through an outer SDK proxy', async () => {
    const { client, raw } = await fixture();
    const outer = withNetworkCheckedParse(client, 'mainnet');
    const states: boolean[] = [];
    const unsubscribe = subscribeSendAuthorization(outer, value => states.push(value));
    expect(requiresSendAuthorization(outer)).toBe(true);
    raw.sendPayment.mockImplementationOnce(async () => {
      expect(states[states.length - 1]).toBe(false);
      cancelSendAuthorization(outer);
      return {} as never;
    });
    await outer.sendPayment(request() as never);
    expect(states).toEqual([false, true, false, false]);
    unsubscribe();
  });

  it('checks revocation again after notifying the UI that authentication finished', async () => {
    const { client, raw } = await fixture();
    let sawPrompt = false;
    const unsubscribe = subscribeSendAuthorization(client, authorizing => {
      if (authorizing) sawPrompt = true;
      else if (sawPrompt) cancelSendAuthorization(client);
    });
    await expect(client.sendPayment(request() as never)).rejects.toMatchObject({ reason: 'inactive' });
    expect(raw.sendPayment).not.toHaveBeenCalled();
    unsubscribe();
  });

  it('supports the SDK entropy-array seed shape without conflating different entropy', async () => {
    const entropy = Object.assign([1, 2, 3, 4], { type: 'entropy' as const });
    const raw = { sendPayment: vi.fn().mockResolvedValue({}) } as unknown as BreezSdk;
    const client = await withPasskeySendAuthorization(raw, {
      seed: entropy, label: 'Primary', rpId: 'wallet.getyoursats.com', credentialId,
    });
    const signedIn = response();
    signedIn.wallet.seed = Object.assign([1, 2, 3, 5], { type: 'entropy' as const });
    signIn.mockResolvedValueOnce(signedIn);
    await expect(client.sendPayment(request() as never)).rejects.toMatchObject({ reason: 'different-wallet' });
    expect(raw.sendPayment).not.toHaveBeenCalled();
  });

  it('uses a fresh native sign-in with the captured credential', async () => {
    vi.mocked(Capacitor.isNativePlatform).mockReturnValue(true);
    const { client, raw } = await fixture();
    await client.sendPayment(request() as never);
    expect(nativeSignIn).toHaveBeenCalledWith({ label: 'Primary', allowCredentials: [credentialId], preferImmediatelyAvailableCredentials: false });
    expect(buildBrowserPasskeyClient).not.toHaveBeenCalled();
    expect(raw.sendPayment).toHaveBeenCalledTimes(1);
  });
});
