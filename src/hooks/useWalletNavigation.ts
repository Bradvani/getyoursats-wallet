import { useState } from 'react';

/** Keep the wallet mounted, but dismiss App's covering screen when a
 * persistent desktop destination is selected. Local state alone is hidden
 * behind Settings and its nested pages. */
export function useWalletNavigation(onReturnToWallet: () => void, onOpenSettings: () => void) {
  const [historyOpen, setHistoryOpen] = useState(false);
  const [gysPosOpen, setGysPosOpen] = useState(false);
  const navigate = (destination: 'wallet' | 'history' | 'merchant' | 'settings') => {
    if (destination === 'settings') {
      setGysPosOpen(false);
      onOpenSettings();
      return;
    }
    onReturnToWallet();
    setHistoryOpen(destination === 'history');
    setGysPosOpen(destination === 'merchant');
  };
  return { historyOpen, setHistoryOpen, gysPosOpen, setGysPosOpen, navigate };
}
