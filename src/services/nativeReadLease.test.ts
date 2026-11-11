import { beforeEach, describe, expect, it } from 'vitest';
import {
  assertNativeReadLease, captureNativeAuthentication, captureNativeReadLease,
  completeNativeAuthentication, confirmNativePinPolicy, getNativePinPolicyRevision,
  invalidateNativePinPolicy, invalidateNativeReadBinding, isNativeReadAccessLocked,
  lockNativeReadAccess,
} from './nativeReadLease';

function visibility(state: string) {
  Object.defineProperty(document, 'visibilityState', { configurable: true, value: state });
  document.dispatchEvent(new Event('visibilitychange'));
}

function policy(enabled: boolean) {
  confirmNativePinPolicy(enabled, getNativePinPolicyRevision());
}

beforeEach(() => {
  visibility('visible');
  invalidateNativePinPolicy();
});

describe('native foreground read lease', () => {
  it('starts closed while durable PIN policy is unknown even if the mirror is absent', () => {
    localStorage.clear();
    expect(isNativeReadAccessLocked()).toBe(true);
    expect(() => captureNativeReadLease()).toThrow(/locked/);
  });

  it('confirmed no-PIN policy permits foreground reads without a credential', () => {
    policy(false);
    expect(() => assertNativeReadLease(captureNativeReadLease())).not.toThrow();
  });

  it('PIN policy requires current authentication and rechecking that policy retains valid access', () => {
    policy(true);
    expect(() => captureNativeReadLease()).toThrow(/locked/);
    completeNativeAuthentication(captureNativeAuthentication());
    const lease = captureNativeReadLease();
    policy(true);
    expect(() => assertNativeReadLease(lease)).not.toThrow();
  });

  it.each(['binding', 'lock', 'background', 'pagehide', 'policy'] as const)(
    'rejects a delayed authentication completion after %s changes', reason => {
      policy(true);
      const authentication = captureNativeAuthentication();
      if (reason === 'binding') invalidateNativeReadBinding();
      if (reason === 'lock') lockNativeReadAccess();
      if (reason === 'background') { visibility('hidden'); visibility('visible'); }
      if (reason === 'pagehide') window.dispatchEvent(new Event('pagehide'));
      if (reason === 'policy') { invalidateNativePinPolicy(); policy(true); }
      expect(() => completeNativeAuthentication(authentication)).toThrow(/changed/);
      expect(() => captureNativeReadLease()).toThrow(/locked/);
    },
  );

  it('brief background cancels an in-flight read while retaining configured foreground permission', () => {
    policy(false);
    const lease = captureNativeReadLease();
    visibility('hidden');
    expect(() => captureNativeReadLease()).toThrow(/foreground/);
    visibility('visible');
    expect(() => assertNativeReadLease(lease)).toThrow(/changed/);
    expect(() => assertNativeReadLease(captureNativeReadLease())).not.toThrow();
  });

  it('actual lock closes both old and new reads until fresh policy permits them', () => {
    policy(false);
    const lease = captureNativeReadLease();
    lockNativeReadAccess();
    expect(() => assertNativeReadLease(lease)).toThrow(/changed/);
    expect(() => captureNativeReadLease()).toThrow(/locked/);
    policy(false);
    expect(() => assertNativeReadLease(lease)).toThrow(/changed/);
    expect(() => captureNativeReadLease()).not.toThrow();
  });

  it('an old no-PIN response cannot undo a newer policy change', () => {
    const old = getNativePinPolicyRevision();
    invalidateNativePinPolicy();
    policy(true);
    expect(() => confirmNativePinPolicy(false, old)).toThrow(/changed/);
    expect(() => captureNativeReadLease()).toThrow(/locked/);
  });

  it.each([undefined, 'unexpected'])('does not treat unavailable/unknown visibility %# as foreground', state => {
    policy(false);
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: state });
    document.dispatchEvent(new Event('visibilitychange'));
    expect(() => captureNativeReadLease()).toThrow(/foreground/);
  });
});
