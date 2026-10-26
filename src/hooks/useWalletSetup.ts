import {useCallback, useEffect, useRef, useSyncExternalStore} from 'react';
import {
  EMPTY_WALLET_SETUP, advanceWalletTour, beginWalletTour, initializeNewWalletSetup,
  readWalletSetup, skipWalletTour, subscribeWalletSetup, walletSetupScope,
  type WalletSetupProgress,
} from '../getyoursats/walletSetupState';

export interface WalletSetupController {
  scope: string | null;
  progress: WalletSetupProgress;
  beginTour: (restart?: boolean) => void;
  next: () => void;
  skip: () => void;
}

export function useWalletSetup(identityPubkey?: string | null, network?: string | null): WalletSetupController {
  const scope = walletSetupScope(identityPubkey, network);
  const subscribe = useCallback((listener: () => void) => subscribeWalletSetup(scope, listener), [scope]);
  const snapshot = useCallback(() => readWalletSetup(scope), [scope]);
  const progress = useSyncExternalStore(subscribe, snapshot, () => EMPTY_WALLET_SETUP);
  const beginTour = useCallback((restart = false) => beginWalletTour(scope, restart), [scope]);
  const next = useCallback(() => advanceWalletTour(scope), [scope]);
  const skip = useCallback(() => skipWalletTour(scope), [scope]);
  return {scope, progress, beginTour, next, skip};
}

export interface NewWalletSetup {
  client: object;
  phraseVerified: boolean;
}

export function useNewWalletSetup({creation, client, connected, scope}: {
  creation: NewWalletSetup | null;
  client: object | null;
  connected: boolean;
  scope: string | null;
}) {
  const handled = useRef<NewWalletSetup | null>(null);
  useEffect(() => {
    if (!creation || handled.current === creation) return;
    // A later credential or label must never inherit an earlier creation event.
    if (client && client !== creation.client) {
      handled.current = creation;
      return;
    }
    if (connected && scope && client === creation.client) {
      handled.current = creation;
      initializeNewWalletSetup(scope, creation.phraseVerified);
    }
  }, [creation, client, connected, scope]);
}
