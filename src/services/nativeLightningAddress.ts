import type {LightningAddressInfo} from '@breeztech/breez-sdk-spark';

export const NATIVE_LIGHTNING_DOMAIN = 'getyoursats.com';

export function nativeLightningLookupUrl(address: LightningAddressInfo): string {
  const username = address?.username;
  if (typeof username === 'string' && /^[a-z][a-z0-9]{2,23}$/.test(username)
    && address.lightningAddress === `${username}@${NATIVE_LIGHTNING_DOMAIN}`) {
    for (const path of [`/.well-known/lnurlp/${username}`, `/lnurlp/${username}`]) {
      const endpoint = `${NATIVE_LIGHTNING_DOMAIN}${path}`;
      if (address.lnurl?.url === `https://${endpoint}` || address.lnurl?.url === `lnurlp://${endpoint}`) {
        return `https://${endpoint}`;
      }
    }
  }
  throw new Error('Could not confirm your GetYourSats address. Please try again.');
}

export function assertNativeLightningAddress(address: LightningAddressInfo): void {
  nativeLightningLookupUrl(address);
}
