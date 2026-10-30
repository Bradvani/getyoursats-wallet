// Fixed field order binds wallet authorization to the actual device operation.
// Shared by the browser and server. No private wallet material is included.
export function pushOperationPayload(action, extra) {
  if (action === 'subscribe') return JSON.stringify({
    endpoint: extra.subscription?.endpoint,
    p256dh: extra.subscription?.keys?.p256dh,
    auth: extra.subscription?.keys?.auth,
  });
  if (action === 'activate') return JSON.stringify({
    endpoint: extra.endpoint, webhookId: extra.webhookId || '',
  });
  if (action === 'status' || action === 'unsubscribe')
    return JSON.stringify({endpoint: extra.endpoint});
  throw new Error('Invalid notification operation');
}
export function pushAuthorizationMessage(action, pub, nonce, payloadHash) {
  return 'gys-push-v2:https://wallet.getyoursats.com:' + action + ':' + pub + ':' + nonce + ':' + payloadHash;
}
