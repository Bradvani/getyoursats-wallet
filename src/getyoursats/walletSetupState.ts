export type WalletTourStep = 'protect' | 'balance' | 'receive' | 'identity';
export type WalletRecoveryMethod = 'passkey' | 'phrase' | 'device';
export type WalletRecoveryStatus = 'pending' | 'passkey-reviewed' | 'phrase-verified';
export type WalletTourStatus = 'not-started' | 'active' | 'skipped' | 'completed';

export interface WalletSetupProgress {
  readonly version: 1;
  readonly tourStatus: WalletTourStatus;
  readonly step: WalletTourStep;
  readonly recoveryStatus: WalletRecoveryStatus;
}

export const WALLET_TOUR_STEPS: readonly WalletTourStep[] = ['protect', 'balance', 'receive', 'identity'];
export const EMPTY_WALLET_SETUP: WalletSetupProgress = Object.freeze({
  version: 1, tourStatus: 'not-started', step: 'protect', recoveryStatus: 'pending',
});

const PREFIX = 'gys:wallet-setup:v1:';
const scopePattern = /^gys:wallet-setup:v1:(mainnet|testnet|signet|regtest):(?:02|03)[a-f0-9]{64}$/;
const cache = new Map<string, {raw: string | null; progress: WalletSetupProgress}>();
const listeners = new Map<string, Set<() => void>>();

export function walletSetupScope(identityPubkey?: string | null, network?: string | null): string | null {
  const scope = `${PREFIX}${network}:${identityPubkey?.toLowerCase()}`;
  return scopePattern.test(scope) ? scope : null;
}

function parseProgress(raw: string | null): WalletSetupProgress {
  if (!raw) return EMPTY_WALLET_SETUP;
  try {
    const value: unknown = JSON.parse(raw);
    if (!value || typeof value !== 'object' || Array.isArray(value)) return EMPTY_WALLET_SETUP;
    const record = value as Record<string, unknown>;
    if (record.version !== 1 || typeof record.tourStatus !== 'string' || typeof record.recoveryStatus !== 'string' ||
      !['not-started', 'active', 'skipped', 'completed'].includes(record.tourStatus) ||
      !WALLET_TOUR_STEPS.includes(record.step as WalletTourStep) ||
      !['pending', 'passkey-reviewed', 'phrase-verified'].includes(record.recoveryStatus)) {
      return EMPTY_WALLET_SETUP;
    }
    return Object.freeze({
      version: 1, tourStatus: record.tourStatus as WalletTourStatus,
      step: record.step as WalletTourStep, recoveryStatus: record.recoveryStatus as WalletRecoveryStatus,
    });
  } catch {
    return EMPTY_WALLET_SETUP;
  }
}

export function readWalletSetup(scope: string | null): WalletSetupProgress {
  if (!scope || !scopePattern.test(scope)) return EMPTY_WALLET_SETUP;
  const previous = cache.get(scope);
  try {
    const raw = localStorage.getItem(scope);
    if (previous && previous.raw === raw) return previous.progress;
    const progress = parseProgress(raw);
    cache.set(scope, {raw, progress});
    return progress;
  } catch {
    return previous?.progress ?? EMPTY_WALLET_SETUP;
  }
}

function notify(scope: string) {
  for (const listener of listeners.get(scope) ?? []) listener();
}

function changeWalletSetup(scope: string | null, change: (current: WalletSetupProgress) => WalletSetupProgress) {
  if (!scope || !scopePattern.test(scope)) return;
  const current = readWalletSetup(scope);
  const progress = Object.freeze(change(current));
  if (progress.tourStatus === current.tourStatus && progress.step === current.step &&
    progress.recoveryStatus === current.recoveryStatus) return;
  let raw = cache.get(scope)?.raw ?? null;
  try {
    const serialized = JSON.stringify(progress);
    localStorage.setItem(scope, serialized);
    raw = serialized;
  } catch { /* Progress stays usable for this session when storage is blocked. */ }
  cache.set(scope, {raw, progress});
  notify(scope);
}

function onStorage(event: StorageEvent) {
  for (const scope of listeners.keys()) {
    if (event.key === null || event.key === scope) {
      cache.delete(scope);
      notify(scope);
    }
  }
}

export function subscribeWalletSetup(scope: string | null, listener: () => void): () => void {
  if (!scope || !scopePattern.test(scope)) return () => {};
  if (listeners.size === 0) window.addEventListener('storage', onStorage);
  let subscribers = listeners.get(scope);
  if (!subscribers) {
    subscribers = new Set();
    listeners.set(scope, subscribers);
  }
  subscribers.add(listener);
  return () => {
    subscribers.delete(listener);
    if (subscribers.size === 0) listeners.delete(scope);
    if (listeners.size === 0) window.removeEventListener('storage', onStorage);
  };
}

export function initializeNewWalletSetup(scope: string | null, phraseVerified: boolean) {
  changeWalletSetup(scope, current => ({
    ...current,
    tourStatus: current.tourStatus === 'not-started' ? 'active' : current.tourStatus,
    recoveryStatus: phraseVerified ? 'phrase-verified' : current.recoveryStatus,
  }));
}

export function beginWalletTour(scope: string | null, restart = false) {
  changeWalletSetup(scope, current => ({
    ...current, tourStatus: 'active',
    step: restart || current.tourStatus === 'completed' ? 'protect' : current.step,
  }));
}

export function advanceWalletTour(scope: string | null) {
  changeWalletSetup(scope, current => {
    if (current.tourStatus !== 'active') return current;
    const next = WALLET_TOUR_STEPS[WALLET_TOUR_STEPS.indexOf(current.step) + 1];
    return {...current, step: next ?? current.step, tourStatus: next ? 'active' : 'completed'};
  });
}

export function skipWalletTour(scope: string | null) {
  changeWalletSetup(scope, current => current.tourStatus === 'completed' ? current : {...current, tourStatus: 'skipped'});
}

export function confirmWalletRecovery(scope: string | null, recoveryStatus: Exclude<WalletRecoveryStatus, 'pending'>) {
  if (recoveryStatus !== 'passkey-reviewed' && recoveryStatus !== 'phrase-verified') return;
  changeWalletSetup(scope, current => ({
    ...current,
    recoveryStatus: current.recoveryStatus === 'phrase-verified' ? 'phrase-verified' : recoveryStatus,
  }));
}

export function clearWalletSetupMemory() {
  cache.clear();
  for (const scope of listeners.keys()) notify(scope);
}
