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

/** Explicitly approved, owned origins. Do not whitelist ephemeral vercel.app
 * hosts: passkey PRF wallet recovery is tied to the relying party identity. */
export function approvedGetYourSatsOrigin(origin: string): string | undefined {
  return origin === 'https://wallet.getyoursats.com' ? origin : undefined;
}


/**
 * Start goes straight to create only on an unrecognised browser profile,
 * avoiding speculative remote-device passkey sign-in and its QR picker.
 * A local registered/label hint means we must try the existing credential
 * first. These hints do not prove who owns a wallet; the SDK's WebAuthn
 * ceremony remains the sole identity proof.
 */
export function shouldDiscoverExistingPasskey(registered: string | null, label: string | null): boolean {
  return registered === '1' || label !== null;
}
