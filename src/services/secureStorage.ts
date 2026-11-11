/**
 * Secure seed storage abstraction.
 *
 * Persists the wallet seed in a platform-appropriate secure store:
 * - Native (iOS / Android via Capacitor): Keychain / Keystore behind a
 *   biometric gate, via the in-house `capacitor-native-vault` plugin in
 *   `glow-app/plugins/`. The plugin owns the iOS Keychain accessibility
 *   policy (`kSecAttrAccessibleWhenUnlockedThisDeviceOnly`) and the
 *   Android Keystore key generation.
 * - Web: not supported here; callers use the browser wallet storage paths.
 *
 * The interface is identical on both platforms; callers branch on
 * `isSupported()` (cheap, synchronous) to decide whether to use this service
 * or the legacy path. No plugin internals leak past this file — every caller
 * talks only to the `SecureStorage` interface and `SecureStorageError`.
 *
 * As of F2, this file no longer depends on `@aparajita/capacitor-secure-storage`
 * or `@aparajita/capacitor-biometric-auth`. The native plugin is accessed
 * through `window.Capacitor.Plugins.NativeVault` following the same global-
 * injection pattern used by `nativePasskeyPrfProvider.ts`. glow-web does not
 * import the plugin's TypeScript directly — only the runtime global.
 *
 * Bonus: removing the aparajita biometric-auth dependency also removes the
 * `vite-plugin-top-level-await` workaround that the previous version of
 * this file carried (see commit history of `feat/native-secure-seed-storage`).
 * Our plugin has no transitive dependency on `@capacitor/app`, so vite never
 * wraps anything in a `__tla` promise and class extension just works.
 */

import type { Seed } from '@breeztech/breez-sdk-spark';
import { Capacitor } from '@capacitor/core';
import { Preferences } from '@capacitor/preferences';
import { logger, LogCategory } from './logger';

// ============================================
// Capacitor plugin global (locally typed)
// ============================================

/**
 * Minimal local mirror of `capacitor-native-vault`'s plugin surface. Only
 * the methods this file actually calls are typed. The full TypeScript
 * definitions live in `glow-app/plugins/capacitor-native-vault/src/definitions.ts`,
 * but glow-web stays decoupled from the plugin's npm package — we access
 * it only through the runtime `window.Capacitor.Plugins.NativeVault`
 * global, matching how `nativePasskeyPrfProvider.ts` consumes
 * `capacitor-passkey-prf`.
 */
interface NativeVaultPlugin {
  checkBiometry(): Promise<{
    available: boolean;
    biometryType: string;
    /** Raw platform reason when `available` is false (diagnostic). */
    unavailabilityReason?: string;
    /** Mapped SecureStorageErrorCode when `available` is false. */
    unavailabilityCode?: string;
  }>;
  authenticate(options?: { reason?: string }): Promise<void>;
  /** Biometrics-or-passcode prompt (iOS); clears biometry lockout. */
  authenticateDeviceOwner(options?: { reason?: string }): Promise<void>;
  // Retired biometric-bound tier: read and clear only.
  hasStoredSeed(): Promise<{ stored: boolean }>;
  retrieveSeed(): Promise<{ seed: string }>;
  clearSeed(): Promise<void>;
  // Device-only tier (encrypted at rest, no biometric gate).
  hasStoredSeedDeviceOnly(): Promise<{ stored: boolean }>;
  storeSeedDeviceOnly(options: { seed: string }): Promise<void>;
  retrieveSeedDeviceOnly(): Promise<{ seed: string }>;
  clearSeedDeviceOnly(): Promise<void>;
}

/**
 * Locally-typed view of the Capacitor global. We deliberately do NOT use
 * `declare global` here — `nativePasskeyPrfProvider.ts` already augments
 * `window.Capacitor` with its own `Plugins.PasskeyPrf` shape, and TypeScript
 * declaration merging on inline object literal types is brittle. A local
 * cast keeps both files self-contained.
 */
interface LocalCapacitorView {
  isNativePlatform?: () => boolean;
  Plugins?: {
    NativeVault?: NativeVaultPlugin;
  };
}

function getCapacitor(): LocalCapacitorView | undefined {
  if (typeof window === 'undefined') return undefined;
  return (window as unknown as { Capacitor?: LocalCapacitorView }).Capacitor;
}

function getNativeVault(): NativeVaultPlugin {
  const plugin = getCapacitor()?.Plugins?.NativeVault;
  if (!plugin) {
    throw new SecureStorageError(
      'UNKNOWN',
      'NativeVault Capacitor plugin not registered. Did you run `npx cap sync`?',
    );
  }
  return plugin;
}

// ============================================
// Constants
// ============================================

/**
 * Non-secret initialization timestamp in Preferences with a localStorage
 * mirror. Retain its existing name for compatibility, but never use its
 * presence, absence or availability to authorize a vault wipe. Bookkeeping
 * can disappear independently of a saved wallet, including across reinstall.
 * This marker proves neither an empty vault nor a cryptographic migration.
 */
const INSTALL_MARKER_KEY = 'glow.secureStorageInitialized';

/**
 * The historical `glow.secureStorageF3Migrated` marker is deliberately no
 * longer read or written here. Earlier builds deleted a legacy bound seed
 * when it was absent and called that a migration, without converting or
 * verifying the record. Preserve any existing marker and both vault tiers.
 * The current plugin interface has no verified legacy-record conversion;
 * initialization must not manufacture a migration-complete assertion.
 */

// ============================================
// Stored payload — versioned for migrations
// ============================================

/**
 * Logical shape of a persisted seed entry. The on-disk shape is
 * `PersistedSeedBlob` below — see `serializeSeedForStorage` for the reason
 * the two are different.
 */
interface StoredSeedBlob {
  version: 1;
  seed: Seed;
  /** ISO 8601 timestamp of when this blob was first written. */
  createdAt: string;
}

// Re-exported in case future callers need to introspect the logical shape.
export type { StoredSeedBlob };

// ============================================
// Seed serialization helpers
// ============================================

/**
 * The Breez SDK's `Seed` type has two variants:
 *
 *   { type: "mnemonic"; mnemonic: string; passphrase?: string }
 *   ({ type: "entropy" } & number[])
 *
 * The entropy variant is an array with a `type` property tacked on. That is
 * a problem for `JSON.stringify`: it walks arrays index-by-index and ignores
 * any non-index own properties. So serializing an entropy seed via raw JSON
 * silently drops the `type` discriminator and the round-trip is broken.
 *
 * We work around this by serializing into a plain object form whose shape
 * is JSON-safe, then reconstructing the array+type intersection on read.
 */
type PersistedSeed =
  | { type: 'mnemonic'; mnemonic: string; passphrase?: string | null }
  | { type: 'entropy'; bytes: number[] };

interface PersistedSeedBlob {
  version: 1;
  seed: PersistedSeed;
  createdAt: string;
}

function serializeSeedForStorage(seed: Seed): PersistedSeed {
  if (typeof seed !== 'object' || seed === null) {
    throw new TypeError('Wallet seed is not valid');
  }
  if (seed.type === 'mnemonic') {
    const mnemonic: unknown = seed.mnemonic;
    const passphrase: unknown = seed.passphrase;
    if (Array.isArray(seed) || typeof mnemonic !== 'string') {
      throw new TypeError('Wallet mnemonic is not valid');
    }
    if (passphrase !== undefined && passphrase !== null && typeof passphrase !== 'string') {
      throw new TypeError('Wallet mnemonic passphrase is not valid');
    }
    return {
      type: 'mnemonic',
      mnemonic,
      passphrase: passphrase ?? undefined,
    };
  }
  if (seed.type !== 'entropy' || !Array.isArray(seed)) {
    throw new TypeError('Wallet seed variant is not valid');
  }
  // Snapshot before any await. Array.from materializes holes as undefined,
  // so sparse input cannot pass the byte check and change meaning in JSON.
  const bytes = Array.from(seed);
  if (!bytes.every(isByte)) throw new TypeError('Wallet seed bytes are not valid');
  return { type: 'entropy', bytes };
}

function isByte(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= 255;
}

function isSameSeed(left: PersistedSeed, right: PersistedSeed): boolean {
  if (left.type === 'mnemonic' && right.type === 'mnemonic') {
    // Only null/undefined absence is normalized. Preserve literal text and
    // conservatively reject empty versus absent passphrases as a conflict.
    return left.mnemonic === right.mnemonic &&
      (left.passphrase ?? undefined) === (right.passphrase ?? undefined);
  }
  if (left.type === 'entropy' && right.type === 'entropy') {
    return left.bytes.length === right.bytes.length &&
      left.bytes.every((value, index) => value === right.bytes[index]);
  }
  return false;
}

function deserializeSeedFromStorage(persisted: PersistedSeed): Seed {
  if (persisted.type === 'mnemonic') {
    return {
      type: 'mnemonic',
      mnemonic: persisted.mnemonic,
      passphrase: persisted.passphrase ?? undefined,
    };
  }
  // Reconstruct the `number[] & { type: 'entropy' }` intersection that the
  // SDK expects: take the bytes as a fresh array and attach the discriminator.
  const arr = persisted.bytes.slice();
  return Object.assign(arr, { type: 'entropy' as const }) as Seed;
}

function isPersistedSeedBlob(value: unknown): value is PersistedSeedBlob {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  if (v.version !== 1) return false;
  if (typeof v.createdAt !== 'string') return false;
  if (typeof v.seed !== 'object' || v.seed === null) return false;
  const s = v.seed as Record<string, unknown>;
  if (s.type === 'mnemonic') {
    return typeof s.mnemonic === 'string' &&
      (s.passphrase === undefined || s.passphrase === null || typeof s.passphrase === 'string');
  }
  if (s.type === 'entropy') {
    return Array.isArray(s.bytes) && s.bytes.every(isByte);
  }
  return false;
}

// ============================================
// Public error surface
// ============================================

/**
 * Typed error codes so callers can branch on a fallback strategy without
 * inspecting raw plugin errors.
 */
export type SecureStorageErrorCode =
  | 'NOT_SUPPORTED'           // Not running on a native Capacitor host.
  | 'NO_STORED_SEED'          // Nothing persisted — normal first-run state.
  | 'USER_CANCELLED'          // User dismissed the biometric prompt.
  | 'BIOMETRIC_LOCKOUT'       // Too many failed attempts — system lockout active.
  | 'BIOMETRIC_NOT_ENROLLED'  // Device has no biometric credentials registered.
  | 'BIOMETRIC_UNAVAILABLE'   // Hardware missing, disabled, or temporarily unavailable.
  | 'KEY_INVALIDATED'         // Stored entry voided (e.g. new biometric enrollment on iOS).
  | 'INVALID_STORED_SEED'     // Malformed seed data; retain the entry for recovery.
  | 'SEED_CONFLICT'           // A different saved seed must not be replaced.
  | 'UNKNOWN';                // Catch-all; treat as recoverable failure.

export class SecureStorageError extends Error {
  constructor(
    public readonly code: SecureStorageErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'SecureStorageError';
  }
}

// ============================================
// Public interface
// ============================================

export interface SecureStorage {
  /**
   * True when running inside a native Capacitor host (iOS or Android).
   * Synchronous and cheap — safe to call at module load time.
   */
  isSupported(): boolean;

  /**
   * Returns true if a seed blob is currently persisted.
   * Does NOT trigger a biometric prompt.
   * Throws on a failed presence check; failure is not proof of absence.
   */
  hasStoredSeed(): Promise<boolean>;

  /**
   * Create a device-only seed only after a fresh, explicit absence read.
   * The same exact seed is a no-op; a different or unreadable saved record
   * is retained and the call fails. Writes and explicit clears are serialized
   * in this JavaScript singleton, not atomically across native processes.
   *
   * @throws {SecureStorageError} on any platform failure.
   */
  storeSeed(seed: Seed): Promise<void>;

  /**
   * Retrieve the persisted seed. Triggers the biometric prompt.
   *
   * @throws {SecureStorageError} with one of:
   *   NO_STORED_SEED | USER_CANCELLED | BIOMETRIC_LOCKOUT |
   *   BIOMETRIC_NOT_ENROLLED | BIOMETRIC_UNAVAILABLE | KEY_INVALIDATED |
   *   INVALID_STORED_SEED | UNKNOWN
   */
  retrieveSeed(): Promise<Seed>;

  /**
   * Explicitly wipe this tier's persisted seed. Does NOT require biometric;
   * callers own the confirmation/recovery policy. Never throws on a missing
   * entry. Initialization and read failures must not call this method.
   */
  clearSeed(): Promise<void>;
}

/**
 * The retired biometric-bound tier: readable and clearable, never
 * written. Legacy entries remain readable in their original tier through
 * unlock and initialization. The native plugin has no write or verified
 * conversion path for this tier.
 */
export type DrainOnlySecureStorage = Omit<SecureStorage, 'storeSeed'>;

// ============================================
// Error mapping + utilities
// ============================================

/**
 * The new `capacitor-native-vault` plugin already returns our typed
 * `SecureStorageErrorCode` strings via `PluginCall.reject(message, code)` —
 * the `err.code` field is exactly what we want. So this is just a
 * pass-through with a fallback for unexpected codes (which would indicate
 * a bug in the plugin, not the caller).
 */
function mapNativeVaultErrorCode(err: unknown): SecureStorageErrorCode {
  if (err && typeof err === 'object' && 'code' in err) {
    const code = (err as { code: unknown }).code;
    // Absence authorizes a write, so coercion or message matching must not
    // turn an unexpected plugin response into that authority.
    if (typeof code !== 'string') return 'UNKNOWN';
    switch (code) {
      case 'NOT_SUPPORTED':
      case 'NO_STORED_SEED':
      case 'USER_CANCELLED':
      case 'BIOMETRIC_LOCKOUT':
      case 'BIOMETRIC_NOT_ENROLLED':
      case 'BIOMETRIC_UNAVAILABLE':
      case 'KEY_INVALIDATED':
      case 'UNKNOWN':
        return code;
    }
  }
  return 'UNKNOWN';
}

function getErrorMessage(err: unknown): string | undefined {
  if (err && typeof err === 'object' && 'message' in err) {
    const msg = (err as { message: unknown }).message;
    if (typeof msg === 'string') return msg;
  }
  return undefined;
}

// ============================================
// Logging breadcrumbs
// ============================================

/**
 * Centralized breadcrumb for successful secure storage operations.
 * Never logs anything that could leak seed material — only the operation name.
 */
function logSecureStorageSuccess(operation: string): void {
  logger.info(LogCategory.AUTH, 'Secure storage operation succeeded', { operation });
}

/**
 * Centralized breadcrumb for secure storage failures, with severity calibrated
 * to whether the code represents a user action, a system state, or an
 * unexpected error. Never logs the underlying error message — only the
 * operation name and the typed error code.
 */
function logSecureStorageFailure(operation: string, code: SecureStorageErrorCode): void {
  const context = { operation, code };
  switch (code) {
    case 'USER_CANCELLED':
    case 'NO_STORED_SEED':
      logger.debug(LogCategory.AUTH, 'Secure storage operation skipped', context);
      break;
    case 'BIOMETRIC_NOT_ENROLLED':
      logger.info(LogCategory.AUTH, 'Secure storage unavailable: biometric not enrolled', context);
      break;
    case 'BIOMETRIC_LOCKOUT':
    case 'BIOMETRIC_UNAVAILABLE':
    case 'KEY_INVALIDATED':
    case 'INVALID_STORED_SEED':
    case 'SEED_CONFLICT':
      logger.warn(LogCategory.AUTH, 'Secure storage operation failed', context);
      break;
    case 'NOT_SUPPORTED':
      // Should never reach this branch from NativeSecureStorage; only
      // NoopSecureStorage emits NOT_SUPPORTED and it's a no-op caller path.
      break;
    case 'UNKNOWN':
    default:
      logger.error(LogCategory.AUTH, 'Unexpected secure storage error', context);
      break;
  }
}

// ============================================
// Native implementation (iOS / Android via capacitor-native-vault)
// ============================================

/**
 * Native (Capacitor) implementation backed by iOS Keychain / Android
 * Keystore via the in-house `capacitor-native-vault` plugin. Constructed
 * only when `Capacitor.isNativePlatform()` is true; the factory below
 * picks `NoopSecureStorage` on web.
 */
// Bookkeeping only, shared by both singletons. This initialization never
// reads, converts or clears either seed slot. A missing or unavailable
// marker must leave the same typed vault operations available to callers.
let sharedInitPromise: Promise<void> | null = null;

function ensureSharedInitialized(): Promise<void> {
  if (!sharedInitPromise) {
    sharedInitPromise = recordStorageInitialization();
  }
  return sharedInitPromise;
}

/**
 * Retry non-secret initialization bookkeeping after an explicit local-data
 * reset. Dropping this memo does not clear a vault or change seed selection.
 */
export function resetSecureStorageInit(): void {
  sharedInitPromise = null;
}

/**
 * Best-effort timestamp only. Also retry after a successful store. A marker
 * failure must not hide, delete or rewrite a saved seed, fail a successful
 * write, or claim that a legacy record was converted to another policy.
 */
async function recordStorageInitialization(): Promise<void> {
  try {
    if (await readDurableMarker(INSTALL_MARKER_KEY)) return;
    const now = new Date().toISOString();
    await writeDurableMarker(INSTALL_MARKER_KEY, now);
  } catch {
    // Bookkeeping is not part of the vault's read/write success contract.
  }
}

/**
 * Read the non-secret timestamp from Preferences, falling back to its
 * legacy localStorage mirror. Copying an existing timestamp forward does
 * not migrate seed data, establish the platform's key policy or select a
 * wallet. Neither backend is authoritative evidence about vault presence.
 */
async function readDurableMarker(key: string): Promise<string | null> {
  try {
    const { value } = await Preferences.get({ key });
    if (value != null) return value;
  } catch {
    /* Preferences unavailable — fall through to the localStorage copy. */
  }
  const legacy =
    typeof localStorage !== 'undefined' ? localStorage.getItem(key) : null;
  if (legacy != null) {
    await writeDurableMarker(key, legacy);
  }
  return legacy;
}

/**
 * Write the timestamp and its existing compatibility mirror. Do not write
 * the retired F3 completion marker or infer success of a cryptographic
 * migration from a successful bookkeeping write.
 */
async function writeDurableMarker(key: string, value: string): Promise<void> {
  try {
    await Preferences.set({ key, value });
  } catch {
    /* best-effort */
  }
  try {
    if (typeof localStorage !== 'undefined') localStorage.setItem(key, value);
  } catch {
    /* best-effort */
  }
}

class NativeSecureStorage implements DrainOnlySecureStorage {
  /**
   * Single in-flight `retrieveSeed` promise so concurrent callers share the
   * same biometric prompt instead of stacking two prompts on top of each
   * other. Reset to null in a `finally` block so the next call re-prompts.
   */
  private inflightRetrieve: Promise<Seed> | null = null;

  isSupported(): boolean {
    return true;
  }

  async hasStoredSeed(): Promise<boolean> {
    await ensureSharedInitialized();
    try {
      const result = await getNativeVault().hasStoredSeed();
      if (typeof result.stored !== 'boolean') throw new Error('Unexpected seed presence response');
      return result.stored;
    } catch (err) {
      const code = mapNativeVaultErrorCode(err);
      logSecureStorageFailure('hasStoredSeed', code);
      throw new SecureStorageError(code, 'Could not check the saved wallet.');
    }
  }

  async retrieveSeed(): Promise<Seed> {
    await ensureSharedInitialized();
    // De-duplicate concurrent callers so we only show one biometric prompt.
    if (this.inflightRetrieve) {
      return this.inflightRetrieve;
    }
    this.inflightRetrieve = this.doRetrieve().finally(() => {
      this.inflightRetrieve = null;
    });
    return this.inflightRetrieve;
  }

  private async doRetrieve(): Promise<Seed> {
    // The plugin handles both the biometric prompt and the Keychain /
    // Keystore read. On success it returns the opaque string an earlier
    // build persisted; on failure it rejects with one of our typed
    // SecureStorageErrorCode strings.
    let result: { seed: string };
    try {
      result = await getNativeVault().retrieveSeed();
    } catch (err) {
      const code = mapNativeVaultErrorCode(err);
      logSecureStorageFailure('retrieveSeed', code);
      throw new SecureStorageError(code, getErrorMessage(err) ?? 'Failed to retrieve seed.');
    }

    return decodeStoredSeedBlob(result?.seed, 'retrieveSeed');
  }

  async clearSeed(): Promise<void> {
    await ensureSharedInitialized();
    try {
      await getNativeVault().clearSeed();
      logSecureStorageSuccess('clearSeed');
    } catch (err) {
      const code = mapNativeVaultErrorCode(err);
      logSecureStorageFailure('clearSeed', code);
      throw new SecureStorageError(code, getErrorMessage(err) ?? 'Failed to clear stored seed.');
    }
  }
}

/**
 * Shared seed-blob decoder used by both tiers. The JSON envelope is
 * identical across biometric / device-only — only the on-disk encryption
 * policy differs — so parsing is tier-agnostic.
 */
function decodeStoredSeedBlob(raw: unknown, operation: string): Seed {
  if (typeof raw !== 'string') {
    logSecureStorageFailure(operation, 'INVALID_STORED_SEED');
    throw new SecureStorageError('INVALID_STORED_SEED', 'Stored seed blob is not a string.');
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    logSecureStorageFailure(operation, 'INVALID_STORED_SEED');
    throw new SecureStorageError(
      'INVALID_STORED_SEED',
      'Stored seed blob is not valid JSON.',
    );
  }
  if (!isPersistedSeedBlob(parsed)) {
    // Malformed data is not proof that the OS invalidated its encryption key.
    // Keep that platform failure distinct and preserve this entry for recovery.
    logSecureStorageFailure(operation, 'INVALID_STORED_SEED');
    throw new SecureStorageError(
      'INVALID_STORED_SEED',
      'Stored seed blob has an unexpected shape.',
    );
  }
  logSecureStorageSuccess(operation);
  return deserializeSeedFromStorage(parsed.seed);
}

/**
 * Native device-only tier. Encrypted at rest via the same iOS Keychain /
 * Android Keystore primitives the biometric-bound tier uses, but WITHOUT
 * the biometric gate. Used for non-passkey users who opted out of the
 * passkey flow during onboarding — their seed never lives in plaintext
 * localStorage on native hosts, but reads don't pop a biometric prompt.
 *
 * The TS interface is deliberately the same `SecureStorage` contract as
 * the biometric tier so callers can swap between them. The error-code
 * surface is a strict subset (no `USER_CANCELLED` / `BIOMETRIC_*` since
 * there's no prompt), but keeping the superset type simplifies the
 * shared call sites in `useBreezSdk.ts`.
 */
class NativeDeviceOnlyStorage implements SecureStorage {
  // The plugin exposes no cross-process compare-and-swap primitive. This
  // queue only orders writes and explicit clears through this JS singleton.
  private mutationTail: Promise<void> = Promise.resolve();

  private enqueueMutation(operation: () => Promise<void>): Promise<void> {
    const result = this.mutationTail.then(operation);
    // Preserve the caller's rejection while allowing a fresh later attempt.
    this.mutationTail = result.catch(() => undefined);
    return result;
  }

  isSupported(): boolean {
    return true;
  }

  async hasStoredSeed(): Promise<boolean> {
    await ensureSharedInitialized();
    try {
      const result = await getNativeVault().hasStoredSeedDeviceOnly();
      if (typeof result.stored !== 'boolean') throw new Error('Unexpected seed presence response');
      return result.stored;
    } catch (err) {
      const code = mapNativeVaultErrorCode(err);
      logSecureStorageFailure('hasStoredSeedDeviceOnly', code);
      throw new SecureStorageError(code, 'Could not check the saved wallet.');
    }
  }

  async storeSeed(seed: Seed): Promise<void> {
    // Validate and snapshot identity before the first await or queue delay.
    const persistedSeed = serializeSeedForStorage(seed);
    return this.enqueueMutation(async () => {
      let existing: Seed | undefined;
      try {
        existing = await this.retrieveSeed();
      } catch (err) {
        if (!(err instanceof SecureStorageError) || err.code !== 'NO_STORED_SEED') throw err;
      }
      if (existing !== undefined) {
        if (isSameSeed(serializeSeedForStorage(existing), persistedSeed)) return;
        throw new SecureStorageError('SEED_CONFLICT', 'A different wallet is already saved on this device.');
      }
      const blob: PersistedSeedBlob = {
        version: 1,
        seed: persistedSeed,
        createdAt: new Date().toISOString(),
      };
      try {
        await getNativeVault().storeSeedDeviceOnly({ seed: JSON.stringify(blob) });
        await recordStorageInitialization();
        logSecureStorageSuccess('storeSeedDeviceOnly');
      } catch (err) {
        // A failed acknowledgement can follow a committed write. Never clear
        // or blindly retry; the next queued create must freshly read it.
        const code = mapNativeVaultErrorCode(err);
        logSecureStorageFailure('storeSeedDeviceOnly', code);
        throw new SecureStorageError(code, getErrorMessage(err) ?? 'Failed to persist seed.');
      }
    });
  }

  async retrieveSeed(): Promise<Seed> {
    await ensureSharedInitialized();
    let result: { seed: string };
    try {
      result = await getNativeVault().retrieveSeedDeviceOnly();
    } catch (err) {
      const code = mapNativeVaultErrorCode(err);
      logSecureStorageFailure('retrieveSeedDeviceOnly', code);
      throw new SecureStorageError(code, getErrorMessage(err) ?? 'Failed to retrieve seed.');
    }
    return decodeStoredSeedBlob(result?.seed, 'retrieveSeedDeviceOnly');
  }

  async clearSeed(): Promise<void> {
    return this.enqueueMutation(async () => {
      await ensureSharedInitialized();
      try {
        await getNativeVault().clearSeedDeviceOnly();
        logSecureStorageSuccess('clearSeedDeviceOnly');
      } catch (err) {
        const code = mapNativeVaultErrorCode(err);
        logSecureStorageFailure('clearSeedDeviceOnly', code);
        throw new SecureStorageError(code, getErrorMessage(err) ?? 'Failed to clear stored seed.');
      }
    });
  }
}

// ============================================
// Web / fallback implementation
// ============================================

/**
 * Used outside a native Capacitor host (browser / PWA / SSR / unit tests).
 * Every method is a no-op or rejects with NOT_SUPPORTED so callers can fall
 * through to the legacy storage path without special-casing the type.
 */
class NoopSecureStorage implements SecureStorage {
  isSupported(): boolean {
    return false;
  }

  async hasStoredSeed(): Promise<boolean> {
    return false;
  }

  async storeSeed(_seed: Seed): Promise<void> {
    throw new SecureStorageError(
      'NOT_SUPPORTED',
      'Secure seed storage is only available on native platforms.',
    );
  }

  async retrieveSeed(): Promise<Seed> {
    throw new SecureStorageError(
      'NOT_SUPPORTED',
      'Secure seed storage is only available on native platforms.',
    );
  }

  async clearSeed(): Promise<void> {
    // No-op — nothing to clear on web.
  }
}

// ============================================
// Biometry info helper (rewritten to use NativeVault)
// ============================================

/** Icon family for the device's biometry; `iris` maps to `face` (a
 *  dedicated glyph isn't worth it for Samsung's retired iris sensor). */
export type BiometryKind = 'face' | 'fingerprint';

export interface BiometryInfo {
  /** User-facing name, e.g. "Face ID", "Touch ID", "fingerprint". */
  label: string;
  kind: BiometryKind;
}

export interface BiometryStatus {
  /** Label + icon kind, null when biometry can't currently run. */
  info: BiometryInfo | null;
  /** iOS: biometry is disabled until the device passcode is entered
   *  (too many failed matches). Recoverable in-app via
   *  `authenticateDeviceOwner`. */
  lockedOut: boolean;
}

/**
 * Full biometry capability status: label + icon kind when available,
 * plus a structured lockout flag so UIs can offer recovery instead of
 * silently hiding their biometric controls.
 *
 * Calls `NativeVault.checkBiometry()` directly — no more TLA workaround
 * is needed because the in-house plugin does not transitively import
 * `@capacitor/app`, so vite-plugin-top-level-await never wraps anything.
 */
export async function getBiometryStatus(): Promise<BiometryStatus> {
  if (!Capacitor.isNativePlatform()) return { info: null, lockedOut: false };
  try {
    const result = await getNativeVault().checkBiometry();
    if (!result.available) {
      // Lands in the Share Logs ring buffer: the only way to tell
      // lockout / permission-denied / not-enrolled apart when the
      // biometric UI silently disappears.
      logger.warn(LogCategory.AUTH, 'checkBiometry: unavailable', {
        biometryType: result.biometryType,
        reason: result.unavailabilityReason ?? 'unspecified',
      });
      return { info: null, lockedOut: result.unavailabilityCode === 'BIOMETRIC_LOCKOUT' };
    }
    switch (result.biometryType) {
      case 'faceId':
        return { info: { label: 'Face ID', kind: 'face' }, lockedOut: false };
      case 'touchId':
        return { info: { label: 'Touch ID', kind: 'fingerprint' }, lockedOut: false };
      case 'fingerprint':
        return { info: { label: 'fingerprint', kind: 'fingerprint' }, lockedOut: false };
      case 'face':
        return { info: { label: 'face', kind: 'face' }, lockedOut: false };
      case 'iris':
        return { info: { label: 'iris scan', kind: 'face' }, lockedOut: false };
      default:
        logger.warn(LogCategory.AUTH, 'checkBiometry: unrecognized biometryType', {
          biometryType: result.biometryType,
        });
        return { info: null, lockedOut: false };
    }
  } catch (e) {
    logger.warn(LogCategory.AUTH, 'checkBiometry: call failed', {
      error: e instanceof Error ? e.message : String(e),
    });
    return { info: null, lockedOut: false };
  }
}

/** `getBiometryStatus().info` for callers that only need label + icon. */
export async function getBiometryInfo(): Promise<BiometryInfo | null> {
  return (await getBiometryStatus()).info;
}

/**
 * Biometrics-or-passcode prompt (iOS `deviceOwnerAuthentication`).
 * Confirms the device owner is present. Succeeding via passcode also
 * clears a biometry lockout system-wide, which is the in-app recovery
 * for BIOMETRIC_LOCKOUT. Resolves on success; throws
 * `SecureStorageError` (USER_CANCELLED, ...).
 */
export async function authenticateDeviceOwner(reason: string): Promise<void> {
  try {
    await getNativeVault().authenticateDeviceOwner({ reason });
  } catch (err) {
    const code = mapNativeVaultErrorCode(err);
    logSecureStorageFailure('authenticateDeviceOwner', code);
    throw new SecureStorageError(
      code,
      err instanceof Error ? err.message : 'Device authentication failed',
    );
  }
}

/**
 * Device-owner check in front of an erase of all local data. True means
 * "go ahead".
 *
 * Only an explicit cancel refuses. A host with no owner check to run
 * (web, or a device with neither passcode nor biometrics enrolled)
 * passes through: a refusal there would leave a forgotten PIN with no
 * escape but reinstalling.
 */
export async function confirmDeviceOwner(reason: string): Promise<boolean> {
  if (!Capacitor.isNativePlatform()) return true;
  // The plugin has no passcode-backed prompt on Android, where the
  // device-owner call rejects outright and the biometric one carries the
  // check instead.
  // ponytail: drop the second prompt once the plugin implements
  // authenticateDeviceOwner with DEVICE_CREDENTIAL on Android.
  for (const prompt of [authenticateDeviceOwner, authenticateBiometric]) {
    try {
      await prompt(reason);
      return true;
    } catch (err) {
      // A cancel is the user saying no. Anything else means that prompt
      // could not run, so fall through to the next one.
      if (err instanceof SecureStorageError && err.code === 'USER_CANCELLED') return false;
    }
  }
  return true;
}

// ============================================
// Factory + singleton
// ============================================

function createSecureStorage(): DrainOnlySecureStorage {
  return Capacitor.isNativePlatform() ? new NativeSecureStorage() : new NoopSecureStorage();
}

function createDeviceOnlyStorage(): SecureStorage {
  return Capacitor.isNativePlatform() ? new NativeDeviceOnlyStorage() : new NoopSecureStorage();
}

/**
 * Module-level singletons.
 *
 * `secureStorage`: retired biometric-bound tier, read-only (legacy
 * installs only; moved into device-only at first unlock).
 * `deviceOnlyStorage`: encrypted at rest, no biometric gate (the default).
 *
 * Both resolve to `NoopSecureStorage` on non-native hosts.
 *
 * Import as:
 *   `import { secureStorage, deviceOnlyStorage } from '@/services/secureStorage';`
 */
export const secureStorage: DrainOnlySecureStorage = createSecureStorage();
export const deviceOnlyStorage: SecureStorage = createDeviceOnlyStorage();

// ============================================
// Standalone biometric gate (native only)
// ============================================

/**
 * App-level biometric prompt, no vault involved. Backs the app-lock
 * layer (`services/appLock.ts`): lock screen and Security page gating.
 * Gates the UI, not the crypto: the seed stays in the device-only tier
 * so a PIN fallback can still start the app. Resolves on success;
 * throws `SecureStorageError` (USER_CANCELLED, BIOMETRIC_LOCKOUT, ...).
 */
export async function authenticateBiometric(reason: string): Promise<void> {
  try {
    await getNativeVault().authenticate({ reason });
  } catch (err) {
    const code = mapNativeVaultErrorCode(err);
    logSecureStorageFailure('authenticate', code);
    throw new SecureStorageError(
      code,
      err instanceof Error ? err.message : 'Biometric authentication failed',
    );
  }
}

/**
 * `authenticateBiometric` for gates with a PIN fallback: cancel /
 * unavailable resolves `false` instead of throwing, since the pad
 * stays on screen either way.
 */
export async function tryAuthenticateBiometric(reason: string): Promise<boolean> {
  try {
    await authenticateBiometric(reason);
    return true;
  } catch {
    return false;
  }
}
