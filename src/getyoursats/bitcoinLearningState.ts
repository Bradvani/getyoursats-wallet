import {useCallback, useSyncExternalStore} from 'react';

/**
 * Educational progress only. Never stores seed material, passkeys, wallet
 * permissions or backup-verification claims. Scoped to one wallet and network.
 */
export const BITCOIN_LEARNING_CHAPTERS = [
  'mission', 'supply', 'sats', 'halving', 'lightning', 'getyoursats',
  'keys', 'recovery', 'passkeys', 'payments',
] as const;
export type BitcoinLearningChapter = typeof BITCOIN_LEARNING_CHAPTERS[number];
export type BitcoinLearningStatus = 'not-offered' | 'offered' | 'active' | 'skipped' | 'completed';
export interface BitcoinLearningProgress {
  readonly version: 1;
  readonly status: BitcoinLearningStatus;
  readonly chapter: BitcoinLearningChapter;
}
export const EMPTY_BITCOIN_LEARNING: BitcoinLearningProgress = Object.freeze({
  version: 1, status: 'not-offered', chapter: 'mission',
});

const SOURCE_SCOPE = /^gys:wallet-setup:v1:(mainnet|testnet|signet|regtest):(?:02|03)[a-f0-9]{64}$/;
const LEARNING_PREFIX = 'gys:bitcoin-learning:v1:';
const listeners = new Map<string, Set<() => void>>();
const cache = new Map<string, {raw: string | null; state: BitcoinLearningProgress}>();

export function bitcoinLearningScope(walletScope: string | null): string | null {
  return walletScope && SOURCE_SCOPE.test(walletScope)
    ? LEARNING_PREFIX + walletScope.slice('gys:wallet-setup:v1:'.length)
    : null;
}

function isValid(scope: string | null): scope is string {
  return Boolean(scope && /^gys:bitcoin-learning:v1:(mainnet|testnet|signet|regtest):(?:02|03)[a-f0-9]{64}$/.test(scope));
}

function parse(raw: string | null): BitcoinLearningProgress {
  if (!raw) return EMPTY_BITCOIN_LEARNING;
  try {
    const value: unknown = JSON.parse(raw);
    if (!value || typeof value !== 'object' || Array.isArray(value)) return EMPTY_BITCOIN_LEARNING;
    const data = value as Record<string, unknown>;
    if (data.version !== 1 ||
        !['not-offered','offered','active','skipped','completed'].includes(String(data.status)) ||
        !BITCOIN_LEARNING_CHAPTERS.includes(data.chapter as BitcoinLearningChapter)) {
      return EMPTY_BITCOIN_LEARNING;
    }
    return Object.freeze({version: 1, status: data.status as BitcoinLearningStatus,
      chapter: data.chapter as BitcoinLearningChapter});
  } catch {
    return EMPTY_BITCOIN_LEARNING;
  }
}

export function readBitcoinLearning(scope: string | null): BitcoinLearningProgress {
  if (!isValid(scope)) return EMPTY_BITCOIN_LEARNING;
  const previous = cache.get(scope);
  try {
    const raw = localStorage.getItem(scope);
    if (previous && previous.raw === raw) return previous.state;
    const state = parse(raw);
    cache.set(scope, {raw, state});
    return state;
  } catch {
    return previous?.state ?? EMPTY_BITCOIN_LEARNING;
  }
}

function change(scope: string | null, update: (old: BitcoinLearningProgress) => BitcoinLearningProgress) {
  if (!isValid(scope)) return;
  const previous = readBitcoinLearning(scope);
  const next = Object.freeze(update(previous));
  if (next.status === previous.status && next.chapter === previous.chapter) return;
  let raw = cache.get(scope)?.raw ?? null;
  try {
    raw = JSON.stringify(next);
    localStorage.setItem(scope, raw);
  } catch { /* Continue in-memory for private browsing or storage restrictions. */ }
  cache.set(scope, {raw, state: next});
  for (const subscriber of listeners.get(scope) ?? []) subscriber();
}

function handleStorage(event: StorageEvent) {
  for (const [scope, subscribers] of listeners) {
    if (event.key !== null && event.key !== scope) continue;
    cache.delete(scope);
    subscribers.forEach(listener => listener());
  }
}

export function subscribeBitcoinLearning(scope: string | null, listener: () => void): () => void {
  if (!isValid(scope)) return () => {};
  if (listeners.size === 0) window.addEventListener('storage', handleStorage);
  let group = listeners.get(scope);
  if (!group) { group = new Set(); listeners.set(scope, group); }
  group.add(listener);
  return () => {
    group.delete(listener);
    if (!group.size) listeners.delete(scope);
    if (!listeners.size) window.removeEventListener('storage', handleStorage);
  };
}

/** Only call after an actual new-wallet creation event. Restores stay untouched. */
export function offerBitcoinLearning(scope: string | null) {
  change(scope, current => current.status === 'not-offered'
    ? {...current, status: 'offered', chapter: 'mission'} : current);
}
export function startBitcoinLearning(scope: string | null, restart = false) {
  change(scope, current => ({
    ...current, status: 'active',
    chapter: restart || ['not-offered', 'offered', 'completed'].includes(current.status) ? 'mission' : current.chapter,
  }));
}
export function nextBitcoinLearning(scope: string | null) {
  change(scope, current => {
    if (current.status !== 'active') return current;
    const next = BITCOIN_LEARNING_CHAPTERS[BITCOIN_LEARNING_CHAPTERS.indexOf(current.chapter) + 1];
    return {...current, status: next ? 'active' : 'completed', chapter: next ?? current.chapter};
  });
}
export function previousBitcoinLearning(scope: string | null) {
  change(scope, current => {
    if (current.status !== 'active') return current;
    return {...current, chapter: BITCOIN_LEARNING_CHAPTERS[
      Math.max(0, BITCOIN_LEARNING_CHAPTERS.indexOf(current.chapter) - 1)]};
  });
}
export function skipBitcoinLearning(scope: string | null) {
  change(scope, current => current.status === 'completed' ? current : {...current, status: 'skipped'});
}
export function clearBitcoinLearningMemory() {
  cache.clear();
  for (const group of listeners.values()) group.forEach(listener => listener());
}

export interface BitcoinLearningController {
  progress: BitcoinLearningProgress;
  scope: string | null;
  start: (restart?: boolean) => void;
  next: () => void;
  previous: () => void;
  skip: () => void;
}

export function useBitcoinLearning(walletScope: string | null): BitcoinLearningController {
  const scope = bitcoinLearningScope(walletScope);
  const subscribe = useCallback((listener: () => void) => subscribeBitcoinLearning(scope, listener), [scope]);
  const snapshot = useCallback(() => readBitcoinLearning(scope), [scope]);
  const progress = useSyncExternalStore(subscribe, snapshot, () => EMPTY_BITCOIN_LEARNING);
  const start = useCallback((restart = false) => startBitcoinLearning(scope, restart), [scope]);
  const next = useCallback(() => nextBitcoinLearning(scope), [scope]);
  const previous = useCallback(() => previousBitcoinLearning(scope), [scope]);
  const skip = useCallback(() => skipBitcoinLearning(scope), [scope]);
  return {scope, progress, start, next, previous, skip};
}
