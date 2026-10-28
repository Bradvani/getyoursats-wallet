import {Capacitor} from '@capacitor/core';

/** Revokes the actual browser PushSubscription before the wallet identity
 * and device storage are wiped. This makes old endpoints undeliverable even
 * when the server is temporarily offline. The server purges expired endpoints
 * after the push service reports 404/410. */
export async function revokeBrowserPushOnLogout():Promise<void> {
  if(Capacitor.isNativePlatform() || typeof navigator==='undefined'
    || !('serviceWorker' in navigator))return;
  const registration=await navigator.serviceWorker.getRegistration('/sw.js');
  const subscription=await registration?.pushManager.getSubscription();
  if(subscription)await subscription.unsubscribe();
}
