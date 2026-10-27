import React from 'react';
import LoadingSpinner from '../../components/LoadingSpinner';
import { QRCodeContainer, CopyableText } from '../../components/ui';
import { useToast } from '../../contexts/ToastContext';
import {useFlowText} from '../../hooks/useFlowText';

interface Props {
  address: string | null;
  isLoading: boolean;
}

const SparkAddressDisplay: React.FC<Props> = ({ address, isLoading }) => {
  const { showToast } = useToast();
  const t=useFlowText();

  if (isLoading || !address) {
    return (
      <div className="text-center py-8">
        <LoadingSpinner text={t('Generating Spark address...')} />
      </div>
    );
  }

  return (
    <div className="flex flex-col items-center gap-6">
      <QRCodeContainer value={address} />

      <CopyableText
        text={address}
        showShare
        label="Spark Address"
        textColor="text-spark-primary"
        onCopied={() => showToast('success', t('Copied!'))}
        onShareError={() => showToast('error', t('Failed to share'))}
        data-testid="spark-address-text"
      />
    </div>
  );
};

export default SparkAddressDisplay;
