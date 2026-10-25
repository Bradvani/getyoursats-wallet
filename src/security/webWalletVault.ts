/**
 * Browser recovery-word vault. This only protects the *persisted phrase* against
 * casual storage disclosure; it does not secure a running compromised origin.
 * An authenticated Spark external signer is required for true signing isolation.
 */
import { Capacitor } from '@capacitor/core';

export const WEB_VAULT_KEY = 'gys:wallet-vault:v1';
const LEGACY_KEY = 'walletMnemonic';
const KDF_ROUNDS = 650_000;
const KEY_LENGTH = 256;
const enc = new TextEncoder();
const dec = new TextDecoder();
const AAD = enc.encode('GetYourSats browser mnemonic vault v1');

interface VaultRecord {
  v: 1;
  cipher: 'AES-GCM';
  kdf: 'PBKDF2-SHA256';
  iterations: number;
  salt: string;
  iv: string;
  ciphertext: string;
  // SHA-256 of high-entropy BIP39 phrase, permitting same-wallet password
  // reset without changing the key or IndexedDB wallet identity.
  recoveryFingerprint: string;
}

let activeMnemonic: string | null = null;

export function hasWebWalletVault(): boolean {
  if (Capacitor.isNativePlatform()) return false;
  try { return localStorage.getItem(WEB_VAULT_KEY) !== null; }
  catch { return false; }
}
export function hasLegacyWebMnemonic(): boolean {
  if (Capacitor.isNativePlatform()) return false;
  try { return !!localStorage.getItem(LEGACY_KEY); }
  catch { return false; }
}
export function legacyWebMnemonic(): string | null {
  if (Capacitor.isNativePlatform()) return null;
  return localStorage.getItem(LEGACY_KEY);
}
export function getUnlockedWebMnemonic(): string | null { return activeMnemonic; }
export function clearUnlockedWebMnemonic(): void { activeMnemonic = null; }

function encodeBase64(data: Uint8Array): string {
  let out = '';
  for (const b of data) out += String.fromCharCode(b);
  return btoa(out);
}
function decodeBase64(data: string): Uint8Array {
  const bytes = atob(data);
  return Uint8Array.from(bytes, c => c.charCodeAt(0));
}
function asBufferSource(bytes: Uint8Array): BufferSource {
  return bytes as BufferSource;
}
async function recoveryFingerprint(mnemonic:string):Promise<string> {
 const digest=new Uint8Array(await crypto.subtle.digest('SHA-256',enc.encode(mnemonic)));
 return encodeBase64(digest);
}
function validateRecord(input: unknown): VaultRecord {
  if (!input || typeof input !== 'object') throw new Error('Wallet protection data is invalid. Restore using your recovery phrase.');
  const r = input as Partial<VaultRecord>;
  if (r.v !== 1 || r.kdf !== 'PBKDF2-SHA256' || r.cipher !== 'AES-GCM'
      || r.iterations !== KDF_ROUNDS || typeof r.salt !== 'string'
      || typeof r.iv !== 'string' || typeof r.ciphertext !== 'string'
      || typeof r.recoveryFingerprint !== 'string' || decodeBase64(r.recoveryFingerprint).length !== 32
      || decodeBase64(r.salt).length !== 16 || decodeBase64(r.iv).length !== 12
      || decodeBase64(r.ciphertext).length < 17)
    throw new Error('Wallet protection data is invalid. Restore using your recovery phrase.');
  return r as VaultRecord;
}
async function derive(passphrase: string, salt: Uint8Array): Promise<CryptoKey> {
  const source = await crypto.subtle.importKey('raw', enc.encode(passphrase), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    { name:'PBKDF2', hash:'SHA-256', salt:asBufferSource(salt), iterations:KDF_ROUNDS },
    source, { name:'AES-GCM', length:KEY_LENGTH }, false, ['encrypt','decrypt']
  );
}
async function readVault(passphrase: string, raw: string): Promise<string> {
  const record = validateRecord(JSON.parse(raw));
  const key = await derive(passphrase, decodeBase64(record.salt));
  try {
    const plaintext = await crypto.subtle.decrypt(
      {name:'AES-GCM',iv:asBufferSource(decodeBase64(record.iv)),additionalData:AAD},
      key, asBufferSource(decodeBase64(record.ciphertext))
    );
    const mnemonic = dec.decode(plaintext);
    if (!/^(?:[a-z]+\s+){11,23}[a-z]+$/.test(mnemonic)) throw new Error('invalid recovery words');
    if (await recoveryFingerprint(mnemonic)!==record.recoveryFingerprint) throw new Error('phrase mismatch');
    return mnemonic;
  } catch {
    throw new Error('Incorrect password or damaged wallet vault. Your recovery words can restore this wallet.');
  }
}
export async function unlockWebWallet(passphrase: string): Promise<string> {
  const raw = localStorage.getItem(WEB_VAULT_KEY);
  if (!raw) throw new Error('Protected wallet not found. Restore your recovery phrase.');
  const mnemonic = await readVault(passphrase, raw);
  // Do not let a corrupt or different legacy value get erased.
  activeMnemonic = mnemonic;
  return mnemonic;
}
export async function checkWebWalletPassword(passphrase: string): Promise<boolean> {
  try {
    const mnemonic = await readVault(passphrase, localStorage.getItem(WEB_VAULT_KEY) ?? '');
    return activeMnemonic != null && mnemonic === activeMnemonic;
  } catch { return false; }
}
/** Enroll without changing wallet identity. Existing vaults cannot be overwritten. */
export async function enrollWebWallet(mnemonic: string, passphrase: string): Promise<void> {
  if (Capacitor.isNativePlatform()) throw new Error('Browser vault is only available on the web.');
  if (passphrase.length < 12 || passphrase.length > 256) throw new Error('Use a password of at least 12 characters.');
  if (!crypto.subtle) throw new Error('Secure browser encryption is not available.');
  const existing = localStorage.getItem(WEB_VAULT_KEY);
  if (existing) {
    const old = await readVault(passphrase, existing);
    if (old !== mnemonic) throw new Error('This device already holds a different protected wallet.');
    activeMnemonic = mnemonic;
    return;
  }
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await derive(passphrase, salt);
  const bytes = new Uint8Array(await crypto.subtle.encrypt(
    {name:'AES-GCM',iv:asBufferSource(iv),additionalData:AAD},key,enc.encode(mnemonic)
  ));
  const record:VaultRecord = {
    v:1,cipher:'AES-GCM',kdf:'PBKDF2-SHA256',iterations:KDF_ROUNDS,
    salt:encodeBase64(salt),iv:encodeBase64(iv),ciphertext:encodeBase64(bytes),
    recoveryFingerprint:await recoveryFingerprint(mnemonic),
  };
  const serialized = JSON.stringify(record);
  // Verify the ciphertext before changing durable wallet state.
  if ((await readVault(passphrase, serialized)) !== mnemonic) throw new Error('Wallet vault verification failed.');
  localStorage.setItem(WEB_VAULT_KEY, serialized);
  if ((await readVault(passphrase, localStorage.getItem(WEB_VAULT_KEY)!)) !== mnemonic)
    throw new Error('Wallet vault could not be verified after saving.');
  activeMnemonic = mnemonic;
}
/** Remove plaintext only after verified encrypted storage has the SAME phrase. */
export async function removeMatchingLegacyMnemonic(passphrase: string): Promise<void> {
  const legacy = legacyWebMnemonic();
  if (!legacy) return;
  const saved = await unlockWebWallet(passphrase);
  if (saved !== legacy) throw new Error('The encrypted wallet does not match this device’s existing wallet. No recovery words were deleted.');
  localStorage.removeItem(LEGACY_KEY);
}

/** Restore the SAME mnemonic from the original recovery words and set a new
 * password. The identity fingerprint blocks accidental replacement with a
 * different wallet. The original encrypted record is not changed on failure. */
export async function resetWebWalletPasswordWithWords(
  mnemonic:string,newPassword:string
):Promise<void> {
  const existing=localStorage.getItem(WEB_VAULT_KEY);
  if(!existing)throw new Error('There is no wallet to recover on this device.');
  const record=validateRecord(JSON.parse(existing));
  const normalized=mnemonic.trim().toLowerCase().replace(/\s+/g,' ');
  if(await recoveryFingerprint(normalized)!==record.recoveryFingerprint)
    throw new Error('These recovery words do not match this device’s existing wallet. No data was changed.');
  // Retain previous ciphertext until the replacement has been encrypted and
  // authenticated locally. enrollWebWallet normally refuses overwrites.
  if(newPassword.length<12)throw new Error('Use a password of at least 12 characters.');
  const salt=crypto.getRandomValues(new Uint8Array(16));
  const iv=crypto.getRandomValues(new Uint8Array(12));
  const key=await derive(newPassword,salt);
  const ciphertext=new Uint8Array(await crypto.subtle.encrypt(
    {name:'AES-GCM',iv:asBufferSource(iv),additionalData:AAD},key,enc.encode(normalized)
  ));
  const replacement:VaultRecord={
    v:1,cipher:'AES-GCM',kdf:'PBKDF2-SHA256',iterations:KDF_ROUNDS,
    salt:encodeBase64(salt),iv:encodeBase64(iv),
    ciphertext:encodeBase64(ciphertext),recoveryFingerprint:record.recoveryFingerprint
  };
  const serialized=JSON.stringify(replacement);
  if(await readVault(newPassword,serialized)!==normalized)
    throw new Error('Failed to validate the replacement wallet vault.');
  localStorage.setItem(WEB_VAULT_KEY,serialized);
  if(await readVault(newPassword,localStorage.getItem(WEB_VAULT_KEY)!)!==normalized)
    throw new Error('Failed to verify saved wallet protection.');
  activeMnemonic=normalized;
}
