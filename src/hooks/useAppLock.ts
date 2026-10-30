/**
 * App-lock lifecycle (native only). Locked when a PIN is set and the
 * app cold-starts, returns from the background past the auto-lock
 * timeout (0 = lock the moment it backgrounds), or sits idle in the
 * foreground for that same timeout. Native read access starts closed until
 * durable PIN policy is known. The read lease is separate from browser signer
 * state and is revoked by this UI lock; mirrors only supply timeout/UI hints.
 */

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import {
  clearPin,
  getAutoLockSeconds,
  getAutoLockSecondsSync,
  isAppLockSupported,
  isBiometricGateEnabled,
  isBiometricGateEnabledSync,
  isIdleLockSuppressed,
  isPinEnabled,
  PIN_RECORD_UNAVAILABLE_MESSAGE,
  verifyPin,
} from '@/services/appLock';
import type { PinVerifyResult } from '@/services/appLock';
import {
  deviceOnlyStorage,
  secureStorage,
  tryAuthenticateBiometric,
} from '@/services/secureStorage';
import { isPasskeyMode } from '@/services/passkeyService';
import { logger, LogCategory } from '@/services/logger';
import {
  captureNativeAuthentication, completeNativeAuthentication, confirmNativePinPolicy,
  getNativePinPolicyRevision, getNativeReadLeaseRevision, invalidateNativePinPolicy, isNativePinRequired,
  isNativeReadAccessLocked, lockNativeReadAccess, subscribeNativeReadLease,
} from '@/services/nativeReadLease';

export interface AppLockState {
  locked: boolean;
  /** True when the biometric gate is on: the lock screen auto-fires the
   *  OS prompt and offers a retry button; PIN stays as fallback. */
  biometricGate: boolean;
  /** Rate-limited: a rejected result carries the remaining backoff. */
  unlockWithPin: (pin: string) => Promise<PinVerifyResult>;
  /** Never rejects: cancel / unavailable leaves the lock in place and
   *  the PIN pad as fallback. */
  unlockWithBiometric: () => Promise<void>;
  /** Drop the lock without verifying anything. Only for the forgotten-PIN
   *  escape, which erases the account the PIN was protecting: clearing the
   *  PIN alone would leave this overlay mounted with nothing behind it. */
  unlockAfterWipe: () => void;
}

export function useAppLock(): AppLockState {
  // An absent mirror is not proof that a PIN is absent. Native access starts
  // closed until the durable policy has been read successfully.
  const locked = useSyncExternalStore(subscribeNativeReadLease,
    () => isAppLockSupported() && isNativeReadAccessLocked(), () => isAppLockSupported());
  const [biometricGate, setBiometricGate] = useState(false);
  const hiddenAtRef = useRef<number | null>(null);
  const mountedRef = useRef(false);

  // Reconcile the mirror against Preferences. Only confirmed absence of all
  // wallet records permits dropping a stale PIN; an unreadable vault stays locked.
  useEffect(() => {
    if (!isAppLockSupported()) return;
    let cancelled = false;
    mountedRef.current = true;
    lockNativeReadAccess();
    const policyRevision = getNativePinPolicyRevision();
    void (async () => {
      const [pin, gate] = await Promise.all([
        isPinEnabled(),
        isBiometricGateEnabled(),
        // Read through to heal a stale or evicted auto-lock mirror
        // before the idle timer arms against it.
        getAutoLockSeconds(),
      ]);
      if (cancelled) return;
      if (!pin) {
        confirmNativePinPolicy(false, policyRevision);
        return;
      }
      confirmNativePinPolicy(true, policyRevision);
      const presenceRevision = getNativeReadLeaseRevision();
      const [deviceSeed, legacySeed] = await Promise.all([
        deviceOnlyStorage.hasStoredSeed(),
        secureStorage.hasStoredSeed(),
      ]);
      if (cancelled) return;
      if (policyRevision !== getNativePinPolicyRevision() || presenceRevision !== getNativeReadLeaseRevision()) {
        throw new Error('Native wallet or PIN changed while checking saved records');
      }
      const hasWallet =
        deviceSeed || legacySeed || isPasskeyMode() || localStorage.getItem('walletMnemonic') != null;
      if (!hasWallet) {
        logger.warn(LogCategory.AUTH, 'appLock: clearing PIN with no wallet behind it');
        await clearPin({ policyRevision, readRevision: presenceRevision });
        const clearedPolicyRevision = getNativePinPolicyRevision();
        const remainingPin = await isPinEnabled();
        if (cancelled) { lockNativeReadAccess(); return; }
        if (remainingPin) throw new Error('PIN removal could not be verified');
        confirmNativePinPolicy(false, clearedPolicyRevision);
        return;
      }
      setBiometricGate(gate);
    })().catch(() => {
      logger.warn(LogCategory.AUTH, 'appLock: wallet presence is unknown; retaining the lock');
      if (!cancelled) {
        lockNativeReadAccess();
        setBiometricGate(false);
      }
    });
    return () => {
      cancelled = true;
      mountedRef.current = false;
      lockNativeReadAccess();
    };
  }, []);

  // Backgrounding signal: visibilitychange 'hidden', NOT @capacitor/app's
  // appStateChange. On iOS the latter fires on willResignActive, which
  // the Face ID sheet itself triggers, so with timeout 0 every OS prompt
  // would relock the app the moment it closes. 'hidden' fires only on
  // real backgrounding (iOS didEnterBackground / Android activity stop).
  useEffect(() => {
    if (!isAppLockSupported()) return;
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') {
        if (!isNativePinRequired()) return;
        if (getAutoLockSecondsSync() === 0) {
          // 'Immediately' locks at background time so the OS
          // task-switcher snapshot captures the lock screen, not the
          // wallet.
          lockNativeReadAccess();
          setBiometricGate(isBiometricGateEnabledSync());
        } else {
          hiddenAtRef.current = Date.now();
        }
        return;
      }
      const hiddenAt = hiddenAtRef.current;
      hiddenAtRef.current = null;
      if (hiddenAt == null || !isNativePinRequired()) return;
      // Synchronous mirror reads: the lock commits before the resumed
      // wallet frame can paint.
      if (Date.now() - hiddenAt >= getAutoLockSecondsSync() * 1000) {
        lockNativeReadAccess();
        void isBiometricGateEnabled().then(setBiometricGate).catch(() => {
          invalidateNativePinPolicy();
          setBiometricGate(false);
        });
      }
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => document.removeEventListener('visibilitychange', onVisibility);
  }, []);

  // Foreground idle: the visibility handler above only covers
  // backgrounding, so the timeout needs a second trigger to apply while
  // Glow stays open. Any pointer or key activity restarts the
  // countdown, so this only fires on real inactivity.
  useEffect(() => {
    if (!isAppLockSupported() || locked) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const arm = () => {
      clearTimeout(timer);
      if (!isNativePinRequired()) return;
      // 'Immediately' (0) is a rule about backgrounding. Read as an idle
      // timeout it would lock the screen the user is looking at, so it
      // takes the shortest real option instead.
      const seconds = getAutoLockSecondsSync() || 30;
      timer = setTimeout(() => {
        // A suppressing screen is up (a receive QR mid-scan). Re-arm
        // rather than lock, so the lock lands on the first expiry after
        // it goes away instead of waiting for the user to touch
        // something.
        if (isIdleLockSuppressed()) {
          arm();
          return;
        }
        lockNativeReadAccess();
        setBiometricGate(isBiometricGateEnabledSync());
      }, seconds * 1000);
    };
    arm();
    const events = ['pointerdown', 'keydown', 'touchstart', 'wheel'] as const;
    events.forEach((event) => document.addEventListener(event, arm, { passive: true }));
    return () => {
      clearTimeout(timer);
      events.forEach((event) => document.removeEventListener(event, arm));
    };
  }, [locked]);

  const prepareAuthentication = useCallback(async () => {
    if (!mountedRef.current) throw new Error('Native lock is unavailable');
    const revision = getNativeReadLeaseRevision();
    const policyRevision = getNativePinPolicyRevision();
    const enabled = await isPinEnabled();
    if (!mountedRef.current || revision !== getNativeReadLeaseRevision() ||
      document.visibilityState === 'hidden' || !enabled) throw new Error('Native PIN settings changed');
    // Retry can recover a transient Preferences failure, but only a fresh,
    // valid PIN record can authorize a new authentication ceremony.
    confirmNativePinPolicy(true, policyRevision);
    return captureNativeAuthentication();
  }, []);

  const unlockWithPin = useCallback(async (pin: string) => {
    try {
      const authentication = await prepareAuthentication();
      const result = await verifyPin(pin);
      if (result.ok) {
        if (!mountedRef.current) throw new Error('Native lock is unavailable');
        completeNativeAuthentication(authentication);
      }
      return result;
    } catch {
      return { ok: false, lockedForMs: 0, error: PIN_RECORD_UNAVAILABLE_MESSAGE };
    }
  }, [prepareAuthentication]);

  const unlockWithBiometric = useCallback(async () => {
    try {
      if (!mountedRef.current || !biometricGate) return;
      const authentication = await prepareAuthentication();
      if (!await isBiometricGateEnabled()) { setBiometricGate(false); return; }
      if (!mountedRef.current || captureNativeAuthentication() !== authentication) return;
      if (await tryAuthenticateBiometric('Unlock GetYourSats')) {
        if (!mountedRef.current) return;
        completeNativeAuthentication(authentication);
      }
    } catch {
      // Failed/stale authentication cannot reopen a backgrounded or replaced wallet.
    }
  }, [biometricGate, prepareAuthentication]);

  const unlockAfterWipe = useCallback(() => {
    lockNativeReadAccess();
    const policyRevision = getNativePinPolicyRevision();
    void isPinEnabled().then(pin => {
      if (mountedRef.current) confirmNativePinPolicy(pin, policyRevision);
    }).catch(() => { invalidateNativePinPolicy(); });
  }, []);

  return { locked, biometricGate, unlockWithPin, unlockWithBiometric, unlockAfterWipe };
}
