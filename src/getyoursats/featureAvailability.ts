/**
 * Public feature gates: enable only after the complete user journey has been
 * verified against a real provider/backend, settled and reconciled on production.
 * A local DCA draft or an external checkout link does NOT count as live.
 * Do not bind these to an unverified browser environment flag alone.
 */
export const featureAvailability={
  buyBitcoin:false,
  recurringBuy:false,
  emailVerification:false,
} as const;
