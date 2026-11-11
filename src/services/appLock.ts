/**
 * App-level lock (native only), the Misty Breez model: an opt-in 6-digit
 * PIN gates the UI, with biometrics as the preferred gate on top
 * (PIN stays the fallback). Deliberately app-level, not crypto binding:
 * the seed lives in the vault's device-only tier because a
 * biometric-bound seed could never be released by a PIN entry. Only a
 * salted PBKDF2 hash of the PIN is persisted; web is always unlocked.
 *
 * Storage: Preferences is the durable truth (survives WebView storage
 * eviction); localStorage mirrors the non-secret lock settings so the
 * timeout and UI hints can be read synchronously. Native read access stays
 * closed until the lock hook confirms durable PIN policy; a missing mirror
 * never grants access while a bridge read is in flight.
 */

import { Capacitor } from '@capacitor/core';
import { Preferences } from '@capacitor/preferences';
import { bytesToHex, hexToBytes } from '../utils/hex';
import { logger, LogCategory } from './logger';
import { confirmNativePinPolicy, getNativePinPolicyRevision, getNativeReadLeaseRevision, invalidateNativePinPolicy, invalidateNativeReadBinding } from './nativeReadLease';

/** Salt + hash in ONE record: a two-key layout could be torn by a
 *  process kill between writes, leaving a PIN no input could match. */
const PIN_RECORD_KEY = 'glow.appLock.pin';
const AUTO_LOCK_KEY = 'glow.appLock.autoLockSeconds';
const BIOMETRIC_KEY = 'glow.appLock.biometricEnabled';
const PIN_ATTEMPTS_KEY = 'glow.appLock.pinAttempts';
/** localStorage mirrors for synchronous reads (booleans/numbers only,
 *  never the PIN record). */
const PIN_MIRROR_KEY = 'glow.appLock.pinEnabledMirror';
const AUTO_LOCK_MIRROR_KEY = 'glow.appLock.autoLockSecondsMirror';
const BIOMETRIC_MIRROR_KEY = 'glow.appLock.biometricEnabledMirror';

export const PIN_LENGTH = 6;

/** Misty parity: {0 = immediately, 30s, 2m (default), 5m, 10m, 30m, 1h}. */
export const AUTO_LOCK_OPTIONS_SECONDS = [0, 30, 120, 300, 600, 1800, 3600];
export const DEFAULT_AUTO_LOCK_SECONDS = 120;

/**
 * OWASP's current floor for PBKDF2-SHA256. The PIN keyspace is small
 * enough that this derivation cost is the only thing between a copied
 * record and the PIN, so it is sized for offline search, not for the
 * on-device backoff below. Measured well under a second on the oldest
 * supported devices; the pad is already busy-blocked while it runs.
 */
const PBKDF2_ITERATIONS = 600_000;
/** What records written before the raise used. Kept so an existing PIN
 *  still verifies; those records are re-derived on next success. */
const LEGACY_PBKDF2_ITERATIONS = 100_000;

/**
 * Consecutive failures to seconds of enforced wait, clamped to the last
 * entry. Five free tries, because a mistyped digit is the common case
 * and should cost nothing. From there the wait climbs to an hour, which
 * bounds entry to a couple of dozen tries a day.
 */
const PIN_BACKOFF_SECONDS = [0, 0, 0, 0, 0, 0, 30, 60, 300, 900, 3600];
const MAX_PIN_BACKOFF_MS = Math.max(...PIN_BACKOFF_SECONDS) * 1000;

export function isAppLockSupported(): boolean {
  return Capacitor.isNativePlatform();
}

function mirrorSet(key: string, value: string | null): void {
  try {
    if (value == null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch { /* mirror only; Preferences stays authoritative */ }
}

function mirrorGet(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

// ============================================
// PIN hashing
// ============================================

async function derivePinHash(
  pin: string,
  salt: Uint8Array,
  iterations: number,
): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(pin),
    'PBKDF2',
    false,
    ['deriveBits'],
  );
  const bits = await crypto.subtle.deriveBits(
    {
      name: 'PBKDF2',
      hash: 'SHA-256',
      salt: salt as BufferSource,
      iterations,
    },
    key,
    256,
  );
  return bytesToHex(new Uint8Array(bits));
}

// ============================================
// PIN management
// ============================================

interface PinRecord {
  v: 1;
  salt: string;
  hash: string;
  /** Absent on records written before the iteration raise. */
  iterations?: number;
}

export const PIN_RECORD_UNAVAILABLE_MESSAGE =
  'PIN settings could not be verified. Your wallet is preserved. Retry or recover this wallet before resetting local data.';

export class PinRecordUnavailableError extends Error {
  constructor() {
    super(PIN_RECORD_UNAVAILABLE_MESSAGE);
    this.name = 'PinRecordUnavailableError';
  }
}

class PinPolicyTransitionError extends PinRecordUnavailableError {}

let pinRecordRevision = 0;
let pendingPinMutations = 0;

function capturePinReadRevision(): number {
  if (pendingPinMutations !== 0) throw new PinPolicyTransitionError();
  return pinRecordRevision;
}

function requirePinReadRevision(revision: number): void {
  if (pendingPinMutations !== 0 || revision !== pinRecordRevision) throw new PinPolicyTransitionError();
}

interface LoadedPinRecord { record: PinRecord; raw: string }

/** Only the two derivation costs actually written by this app are supported. */
function recordIterations(record: PinRecord): number {
  return record.iterations ?? LEGACY_PBKDF2_ITERATIONS;
}

async function readPinRecord(): Promise<LoadedPinRecord | null> {
  const revision = capturePinReadRevision();
  try {
    const { value } = await Preferences.get({ key: PIN_RECORD_KEY });
    requirePinReadRevision(revision);
    if (value === null) return null;
    if (typeof value !== 'string' || value.length > 1024) throw new PinRecordUnavailableError();
    const parsed: unknown = JSON.parse(value);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new PinRecordUnavailableError();
    const record = parsed as Record<string, unknown>;
    if (Object.keys(record).some(key => !['v', 'salt', 'hash', 'iterations'].includes(key)) ||
      record.v !== 1 || typeof record.salt !== 'string' || !/^[0-9a-f]{32}$/.test(record.salt) ||
      typeof record.hash !== 'string' || !/^[0-9a-f]{64}$/.test(record.hash) ||
      ('iterations' in record && record.iterations !== LEGACY_PBKDF2_ITERATIONS && record.iterations !== PBKDF2_ITERATIONS)) {
      throw new PinRecordUnavailableError();
    }
    return { record: record as unknown as PinRecord, raw: value };
  } catch (error) {
    // A read from before/during a mutation has no authority over its result.
    // Do not invalidate a newer policy because an older read became stale.
    if (error instanceof PinPolicyTransitionError || pendingPinMutations !== 0 || revision !== pinRecordRevision) {
      throw new PinPolicyTransitionError();
    }
    // Corruption/unavailability is not proof of absence. Preserve the raw
    // record, retain a conservative mirror, and revoke pending authorization.
    mirrorSet(PIN_MIRROR_KEY, 'true');
    invalidateNativePinPolicy();
    throw new PinRecordUnavailableError();
  }
}

export async function isPinEnabled(): Promise<boolean> {
  if (!isAppLockSupported()) return false;
  const revision = getNativePinPolicyRevision();
  const enabled = (await readPinRecord()) !== null;
  if (revision !== getNativePinPolicyRevision()) throw new PinPolicyTransitionError();
  mirrorSet(PIN_MIRROR_KEY, enabled ? 'true' : null);
  return enabled;
}

/** Non-secret UI hint. This mirror does not authorize native seed reads. */
export function isPinEnabledSync(): boolean {
  return isAppLockSupported() && mirrorGet(PIN_MIRROR_KEY) === 'true';
}

function requirePinPolicyRevision(revision: number): void {
  if (revision !== getNativePinPolicyRevision()) throw new PinPolicyTransitionError();
}

// Serialize this app's PIN mutations so a delayed old upgrade cannot overwrite
// a later change. This is local ordering, not cross-device storage authority.
let pinMutation: Promise<void> = Promise.resolve();
function mutatePin(revision: number, operation: () => Promise<void>): Promise<void> {
  pendingPinMutations += 1;
  pinRecordRevision += 1;
  const pending = pinMutation.then(async () => {
    requirePinPolicyRevision(revision);
    await operation();
    requirePinPolicyRevision(revision);
  }).finally(() => {
    pendingPinMutations -= 1;
    pinRecordRevision += 1;
  });
  pinMutation = pending.catch(() => {});
  return pending;
}

async function writePinRecord(pin: string, salt: Uint8Array, revision: number): Promise<void> {
  const record: PinRecord = {
    v: 1,
    salt: bytesToHex(salt),
    hash: await derivePinHash(pin, salt, PBKDF2_ITERATIONS),
    iterations: PBKDF2_ITERATIONS,
  };
  requirePinPolicyRevision(revision);
  await Preferences.set({ key: PIN_RECORD_KEY, value: JSON.stringify(record) });
}

/** Create or replace the PIN. Caller is responsible for the verify step. */
export async function setPin(pin: string): Promise<void> {
  if (typeof pin !== 'string' || !/^\d{6}$/.test(pin)) throw new Error('PIN must contain exactly six digits');
  const revision = invalidateNativePinPolicy();
  await mutatePin(revision, async () => {
    await writePinRecord(pin, crypto.getRandomValues(new Uint8Array(16)), revision);
    requirePinPolicyRevision(revision);
    await Preferences.remove({ key: PIN_ATTEMPTS_KEY });
  });
  mirrorSet(PIN_MIRROR_KEY, 'true');
  confirmNativePinPolicy(true, revision);
  logger.info(LogCategory.AUTH, 'appLock: PIN set');
}

/** Deactivate PIN protection. Also disables the biometric gate: it is
 *  only offered on top of a PIN, matching Misty. */
export async function clearPin(expected?: { policyRevision: number; readRevision: number }): Promise<void> {
  if (expected) {
    capturePinReadRevision();
    requirePinPolicyRevision(expected.policyRevision);
    if (expected.readRevision !== getNativeReadLeaseRevision()) throw new PinPolicyTransitionError();
  }
  const revision = invalidateNativePinPolicy();
  const mutationReadRevision = getNativeReadLeaseRevision();
  await mutatePin(revision, async () => {
    if (expected && mutationReadRevision !== getNativeReadLeaseRevision()) throw new PinPolicyTransitionError();
    await Preferences.remove({ key: PIN_RECORD_KEY });
    requirePinPolicyRevision(revision);
    // Drain earlier biometric writes before disabling the flag. A delayed
    // enable must not resurrect it after clearPin reports completion.
    await setBiometricGateEnabled(false);
    requirePinPolicyRevision(revision);
    await Preferences.remove({ key: PIN_ATTEMPTS_KEY });
  });
  mirrorSet(PIN_MIRROR_KEY, null);
  mirrorSet(BIOMETRIC_MIRROR_KEY, null);
  confirmNativePinPolicy(false, revision);
  logger.info(LogCategory.AUTH, 'appLock: PIN cleared');
}

// ============================================
// Failed-attempt backoff
// ============================================

interface AttemptRecord {
  failed: number;
  /** Epoch ms before which no attempt is accepted. */
  until: number;
}

const NO_ATTEMPTS: AttemptRecord = { failed: 0, until: 0 };

async function readAttempts(): Promise<AttemptRecord> {
  const { value } = await Preferences.get({ key: PIN_ATTEMPTS_KEY });
  if (value == null) return NO_ATTEMPTS;
  try {
    const parsed = JSON.parse(value) as AttemptRecord;
    return Number.isFinite(parsed.failed) && Number.isFinite(parsed.until) ? parsed : NO_ATTEMPTS;
  } catch {
    return NO_ATTEMPTS;
  }
}

/** Remaining wait, 0 when an attempt is allowed now. A clock pushed
 *  backwards would otherwise freeze the pad indefinitely, so the wait
 *  is capped at the longest the schedule can produce. */
function lockoutMs(record: AttemptRecord): number {
  return Math.min(Math.max(record.until - Date.now(), 0), MAX_PIN_BACKOFF_MS);
}

export interface PinVerifyResult {
  ok: boolean;
  /** ms until the next attempt is accepted; 0 when one is allowed now. */
  lockedForMs: number;
  /** A storage/policy failure is different from an incorrect PIN. */
  error?: string;
}

/**
 * Rate-limited PIN check. An attempt made during a wait is rejected
 * before the hash is touched and leaves the deadline alone, so repeated
 * entries neither shorten nor extend it.
 */
export async function verifyPin(pin: string): Promise<PinVerifyResult> {
  try {
    const recordRevision = capturePinReadRevision();
    const revision = getNativePinPolicyRevision();
    const attempts = await readAttempts();
    requirePinReadRevision(recordRevision);
    const waiting = lockoutMs(attempts);
    if (waiting > 0) return { ok: false, lockedForMs: waiting };

    const loaded = await readPinRecord();
    const record = loaded?.record ?? null;
    requirePinReadRevision(recordRevision);
    requirePinPolicyRevision(revision);
    const iterations = record == null ? PBKDF2_ITERATIONS : recordIterations(record);
    const ok =
      record != null &&
      (await derivePinHash(pin, hexToBytes(record.salt), iterations)) === record.hash;
    requirePinReadRevision(recordRevision);
    requirePinPolicyRevision(revision);
    if (ok) {
      await Preferences.remove({ key: PIN_ATTEMPTS_KEY });
      requirePinReadRevision(recordRevision);
      requirePinPolicyRevision(revision);
      // Re-derive a record left at the old cost, with a fresh salt. Done
      // after clearing attempts so a failure here cannot lock the user
      // out: the old record still verifies on the next entry.
      if (iterations !== PBKDF2_ITERATIONS) {
        await mutatePin(revision, async () => {
          const current = await Preferences.get({ key: PIN_RECORD_KEY });
          requirePinPolicyRevision(revision);
          if (!loaded || current.value !== loaded.raw) throw new PinPolicyTransitionError();
          await writePinRecord(pin, crypto.getRandomValues(new Uint8Array(16)), revision);
        });
        logger.info(LogCategory.AUTH, 'appLock: PIN record re-derived');
      }
      requirePinPolicyRevision(revision);
      return { ok: true, lockedForMs: 0 };
    }

    const failed = attempts.failed + 1;
    const backoffMs =
      PIN_BACKOFF_SECONDS[Math.min(failed, PIN_BACKOFF_SECONDS.length - 1)] * 1000;
    await Preferences.set({
      key: PIN_ATTEMPTS_KEY,
      value: JSON.stringify({ failed, until: Date.now() + backoffMs } satisfies AttemptRecord),
    });
    requirePinReadRevision(recordRevision);
    requirePinPolicyRevision(revision);
    logger.warn(LogCategory.AUTH, 'appLock: PIN attempt failed', { failed, backoffMs });
    return { ok: false, lockedForMs: backoffMs };
  } catch (error) {
    if (!(error instanceof PinPolicyTransitionError)) invalidateNativePinPolicy();
    return { ok: false, lockedForMs: 0, error: PIN_RECORD_UNAVAILABLE_MESSAGE };
  }
}

/** Lock-screen copy for a rejected attempt. */
export function pinAttemptMessage(result: PinVerifyResult): string {
  if (result.error) return result.error;
  if (result.lockedForMs <= 0) return 'Incorrect PIN';
  const seconds = Math.ceil(result.lockedForMs / 1000);
  if (seconds < 60) return `Too many attempts. Try again in ${seconds} seconds.`;
  const minutes = Math.ceil(seconds / 60);
  return `Too many attempts. Try again in ${minutes === 1 ? '1 minute' : `${minutes} minutes`}.`;
}

// ============================================
// Auto-lock timeout
// ============================================

export async function getAutoLockSeconds(): Promise<number> {
  const { value } = await Preferences.get({ key: AUTO_LOCK_KEY });
  const parsed = value == null ? NaN : parseInt(value, 10);
  const seconds = Number.isFinite(parsed) ? parsed : DEFAULT_AUTO_LOCK_SECONDS;
  // Backfill the mirror for installs that chose a timeout before the
  // mirror existed (and self-heal an evicted one). Every lock decision
  // reads the mirror, so a missing one silently means 2 minutes.
  mirrorSet(AUTO_LOCK_MIRROR_KEY, String(seconds));
  return seconds;
}

/** Mirror-backed synchronous read for the foreground-return decision. */
export function getAutoLockSecondsSync(): number {
  const parsed = parseInt(mirrorGet(AUTO_LOCK_MIRROR_KEY) ?? '', 10);
  return Number.isFinite(parsed) ? parsed : DEFAULT_AUTO_LOCK_SECONDS;
}

export async function setAutoLockSeconds(seconds: number): Promise<void> {
  await Preferences.set({ key: AUTO_LOCK_KEY, value: String(seconds) });
  mirrorSet(AUTO_LOCK_MIRROR_KEY, String(seconds));
}

/** Human label for a timeout option ("Immediately", "30 seconds", "2 minutes"…). */
export function formatAutoLockOption(seconds: number): string {
  if (seconds === 0) return 'Immediately';
  if (seconds < 60) return `${seconds} seconds`;
  const minutes = seconds / 60;
  if (minutes < 60) return minutes === 1 ? '1 minute' : `${minutes} minutes`;
  const hours = minutes / 60;
  return hours === 1 ? '1 hour' : `${hours} hours`;
}

// ============================================
// Idle-lock suppression
// ============================================

/**
 * Held on by screens meant to be looked at rather than touched: a
 * receive QR waiting to be scanned, a camera being aimed at someone
 * else's code. Only the foreground idle timer honours it, so
 * backgrounding and cold start still lock as usual. Module-level rather
 * than context so the lock hook reads it without a re-render coupling,
 * the same shape as `features/send/sendSheetVisibility.ts`.
 *
 * A counter, not a flag: the scanner opens over the send sheet, so
 * holders overlap, and the inner one's release would otherwise cancel
 * the outer one's hold.
 */
let idleLockHolds = 0;

/** Suppress the foreground idle lock until the returned release runs.
 *  Releasing twice is a no-op, so a double cleanup cannot drop another
 *  holder's suppression. */
export function holdIdleLock(): () => void {
  idleLockHolds += 1;
  let released = false;
  return () => {
    if (released) return;
    released = true;
    idleLockHolds -= 1;
  };
}

export function isIdleLockSuppressed(): boolean {
  return idleLockHolds > 0;
}

// ============================================
// Biometric gate flag
// ============================================

let biometricPolicyRevision = 0;
let pendingBiometricMutations = 0;
let biometricMutation: Promise<void> = Promise.resolve();

export async function isBiometricGateEnabled(): Promise<boolean> {
  if (!isAppLockSupported()) return false;
  if (pendingBiometricMutations !== 0) throw new PinPolicyTransitionError();
  const revision = biometricPolicyRevision;
  const { value } = await Preferences.get({ key: BIOMETRIC_KEY });
  if (pendingBiometricMutations !== 0 || revision !== biometricPolicyRevision) throw new PinPolicyTransitionError();
  if (value !== null && value !== 'true' && value !== 'false') throw new PinRecordUnavailableError();
  const enabled = value === 'true';
  // Backfill the mirror for installs that enabled the gate before the
  // mirror existed (and self-heal an evicted one).
  mirrorSet(BIOMETRIC_MIRROR_KEY, enabled ? 'true' : null);
  return enabled;
}

/** Mirror-backed synchronous read so lock UIs can decide "pad or
 *  biometric first" at first render, with no pad flash while the
 *  Preferences read is in flight. A lost mirror degrades to showing
 *  the pad; the async read reconciles. */
export function isBiometricGateEnabledSync(): boolean {
  return isAppLockSupported() && mirrorGet(BIOMETRIC_MIRROR_KEY) === 'true';
}

export async function setBiometricGateEnabled(enabled: boolean): Promise<void> {
  if (typeof enabled !== 'boolean') throw new Error('Biometric policy must be boolean');
  pendingBiometricMutations += 1;
  biometricPolicyRevision += 1;
  invalidateNativeReadBinding();
  const pending = biometricMutation.then(async () => {
    if (enabled) await Preferences.set({ key: BIOMETRIC_KEY, value: 'true' });
    else await Preferences.remove({ key: BIOMETRIC_KEY });
    mirrorSet(BIOMETRIC_MIRROR_KEY, enabled ? 'true' : null);
  }).finally(() => {
    pendingBiometricMutations -= 1;
    biometricPolicyRevision += 1;
    invalidateNativeReadBinding();
  });
  biometricMutation = pending.catch(() => {});
  await pending;
  logger.info(LogCategory.AUTH, `appLock: biometric gate ${enabled ? 'enabled' : 'disabled'}`);
}
