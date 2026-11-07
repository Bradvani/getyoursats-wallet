import GetYourSatsWordmark from './GetYourSatsWordmark';
import {AlertTriangleIcon, CashAppIcon, ChevronDownIcon, CurrencyIcon, QrCodeIcon, SatoshiIcon, SpinnerIcon} from './Icons';
import {useFlowText} from '../hooks/useFlowText';
import {usePresentation} from '../hooks/usePresentation';
import {WALLET_COPY} from '../services/presentationPreferences';
import {buyCopy, isBuyIconOnly} from '../services/settings';
import {safeAreaTop} from '../utils/safeAreaInsets';

interface Props {
  onOpenMenu: () => void;
  onScan?: () => void;
  onOpenBuyBitcoin?: () => void;
  isBuyLoading?: boolean;
  hasRejectedDeposits?: boolean;
  onOpenGetRefund?: () => void;
}

/** Only navigation stays above the scroll viewport. Balance is page content. */
export default function WalletToolbar({onOpenMenu, onScan, onOpenBuyBitcoin, isBuyLoading, hasRejectedDeposits, onOpenGetRefund}: Props) {
  const t = useFlowText();
  const {language} = usePresentation();
  return <header className="gys-wallet-toolbar" style={{paddingTop: safeAreaTop}}>
    <div className="gys-wallet-toolbar__row">
      <button type="button" className="gys-wallet-toolbar__menu" onClick={onOpenMenu}
        aria-label={t('Open menu')} data-testid="menu-button">
        <SatoshiIcon size="lg"/><ChevronDownIcon size="xs"/>
      </button>
      <GetYourSatsWordmark compact/>
      <div className="gys-wallet-toolbar__actions">
        {hasRejectedDeposits && onOpenGetRefund && <button type="button" onClick={onOpenGetRefund}
          aria-label={t('Refund')} title={t('Refund')}><AlertTriangleIcon/></button>}
        {onOpenBuyBitcoin && <button type="button" onClick={onOpenBuyBitcoin} disabled={isBuyLoading}
          aria-label={buyCopy(t('Buy'))} title={buyCopy(t('Buy'))}>
          {isBuyLoading ? <SpinnerIcon className="animate-spin"/> : isBuyIconOnly() ? <CashAppIcon/> : <CurrencyIcon/>}
        </button>}
        {onScan && <button type="button" onClick={onScan} aria-label={WALLET_COPY[language].scanPayment}
          title={WALLET_COPY[language].scan} data-testid="scan-button"><QrCodeIcon/></button>}
      </div>
    </div>
  </header>;
}
