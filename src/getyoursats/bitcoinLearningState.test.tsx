import {act, cleanup, renderHook} from '@testing-library/react';
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import {
  BITCOIN_LEARNING_CHAPTERS, EMPTY_BITCOIN_LEARNING,
  bitcoinLearningScope, clearBitcoinLearningMemory, nextBitcoinLearning,
  offerBitcoinLearning, previousBitcoinLearning, readBitcoinLearning,
  skipBitcoinLearning, startBitcoinLearning, subscribeBitcoinLearning, useBitcoinLearning,
} from './bitcoinLearningState';
import {confirmWalletRecovery, readWalletSetup, walletSetupScope, clearWalletSetupMemory} from './walletSetupState';

const identity = '02' + 'a'.repeat(64);
const otherIdentity = '03' + 'b'.repeat(64);
const walletA = walletSetupScope(identity, 'mainnet')!;
const walletB = walletSetupScope(otherIdentity, 'mainnet')!;
const scope = bitcoinLearningScope(walletA)!;

beforeEach(() => {
  vi.restoreAllMocks();
  localStorage.clear();
  clearBitcoinLearningMemory();
  clearWalletSetupMemory();
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('optional Bitcoin education, isolated from Bitcoin ownership', () => {
  it('refuses invalid identity/network scopes and never creates a global fallback', () => {
    expect(bitcoinLearningScope(null)).toBeNull();
    expect(bitcoinLearningScope('wrong')).toBeNull();
    expect(bitcoinLearningScope(walletSetupScope(identity, 'regtest'))).not.toBe(scope);
    offerBitcoinLearning(null);
    expect(localStorage.length).toBe(0);
  });

  it('only offers a lesson when explicitly enrolled and keeps restored wallets unseen', () => {
    expect(readBitcoinLearning(scope)).toEqual(EMPTY_BITCOIN_LEARNING);
    expect(readBitcoinLearning(bitcoinLearningScope(walletB)).status).toBe('not-offered');
    offerBitcoinLearning(scope);
    expect(readBitcoinLearning(scope).status).toBe('offered');
    expect(readBitcoinLearning(bitcoinLearningScope(walletB)).status).toBe('not-offered');
  });

  it('skips at any point, preserves the chapter and never verifies wallet recovery', () => {
    offerBitcoinLearning(scope);
    startBitcoinLearning(scope);
    nextBitcoinLearning(scope);
    skipBitcoinLearning(scope);
    expect(readBitcoinLearning(scope)).toMatchObject({status:'skipped', chapter:'supply'});
    expect(readWalletSetup(walletA).recoveryStatus).toBe('pending');
    confirmWalletRecovery(walletA, 'phrase-verified');
    expect(readWalletSetup(walletA).recoveryStatus).toBe('phrase-verified');
    startBitcoinLearning(scope, true);
    expect(readBitcoinLearning(scope)).toMatchObject({status:'active', chapter:'mission'});
    expect(readWalletSetup(walletA).recoveryStatus).toBe('phrase-verified');
  });

  it('completes exactly ten manual chapters with no payout or backup claims', () => {
    startBitcoinLearning(scope);
    for (let i=0;i<BITCOIN_LEARNING_CHAPTERS.length;i++) nextBitcoinLearning(scope);
    expect(readBitcoinLearning(scope)).toMatchObject({status:'completed',chapter:'payments'});
    previousBitcoinLearning(scope);
    expect(readBitcoinLearning(scope).status).toBe('completed');
    startBitcoinLearning(scope, true);
    expect(readBitcoinLearning(scope).chapter).toBe('mission');
  });

  it('persists progress only on its own network and wallet', () => {
    offerBitcoinLearning(scope);
    startBitcoinLearning(scope);
    for (let i=0;i<6;i++) nextBitcoinLearning(scope);
    const last = readBitcoinLearning(scope);
    clearBitcoinLearningMemory();
    expect(readBitcoinLearning(scope)).toEqual(last);
    expect(readBitcoinLearning(bitcoinLearningScope(walletB))).toEqual(EMPTY_BITCOIN_LEARNING);
    expect(readBitcoinLearning(bitcoinLearningScope(walletSetupScope(identity, 'regtest')))).toEqual(EMPTY_BITCOIN_LEARNING);
  });

  it('reacts to changes across live subscribers and browser tabs', () => {
    const a = vi.fn();
    const b = vi.fn();
    const stopA = subscribeBitcoinLearning(scope, a);
    const stopB = subscribeBitcoinLearning(bitcoinLearningScope(walletB), b);
    offerBitcoinLearning(scope);
    expect(a).toHaveBeenCalledOnce();
    expect(b).not.toHaveBeenCalled();
    localStorage.setItem(scope, JSON.stringify({...readBitcoinLearning(scope),status:'skipped'}));
    window.dispatchEvent(new StorageEvent('storage',{key:scope}));
    expect(readBitcoinLearning(scope).status).toBe('skipped');
    expect(a).toHaveBeenCalledTimes(2);
    stopA();stopB();
  });

  it('works in memory when private browsing blocks persistence', () => {
    vi.spyOn(Storage.prototype,'setItem').mockImplementation(() => {throw new DOMException('Blocked','SecurityError')});
    offerBitcoinLearning(scope);
    startBitcoinLearning(scope);
    nextBitcoinLearning(scope);
    expect(readBitcoinLearning(scope)).toMatchObject({status:'active',chapter:'supply'});
  });

  it('a hook receives wallet updates without changing signer or mnemonic state', () => {
    const {result, rerender} = renderHook(({scope:wallet}) => useBitcoinLearning(wallet), {initialProps:{scope:walletA}});
    expect(result.current.progress.status).toBe('not-offered');
    act(() => offerBitcoinLearning(result.current.scope));
    expect(result.current.progress.status).toBe('offered');
    act(() => result.current.start());
    expect(result.current.progress.status).toBe('active');
    act(() => result.current.skip());
    expect(result.current.progress.status).toBe('skipped');
    rerender({scope:walletB});
    expect(result.current.progress).toEqual(EMPTY_BITCOIN_LEARNING);
  });
});
