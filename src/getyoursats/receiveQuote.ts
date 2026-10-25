import type {CrossChainReceiveInfo} from '@breeztech/breez-sdk-spark';
/** Only fields returned by the installed SDK are facts. No inferred fee or overpayment buffer. */
export function receiveQuoteEvidence(info: CrossChainReceiveInfo, requested: bigint) {
 const feeKnown=typeof info.serviceFeeAsset==='string' && Number.isInteger(info.serviceFeeAssetDecimals) && info.serviceFeeAssetDecimals!>=0 && info.serviceFeeAssetDecimals!<=36;
 return {
  requested, required:info.depositAmount, difference:info.depositAmount-requested,
  fee:feeKnown?{amount:info.serviceFeeAmount,asset:info.serviceFeeAsset!,decimals:info.serviceFeeAssetDecimals!}:null,
  buffer:null,
  expected:info.expectedReceivedAmount, destinationAsset:info.destinationAsset,
  destinationSats:!info.tokenIdentifier && /^(btc|bitcoin|sats)$/i.test(info.destinationAsset)?info.expectedReceivedAmount:null,
  expiresAtMs:Number.isFinite(info.expiresAt)&&info.expiresAt>0?info.expiresAt*1000:null,
 };
}
