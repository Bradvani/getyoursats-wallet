import {act, cleanup, renderHook} from '@testing-library/react';
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import {useNewWalletSetup, useWalletSetup, type NewWalletSetup} from './useWalletSetup';
import {
  clearWalletSetupMemory, confirmWalletRecovery, readWalletSetup, walletSetupScope,
} from '../getyoursats/walletSetupState';

const identityA = `02${'a'.repeat(64)}`;
const identityB = `03${'b'.repeat(64)}`;
const scopeA = walletSetupScope(identityA, 'mainnet')!;
const scopeB = walletSetupScope(identityB, 'mainnet')!;

beforeEach(() => {
  localStorage.clear();
  clearWalletSetupMemory();
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  localStorage.clear();
  clearWalletSetupMemory();
});

describe('wallet setup subscriptions and actions', () => {
  it('resumes saved progress after a remount without replaying the tour', () => {
    const first = renderHook(() => useWalletSetup(identityA, 'mainnet'));
    act(() => first.result.current.beginTour());
    act(() => first.result.current.next());
    act(() => first.result.current.skip());
    first.unmount();
    const restored = renderHook(() => useWalletSetup(identityA, 'mainnet'));
    expect(restored.result.current.progress).toMatchObject({tourStatus: 'skipped', step: 'protect', recoveryStatus: 'pending'});
    act(() => restored.result.current.beginTour());
    expect(restored.result.current.progress).toMatchObject({tourStatus: 'active', step: 'protect'});
  });

  it('uses the next wallet scope immediately and preserves each wallet independently', () => {
    const {result, rerender} = renderHook(({identity}) => useWalletSetup(identity, 'mainnet'),
      {initialProps: {identity: identityA}});
    act(() => result.current.beginTour());
    act(() => result.current.next());
    act(() => confirmWalletRecovery(scopeA, 'phrase-verified'));
    rerender({identity: identityB});
    expect(result.current.scope).toBe(scopeB);
    expect(result.current.progress).toMatchObject({tourStatus: 'not-started', step: 'language', recoveryStatus: 'pending'});
    act(() => result.current.beginTour());
    act(() => result.current.skip());
    rerender({identity: identityA});
    expect(result.current.progress).toMatchObject({tourStatus: 'active', step: 'protect', recoveryStatus: 'phrase-verified'});
    expect(readWalletSetup(scopeB)).toMatchObject({tourStatus: 'skipped', recoveryStatus: 'pending'});
  });

  it('updates every subscriber only from matching wallet progress', () => {
    const first = renderHook(() => useWalletSetup(identityA, 'mainnet'));
    const second = renderHook(() => useWalletSetup(identityA, 'mainnet'));
    const other = renderHook(() => useWalletSetup(identityB, 'mainnet'));
    act(() => first.result.current.beginTour());
    expect(second.result.current.progress.tourStatus).toBe('active');
    expect(other.result.current.progress.tourStatus).toBe('not-started');
    act(() => confirmWalletRecovery(scopeA, 'passkey-reviewed'));
    expect(second.result.current.progress.recoveryStatus).toBe('passkey-reviewed');
    expect(other.result.current.progress.recoveryStatus).toBe('pending');
  });

  it('keeps Next, Skip and replay separate from backup evidence', () => {
    const {result} = renderHook(() => useWalletSetup(identityA, 'mainnet'));
    act(() => result.current.beginTour());
    for (let step = 0; step < 6; step++) act(() => result.current.next());
    expect(result.current.progress).toMatchObject({tourStatus: 'completed', recoveryStatus: 'pending'});
    act(() => result.current.beginTour(true));
    act(() => result.current.skip());
    expect(result.current.progress).toMatchObject({tourStatus: 'skipped', step: 'language', recoveryStatus: 'pending'});
  });

  it('keeps the current session usable when persistent storage rejects writes', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {throw new DOMException('Blocked', 'SecurityError');});
    const {result} = renderHook(() => useWalletSetup(identityA, 'mainnet'));
    act(() => result.current.beginTour());
    act(() => result.current.next());
    expect(result.current.progress).toMatchObject({tourStatus: 'active', step: 'protect'});
    act(() => result.current.skip());
    expect(result.current.progress).toMatchObject({tourStatus: 'skipped', step: 'protect', recoveryStatus: 'pending'});
  });
});

describe('new-wallet enrollment', () => {
  interface Props {
    creation: NewWalletSetup | null;
    client: object | null;
    connected: boolean;
    identity: string | null;
  }
  function useEnrollment({creation, client, connected, identity}: Props) {
    const setup = useWalletSetup(identity, 'mainnet');
    useNewWalletSetup({creation, client, connected, scope: setup.scope});
    return setup;
  }

  it('waits for the exact connected client and its valid identity', () => {
    const client = {};
    const creation = {client, phraseVerified: false};
    const {result, rerender} = renderHook(useEnrollment, {initialProps: {
      creation, client: null, connected: false, identity: null,
    } as Props});
    expect(result.current.scope).toBeNull();
    rerender({creation, client, connected: false, identity: identityA});
    expect(result.current.progress.tourStatus).toBe('not-started');
    rerender({creation, client, connected: true, identity: null});
    expect(readWalletSetup(scopeA).tourStatus).toBe('not-started');
    rerender({creation, client, connected: true, identity: identityA});
    expect(result.current.progress).toMatchObject({tourStatus: 'active', recoveryStatus: 'pending'});
  });

  it('carries a successfully completed phrase challenge into the newly connected wallet only', () => {
    const client = {};
    const {result} = renderHook(useEnrollment, {initialProps: {
      creation: {client, phraseVerified: true}, client, connected: true, identity: identityA,
    } as Props});
    expect(result.current.progress).toMatchObject({tourStatus: 'active', recoveryStatus: 'phrase-verified'});
    expect(readWalletSetup(scopeB).recoveryStatus).toBe('pending');
  });

  it('does not enroll a restore, unlock or reconnect without a creation event', () => {
    const client = {};
    const {result, rerender} = renderHook(useEnrollment, {initialProps: {
      creation: null, client, connected: true, identity: identityA,
    } as Props});
    expect(result.current.progress.tourStatus).toBe('not-started');
    rerender({creation: null, client, connected: false, identity: identityA});
    rerender({creation: null, client, connected: true, identity: identityA});
    expect(result.current.progress.tourStatus).toBe('not-started');
  });

  it('abandons an old creation event once a different client takes over', () => {
    const originalClient = {};
    const replacementClient = {};
    const creation = {client: originalClient, phraseVerified: true};
    const {result, rerender} = renderHook(useEnrollment, {initialProps: {
      creation, client: replacementClient, connected: true, identity: identityB,
    } as Props});
    expect(result.current.progress).toMatchObject({tourStatus: 'not-started', recoveryStatus: 'pending'});
    rerender({creation, client: originalClient, connected: true, identity: identityA});
    expect(result.current.progress).toMatchObject({tourStatus: 'not-started', recoveryStatus: 'pending'});
  });

  it('does not reuse a handled creation event when the identity later changes', () => {
    const client = {};
    const creation = {client, phraseVerified: true};
    const {result, rerender} = renderHook(useEnrollment, {initialProps: {
      creation, client, connected: true, identity: identityA,
    } as Props});
    act(() => result.current.skip());
    rerender({creation, client, connected: true, identity: identityB});
    expect(result.current.progress).toMatchObject({tourStatus: 'not-started', recoveryStatus: 'pending'});
    rerender({creation, client, connected: true, identity: identityA});
    expect(result.current.progress).toMatchObject({tourStatus: 'skipped', recoveryStatus: 'phrase-verified'});
  });

  it('does not reopen previously skipped progress if enrollment is repeated after remount', () => {
    const client = {};
    const creation = {client, phraseVerified: false};
    const initialProps: Props = {creation, client, connected: true, identity: identityA};
    const first = renderHook(useEnrollment, {initialProps});
    act(() => first.result.current.skip());
    first.unmount();
    const second = renderHook(useEnrollment, {initialProps});
    expect(second.result.current.progress).toMatchObject({tourStatus: 'skipped', recoveryStatus: 'pending'});
  });
});
