import type { BreezSdk, Network, Seed } from '@breeztech/breez-sdk-spark';
import { deviceOnlyStorage, secureStorage } from './secureStorage';
import {
  assertCurrentSession, getSpendingSessionEpoch, isSpendingSessionLocked,
} from '../security/spendApproval';

export type NativeSeedTier = 'device' | 'biometric';
type ActiveWallet = { sdk: Pick<BreezSdk, 'getInfo'>; network: Network };

export class NativeSeedAuthenticationRequiredError extends Error {
  constructor() {
    super('Unlocking the saved wallet with biometrics is needed to continue this exit');
    this.name = 'NativeSeedAuthenticationRequiredError';
  }
}

// Selection contains no seed. A failed read must never select another record.
let selectedTier: NativeSeedTier | null = null;
let unconfirmedTier: NativeSeedTier | null = null;
type Selection = { tier: NativeSeedTier | null; revision: number };
let pendingSelection: Promise<Selection> | null = null;
let activeWallet: ActiveWallet | null = null;
let revision = 0;

export function getNativeSeedTier(): NativeSeedTier | null { return selectedTier; }

export function setNativeSeedTier(tier: NativeSeedTier): void {
  selectedTier = tier;
  unconfirmedTier = null;
  revision++;
}

export function setActiveNativeSeedWallet(sdk: ActiveWallet['sdk'] | null, network?: Network): void {
  if (sdk && !network) throw new Error('Native wallet network is required');
  activeWallet = sdk && network ? { sdk, network } : null;
  revision++;
}

/** Only an explicit wallet reset may discard the selected native record. */
export function resetNativeSeedSelection(): void {
  selectedTier = null;
  unconfirmedTier = null;
  pendingSelection = null;
  activeWallet = null;
  revision++;
}

/** Preserve existing device-only precedence, keeping the other record intact. */
function chooseNativeSeedSelection(): Promise<Selection> {
  if (selectedTier) return Promise.resolve({ tier: selectedTier, revision });
  if (pendingSelection) return pendingSelection;
  const probe = async (): Promise<Selection> => {
    const tiers = [['device', deviceOnlyStorage], ['biometric', secureStorage]] as const;
    // A failed probe is retried in the same tier. It is not yet a confirmed
    // wallet selection, so a fresh, explicit absence response may advance it.
    const start = unconfirmedTier === 'biometric' ? 1 : 0;
    for (const [tier, store] of tiers.slice(start)) {
      if (!store.isSupported()) continue;
      unconfirmedTier = tier;
      const selectedRevision = ++revision;
      const present = await store.hasStoredSeed();
      if (revision !== selectedRevision || unconfirmedTier !== tier) throw new Error('Native wallet selection changed');
      if (present) {
        setNativeSeedTier(tier);
        return { tier, revision };
      }
      unconfirmedTier = null;
      revision++;
    }
    return { tier: null, revision };
  };
  const pending = probe().finally(() => {
    if (pendingSelection === pending) pendingSelection = null;
  });
  pendingSelection = pending;
  return pending;
}

export async function chooseNativeSeedTier(): Promise<NativeSeedTier | null> {
  return (await chooseNativeSeedSelection()).tier;
}

/** The native plugin has one slot per tier, so switching cannot archive a saved identity. */
export async function assertNativeWalletSwitchAllowed(): Promise<void> {
  const selectedRevision = revision;
  const epoch = getSpendingSessionEpoch();
  const retained = () => new Error(
    'Wallet switching is unavailable while saved wallet records remain on this device. Your wallet and recovery records were preserved.',
  );
  if (selectedTier || unconfirmedTier || pendingSelection) throw retained();
  for (const store of [deviceOnlyStorage, secureStorage]) {
    if (!store.isSupported()) continue;
    let present: boolean;
    try {
      present = await store.hasStoredSeed();
    } catch {
      throw new Error('Could not verify saved wallet records. Wallet switching was stopped and your wallet was preserved.');
    }
    assertCurrentSession(epoch);
    if (revision !== selectedRevision || selectedTier || unconfirmedTier || pendingSelection || present !== false) {
      throw retained();
    }
  }
}

function snapshotSeed(seed: Seed): Seed {
  if (seed.type === 'mnemonic') return Object.freeze({
    type: 'mnemonic', mnemonic: seed.mnemonic, passphrase: seed.passphrase,
  });
  if (seed.type === 'entropy' && Array.isArray(seed)) {
    return Object.freeze(Object.assign(Array.from(seed), { type: 'entropy' as const })) as Seed;
  }
  throw new Error('Wallet seed is not valid');
}

/** Verify a freshly read seed using the SDK's unchanged seed/account semantics. */
export async function readSeedForActiveNativeWallet(read: () => Promise<Seed>): Promise<Seed> {
  const wallet = activeWallet;
  const selectedRevision = revision;
  const epoch = getSpendingSessionEpoch();
  const ensureCurrent = () => {
    if (!wallet || activeWallet !== wallet || revision !== selectedRevision) {
      throw new Error('Native wallet connection or selection changed');
    }
    assertCurrentSession(epoch);
    if (isSpendingSessionLocked()) throw new Error('Wallet session is locked');
  };
  ensureCurrent();
  const seed = snapshotSeed(await read());
  ensureCurrent();
  const [{ defaultExternalSignersFromSeed }, { sdkReady }] = await Promise.all([
    import('@breeztech/breez-sdk-spark'), import('./sdkReady'),
  ]);
  ensureCurrent();
  await sdkReady();
  ensureCurrent();
  const info = await wallet!.sdk.getInfo({ ensureSynced: false });
  ensureCurrent();
  const expectedIdentity = info.identityPubkey;
  if (typeof expectedIdentity !== 'string' || !/^(02|03)[a-f0-9]{64}$/i.test(expectedIdentity)) {
    throw new Error('Connected wallet identity is unavailable');
  }
  const signers = defaultExternalSignersFromSeed(seed, wallet!.network, undefined);
  let breez: typeof signers.breezSigner | undefined;
  let spark: typeof signers.sparkSigner | undefined;
  try {
    breez = signers.breezSigner;
    spark = signers.sparkSigner;
    const { bytes } = await spark.getIdentityPublicKey();
    ensureCurrent();
    if (!Array.isArray(bytes) || bytes.length !== 33 ||
      !bytes.every(byte => Number.isInteger(byte) && byte >= 0 && byte <= 255) ||
      ![2, 3].includes(bytes[0]) ||
      bytes.map(byte => byte.toString(16).padStart(2, '0')).join('') !== expectedIdentity.toLowerCase()) {
      throw new Error('Stored seed does not match the connected wallet');
    }
    return seed;
  } finally {
    // Each getter owns a handle; free each once, then the container, including
    // mismatches and session changes. No signing method is used by this check.
    try { breez?.free(); } finally {
      try { spark?.free(); } finally { signers.free(); }
    }
  }
}

export async function readSelectedNativeSeed({ verifyIdentity = true, allowBiometric = true } = {}): Promise<Seed | null> {
  const wallet = activeWallet;
  const epoch = getSpendingSessionEpoch();
  const selection = await chooseNativeSeedSelection();
  const { tier, revision: selectedRevision } = selection;
  if (activeWallet !== wallet || revision !== selectedRevision || selectedTier !== tier) throw new Error('Native wallet selection changed');
  assertCurrentSession(epoch);
  if (!tier) return null;
  if (tier === 'biometric' && !allowBiometric) throw new NativeSeedAuthenticationRequiredError();
  const read = async () => {
    if (revision !== selectedRevision || selectedTier !== tier) throw new Error('Native wallet selection changed');
    const seed = await (tier === 'device' ? deviceOnlyStorage : secureStorage).retrieveSeed();
    if (revision !== selectedRevision || selectedTier !== tier) throw new Error('Native wallet selection changed');
    assertCurrentSession(epoch);
    return seed;
  };
  // Startup needs the selected seed to establish the first SDK connection.
  // Once connected, backup/funding reads must prove the exact public identity.
  return verifyIdentity ? readSeedForActiveNativeWallet(read) : read();
}
