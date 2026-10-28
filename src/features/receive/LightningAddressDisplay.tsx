import {useFlowText} from '@/hooks/useFlowText';
import {trustCopy} from '@/getyoursats/trustCopy';
import {featureAvailability} from '@/getyoursats/featureAvailability';
import React, { type ReactNode } from 'react';
import type { LightningAddressInfo } from '@breeztech/breez-sdk-spark';
import { AlertCard } from '../../components/AlertCard';
import { QRCodeContainer, QrPlaceholder, PrimaryButton, CopyableText, TextButton } from '../../components/ui';
import { useToast } from '../../contexts/ToastContext';

export interface LightningAddressDisplayProps {
  address: LightningAddressInfo | null;
  isLoading: boolean;
  isSupported: boolean;
  /** Opens the edit sheet, which also creates the first address. */
  onEdit: () => void;
  onCustomizeAmount: () => void;
  /** The QR slot beside the side dock, or the address and actions under it. */
  section: 'qr' | 'details';
  qrSize?: number;
  qrCardClassName?: string;
}

const LightningAddressDisplay: React.FC<LightningAddressDisplayProps> = ({
  address,
  isLoading,
  isSupported,
  onEdit,
  onCustomizeAmount,
  section,
  qrSize = 200,
  qrCardClassName,
}) => {
  const t=useFlowText();
  const { showToast } = useToast();
  const amountLink = (className: string) => (
    <TextButton
      onClick={onCustomizeAmount}
      className={`${className} show-amount-panel-button`}
      data-testid="show-amount-panel-button"
    >{t("Create invoice with specific amount →")}</TextButton>
  );
  // A message in the QR slot takes the card's width, so the dock and caption stay put.
  const slot = (children: ReactNode) => <div style={{ width: qrSize + 32 }}>{children}</div>;

  if (!isSupported) {
    return section === 'qr' ? slot(
      <AlertCard variant="info" title={t("Lightning addresses unavailable")} className="w-full text-left">
        <p className="text-spark-text-secondary text-sm" data-testid="lightning-address-unsupported">{t("They're not supported in this environment.")}</p>
      </AlertCard>,
    ) : (
      <div className="w-full flex justify-center">{amountLink('text-sm')}</div>
    );
  }

  // Loading state — gated on `!address` so we only show the placeholder
  // while the address is genuinely unknown. The first open after
  // passkey onboarding (new label, no LN address registered yet)
  // lands here: `useLightningAddress.load()` hits
  // `getLightningAddress() → null`, auto-registers a random
  // username, then re-fetches. `isLoading=true` and `address=null`
  // for the full lookup→register→re-lookup span — without this
  // branch the user saw the `!address` fallback
  // ("Create Lightning Address" button) flash during auto-creation,
  // which is confusing because they didn't ask to create anything.
  //
  // The earlier version of this branch gated on plain `isLoading`
  // and caused a flash on every tab switch because
  // `load()` refires on Lightning-tab re-entry even when `address`
  // is already cached. Gating on `!address` fixes that regression
  // too: cached-address + in-flight refresh now stays on the QR
  // view.
  if (isLoading && !address) {
    return section === 'qr' ? <QrPlaceholder size={qrSize} cardClassName={qrCardClassName} /> : null;
  }

  if (!address) {
    return section === 'qr' ? slot(
      <div className="text-center">
        <h3 className="font-display text-lg font-semibold text-spark-text-primary mb-2">{t('Lightning Address')}</h3>
        <p className="text-spark-text-secondary text-sm mb-4">{t("Create a Lightning Address to receive payments easily")}</p>
        <PrimaryButton onClick={onEdit}>{t("Create Lightning Address")}</PrimaryButton>
      </div>,
    ) : (
      <div className="w-full flex justify-center">{amountLink('text-sm')}</div>
    );
  }

  if (section === 'qr') {
    return <QRCodeContainer value={address.lnurl.bech32.toUpperCase()} size={qrSize} cardClassName={qrCardClassName} />;
  }

  return (
    <div className="w-full flex flex-col items-center gap-4">
      <CopyableText
        text={address.lightningAddress}
        truncate
        showShare
        label="Lightning Address"
        textColor="text-spark-primary"
        onCopied={() => showToast('success', t('Copied!'))}
        onShareError={() => showToast('error', t('Failed to share'))}
        textToCopy={address.lightningAddress}
        textToShare={address.lnurl.bech32}
        shareLabel="LNURL-Pay"
        data-testid="lightning-address-text"
      />

      <p className="text-xs text-center text-spark-text-muted max-w-xs">
        {featureAvailability.emailVerification?t('Personalize your address in Settings after email verification.'):trustCopy().personalSoon}
      </p>
      {amountLink('mt-2')}
    </div>
  );
};

export default LightningAddressDisplay;
