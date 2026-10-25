import React from 'react';
import LoadingSpinner from '../../components/LoadingSpinner';
import { QRCodeContainer, CopyableText } from '../../components/ui';
import { useToast } from '../../contexts/ToastContext';

interface Props {
  address: string | null;
  isLoading: boolean;
  error?: string | null;
  onRetry?: () => void;
}

/** Direct Spark receipt is a separate protocol, not a fee-free Lightning invoice. */
const SparkAddressDisplay: React.FC<Props> = ({ address, isLoading, error, onRetry }) => {
  const { showToast } = useToast();

  if (!address) {
    if (isLoading) {
      return <div className="text-center py-8"><LoadingSpinner text="Generating Spark address..." /></div>;
    }
    return (
      <div className="w-full rounded-xl border border-spark-border bg-spark-surface p-4 text-center" role="alert">
        <p className="text-sm text-spark-text-secondary">
          {error ?? 'Could not create a Spark receive address. No payment request is available.'}
        </p>
        {onRetry && (
          <button type="button" onClick={onRetry}
            className="mt-3 rounded-lg border border-spark-border px-4 py-2 text-sm font-semibold text-spark-text-primary">
            Try again
          </button>
        )}
      </div>
    );
  }

  return (
    <div className="w-full flex flex-col items-center gap-4">
      <QRCodeContainer value={address} />
      <div className="w-full rounded-xl border border-spark-border bg-spark-surface p-3 text-center">
        <p className="font-semibold text-sm text-spark-text-primary">Direct Spark Bitcoin receive</p>
        <p className="mt-1 text-xs text-spark-text-secondary">
          Another Spark-compatible wallet can send Bitcoin here with no Spark transfer fee.
          This is not a Lightning invoice. Lightning Address payments can still incur routing fees.
        </p>
        <p className="mt-2 text-xs text-spark-text-muted">
          Spark addresses can be reused and linked across payments. Share this address only with people you trust.
        </p>
      </div>
      <CopyableText
        text={address}
        showShare
        label="Spark Address"
        textColor="text-spark-primary"
        onCopied={() => showToast('success', 'Copied!')}
        onShareError={() => showToast('error', 'Failed to share')}
        data-testid="spark-address-text"
      />
    </div>
  );
};

export default SparkAddressDisplay;
