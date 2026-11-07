import {ChevronRightIcon, CopyIcon} from '../components/Icons';
import {usePresentation} from '../hooks/usePresentation';
import {useToast} from '../contexts/ToastContext';
import type {UseLightningAddress} from '../features/receive/hooks/useLightningAddress';
import {WALLET_HOME} from '../locales/walletHome';
import {trustCopy} from './trustCopy';

import {isGetYourSatsAddress} from './walletIdentity';

export default function WalletIdentityCard({identity, onPersonalize}: {
  identity: Pick<UseLightningAddress, 'address' | 'isLoading' | 'error' | 'isSupported'>;
  onPersonalize?: () => void;
}) {
  const {language} = usePresentation();
  const {showToast} = useToast();
  const text = WALLET_HOME[language];
  const address = identity.address?.lightningAddress;
  const named = isGetYourSatsAddress(address);
  if (!identity.isSupported && !named) return null;
  if (!named && (identity.isLoading || identity.error)) {
    return <div className="gys-home-identity gys-home-identity--pending" role="status">
      {identity.isLoading ? text.checking : text.unavailable}
    </div>;
  }
  if (!named && !onPersonalize) return null;
  const copy = async () => {
    if (!named || !address) return;
    try {
      await navigator.clipboard.writeText(address);
      showToast('success', trustCopy(language).copySuccess);
    } catch { showToast('error', trustCopy(language).copyFailure); }
  };
  return <button type="button" className="gys-home-identity" data-testid="home-identity"
    data-wallet-tour="identity" onClick={named ? () => void copy() : onPersonalize}
    aria-label={named ? `${text.copyAddress}: ${address}` : undefined}>
    <span className="gys-home-identity__mark" aria-hidden="true">@</span>
    <span className="gys-home-identity__copy">
      {named ? <strong><bdi>{address}</bdi></strong> : <><strong>{text.chooseName}</strong><span dir="ltr">@getyoursats.com</span></>}
    </span>
    {named ? <CopyIcon size="sm"/> : <ChevronRightIcon size="sm" className="rtl:rotate-180"/>}
  </button>;
}
