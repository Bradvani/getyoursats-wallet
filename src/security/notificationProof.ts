import type {Network} from '@breeztech/breez-sdk-spark';

// Existing device-notification authorization only. This does not grant SDK
// webhook registration, spending, receiving, or checkout authority.
const ORIGIN = 'https://wallet.getyoursats.com';
const MESSAGE = /^gys-push-v2:https:\/\/wallet\.getyoursats\.com:(subscribe|activate|status|unsubscribe):((?:02|03)[0-9a-f]{64}):([0-9a-f]{32}):[0-9a-f]{64}$/;
const CHALLENGE_TTL_MS = 300_000;
const MAX_CONSUMED_CHALLENGES = 1024;

export function parseNotificationProof(message:unknown, network:Network, origin:string) {
  if(typeof message !== 'string' || message.length > 512 || network !== 'mainnet' || origin !== ORIGIN) return null;
  const match = MESSAGE.exec(message);
  // `$` also matches before a final newline; demand the entire original bytes.
  return match && match[0] === message ? {walletPubkey:match[2], nonce:match[3]} : null;
}

export function createNotificationProofReservation() {
  const consumed = new Map<string,number>();
  return (nonce:string) => {
    const now = Date.now();
    for(const [key, deadline] of consumed) if(deadline <= now) consumed.delete(key);
    if(consumed.has(nonce)) throw new Error('Notification proof challenge was already used');
    if(consumed.size >= MAX_CONSUMED_CHALLENGES) throw new Error('Too many notification proof challenges');
    // Reserve before entering the signer and retain through failure/lock or an
    // ambiguous response. Server GETDEL+TTL remains the durable replay boundary.
    consumed.set(nonce, now + CHALLENGE_TTL_MS);
  };
}
