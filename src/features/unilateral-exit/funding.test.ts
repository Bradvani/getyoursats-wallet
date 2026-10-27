import { deriveFundingKey, deriveFundingKeyFromSeed, readWalletSeed, MnemonicNeedsPasskeyError, MnemonicUnavailableError, readWalletMnemonic } from './funding';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mnemonicToSeedSync, entropyToMnemonic } from 'bip39';
import type { Seed } from '@breeztech/breez-sdk-spark';
import { signInPinnedToActiveCredential } from '@/services/passkeyService';
import { chooseNativeSeedTier, resetNativeSeedSelection, setActiveNativeSeedWallet } from '@/services/nativeSeedSelection';
import { confirmNativePinPolicy, getNativePinPolicyRevision, invalidateNativePinPolicy } from '@/services/nativeReadLease';
import { clearSignerIdentity, rememberSignerIdentity } from '@/security/spendApproval';

const stores = vi.hoisted(() => ({
  deviceOnlyStorage: { isSupported: vi.fn(), hasStoredSeed: vi.fn(), retrieveSeed: vi.fn() },
  secureStorage: { isSupported: vi.fn(), hasStoredSeed: vi.fn(), retrieveSeed: vi.fn() },
}));

vi.mock('@/services/secureStorage', () => stores);

vi.mock('@/services/passkeyService', () => ({
  isPasskeyMode: () => localStorage.getItem('passkeyLabel') !== null,
  getPasskeyLabel: () => localStorage.getItem('passkeyLabel'),
  signInPinnedToActiveCredential: vi.fn(),
}));

const VECTOR_MNEMONIC =
  'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';

beforeEach(() => {
  Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' });
  invalidateNativePinPolicy();
  confirmNativePinPolicy(false, getNativePinPolicyRevision());
  resetNativeSeedSelection();
  clearSignerIdentity();
  for (const store of Object.values(stores)) {
    store.isSupported.mockReset().mockReturnValue(false);
    store.hasStoredSeed.mockReset().mockResolvedValue(false);
    store.retrieveSeed.mockReset();
  }
});

describe('deriveFundingKey', () => {
  it('derives the first BIP84 mainnet address of the reference mnemonic', () => {
    const key = deriveFundingKey(VECTOR_MNEMONIC, 'mainnet', 0);
    expect(key.address).toBe('bc1qcr8te4kr609gcawutmrza0j4xv80jy8z306fyu');
    expect(key.publicKeyHex).toBe(
      '0330d54fd0dd420a6e5f8d3624f5f3482cae350f79d5f0753bf5beef9c2d91af3c',
    );
  });

  it('derives the second address of the same account', () => {
    const key = deriveFundingKey(VECTOR_MNEMONIC, 'mainnet', 1);
    expect(key.address).toBe('bc1qnjg0jd8228aq7egyzacy8cys3knf9xvrerkf9g');
    expect(key.publicKeyHex).toBe(
      '03e775fd51f0dfb8cd865d9ff1cca2a158cf651fe997fdc9fee9c1d3b5e995ea77',
    );
  });

  it('returns a 32 byte secret key', () => {
    expect(deriveFundingKey(VECTOR_MNEMONIC, 'mainnet', 0).secretKey).toHaveLength(32);
  });

  it('uses the testnet coin type and prefix on testnet', () => {
    const key = deriveFundingKey(VECTOR_MNEMONIC, 'testnet', 0);
    expect(key.address.startsWith('tb1q')).toBe(true);
  });

  it('uses the regtest prefix on regtest', () => {
    const key = deriveFundingKey(VECTOR_MNEMONIC, 'regtest', 0);
    expect(key.address.startsWith('bcrt1q')).toBe(true);
  });

  it('uses test-network derivation and addresses on signet', () => {
    const signet = deriveFundingKey(VECTOR_MNEMONIC, 'signet', 0);
    expect(signet).toEqual(deriveFundingKey(VECTOR_MNEMONIC, 'testnet', 0));
    expect(signet.address.startsWith('tb1q')).toBe(true);
  });

  it.each(['unknown', '', 'MAINNET'])('rejects unknown network %s before displaying a funding address', network => {
    expect(() => deriveFundingKey(VECTOR_MNEMONIC, network, 0)).toThrow(/Unsupported/);
  });

  it.each([-1, 1.5, NaN, Infinity, 0x80000000])('rejects invalid or hardened funding index %s', index => {
    expect(() => deriveFundingKey(VECTOR_MNEMONIC, 'regtest', index)).toThrow(/index/);
  });

  it('gives testnet and mainnet different keys', () => {
    const mainnet = deriveFundingKey(VECTOR_MNEMONIC, 'mainnet', 0);
    const testnet = deriveFundingKey(VECTOR_MNEMONIC, 'testnet', 0);
    expect(testnet.publicKeyHex).not.toBe(mainnet.publicKeyHex);
  });

  it('gives every index its own address', () => {
    const first = deriveFundingKey(VECTOR_MNEMONIC, 'mainnet', 0);
    const second = deriveFundingKey(VECTOR_MNEMONIC, 'mainnet', 1);
    expect(second.address).not.toBe(first.address);
  });

  it('is deterministic for the same inputs', () => {
    expect(deriveFundingKey(VECTOR_MNEMONIC, 'mainnet', 3)).toEqual(
      deriveFundingKey(VECTOR_MNEMONIC, 'mainnet', 3),
    );
  });

  it('rejects a mnemonic that is not valid', () => {
    expect(() => deriveFundingKey('not a real mnemonic at all', 'mainnet', 0)).toThrow();
  });
});

describe('readWalletMnemonic', () => {
  const signIn = vi.mocked(signInPinnedToActiveCredential);

  beforeEach(() => {
    localStorage.clear();
    signIn.mockReset();
  });

  afterEach(() => localStorage.clear());

  it('uses the phrase this device already holds', async () => {
    localStorage.setItem('walletMnemonic', VECTOR_MNEMONIC);
    await expect(readWalletMnemonic()).resolves.toBe(VECTOR_MNEMONIC);
    expect(signIn).not.toHaveBeenCalled();
  });

  it('says the phrase is gone when nothing can produce it', async () => {
    await expect(readWalletMnemonic({ interactive: true })).rejects.toThrow(MnemonicUnavailableError);
  });

  it('derives it through the passkey when the user is there to sign in', async () => {
    localStorage.setItem('passkeyLabel', 'Default');
    signIn.mockResolvedValue({
      wallet: { seed: { type: 'mnemonic', mnemonic: VECTOR_MNEMONIC }, label: 'Default' },
    } as never);
    await expect(readWalletMnemonic({ interactive: true })).resolves.toBe(VECTOR_MNEMONIC);
    expect(signIn).toHaveBeenCalledWith('Default');
  });

  it('never asks for a passkey on a background pass', async () => {
    localStorage.setItem('passkeyLabel', 'Default');
    await expect(readWalletMnemonic()).rejects.toThrow(MnemonicNeedsPasskeyError);
    expect(signIn).not.toHaveBeenCalled();
  });

  it('prefers the stored phrase over a passkey ceremony', async () => {
    localStorage.setItem('passkeyLabel', 'Default');
    localStorage.setItem('walletMnemonic', VECTOR_MNEMONIC);
    await expect(readWalletMnemonic({ interactive: true })).resolves.toBe(VECTOR_MNEMONIC);
    expect(signIn).not.toHaveBeenCalled();
  });
});

// Public deterministic test vectors only. No user wallet material.
describe('seed-preserving exit funding', () => {
  const raw = (bytes: number[]): Seed => Object.assign(bytes, { type: 'entropy' as const });
  it('uses raw BIP32 bytes directly and leaves the caller seed unchanged', () => {
    const bytes = Array.from(mnemonicToSeedSync(VECTOR_MNEMONIC));
    const seed = raw(bytes.slice());
    expect(deriveFundingKeyFromSeed(seed, 'mainnet', 0)).toEqual(deriveFundingKey(VECTOR_MNEMONIC, 'mainnet', 0));
    expect(Array.from(seed as number[])).toEqual(bytes);
  });
  it('preserves the mnemonic passphrase', () => {
    const seed: Seed = { type: 'mnemonic', mnemonic: VECTOR_MNEMONIC, passphrase: 'TREZOR' };
    const expected = deriveFundingKeyFromSeed(raw(Array.from(mnemonicToSeedSync(VECTOR_MNEMONIC, 'TREZOR'))), 'regtest', 2);
    expect(deriveFundingKeyFromSeed(seed, 'regtest', 2)).toEqual(expected);
    expect(expected.address).not.toBe(deriveFundingKey(VECTOR_MNEMONIC, 'regtest', 2).address);
  });
  it.each([undefined, null, ''])('preserves absent or empty passphrase %s without changing the input', passphrase => {
    const seed = Object.freeze({ type: 'mnemonic', mnemonic: VECTOR_MNEMONIC, passphrase }) as Seed;
    expect(deriveFundingKeyFromSeed(seed, 'regtest', 2)).toEqual(deriveFundingKey(VECTOR_MNEMONIC, 'regtest', 2));
    expect(seed).toHaveProperty('passphrase', passphrase);
  });
  it('preserves whitespace and Unicode passphrase meaning', () => {
    const passphrase = '  \u212b caf\u00e9  ';
    const seed: Seed = Object.freeze({ type: 'mnemonic', mnemonic: VECTOR_MNEMONIC, passphrase });
    const expected = raw(Array.from(mnemonicToSeedSync(VECTOR_MNEMONIC, passphrase)));
    expect(deriveFundingKeyFromSeed(seed, 'regtest', 2)).toEqual(deriveFundingKeyFromSeed(expected, 'regtest', 2));
    expect(seed.passphrase).toBe(passphrase);
  });
  it.each([false, true, 0, 1, NaN, [], {}, { normalize: () => '' }].map(passphrase => ({ passphrase })))('rejects malformed present passphrase %# before deriving a different identity', ({ passphrase }) => {
    const seed = Object.freeze({ type: 'mnemonic', mnemonic: VECTOR_MNEMONIC, passphrase }) as unknown as Seed;
    expect(() => deriveFundingKeyFromSeed(seed, 'regtest', 0)).toThrow(/passphrase/i);
    expect(seed).toHaveProperty('passphrase', passphrase);
  });
  it('never turns raw bytes into new BIP39 words', () => {
    const bytes = Array.from({ length: 32 }, (_, i) => i);
    expect(deriveFundingKeyFromSeed(raw(bytes), 'mainnet', 0).address).not.toBe(
      deriveFundingKey(entropyToMnemonic(Buffer.from(bytes)), 'mainnet', 0).address,
    );
  });
  it.each([[], Array(15).fill(0), Array(65).fill(0), [...Array(31).fill(0), 256], [...Array(31).fill(0), -1], [...Array(31).fill(0), 1.5], new Array(32)].map(bytes => ({ bytes })))('rejects invalid seed bytes %#', ({ bytes }) => {
    expect(() => deriveFundingKeyFromSeed(raw(bytes), 'mainnet', 0)).toThrow(/seed/);
  });
  it('retains a passkey-returned raw seed without changing its variant', async () => {
    localStorage.setItem('passkeyLabel', 'Default');
    const seed = raw(Array(32).fill(7));
    vi.mocked(signInPinnedToActiveCredential).mockResolvedValue({ wallet: { seed } } as never);
    try {
      await expect(readWalletSeed({ interactive: true })).resolves.toBe(seed);
      await expect(readWalletMnemonic({ interactive: true })).rejects.toThrow(MnemonicUnavailableError);
    } finally { localStorage.clear(); }
  });
});

describe('funding seed selection fails closed', () => {
  const signIn = vi.mocked(signInPinnedToActiveCredential);

  beforeEach(() => {
    localStorage.clear();
    signIn.mockReset();
  });

  afterEach(() => localStorage.clear());

  it('pauses a background rebuild without prompting or selecting another stored identity', async () => {
    stores.secureStorage.isSupported.mockReturnValue(true);
    stores.secureStorage.hasStoredSeed.mockResolvedValue(true);
    localStorage.setItem('walletMnemonic', VECTOR_MNEMONIC);
    await chooseNativeSeedTier();
    await expect(readWalletSeed()).rejects.toThrow(MnemonicNeedsPasskeyError);
    expect(stores.secureStorage.retrieveSeed).not.toHaveBeenCalled();
    expect(signIn).not.toHaveBeenCalled();
    expect(localStorage.getItem('walletMnemonic')).toBe(VECTOR_MNEMONIC);
  });

  it.each(['deviceOnlyStorage', 'secureStorage'] as const)('does not fall through after a known-present %s read fails', async tier => {
    await rememberSignerIdentity({ type: 'mnemonic', mnemonic: VECTOR_MNEMONIC });
    setActiveNativeSeedWallet({ getInfo: vi.fn() }, 'regtest');
    const error = new Error('Stored seed blob has an unexpected shape.');
    stores[tier].isSupported.mockReturnValue(true);
    stores[tier].hasStoredSeed.mockResolvedValue(true);
    stores[tier].retrieveSeed.mockRejectedValue(error);
    if (tier === 'deviceOnlyStorage') {
      stores.secureStorage.isSupported.mockReturnValue(true);
      stores.secureStorage.hasStoredSeed.mockResolvedValue(true);
      stores.secureStorage.retrieveSeed.mockResolvedValue({ type: 'mnemonic', mnemonic: VECTOR_MNEMONIC });
    }
    localStorage.setItem('walletMnemonic', VECTOR_MNEMONIC);
    localStorage.setItem('passkeyLabel', 'Default');

    await chooseNativeSeedTier();
    await expect(readWalletSeed({ interactive: true })).rejects.toBe(error);
    expect(signIn).not.toHaveBeenCalled();
    expect(localStorage.getItem('walletMnemonic')).toBe(VECTOR_MNEMONIC);
    if (tier === 'deviceOnlyStorage') expect(stores.secureStorage.retrieveSeed).not.toHaveBeenCalled();
  });

  it.each([false, 0, NaN].map(passphrase => ({ passphrase })))('rejects malformed passkey-returned passphrase %# in both seed and words readers', async ({ passphrase }) => {
    const seed = Object.freeze({ type: 'mnemonic', mnemonic: VECTOR_MNEMONIC, passphrase });
    localStorage.setItem('passkeyLabel', 'Default');
    signIn.mockResolvedValue({ wallet: { seed } } as never);

    await expect(readWalletSeed({ interactive: true })).rejects.toThrow(/passphrase/i);
    await expect(readWalletMnemonic({ interactive: true })).rejects.toThrow(/passphrase/i);
    expect(seed.passphrase).toBe(passphrase);
  });

  it.each([undefined, null, ''])('allows words-only access for an absent or empty passphrase %s', async passphrase => {
    const seed = Object.freeze({ type: 'mnemonic', mnemonic: VECTOR_MNEMONIC, passphrase });
    localStorage.setItem('passkeyLabel', 'Default');
    signIn.mockResolvedValue({ wallet: { seed } } as never);

    await expect(readWalletSeed({ interactive: true })).resolves.toBe(seed);
    await expect(readWalletMnemonic({ interactive: true })).resolves.toBe(VECTOR_MNEMONIC);
    expect(seed.passphrase).toBe(passphrase);
  });

  it('preserves a nonempty passphrase and refuses words-only access', async () => {
    const seed = Object.freeze({ type: 'mnemonic', mnemonic: VECTOR_MNEMONIC, passphrase: ' ' });
    localStorage.setItem('passkeyLabel', 'Default');
    signIn.mockResolvedValue({ wallet: { seed } } as never);

    await expect(readWalletSeed({ interactive: true })).resolves.toBe(seed);
    await expect(readWalletMnemonic({ interactive: true })).rejects.toThrow(MnemonicUnavailableError);
    expect(seed.passphrase).toBe(' ');
  });
});
