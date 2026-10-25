import type { CrossChainAddressDetails, CrossChainRoutePair, PrepareSendPaymentResponse } from '@breeztech/breez-sdk-spark';
import { normalizeChainName } from '../../../utils/crossChainRoutes';

export interface StablecoinDestination {
  rawInput: string;
  details: CrossChainAddressDetails;
  asset: string;
  chain: string;
}

export function routeMatchesAddress(route: CrossChainRoutePair, details: CrossChainAddressDetails) {
  if (details.chainId !== undefined && route.chainId !== String(details.chainId)) return false;
  if (!details.contractAddress) return true;
  // A payment URI can specify a token contract. Keep that constraint even if
  // the provider returns a broader route catalogue. EVM hex is case-insensitive.
  const normalize = (value?: string) => details.addressFamily === 'evm' ? value?.toLowerCase() : value;
  return normalize(route.contractAddress) === normalize(details.contractAddress);
}

export function matchesDestination(route: CrossChainRoutePair, destination: StablecoinDestination) {
  return route.asset === destination.asset && normalizeChainName(route.chain) === destination.chain
    && routeMatchesAddress(route, destination.details);
}

export function quoteMatchesDestination(response: PrepareSendPaymentResponse, destination: StablecoinDestination): boolean {
  const method = response.paymentMethod;
  return method.type === 'crossChainAddress'
    && method.recipientAddress === destination.details.address
    && matchesDestination(method.route, destination);
}

export function quoteIsCurrent(response: PrepareSendPaymentResponse, now = Date.now()): boolean {
  const method = response.paymentMethod;
  return method.type === 'crossChainAddress' && Date.parse(method.expiresAt) > now;
}
