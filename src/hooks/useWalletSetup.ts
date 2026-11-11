import {useCallback, useEffect, useRef, useSyncExternalStore} from 'react';
import {bitcoinLearningScope, offerBitcoinLearning} from '../getyoursats/bitcoinLearningState';
import {
  EMPTY_WALLET_SETUP, advanceWalletTour, retreatWalletTour, beginWalletTour, initializeNewWalletSetup,
  dismissWalletSetupCard, readWalletSetup, skipWalletTour, subscribeWalletSetup, walletSetupScope,
  type WalletSetupProgress,
} from '../getyoursats/walletSetupState';

export interface WalletSetupController {
  scope: string | null;
  progress: WalletSetupProgress;
  beginTour: (restart?: boolean) => void;
  next: () => void;
  previous: () => void;
  skip: () => void;
  dismissCard: () => void;
}

export function useWalletSetup(identityPubkey?: string | null, network?: string | null): WalletSetupController {
  const scope = walletSetupScope(identityPubkey, network);
  const subscribe = useCallback((listener: () => void) => subscribeWalletSetup(scope, listener), [scope]);
  const snapshot = useCallback(() => readWalletSetup(scope), [scope]);
  const progress = useSyncExternalStore(subscribe, snapshot, () => EMPTY_WALLET_SETUP);
  const beginTour = useCallback((restart = false) => beginWalletTour(scope, restart), [scope]);
  const next = useCallback(() => advanceWalletTour(scope), [scope]);
  const previous = useCallback(() => retreatWalletTour(scope), [scope]);
  const skip = useCallback(() => skipWalletTour(scope), [scope]);
  const dismissCard = useCallback(() => dismissWalletSetupCard(scope), [scope]);
  return {scope, progress, beginTour, next, previous, skip, dismissCard};
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
      // The older six-step wallet tour is opt-in rather than a second forced flow.
      skipWalletTour(scope);
      // Education is only offered to freshly created wallets, never restores.
      offerBitcoinLearning(bitcoinLearningScope(scope));
    }
  }, [creation, client, connected, scope]);
}
