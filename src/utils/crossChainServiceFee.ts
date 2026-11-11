import type { DisplayMoney } from '../getyoursats/money';

interface ServiceFeeQuote {
  serviceFeeAmount?: bigint;
  serviceFeeAsset?: string;
  serviceFeeAssetDecimals?: number;
}

/** Display the SDK's service charge in its own denomination. `feeAmount`
 * is the wider conversion cost in destination units and includes this charge.
 * The pinned SDK's CrossChainReceiveInfo/CrossChainSendPrepared contract
 * defines an absent serviceFeeAsset as sats. A named asset needs precision.
 * This is display-only: never add it to or subtract it from quoted amounts.
 */
export function crossChainServiceFee(quote: ServiceFeeQuote | null | undefined): DisplayMoney | null {
  if (typeof quote?.serviceFeeAmount !== 'bigint' || quote.serviceFeeAmount < 0n) return null;
  if (quote.serviceFeeAsset === undefined) return { kind: 'sats', amount: quote.serviceFeeAmount };
  const decimals = quote.serviceFeeAssetDecimals;
  if (typeof quote.serviceFeeAsset !== 'string' || !quote.serviceFeeAsset.trim()
    || !Number.isInteger(decimals) || decimals! < 0 || decimals! > 36) return null;
  return { kind: 'token', amount: quote.serviceFeeAmount, decimals: decimals!, ticker: quote.serviceFeeAsset };
}
