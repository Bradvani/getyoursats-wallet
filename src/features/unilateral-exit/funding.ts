import {getUnlockedWebMnemonic} from '../../security/webWalletVault';
import type { Seed } from '@breeztech/breez-sdk-spark';
import { LogCategory, logger } from '@/services/logger';
import { deviceOnlyStorage, secureStorage } from '@/services/secureStorage';
import { ripemd160 } from '@noble/hashes/legacy';
import { sha256 } from '@noble/hashes/sha2';
import { bech32, hex } from '@scure/base';
import { HDKey } from '@scure/bip32';
import { mnemonicToSeedSync, validateMnemonic } from 'bip39';

export interface FundingKey {
  address: string;
  publicKeyHex: string;
  secretKey: Uint8Array;
}

interface NetworkParams {
  hrp: string;
  coinType: number;
}

const networkParams = (network: string): NetworkParams => {
  switch (network) {
    case 'testnet':
    case 'signet':
      return { hrp: 'tb', coinType: 1 };
    case 'regtest':
      return { hrp: 'bcrt', coinType: 1 };
    case 'mainnet':
      return { hrp: 'bc', coinType: 0 };
    default:
      throw new Error('Unsupported exit funding network');
  }
};

const toHex = (bytes: Uint8Array): string =>
  Array.from(bytes)
    .map(byte => byte.toString(16).padStart(2, '0'))
    .join('');

/** The P2WPKH address of a public key, which is what a funding key receives at. */
export function fundingAddressOf(publicKey: Uint8Array | string, network: string): string {
  const bytes = typeof publicKey === 'string' ? hex.decode(publicKey) : publicKey;
  const witnessProgram = ripemd160(sha256(bytes));
  return bech32.encode(networkParams(network).hrp, [0, ...bech32.toWords(witnessProgram)]);
}

export function deriveFundingKey(mnemonic: string, network: string, index: number): FundingKey {
  return deriveFundingKeyFromSeed({ type: 'mnemonic', mnemonic }, network, index);
}

/** Preserve the SDK seed variant: raw seed bytes are already BIP32 seed material. */
export function deriveFundingKeyFromSeed(walletSeed: Seed, network: string, index: number): FundingKey {
  if (!Number.isSafeInteger(index) || index < 0 || index >= 0x80000000) {
    throw new Error('Invalid exit funding address index');
  }
  const { coinType } = networkParams(network);
  let seed: Uint8Array;
  if (walletSeed.type === 'mnemonic') {
    if (!validateMnemonic(walletSeed.mnemonic)) throw new Error('Recovery phrase is not valid');
    seed = mnemonicToSeedSync(walletSeed.mnemonic, walletSeed.passphrase);
  } else if (walletSeed.type === 'entropy' && Array.isArray(walletSeed) &&
      walletSeed.length >= 16 && walletSeed.length <= 64 &&
      Array.from(walletSeed).every(byte => Number.isInteger(byte) && byte >= 0 && byte <= 255)) {
    seed = Uint8Array.from(walletSeed);
  } else {
    throw new Error('Wallet seed is not valid');
  }
  let root: HDKey | undefined;
  let node: HDKey | undefined;
  try {
    root = HDKey.fromMasterSeed(seed);
    node = root.derive(`m/84'/${coinType}'/0'/0/${index}`);
    if (!node.publicKey || !node.privateKey) throw new Error('Failed to derive the funding key');
    return {
      address: fundingAddressOf(node.publicKey, network),
      publicKeyHex: toHex(node.publicKey),
      secretKey: Uint8Array.from(node.privateKey),
    };
  } finally {
    seed.fill(0);
    root?.wipePrivateData();
    node?.wipePrivateData();
  }
}

export class MnemonicUnavailableError extends Error {
  constructor() {
    super('Recovery mode needs this wallet\'s recovery phrase on this device');
    this.name = 'MnemonicUnavailableError';
  }
}

/**
 * Thrown when the phrase exists but only a passkey ceremony can produce it, and
 * the caller is not in a position to ask for one.
 */
export class MnemonicNeedsPasskeyError extends Error {
  constructor() {
    super('Signing in with your passkey is needed to continue this exit');
    this.name = 'MnemonicNeedsPasskeyError';
  }
}

const stored = async (): Promise<Seed | null> => {
  for (const [store, where] of [
    [deviceOnlyStorage, 'device-only storage'],
    [secureStorage, 'biometric storage'],
  ] as const) {
    if (!store.isSupported() || !(await store.hasStoredSeed())) continue;
    try {
      const seed = await store.retrieveSeed();
      return seed;
    } catch (e) {
      logger.warn(LogCategory.AUTH, `Failed to read seed from ${where}`, {
        error: e instanceof Error ? e.message : String(e),
      });
    }
  }
  const mnemonic = getUnlockedWebMnemonic() ?? localStorage.getItem('walletMnemonic');
  return mnemonic ? { type: 'mnemonic', mnemonic } : null;
};

/**
 * The original SDK seed the funding key is derived from.
 *
 * A web passkey wallet keeps no persistent copy, so it is re-derived through a
 * passkey ceremony. That needs a user gesture, which `interactive` says the
 * caller has: a background pass does not, and gets
 * {@link MnemonicNeedsPasskeyError} instead of an authentication prompt the
 * user did not ask for.
 */
export async function readWalletSeed({ interactive = false } = {}): Promise<Seed> {
  const cached = await stored();
  if (cached) return cached;

  // Loaded here rather than imported: the passkey module reads
  // `import.meta.env` as it loads, which only a bundled browser build has, and
  // the exit's key derivation is reused outside one.
  const { getPasskeyLabel, isPasskeyMode, signInPinnedToActiveCredential } = await import(
    '@/services/passkeyService'
  );
  if (!isPasskeyMode()) throw new MnemonicUnavailableError();
  if (!interactive) throw new MnemonicNeedsPasskeyError();

  const { wallet } = await signInPinnedToActiveCredential(getPasskeyLabel() ?? undefined);
  return wallet.seed;
}

/** Compatibility for callers that explicitly require words, never reinterpret raw bytes. */
export async function readWalletMnemonic(options: { interactive?: boolean } = {}): Promise<string> {
  const seed = await readWalletSeed(options);
  if (seed.type !== 'mnemonic' || seed.passphrase) throw new MnemonicUnavailableError();
  return seed.mnemonic;
}
