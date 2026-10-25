import type { CrossChainAddressDetails, CrossChainRoutePair, PrepareSendPaymentResponse } from '@breeztech/breez-sdk-spark';
import { normalizeChainName } from '../../../utils/crossChainRoutes';

export interface StablecoinDestination {
  rawInput: string;
  details: CrossChainAddressDetails;
  asset: string;
  chain: string;
}

export function matchesDestination(route: CrossChainRoutePair, destination: StablecoinDestination) {
  return route.asset === destination.asset && normalizeChainName(route.chain) === destination.chain;
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
