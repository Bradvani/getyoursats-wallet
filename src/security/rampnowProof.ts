import type {Network} from '@breeztech/breez-sdk-spark';

// This is the existing, reviewed sandbox challenge contract. Production proof
// signing requires an explicit environment/origin/network contract review.
const SANDBOX_ORIGIN = 'https://getyoursats-wallet-git-feat-rampnow-integr-d20510-bradvani-8798.vercel.app';
const PREFIX = 'gys-rampnow-v1:';
const PURPOSES = new Set(['prepare', 'submit', 'status', 'reconcile']);
const CHALLENGE_TTL_MS = 300_000;
const MAX_CONSUMED_CHALLENGES = 1024;

type RampnowProof = {walletPubkey:string; nonce:string};

export function parseRampnowProof(message:unknown, network:Network, origin:string):RampnowProof|null {
  if (typeof message !== 'string' || message.length > 1024 || !message.startsWith(PREFIX)
      || network !== 'signet' || origin !== SANDBOX_ORIGIN) return null;
  try {
    const fields:unknown = JSON.parse(message.slice(PREFIX.length));
    if (!Array.isArray(fields) || fields.length !== 6 || !fields.every(field=>typeof field === 'string')
        || message !== PREFIX + JSON.stringify(fields)) return null;
    const [environment, audience, purpose, digest, nonce, walletPubkey] = fields as string[];
    if (environment !== 'sandbox' || audience !== origin || !PURPOSES.has(purpose)
        || !/^[0-9a-f]{64}$/.test(digest) || !/^[0-9a-f]{36}$/.test(nonce)
        || !/^(?:02|03)[0-9a-f]{64}$/.test(walletPubkey)) return null;
    return {walletPubkey, nonce};
  } catch { return null; }
}

export function createRampnowProofReservation() {
  const consumed = new Map<string,number>();
  return (nonce:string) => {
    const now = Date.now();
    for (const [key, deadline] of consumed) if (deadline <= now) consumed.delete(key);
    if (consumed.has(nonce)) throw new Error('Checkout proof challenge was already used');
    if (consumed.size >= MAX_CONSUMED_CHALLENGES) throw new Error('Too many checkout proof challenges');
    // Reserve synchronously before entering the signer. Failure, session
    // revocation and an ambiguous result never restore this challenge. This is
    // connection-local defense; the server still consumes its durable nonce.
    consumed.set(nonce, now + CHALLENGE_TTL_MS);
  };
}
