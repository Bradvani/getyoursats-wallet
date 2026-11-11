/**
 * Software-vault threat fixtures only: replay and mutate this module's stored
 * records without dispatching browser storage events. Web Crypto is real;
 * localStorage and the authenticator are test fixtures. This is not an iOS
 * exploit test, a Safari filesystem/IndexedDB inventory or proof against a
 * compromised running origin, browser or operating system. Password ciphertext
 * remains subject to offline guessing if its password is weak.
 */
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import {fixtureAuthenticator} from '../test/linkedPasskeyAuthenticator';
import {b64, bytes, sha, unb64} from './linkedPasskeyProtocol';
import {clearSignerIdentity, hasSignerIdentity, isSpendingSessionLocked, rememberSignerIdentity} from './spendApproval';
import {installVaultTestLock} from './vaultTestLock';
import {
  WEB_PASSKEY_LINK_KEY, WEB_VAULT_KEY, beginWebPasskeyEnrollment,
  clearUnlockedWebMnemonic, enrollWebWallet, exportWebPasskeyBackup,
  getUnlockedWebMnemonic, restoreWebPasswordBackup, restoreWebPasskeyBackup,
  unlockWebWallet, unlockWebWalletWithPasskey,
} from './webWalletVault';

// Public BIP39 test vectors. Never use these wallets for funds.
const WORDS = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
const OTHER_WORDS = 'legal winner thank year wave sausage worth useful legal winner thank yellow';
const PASSWORD = 'container-fixture-password-not-for-real-funds';
type StoredRecords = Record<string, string>;
let authenticator: Awaited<ReturnType<typeof fixtureAuthenticator>>;

function storedRecords(): StoredRecords {
  return Object.fromEntries(Array.from({length: localStorage.length}, (_, index) => {
    const key = localStorage.key(index)!;
    return [key, localStorage.getItem(key)!];
  }));
}

function replayIntoLockedState(records: StoredRecords): void {
  clearSignerIdentity();
  clearUnlockedWebMnemonic();
  localStorage.clear();
  for (const [key, value] of Object.entries(records)) localStorage.setItem(key, value);
  // No storage/visibility event is dispatched: the bytes alone are the input.
  expect(getUnlockedWebMnemonic()).toBeNull();
  expect(hasSignerIdentity()).toBe(false);
  expect(isSpendingSessionLocked()).toBe(true);
}

function expectStillLockedWith(records: StoredRecords): void {
  expect(storedRecords()).toEqual(records);
  expect(getUnlockedWebMnemonic()).toBeNull();
  expect(hasSignerIdentity()).toBe(false);
  expect(isSpendingSessionLocked()).toBe(true);
  expect(localStorage.getItem('walletMnemonic')).toBeNull();
}

async function prepareWallet(mnemonic = WORDS): Promise<void> {
  await enrollWebWallet(mnemonic, PASSWORD);
  await rememberSignerIdentity({type: 'mnemonic', mnemonic});
  const pending = await beginWebPasskeyEnrollment(PASSWORD);
  await pending.verify();
}

/** Preserve encoded byte length and canonical encoding while changing content. */
function flipEncodedByte(value: string, urlSafe: boolean): string {
  const decoded = urlSafe
    ? unb64(value)
    : Uint8Array.from(atob(value), character => character.charCodeAt(0));
  decoded[decoded.length - 1] ^= 1;
  return urlSafe ? b64(decoded) : btoa(Array.from(decoded, byte => String.fromCharCode(byte)).join(''));
}

function secretEncodings(value: Uint8Array): string[] {
  const binary = Array.from(value, byte => String.fromCharCode(byte)).join('');
  return [
    btoa(binary), b64(value),
    Array.from(value, byte => byte.toString(16).padStart(2, '0')).join(''),
    JSON.stringify(Array.from(value)),
  ];
}

beforeEach(async () => {
  localStorage.clear();
  clearSignerIdentity();
  clearUnlockedWebMnemonic();
  installVaultTestLock();
  vi.stubGlobal('indexedDB', {databases: vi.fn(async () => [])});
  Object.defineProperty(document, 'visibilityState', {configurable: true, value: 'visible'});
  authenticator = await fixtureAuthenticator();
  authenticator.install();
});

afterEach(() => {
  clearSignerIdentity();
  clearUnlockedWebMnemonic();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  localStorage.clear();
});

describe('copied and directly modified software vault records', {timeout: 20_000}, () => {
  it.each([
    ['first public BIP39 vector', WORDS],
    ['second public BIP39 vector', OTHER_WORDS],
  ])('requires a separate unlock secret after copying the %s', async (_name, mnemonic) => {
    await prepareWallet(mnemonic);
    const copied = storedRecords();
    replayIntoLockedState(copied);
    const unrelatedAuthenticator = await fixtureAuthenticator();
    unrelatedAuthenticator.install();

    await expect(unlockWebWalletWithPasskey()).rejects.toThrow();
    await expect(unlockWebWallet('wrong-container-fixture-password')).rejects.toThrow();
    expectStillLockedWith(copied);

    // The original password recovers the same wallet without rewriting records.
    expect(await unlockWebWallet(PASSWORD)).toBe(mnemonic);
    expect(storedRecords()).toEqual(copied);
    replayIntoLockedState(copied);

    // The original authenticator is independently sufficient; its key was not
    // copied as part of the serialized browser records.
    authenticator.install();
    expect(await unlockWebWalletWithPasskey()).toBe(mnemonic);
    expect(storedRecords()).toEqual(copied);
  });

  it.each(['ciphertext', 'iv', 'salt', 'recoveryFingerprint'])('rejects a well-formed vault with modified %s and preserves its bytes', async field => {
    await prepareWallet();
    const copied = storedRecords();
    const record = JSON.parse(copied[WEB_VAULT_KEY]);
    record[field] = flipEncodedByte(record[field], false);
    copied[WEB_VAULT_KEY] = JSON.stringify(record);
    replayIntoLockedState(copied);

    await expect(unlockWebWallet(PASSWORD)).rejects.toThrow();
    await expect(unlockWebWalletWithPasskey()).rejects.toThrow();
    expectStillLockedWith(copied);
  });

  it.each(['wrappedKey', 'iv', 'prfSalt', 'userHandle'])('rejects a well-formed passkey link with modified %s without replacing the password vault', async field => {
    await prepareWallet();
    const copied = storedRecords();
    const link = JSON.parse(copied[WEB_PASSKEY_LINK_KEY]);
    link[field] = flipEncodedByte(link[field], true);
    copied[WEB_PASSKEY_LINK_KEY] = JSON.stringify(link);
    replayIntoLockedState(copied);

    await expect(unlockWebWalletWithPasskey()).rejects.toThrow();
    expectStillLockedWith(copied);
    expect(await unlockWebWallet(PASSWORD)).toBe(WORDS);
    expect(storedRecords()).toEqual(copied);
  });

  it('rejects modified ciphertext even when its public digest is recomputed in the passkey link', async () => {
    await prepareWallet();
    const copied = storedRecords();
    const vault = JSON.parse(copied[WEB_VAULT_KEY]);
    vault.ciphertext = flipEncodedByte(vault.ciphertext, false);
    copied[WEB_VAULT_KEY] = JSON.stringify(vault);
    const link = JSON.parse(copied[WEB_PASSKEY_LINK_KEY]);
    link.vaultDigest = await sha(copied[WEB_VAULT_KEY]);
    copied[WEB_PASSKEY_LINK_KEY] = JSON.stringify(link);
    replayIntoLockedState(copied);
    const calls = authenticator.state.getCalls;

    await expect(unlockWebWalletWithPasskey()).rejects.toThrow();
    // This reaches a valid authenticator assertion before authenticated
    // decryption rejects the modified binding, rather than a format check.
    expect(authenticator.state.getCalls).toBe(calls + 1);
    expectStillLockedWith(copied);
  });

  it('does not turn encrypted bytes into an unlocked phrase when marker flags are modified', async () => {
    await prepareWallet();
    const copied = storedRecords();
    const vault = JSON.parse(copied[WEB_VAULT_KEY]);
    copied[WEB_VAULT_KEY] = JSON.stringify({...vault, unlocked: true, encrypted: false});
    const link = JSON.parse(copied[WEB_PASSKEY_LINK_KEY]);
    copied.passkeyRegistered = '1';
    copied.passkeyLabel = 'Attacker supplied display label';
    copied.passkeyActiveCredentialId = link.credentialId;
    copied.passkeyActiveCredentialRpId = location.hostname;
    copied.passkeyMigrated = 'true';
    replayIntoLockedState(copied);

    await expect(unlockWebWallet('wrong-container-fixture-password')).rejects.toThrow();
    await expect(unlockWebWalletWithPasskey()).rejects.toThrow();
    expectStillLockedWith(copied);
    expect(await unlockWebWallet(PASSWORD)).toBe(WORDS);
    expect(storedRecords()).toEqual(copied);
  });

  it('requires an unlock secret for a copied encrypted backup before writing any recovered records', async () => {
    await prepareWallet();
    const originalVault = localStorage.getItem(WEB_VAULT_KEY);
    const backup = await exportWebPasskeyBackup();
    replayIntoLockedState({});
    const unrelatedAuthenticator = await fixtureAuthenticator();
    unrelatedAuthenticator.install();

    await expect(restoreWebPasskeyBackup(backup)).rejects.toThrow();
    expectStillLockedWith({});
    await expect(restoreWebPasswordBackup(backup, 'wrong-backup-password')).rejects.toThrow();
    expectStillLockedWith({});
    expect(await restoreWebPasswordBackup(backup, PASSWORD)).toBe(WORDS);
    expect(localStorage.getItem(WEB_VAULT_KEY)).toBe(originalVault);
    expect(localStorage.getItem('walletMnemonic')).toBeNull();
  });

  it('does not persist the phrase, password, captured raw vault key or PRF output in vault records or exported backup', async () => {
    const rawVaultKeys: Uint8Array[] = [];
    const prfOutputs: Uint8Array[] = [];
    const encrypt = crypto.subtle.encrypt.bind(crypto.subtle);
    vi.spyOn(crypto.subtle, 'encrypt').mockImplementation(async (algorithm, key, data) => {
      // The only 32-byte AES-GCM plaintext in this fixture is the derived
      // vault key being wrapped; the public test mnemonic is much longer.
      if (key.algorithm.name === 'AES-GCM' && data.byteLength === 32) {
        rawVaultKeys.push(bytes(data).slice());
      }
      return encrypt(algorithm, key, data);
    });
    const get = authenticator.methods.get;
    vi.spyOn(authenticator.methods, 'get').mockImplementation(async options => {
      const credential = await get(options) as PublicKeyCredential;
      const extension = credential.getClientExtensionResults() as {prf?: {results?: {first?: ArrayBuffer}}};
      if (extension.prf?.results?.first) {
        prfOutputs.push(new Uint8Array(extension.prf.results.first).slice());
      }
      return credential;
    });

    await prepareWallet();
    const persisted = JSON.stringify(storedRecords());
    const backup = await exportWebPasskeyBackup();
    expect(rawVaultKeys).toHaveLength(1);
    expect(prfOutputs).toHaveLength(1);
    const encodedSecrets = [
      ...secretEncodings(new TextEncoder().encode(WORDS)),
      ...secretEncodings(new TextEncoder().encode(PASSWORD)),
      ...rawVaultKeys.flatMap(secretEncodings), ...prfOutputs.flatMap(secretEncodings),
    ];
    for (const serialized of [persisted, backup]) {
      expect(serialized).not.toContain(WORDS);
      expect(serialized).not.toContain(PASSWORD);
      for (const encoded of encodedSecrets) expect(serialized).not.toContain(encoded);
    }
    expect(localStorage.getItem('walletMnemonic')).toBeNull();
  });
});
