/** WebAuthn/PRF protection for an EXISTING vault, never a wallet seed derivation.
 * No SDK connection, relay, payment or network request belongs in this module.
 * A compromised running origin remains outside this software boundary. */
export const LINKED_USER_PREFIX = new TextEncoder().encode('GYS-vault-v1:');
const enc = new TextEncoder();
export const bytes = (value: BufferSource): Uint8Array => value instanceof ArrayBuffer
  ? new Uint8Array(value) : new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
export const source = (value: Uint8Array): BufferSource => value as BufferSource;
export function b64(value: Uint8Array): string {
  return btoa(Array.from(value, n => String.fromCharCode(n)).join('')).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
export function unb64(value: string, min = 1, max = 2048): Uint8Array {
  if (!/^[A-Za-z0-9_-]+$/.test(value) || value.length > Math.ceil(max * 4 / 3)) throw new Error('Invalid protection record');
  const result = Uint8Array.from(atob(value.replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0));
  if (result.length < min || result.length > max || b64(result) !== value) throw new Error('Invalid protection record');
  return result;
}
export async function sha(value: string | Uint8Array): Promise<string> {
  return b64(new Uint8Array(await crypto.subtle.digest('SHA-256', typeof value === 'string' ? enc.encode(value) : source(value))));
}
export function isLinkedUserHandle(value: BufferSource | null | undefined): boolean {
  if (!value) return false;
  const data = bytes(value);
  return data.length >= LINKED_USER_PREFIX.length && LINKED_USER_PREFIX.every((n, i) => n === data[i]);
}
export interface LinkedCredential {
  credentialId: string;
  userHandle: string;
  rpId: string;
  origin: string;
  publicKey: string;
  prfSalt: string;
}
export function assertProtectionEnvironment(): void {
  if (!window.isSecureContext || window.top !== window.self || !crypto.subtle
      || !navigator.credentials?.create || !navigator.credentials?.get) {
    throw new Error('Passkey protection requires a secure, top-level browser. Use your wallet password instead.');
  }
}
export function assertCredentialScope(record: LinkedCredential): void {
  assertProtectionEnvironment();
  // Deliberately do not use the SDK's shared RP setting. A preview must not
  // acquire production credentials through an inherited parent/shared RP.
  if (record.rpId !== location.hostname || record.origin !== location.origin) throw new Error('This protection backup belongs to a different website.');
}
function validateClientData(raw: ArrayBuffer, challenge: Uint8Array, type: string): void {
  if (raw.byteLength > 4096) throw new Error('Invalid authentication response');
  const data: unknown = JSON.parse(new TextDecoder().decode(raw));
  if (!data || typeof data !== 'object') throw new Error('Invalid authentication response');
  const r = data as Record<string, unknown>;
  if (r.type !== type || r.challenge !== b64(challenge) || r.origin !== location.origin
      || (r.crossOrigin !== undefined && r.crossOrigin !== false)
      || (r.topOrigin !== undefined && r.topOrigin !== location.origin)) throw new Error('Authentication origin or challenge did not match.');
}
async function validateAuthData(raw: ArrayBuffer, rpId: string): Promise<Uint8Array> {
  const data = new Uint8Array(raw);
  if (data.length < 37 || data.length > 8192 || (data[32] & 5) !== 5
      || b64(data.slice(0, 32)) !== await sha(rpId)) throw new Error('Verified device-owner authentication is required.');
  return data;
}
/** WebAuthn ES256 signatures use ASN.1 DER; Web Crypto requires r || s. */
export function p256Signature(raw: ArrayBuffer): Uint8Array {
  const data = new Uint8Array(raw);
  if (data.length < 8 || data.length > 72 || data[0] !== 0x30 || data[1] !== data.length - 2) throw new Error('Invalid passkey signature');
  const result = new Uint8Array(64);
  let at = 2;
  for (let part = 0; part < 2; part++) {
    if (data[at++] !== 2) throw new Error('Invalid passkey signature');
    const size = data[at++];
    if (size < 1 || size > 33 || at + size > data.length || (data[at] & 0x80)) throw new Error('Invalid passkey signature');
    let value = data.slice(at, at + size); at += size;
    if (value[0] === 0 && value.length > 1) {
      if (!(value[1] & 0x80)) throw new Error('Invalid passkey signature');
      value = value.slice(1);
    }
    if (value.length > 32) throw new Error('Invalid passkey signature');
    result.set(value, part * 32 + 32 - value.length);
  }
  if (at !== data.length) throw new Error('Invalid passkey signature');
  return result;
}
function publicCredential(value: Credential | null): PublicKeyCredential {
  if (!value || value.type !== 'public-key') throw new Error('Passkey authentication did not complete.');
  const cred = value as PublicKeyCredential;
  if (!(cred.rawId instanceof ArrayBuffer) || cred.rawId.byteLength < 16 || cred.rawId.byteLength > 1024) throw new Error('Invalid passkey credential');
  return cred;
}
export async function createLinkedCredential(signal: AbortSignal): Promise<LinkedCredential> {
  assertProtectionEnvironment();
  const challenge = crypto.getRandomValues(new Uint8Array(32));
  const userId = new Uint8Array(LINKED_USER_PREFIX.length + 32);
  userId.set(LINKED_USER_PREFIX); crypto.getRandomValues(userId.subarray(LINKED_USER_PREFIX.length));
  const salt = crypto.getRandomValues(new Uint8Array(32));
  const credential = publicCredential(await navigator.credentials.create({signal, publicKey: {
    challenge: source(challenge), rp: {id: location.hostname, name: 'GetYourSats wallet protection'},
    user: {id: source(userId), name: `wallet-protection-${b64(userId.slice(-8))}`, displayName: 'Protect my existing GetYourSats wallet'},
    pubKeyCredParams: [{type: 'public-key', alg: -7}],
    authenticatorSelection: {residentKey: 'required', userVerification: 'required'},
    timeout: 60_000, attestation: 'none',
    extensions: {prf: {eval: {first: source(salt)}}} as AuthenticationExtensionsClientInputs,
  }}));
  signal.throwIfAborted();
  const response = credential.response as AuthenticatorAttestationResponse;
  validateClientData(response.clientDataJSON, challenge, 'webauthn.create');
  if (typeof response.getPublicKey !== 'function' || typeof response.getAuthenticatorData !== 'function'
      || response.getPublicKeyAlgorithm() !== -7) throw new Error('This browser cannot verify this protection passkey. Your password is unchanged.');
  const auth = await validateAuthData(response.getAuthenticatorData(), location.hostname);
  const id = new Uint8Array(credential.rawId);
  if (!(auth[32] & 64) || auth.length < 55 || ((auth[53] << 8) | auth[54]) !== id.length
      || b64(auth.slice(55, 55 + id.length)) !== b64(id)) throw new Error('Passkey registration did not match.');
  const key = response.getPublicKey();
  if (!key || key.byteLength > 256) throw new Error('Passkey public key is unavailable.');
  await crypto.subtle.importKey('spki', key, {name: 'ECDSA', namedCurve: 'P-256'}, false, ['verify']);
  const extensions = credential.getClientExtensionResults() as {prf?: {enabled?: boolean}};
  if (extensions.prf?.enabled !== true) throw new Error('This passkey provider cannot encrypt wallet access. Your wallet password still works.');
  signal.throwIfAborted();
  return {credentialId: b64(id), userHandle: b64(userId), rpId: location.hostname, origin: location.origin,
    publicKey: b64(new Uint8Array(key)), prfSalt: b64(salt)};
}
export async function evaluateLinkedCredential(record: LinkedCredential, signal: AbortSignal): Promise<Uint8Array> {
  assertCredentialScope(record);
  const challenge = crypto.getRandomValues(new Uint8Array(32));
  const credential = publicCredential(await navigator.credentials.get({signal, publicKey: {
    challenge: source(challenge), rpId: record.rpId, userVerification: 'required', timeout: 60_000,
    allowCredentials: [{type: 'public-key', id: source(unb64(record.credentialId, 16, 1024))}],
    extensions: {prf: {eval: {first: source(unb64(record.prfSalt, 32, 32))}}} as AuthenticationExtensionsClientInputs,
  }}));
  signal.throwIfAborted();
  if (b64(new Uint8Array(credential.rawId)) !== record.credentialId) throw new Error('A different protection passkey was selected.');
  const response = credential.response as AuthenticatorAssertionResponse;
  validateClientData(response.clientDataJSON, challenge, 'webauthn.get');
  const auth = await validateAuthData(response.authenticatorData, record.rpId);
  if (response.userHandle && b64(new Uint8Array(response.userHandle)) !== record.userHandle) throw new Error('Passkey owner did not match.');
  const clientHash = new Uint8Array(await crypto.subtle.digest('SHA-256', response.clientDataJSON));
  const signed = new Uint8Array(auth.length + clientHash.length); signed.set(auth); signed.set(clientHash, auth.length);
  const key = await crypto.subtle.importKey('spki', source(unb64(record.publicKey, 64, 256)), {name: 'ECDSA', namedCurve: 'P-256'}, false, ['verify']);
  if (!await crypto.subtle.verify({name: 'ECDSA', hash: 'SHA-256'}, key, source(p256Signature(response.signature)), source(signed))) throw new Error('Passkey signature could not be verified.');
  const extensions = credential.getClientExtensionResults() as {prf?: {results?: {first?: ArrayBuffer}}};
  const value = extensions.prf?.results?.first;
  if (!(value instanceof ArrayBuffer) || value.byteLength !== 32) throw new Error('This provider did not supply wallet encryption access. Use your password.');
  signal.throwIfAborted();
  return new Uint8Array(value);
}
export async function wrappingKey(secret: Uint8Array, binding: string): Promise<CryptoKey> {
  const material = await crypto.subtle.importKey('raw', source(secret), 'HKDF', false, ['deriveKey']);
  return crypto.subtle.deriveKey({name: 'HKDF', hash: 'SHA-256', salt: enc.encode('GetYourSats existing-vault wrap v1'), info: enc.encode(binding)}, material,
    {name: 'AES-GCM', length: 256}, false, ['encrypt', 'decrypt']);
}
