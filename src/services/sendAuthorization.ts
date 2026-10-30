import { Capacitor } from '@capacitor/core';
import type { BreezSdk, Seed, SignInResponse } from '@breeztech/breez-sdk-spark';
import { buildBrowserPasskeyClient, getPasskey } from './passkeyService';

export type SendAuthorizationReason =
  | 'cancelled' | 'unavailable' | 'different-wallet' | 'busy' | 'expired' | 'inactive' | 'changed';

/** This error only describes a refusal before a payment reaches the SDK. */
export class SendAuthorizationError extends Error {
  constructor(public readonly reason: SendAuthorizationReason) {
    super('Payment was not sent. Confirm again to authorize with your wallet passkey.');
    this.name = 'SendAuthorizationError';
  }
}

export function isSendAuthorizationError(error: unknown): error is SendAuthorizationError {
  return error instanceof SendAuthorizationError;
}

interface AuthorizationState {
  authorizing: boolean;
  listeners: Set<(authorizing: boolean) => void>;
  cancel: () => void;
}

const authorizationState = Symbol('getyoursats.sendAuthorization');

function stateOf(client: BreezSdk): AuthorizationState | undefined {
  return Reflect.get(client, authorizationState) as AuthorizationState | undefined;
}

export function requiresSendAuthorization(client: BreezSdk): boolean {
  return !!stateOf(client);
}

export function cancelSendAuthorization(client: BreezSdk): void {
  stateOf(client)?.cancel();
}

export function subscribeSendAuthorization(client: BreezSdk, listener: (authorizing: boolean) => void): () => void {
  const state = stateOf(client);
  if (!state) return () => {};
  state.listeners.add(listener);
  listener(state.authorizing);
  return () => { state.listeners.delete(listener); };
}

interface PasskeySendPolicy {
  seed: Seed;
  label: string;
  rpId: string;
  credentialId?: Uint8Array | null;
  isActive?: () => boolean;
}

async function seedFingerprint(seed: Seed): Promise<string> {
  const value = seed.type === 'mnemonic'
    ? ['mnemonic', seed.mnemonic.normalize('NFKD').trim().replace(/\s+/g, ' '), (seed.passphrase ?? '').normalize('NFKD')]
    : ['entropy', Array.from(seed)];
  const encoded = new TextEncoder().encode(JSON.stringify(value));
  try {
    const digest = await crypto.subtle.digest('SHA-256', encoded);
    return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
  } finally {
    encoded.fill(0);
  }
}

function requestValue(request: unknown): string {
  return JSON.stringify(request, (_key, value: unknown) =>
    typeof value === 'bigint' ? { bigint: value.toString() } : value);
}

function sameCredential(expected: Uint8Array, actual?: Uint8Array): boolean {
  return !!actual && expected.length === actual.length && expected.every((byte, index) => byte === actual[index]);
}

/** Capture the session policy once. Mutable storage flags cannot waive it later. */
export async function withPasskeySendAuthorization(client: BreezSdk, policy: PasskeySendPolicy): Promise<BreezSdk> {
  const fingerprint = await seedFingerprint(policy.seed);
  return guardedClient(client, fingerprint, {
    label: policy.label,
    rpId: policy.rpId,
    credentialId: policy.credentialId ? new Uint8Array(policy.credentialId) : null,
    isActive: policy.isActive,
  });
}

function guardedClient(client: BreezSdk, fingerprint: string, policy: Omit<PasskeySendPolicy, 'seed'>): BreezSdk {
  let revoked = false;
  let busy = false;
  let cancelCurrent: ((reason?: SendAuthorizationReason) => void) | undefined;
  const state: AuthorizationState = {
    authorizing: false,
    listeners: new Set(),
    cancel: () => cancelCurrent?.('cancelled'),
  };
  const publish = (authorizing: boolean) => {
    state.authorizing = authorizing;
    for (const listener of state.listeners) {
      try { listener(authorizing); } catch { /* Presentation cannot authorize a payment. */ }
    }
  };
  const assertActive = () => {
    if (revoked || policy.isActive?.() === false || document.visibilityState !== 'visible') {
      throw new SendAuthorizationError('inactive');
    }
  };

  const execute = async (method: 'sendPayment' | 'lnurlPay', request: unknown): Promise<unknown> => {
    assertActive();
    if (busy) throw new SendAuthorizationError('busy');
    busy = true;
    let ceremonySettled = true;
    let operationFinished = false;
    let executionStarted = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let removeListeners = () => {};
    try {
      const snapshot = structuredClone(request);
      const reviewedRequest = requestValue(snapshot);
      let invalidated = false;
      const cancelled = new Promise<never>((_resolve, reject) => {
        const cancel = (reason: SendAuthorizationReason) => {
          invalidated = true;
          reject(new SendAuthorizationError(reason));
        };
        cancelCurrent = (reason = 'inactive') => cancel(reason);
        const onHidden = () => {
          if (document.visibilityState !== 'visible') cancel('inactive');
        };
        const onPageHide = () => cancel('inactive');
        document.addEventListener('visibilitychange', onHidden);
        window.addEventListener('pagehide', onPageHide);
        removeListeners = () => {
          document.removeEventListener('visibilitychange', onHidden);
          window.removeEventListener('pagehide', onPageHide);
        };
        timer = setTimeout(() => cancel('expired'), 60_000);
      });

      publish(true);
      ceremonySettled = false;
      const ceremony = (async (): Promise<SignInResponse> => {
        const request = {
          label: policy.label,
          allowCredentials: policy.credentialId ? [new Uint8Array(policy.credentialId)] : [],
          preferImmediatelyAvailableCredentials: false,
        };
        if (Capacitor.isNativePlatform()) return getPasskey().signIn(request);
        // A one-shot client guarantees a fresh user-verifying PRF ceremony.
        const passkey = buildBrowserPasskeyClient({ rpId: policy.rpId });
        try { return await passkey.signIn(request); }
        finally { passkey.free(); }
      })().finally(() => {
        ceremonySettled = true;
        if (operationFinished) busy = false;
      });
      let response: SignInResponse;
      try {
        response = await Promise.race([ceremony, cancelled]);
      } catch (error) {
        if (isSendAuthorizationError(error)) throw error;
        throw new SendAuthorizationError('cancelled');
      }
      const matches = await seedFingerprint(response.wallet.seed);
      if (matches !== fingerprint || response.wallet.label !== policy.label
        || (policy.credentialId && !sameCredential(policy.credentialId, response.credential?.credentialId))) {
        throw new SendAuthorizationError('different-wallet');
      }
      assertActive();
      if (invalidated) throw new SendAuthorizationError('inactive');
      if (reviewedRequest !== requestValue(request)) throw new SendAuthorizationError('changed');
      clearTimeout(timer);
      removeListeners();
      publish(false);
      assertActive();
      if (invalidated) throw new SendAuthorizationError('inactive');
      cancelCurrent = undefined;
      // No approval is cached. Only this captured request reaches execution.
      executionStarted = true;
      return await Reflect.apply(client[method], client, [snapshot]);
    } catch (error) {
      if (executionStarted || isSendAuthorizationError(error)) throw error;
      throw new SendAuthorizationError('unavailable');
    } finally {
      clearTimeout(timer);
      removeListeners();
      cancelCurrent = undefined;
      publish(false);
      operationFinished = true;
      // A timed-out OS prompt may still be alive. Its late result cannot send,
      // and no second ceremony may race it before it has actually settled.
      if (ceremonySettled) busy = false;
    }
  };

  return new Proxy(client, {
    get(target, property) {
      if (property === authorizationState) return state;
      const value: unknown = Reflect.get(target, property);
      if (typeof value !== 'function') return value;
      if (property === 'sendPayment' || property === 'lnurlPay') {
        return (request: unknown) => execute(property, request);
      }
      if (property === 'disconnect' || property === 'free') {
        return (...args: unknown[]) => {
          revoked = true;
          cancelCurrent?.();
          return Reflect.apply(value, target, args);
        };
      }
      return value.bind(target);
    },
  });
}
