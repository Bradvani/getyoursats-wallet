import {NATIVE_LIGHTNING_DOMAIN} from '@/services/nativeLightningAddress';

// Partial payment encodings must keep reaching the SDK unchanged, even when
// their length and alphabet could also describe a username.
const PAYMENT_PREFIX = /^(?:bc1|tb1|bcrt1|lnbc|lntb|lnbcrt|lnsb|lnurl|lno1|lni1|lnr1|spark|sp1|tsp1)/;

export function usernameDestination(input: string): string | null {
  const username = input.trim().toLowerCase();
  if (!/^[a-z][a-z0-9]{2,23}$/.test(username) || PAYMENT_PREFIX.test(username)) return null;
  return `${username}@${NATIVE_LIGHTNING_DOMAIN}`;
}
