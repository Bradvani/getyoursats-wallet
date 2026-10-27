/**
 * Native backup/funding read authorization. This is an app-lock boundary, not
 * native signer isolation. It stores no seed, PIN, SDK handle, or credential.
 *
 * A read lease belongs to one foreground authorization revision. Backgrounding
 * always invalidates pending work; the app-lock hook decides whether its
 * configured timeout also requires fresh authentication on return.
 */
export type NativeReadLease = number;

type PinPolicy = 'unknown' | 'pin' | 'none';
let revision = 0;
let policyRevision = 0;
let policy: PinPolicy = 'unknown';
let permitted = false;
const listeners = new Set<() => void>();

function publish(): void {
  revision += 1;
  listeners.forEach(listener => listener());
}

function requireForeground(): void {
  if (typeof document === 'undefined' || document.visibilityState !== 'visible') {
    throw new Error('Native wallet is not in the foreground');
  }
}

export function subscribeNativeReadLease(listener: () => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

export function getNativeReadLeaseRevision(): number { return revision; }
export function isNativeReadAccessLocked(): boolean { return policy === 'unknown' || !permitted; }
export function isNativePinRequired(): boolean { return policy !== 'none'; }
export function getNativePinPolicyRevision(): number { return policyRevision; }

/** Connection/tier changes revoke pending reads and authentication completions. */
export function invalidateNativeReadBinding(): void { publish(); }

/** Actual UI lock: no subsequent read is authorized until policy/auth permits it. */
export function lockNativeReadAccess(): void {
  permitted = false;
  publish();
}

/** Call before changing PIN policy, or when its durable record cannot be read. */
export function invalidateNativePinPolicy(): number {
  policyRevision += 1;
  policy = 'unknown';
  lockNativeReadAccess();
  return policyRevision;
}

/** A stale durable read cannot undo a newer PIN change or policy failure. */
export function confirmNativePinPolicy(pinEnabled: boolean, expectedPolicyRevision: number): void {
  if (expectedPolicyRevision !== policyRevision) throw new Error('Native PIN policy changed');
  const next = pinEnabled ? 'pin' : 'none';
  if (policy !== next) {
    policy = next;
    permitted = !pinEnabled;
    publish();
  } else if (!pinEnabled && !permitted) {
    // Confirmed absence of a PIN requires no authentication. In-flight reads
    // from before the lock remain invalid because their revision has changed.
    permitted = true;
    publish();
  }
}

/** Snapshot before an authentication ceremony; locked access is allowed here. */
export function captureNativeAuthentication(): number {
  requireForeground();
  if (policy !== 'pin') throw new Error('Native PIN settings have not been verified');
  return revision;
}

export function completeNativeAuthentication(expectedRevision: number): void {
  requireForeground();
  if (policy !== 'pin' || expectedRevision !== revision) {
    throw new Error('Native wallet changed during authentication. Please unlock again.');
  }
  permitted = true;
  publish();
}

export function captureNativeReadLease(): NativeReadLease {
  requireForeground();
  if (isNativeReadAccessLocked()) throw new Error('Native wallet is locked');
  return revision;
}

export function assertNativeReadLease(lease: NativeReadLease): void {
  requireForeground();
  if (lease !== revision || isNativeReadAccessLocked()) {
    throw new Error('Native wallet changed or locked during the read');
  }
}

if (typeof document !== 'undefined') {
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'visible') invalidateNativeReadBinding();
  });
  window.addEventListener('pagehide', invalidateNativeReadBinding);
}
