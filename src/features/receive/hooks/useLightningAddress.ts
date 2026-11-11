import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import type { LightningAddressInfo, BreezSdk } from '@breeztech/breez-sdk-spark';
import { useSdkEvents, useWallet, useWalletConnection } from '../../../contexts/WalletContext';
import { generateRandomName, generateRandomNameSuffix } from '../../../utils/randomName';
import { logger, LogCategory } from '@/services/logger';
import { formatError } from '@/utils/formatError';
import {browserReceivingRestriction} from '../../../security/browserReleasePolicy';

export interface UseLightningAddress {
  address: LightningAddressInfo | null;
  isLoading: boolean;
  isEditing: boolean;
  editValue: string;
  error: string | null;
  isSupported: boolean;
  load: () => Promise<void>;
  beginEdit: (currentAddress?: LightningAddressInfo | null) => void;
  cancelEdit: () => void;
  setEditValue: (v: string) => void;
  save: () => Promise<void>;
  reset: () => void;
}

const LOAD_FAILED_MESSAGE = "Couldn't load your Lightning address. Please try again.";
const SAVE_FAILED_MESSAGE = "Couldn't save your Lightning address. Please try again.";

interface AddressSnapshot {
  address: LightningAddressInfo | null;
  isLoading: boolean;
  error: string | null;
  isSupported: boolean;
}

interface AddressState {
  snapshot: AddressSnapshot;
  listeners: Set<() => void>;
  pending: Promise<void> | null;
  revision: number;
  eventConsumers: number;
  unsubscribeEvents: (() => void) | null;
  preferred: LightningAddressInfo | null;
  getSnapshot: () => AddressSnapshot;
  subscribe: (listener: () => void) => () => void;
}

// Home and Receive share the address and registration operation. A new SDK
// gets a new state, so an old wallet's late response cannot reach the new one.
const addressesBySdk = new WeakMap<BreezSdk, AddressState>();

function addressState(wallet: BreezSdk): AddressState {
  const existing = addressesBySdk.get(wallet);
  if (existing) return existing;
  const state: AddressState = {
    snapshot: { address: null, isLoading: true, error: null, isSupported: true },
    listeners: new Set(),
    pending: null,
    revision: 0,
    eventConsumers: 0,
    unsubscribeEvents: null,
    preferred: null,
    getSnapshot: () => state.snapshot,
    subscribe: listener => {
      state.listeners.add(listener);
      return () => { state.listeners.delete(listener); };
    },
  };
  addressesBySdk.set(wallet, state);
  return state;
}

function update(state: AddressState, changes: Partial<AddressSnapshot>): void {
  state.snapshot = { ...state.snapshot, ...changes };
  state.listeners.forEach(listener => listener());
}

// Native registration returns before any cross-device change event. Publish
// that result against the exact SDK from useWallet, invalidating older reads.
export function publishLightningAddress(wallet: BreezSdk, address: LightningAddressInfo): void {
  const state = addressState(wallet);
  state.revision++;
  update(state, { address, isLoading: false, error: null, isSupported: true });
}

function preferLightningAddress(wallet: BreezSdk, address: LightningAddressInfo | null): void {
  addressState(wallet).preferred = address;
  if (address) publishLightningAddress(wallet, address);
}

function failed(state: AddressState, error: unknown, message: string): void {
  if (error instanceof Error && /lnurl server is not configured/i.test(error.message)) {
    update(state, { isSupported: false, error: null });
  } else {
    update(state, { error: message });
  }
}

function current(state: AddressState, revision: number): boolean {
  return state.revision === revision && state.listeners.size > 0;
}

function loadAddress(wallet: BreezSdk, state: AddressState): Promise<void> {
  if (state.preferred) return Promise.resolve();
  if (state.pending) return state.pending;
  if (!state.snapshot.isSupported) return Promise.resolve();
  const revision = ++state.revision;
  update(state, { isLoading: !state.snapshot.address, error: null });

  const task = (async () => {
    try {
      const existing = await wallet.getLightningAddress();
      if (!current(state, revision)) return;
      if (existing) {
        update(state, { address: existing });
        return;
      }
      // Keep recovery reads available without allocating a new payable name
      // while the corresponding Lightning claim path is unavailable.
      if(browserReceivingRestriction(wallet,'bolt11Invoice'))return;

      const base = generateRandomName();
      for (let i = 0; i < 3; i++) {
        const username = base + (i === 0 ? '' : generateRandomNameSuffix());
        const available = await wallet.checkLightningAddressAvailable({ username });
        if (!current(state, revision)) return;
        if (!available) continue;
        // The SDK derives the description from its registered domain and
        // returns the actual payable address, including its LNURL QR data.
        const registered = await wallet.registerLightningAddress({ username });
        if (current(state, revision)) update(state, { address: registered ?? null });
        return;
      }
    } catch (error) {
      if (current(state, revision)) {
        logger.error(LogCategory.PAYMENT, 'Failed to load Lightning address', { error: formatError(error) });
        failed(state, error, LOAD_FAILED_MESSAGE);
      }
    } finally {
      if (state.revision === revision) update(state, { isLoading: false });
    }
  })();
  state.pending = task;
  void task.finally(() => { if (state.pending === task) state.pending = null; });
  return task;
}

function observeAddressChanges(
  wallet: BreezSdk,
  state: AddressState,
  subscribe: ReturnType<typeof useSdkEvents>,
): () => void {
  state.eventConsumers++;
  if (!state.unsubscribeEvents) {
    state.unsubscribeEvents = subscribe(event => {
      if (event.type !== 'lightningAddressChanged') return;
      // The payment SDK remains on Breez's domain. Its cache and change
      // events cannot replace a native address recovered for this wallet.
      if (state.preferred) return;
      const revision = ++state.revision;
      // The app event bus has no SDK identity tag. Read this SDK's cache
      // instead of applying a payload that could arrive from an old session.
      // A remote deletion clears the address without allocating a new name.
      void wallet.getLightningAddress().then(address => {
        if (current(state, revision)) {
          update(state, { address: address ?? null, isLoading: false, error: null, isSupported: true });
        }
      }).catch(error => {
        if (current(state, revision)) {
          failed(state, error, LOAD_FAILED_MESSAGE);
          update(state, { isLoading: false });
        }
      });
    });
  }
  return () => {
    if (--state.eventConsumers === 0) {
      state.unsubscribeEvents?.();
      state.unsubscribeEvents = null;
    }
  };
}

async function saveAddress(wallet: BreezSdk, state: AddressState, username: string): Promise<boolean> {
  const restriction=browserReceivingRestriction(wallet,'bolt11Invoice');
  if(restriction){update(state,{error:restriction});return false;}
  if (!state.snapshot.isSupported || state.pending || state.preferred) return false;
  if (!username) {
    update(state, { error: 'Please enter a username' });
    return false;
  }
  const revision = ++state.revision;
  update(state, { isLoading: true, error: null });
  let saved = false;
  const task = (async () => {
    try {
      const available = await wallet.checkLightningAddressAvailable({ username });
      if (!current(state, revision)) return;
      if (!available) {
        update(state, { error: 'This username is not available' });
        return;
      }
      const registered = await wallet.registerLightningAddress({ username });
      saved = true;
      if (current(state, revision)) update(state, { address: registered ?? null });
    } catch (error) {
      if (current(state, revision)) {
        logger.error(LogCategory.PAYMENT, 'Failed to save Lightning address', { error: formatError(error) });
        failed(state, error, SAVE_FAILED_MESSAGE);
      }
    } finally {
      if (state.revision === revision) update(state, { isLoading: false });
    }
  })();
  state.pending = task;
  try { await task; } finally { if (state.pending === task) state.pending = null; }
  return saved;
}

const extractUsername = (value: string): string => value.split('@')[0];

export const useLightningAddress = (): UseLightningAddress => {
  const wallet = useWallet();
  const {preferredLightningAddress} = useWalletConnection();
  const subscribeEvents = useSdkEvents();
  const state = useMemo(() => addressState(wallet), [wallet]);
  const snapshot = useSyncExternalStore(state.subscribe, state.getSnapshot, state.getSnapshot);
  const [editor, setEditor] = useState({ wallet, isEditing: false, value: '' });
  const isEditing = editor.wallet === wallet && editor.isEditing && snapshot.isSupported && !preferredLightningAddress;
  const editValue = editor.wallet === wallet ? editor.value : '';

  const load = useCallback(() => loadAddress(wallet, state), [wallet, state]);

  useEffect(() => {
    preferLightningAddress(wallet, preferredLightningAddress);
  }, [wallet, preferredLightningAddress]);

  useEffect(() => {
    const unsubscribe = observeAddressChanges(wallet, state, subscribeEvents);
    void load();
    return unsubscribe;
  }, [wallet, state, subscribeEvents, load]);

  const beginEdit = useCallback((address?: LightningAddressInfo | null) => {
    if (!state.snapshot.isSupported || state.preferred) return;
    setEditor({ wallet, isEditing: true, value: extractUsername((address ?? state.snapshot.address)?.lightningAddress ?? '') });
    update(state, { error: null });
  }, [wallet, state]);

  const cancelEdit = useCallback(() => {
    setEditor({ wallet, isEditing: false, value: '' });
    update(state, { error: null });
  }, [wallet, state]);

  const setEditValue = useCallback((value: string) => {
    setEditor(previous => ({ wallet, isEditing: previous.wallet === wallet && previous.isEditing, value }));
  }, [wallet]);

  const save = useCallback(async () => {
    const username = extractUsername(editValue.trim());
    if (await saveAddress(wallet, state, username)) {
      setEditor(previous => previous.wallet === wallet ? { wallet, isEditing: false, value: '' } : previous);
    }
  }, [editValue, wallet, state]);

  return {
    ...snapshot,
    ...(preferredLightningAddress ? {address: preferredLightningAddress, isLoading: false, error: null, isSupported: true} : {}),
    isEditing,
    editValue,
    load,
    beginEdit,
    cancelEdit,
    setEditValue,
    save,
    reset: cancelEdit,
  };
};
