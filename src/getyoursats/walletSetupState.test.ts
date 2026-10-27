import {beforeEach, describe, expect, it, vi} from 'vitest';
import {
  EMPTY_WALLET_SETUP, advanceWalletTour, beginWalletTour, clearWalletSetupMemory,
  confirmWalletRecovery, dismissWalletSetupCard, initializeNewWalletSetup, readWalletSetup, skipWalletTour,
  subscribeWalletSetup, walletSetupScope,
} from './walletSetupState';

const identityA = `02${'a'.repeat(64)}`;
const identityB = `03${'b'.repeat(64)}`;
const scopeA = walletSetupScope(identityA, 'mainnet')!;
const scopeB = walletSetupScope(identityB, 'mainnet')!;

beforeEach(() => {
  vi.restoreAllMocks();
  localStorage.clear();
  clearWalletSetupMemory();
});

describe('wallet-scoped setup progress', () => {
  it('waits for a valid identity and network without creating a global fallback', () => {
    expect(walletSetupScope(null, 'mainnet')).toBeNull();
    expect(walletSetupScope(identityA, null)).toBeNull();
    expect(walletSetupScope('unknown', 'mainnet')).toBeNull();
    expect(walletSetupScope(identityA, 'unknown')).toBeNull();
    initializeNewWalletSetup(null, true);
    expect(localStorage.length).toBe(0);
    expect(walletSetupScope(identityA.toUpperCase(), 'mainnet')).toBe(scopeA);
  });

  it('does not auto-enroll an unseen restored wallet', () => {
    expect(readWalletSetup(scopeA)).toEqual(EMPTY_WALLET_SETUP);
    expect(localStorage.length).toBe(0);
  });

  it('starts fresh wallets with language while keeping an actual phrase check', () => {
    initializeNewWalletSetup(scopeA, true);
    expect(readWalletSetup(scopeA)).toMatchObject({tourStatus: 'active', step: 'language', recoveryStatus: 'phrase-verified'});
    initializeNewWalletSetup(scopeB, false);
    expect(readWalletSetup(scopeB).recoveryStatus).toBe('pending');
  });

  it('isolates different wallets and the same public identity on another network', () => {
    initializeNewWalletSetup(scopeA, true);
    advanceWalletTour(scopeA);
    expect(readWalletSetup(scopeB)).toEqual(EMPTY_WALLET_SETUP);
    expect(readWalletSetup(walletSetupScope(identityA, 'regtest'))).toEqual(EMPTY_WALLET_SETUP);
  });

  it('persists the exact skipped step and resumes without confirming recovery', () => {
    initializeNewWalletSetup(scopeA, false);
    advanceWalletTour(scopeA);
    skipWalletTour(scopeA);
    clearWalletSetupMemory();
    expect(readWalletSetup(scopeA)).toMatchObject({tourStatus: 'skipped', step: 'protect', recoveryStatus: 'pending'});
    beginWalletTour(scopeA);
    expect(readWalletSetup(scopeA)).toMatchObject({tourStatus: 'active', step: 'protect', recoveryStatus: 'pending'});
  });

  it('finishing and replaying a tour never confirms backup', () => {
    beginWalletTour(scopeA);
    for (let index = 0; index < 6; index++) advanceWalletTour(scopeA);
    expect(readWalletSetup(scopeA)).toMatchObject({tourStatus: 'completed', recoveryStatus: 'pending'});
    skipWalletTour(scopeA);
    expect(readWalletSetup(scopeA).tourStatus).toBe('completed');
    beginWalletTour(scopeA);
    expect(readWalletSetup(scopeA)).toMatchObject({tourStatus: 'active', step: 'language', recoveryStatus: 'pending'});
  });

  it('does not reset existing progress when a creation event is repeated', () => {
    initializeNewWalletSetup(scopeA, false);
    advanceWalletTour(scopeA);
    skipWalletTour(scopeA);
    initializeNewWalletSetup(scopeA, false);
    expect(readWalletSetup(scopeA)).toMatchObject({tourStatus: 'skipped', step: 'protect'});
  });

  it('records a passkey review separately and never downgrades verified words', () => {
    confirmWalletRecovery(scopeA, 'passkey-reviewed');
    expect(readWalletSetup(scopeA).recoveryStatus).toBe('passkey-reviewed');
    confirmWalletRecovery(scopeA, 'phrase-verified');
    confirmWalletRecovery(scopeA, 'passkey-reviewed');
    expect(readWalletSetup(scopeA).recoveryStatus).toBe('phrase-verified');
    expect(readWalletSetup(scopeB).recoveryStatus).toBe('pending');
  });

  it('resumes older guide progress and reaches POS without forcing a restart', () => {
    localStorage.setItem(scopeA, JSON.stringify({version: 1, tourStatus: 'skipped', step: 'receive', recoveryStatus: 'passkey-reviewed'}));
    beginWalletTour(scopeA);
    expect(readWalletSetup(scopeA)).toMatchObject({step: 'receive', recoveryStatus: 'passkey-reviewed'});
    advanceWalletTour(scopeA);
    expect(readWalletSetup(scopeA).step).toBe('pos');
    beginWalletTour(scopeA, true);
    expect(readWalletSetup(scopeA)).toMatchObject({step: 'language', recoveryStatus: 'passkey-reviewed'});
  });

  it.each(['{', 'null', '[]', '{"version":99}', JSON.stringify({version: 1, tourStatus: ['completed'], step: 'language', recoveryStatus: 'phrase-verified'})])(
    'treats malformed persisted progress as unknown: %s', raw => {
      localStorage.setItem(scopeA, raw);
      expect(readWalletSetup(scopeA)).toEqual(EMPTY_WALLET_SETUP);
    },
  );

  it('remains usable when persistence is blocked and does not leak state to another wallet', () => {
    const setItem = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new DOMException('Blocked'); });
    initializeNewWalletSetup(scopeA, false);
    advanceWalletTour(scopeA);
    skipWalletTour(scopeA);
    expect(readWalletSetup(scopeA)).toMatchObject({step: 'protect', tourStatus: 'skipped'});
    expect(readWalletSetup(scopeB)).toEqual(EMPTY_WALLET_SETUP);
    setItem.mockRestore();
    beginWalletTour(scopeA);
    clearWalletSetupMemory();
    expect(readWalletSetup(scopeA)).toMatchObject({step: 'protect', tourStatus: 'active'});
  });

  it('notifies only subscribers for the changed wallet and accepts cross-tab updates', () => {
    const listenerA = vi.fn();
    const listenerB = vi.fn();
    const stopA = subscribeWalletSetup(scopeA, listenerA);
    const stopB = subscribeWalletSetup(scopeB, listenerB);
    initializeNewWalletSetup(scopeA, false);
    expect(listenerA).toHaveBeenCalledTimes(1);
    expect(listenerB).not.toHaveBeenCalled();
    localStorage.setItem(scopeA, JSON.stringify({...EMPTY_WALLET_SETUP, tourStatus: 'completed'}));
    window.dispatchEvent(new StorageEvent('storage', {key: scopeA}));
    expect(readWalletSetup(scopeA).tourStatus).toBe('completed');
    expect(listenerA).toHaveBeenCalledTimes(2);
    expect(listenerB).not.toHaveBeenCalled();
    stopA();
    stopB();
  });
});

describe('welcome card dismissal', () => {
  it('survives a new session and repeated enrollment without changing recovery evidence', () => {
    initializeNewWalletSetup(scopeA, false);
    skipWalletTour(scopeA);
    dismissWalletSetupCard(scopeA);
    clearWalletSetupMemory();
    initializeNewWalletSetup(scopeA, false);
    expect(readWalletSetup(scopeA)).toMatchObject({cardDismissed: true, tourStatus: 'skipped', recoveryStatus: 'pending'});
    expect(readWalletSetup(scopeB).cardDismissed).toBe(false);
    expect(readWalletSetup(walletSetupScope(identityA, 'regtest')).cardDismissed).toBe(false);
    beginWalletTour(scopeA, true);
    expect(readWalletSetup(scopeA)).toMatchObject({cardDismissed: true, tourStatus: 'active', step: 'language', recoveryStatus: 'pending'});
  });

  it('reads older verified records without discarding backup evidence', () => {
    localStorage.setItem(scopeA, JSON.stringify({version: 1, tourStatus: 'skipped', step: 'protect', recoveryStatus: 'phrase-verified'}));
    expect(readWalletSetup(scopeA)).toMatchObject({cardDismissed: false, recoveryStatus: 'phrase-verified', tourStatus: 'skipped'});
    dismissWalletSetupCard(scopeA);
    clearWalletSetupMemory();
    expect(readWalletSetup(scopeA)).toMatchObject({cardDismissed: true, recoveryStatus: 'phrase-verified'});
  });
});
