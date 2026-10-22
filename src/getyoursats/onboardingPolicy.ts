/**
 * Fail-closed passkey onboarding routing.
 *
 * RP IDs are a recovery dependency. On ephemeral Vercel PR hostnames, or
 * before the canonical domain/native association is verified, passkeys
 * created today may not be discoverable after moving to the real app.
 */
export interface OnboardingPolicyInput {
  prfAvailable: boolean;
  origin: string;
  approvedWebOrigin?: string;
  isNative: boolean;
  nativeAssociationVerified: boolean;
}
export function chooseWalletOnboarding({
  prfAvailable, origin, approvedWebOrigin, isNative, nativeAssociationVerified,
}: OnboardingPolicyInput): 'passkey' | 'manual' {
  if (!prfAvailable) return 'manual';
  if (isNative) return nativeAssociationVerified ? 'passkey' : 'manual';
  if (!approvedWebOrigin) return 'manual';
  try {
    const approved = new URL(approvedWebOrigin);
    const actual = new URL(origin);
    if (approved.protocol !== 'https:' || actual.protocol !== 'https:') return 'manual';
    if (approved.href !== approved.origin + '/' || actual.origin !== approved.origin) return 'manual';
    return 'passkey';
  } catch {
    return 'manual';
  }
}
