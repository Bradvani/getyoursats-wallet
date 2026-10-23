/**
 * The build flag is an OPERATOR ATTESTATION, not proof that the domain works.
 *
 * Never set it until Breez has confirmed API-key association and the LNURL
 * endpoint has passed real lookup, invoice and payment tests.
 * Root getyoursats.com requires a verified reverse proxy for the LNURL paths,
 * not a CNAME that would take over the customer-facing website.
 */
export type GetYourSatsLightningDomain = 'getyoursats.com' | 'pay.getyoursats.com';

export function configuredBrandedLightningDomain(): GetYourSatsLightningDomain | null {
  if (import.meta.env.VITE_GETYOURSATS_LNURL_DOMAIN_APPROVED !== 'true') return null;
  const domain = import.meta.env.VITE_GETYOURSATS_LNURL_DOMAIN?.trim().toLowerCase();
  return domain === 'getyoursats.com' || domain === 'pay.getyoursats.com' ? domain : null;
}
