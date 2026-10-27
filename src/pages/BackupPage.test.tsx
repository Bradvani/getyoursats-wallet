import type {ReactNode} from 'react';
import {beforeEach, describe, expect, it, vi} from 'vitest';
import {act, fireEvent, render, screen, waitFor} from '@testing-library/react';
import BackupPage from './BackupPage';
import {backupSetupCopy} from '@/locales/backupSetup';
import {setAppLanguage} from '@/services/presentationPreferences';
import {resetNativeSeedSelection, setActiveNativeSeedWallet, setNativeSeedTier} from '@/services/nativeSeedSelection';
import {clearSignerIdentity, rememberSignerIdentity} from '@/security/spendApproval';
import {confirmNativePinPolicy, getNativePinPolicyRevision, invalidateNativePinPolicy, invalidateNativeReadBinding, lockNativeReadAccess} from '@/services/nativeReadLease';

const fixtures = vi.hoisted(() => ({
  phrase: Array(11).fill('abandon').concat('about').join(' '),
  passkey: vi.fn(),
  signIn: vi.fn(),
  appLockSupported: vi.fn(),
  pinEnabled: vi.fn(),
  captureProtection: vi.fn(),
  challenge: vi.fn(),
  native: vi.fn(),
  deviceSupported: vi.fn(),
  deviceHasSeed: vi.fn(),
  deviceRetrieve: vi.fn(),
  biometricSupported: vi.fn(),
  biometricHasSeed: vi.fn(),
  biometricRetrieve: vi.fn(),
  factory: vi.fn(),
  pinCallbacks: [] as Array<() => void>,
}));

vi.mock('../components/layout/SlideInPage', () => ({
  default: ({children, footer, onClose}: {children: ReactNode; footer?: ReactNode; onClose: () => void}) => (
    <main><button onClick={onClose}>Go Back</button>{children}<footer>{footer}</footer></main>
  ),
}));
vi.mock('../components/PinEntry', () => ({
  PinGate: ({onUnlocked}: {onUnlocked: () => void}) => {
    fixtures.pinCallbacks.push(onUnlocked);
    return <button onClick={onUnlocked}>Unlock Backup</button>;
  },
}));
vi.mock('../components/ui', () => ({LoadingSpinner: () => <span>Loading</span>}));
vi.mock('../components/AlertCard', () => ({
  AlertCard: ({children, title}: {children: ReactNode; title: string}) => <div role="alert"><strong>{title}</strong>{children}</div>,
}));
vi.mock('@capacitor/core', () => ({Capacitor: {isNativePlatform: fixtures.native}}));
vi.mock('@/services/appLock', () => ({
  isAppLockSupported: fixtures.appLockSupported,
  isPinEnabled: fixtures.pinEnabled,
}));
vi.mock('@/services/passkeyService', () => ({
  isPasskeyMode: fixtures.passkey,
  signInPinnedToActiveCredential: fixtures.signIn,
}));
vi.mock('@/services/secureStorage', () => ({
  deviceOnlyStorage: {
    isSupported: fixtures.deviceSupported, hasStoredSeed: fixtures.deviceHasSeed, retrieveSeed: fixtures.deviceRetrieve,
  },
  secureStorage: {
    isSupported: fixtures.biometricSupported, hasStoredSeed: fixtures.biometricHasSeed, retrieveSeed: fixtures.biometricRetrieve,
  },
}));
vi.mock('@/services/logger', () => ({logger: {warn: vi.fn(), error: vi.fn()}, LogCategory: {AUTH: 'auth'}}));
vi.mock('@/utils/screenSecurity', () => ({useScreenCaptureProtection: fixtures.captureProtection}));
vi.mock('../getyoursats/recoveryChallenge', () => ({createRecoveryChallenge: fixtures.challenge}));
vi.mock('@breeztech/breez-sdk-spark', () => ({defaultExternalSignersFromSeed: fixtures.factory}));
vi.mock('@/services/sdkReady', () => ({sdkReady: vi.fn(async () => {})}));

beforeEach(async () => {
  vi.clearAllMocks();
  fixtures.pinCallbacks.length = 0;
  invalidateNativePinPolicy();
  confirmNativePinPolicy(false, getNativePinPolicyRevision());
  resetNativeSeedSelection();
  clearSignerIdentity();
  await rememberSignerIdentity({type: 'mnemonic', mnemonic: fixtures.phrase});
  setActiveNativeSeedWallet({getInfo: vi.fn(async () => ({identityPubkey: `02${'11'.repeat(32)}`}))} as never, 'regtest');
  fixtures.factory.mockReset().mockReturnValue({
    breezSigner: {free: vi.fn()},
    sparkSigner: {getIdentityPublicKey: vi.fn(async () => ({bytes: [2, ...Array(32).fill(17)]})), free: vi.fn()},
    free: vi.fn(),
  });
  localStorage.clear();
  setAppLanguage('en');
  localStorage.setItem('walletMnemonic', fixtures.phrase);
  fixtures.passkey.mockReturnValue(false);
  fixtures.appLockSupported.mockReturnValue(false);
  fixtures.pinEnabled.mockResolvedValue(false);
  fixtures.challenge.mockReset().mockReturnValue([0, 11]);
  fixtures.signIn.mockResolvedValue({wallet: {seed: {type: 'mnemonic', mnemonic: fixtures.phrase}}});
  fixtures.native.mockReset().mockReturnValue(false);
  fixtures.deviceSupported.mockReset().mockReturnValue(false);
  fixtures.deviceHasSeed.mockReset().mockResolvedValue(false);
  fixtures.deviceRetrieve.mockReset().mockResolvedValue({type: 'mnemonic', mnemonic: fixtures.phrase});
  fixtures.biometricSupported.mockReset().mockReturnValue(false);
  fixtures.biometricHasSeed.mockReset().mockResolvedValue(false);
  fixtures.biometricRetrieve.mockReset().mockResolvedValue({type: 'mnemonic', mnemonic: fixtures.phrase});
});

async function revealWords() {
  const reveal = await screen.findByRole('button', {name: 'Reveal Words Privately'});
  expect(reveal).toBeDisabled();
  fireEvent.click(screen.getByRole('checkbox', {name: /I am in a private space/}));
  expect(reveal).toBeDisabled();
  fireEvent.click(screen.getByRole('checkbox', {name: /I understand these words control my wallet/}));
  expect(reveal).not.toBeDisabled();
  fireEvent.click(reveal);
  await screen.findByText('Recovery Phrase');
}

async function beginCheck() {
  await revealWords();
  const check = screen.getByRole('button', {name: 'Check My Handwritten Backup'});
  expect(check).toBeDisabled();
  fireEvent.click(screen.getByRole('checkbox', {name: /I have written down every word/}));
  fireEvent.click(check);
  expect(screen.queryByText('Recovery Phrase')).toBeNull();
  expect(screen.queryAllByText('abandon')).toHaveLength(0);
  expect(screen.queryByText('about')).toBeNull();
}

describe('private offline backup verification', () => {
  it('requires the existing privacy checks and a handwritten acknowledgement before checking', async () => {
    const confirmed = vi.fn();
    render(<BackupPage onBack={vi.fn()} onRecoveryConfirmed={confirmed}/>);
    expect(fixtures.captureProtection).toHaveBeenCalledWith(true);
    await beginCheck();
    expect(confirmed).not.toHaveBeenCalled();
    expect(fixtures.challenge).toHaveBeenCalledWith(12, undefined);
    expect(screen.getByRole('button', {name: 'Verify Offline Backup'})).toBeDisabled();
  });

  it('does not mark backup complete after revealing words or leaving the page', async () => {
    const confirmed = vi.fn();
    const back = vi.fn();
    render(<BackupPage onBack={back} onRecoveryConfirmed={confirmed}/>);
    await revealWords();
    fireEvent.click(screen.getByRole('button', {name: 'Go Back'}));
    expect(back).toHaveBeenCalledOnce();
    expect(confirmed).not.toHaveBeenCalled();
    expect(screen.queryByText('Recovery Phrase')).toBeNull();
  });

  it('rejects incorrect answers without recording completion', async () => {
    const confirmed = vi.fn();
    render(<BackupPage onBack={vi.fn()} onRecoveryConfirmed={confirmed}/>);
    await beginCheck();
    fireEvent.change(screen.getByLabelText('Word 1'), {target: {value: 'wrong'}});
    fireEvent.change(screen.getByLabelText('Word 12'), {target: {value: 'about'}});
    fireEvent.click(screen.getByRole('button', {name: 'Verify Offline Backup'}));
    expect(screen.getByRole('alert')).toHaveTextContent('Those words do not match');
    expect(confirmed).not.toHaveBeenCalled();
    expect(screen.queryByTestId('backup-complete')).toBeNull();
  });

  it('records phrase verification only after correct answers and clears the phrase and fields', async () => {
    const confirmed = vi.fn();
    const back = vi.fn();
    render(<BackupPage onBack={back} onRecoveryConfirmed={confirmed}/>);
    await beginCheck();
    const writes = vi.spyOn(Storage.prototype, 'setItem');
    fireEvent.change(screen.getByLabelText('Word 1'), {target: {value: ' ABANDON '}});
    fireEvent.change(screen.getByLabelText('Word 12'), {target: {value: 'about'}});
    fireEvent.click(screen.getByRole('button', {name: 'Verify Offline Backup'}));
    expect(confirmed).toHaveBeenCalledExactlyOnceWith('phrase-verified');
    expect(screen.getByRole('status', {name: 'Offline backup verified'})).toBeVisible();
    expect(screen.queryAllByRole('textbox')).toHaveLength(0);
    expect(screen.queryByText('Recovery Phrase')).toBeNull();
    expect(writes).not.toHaveBeenCalled();
    writes.mockRestore();
    fireEvent.click(screen.getByRole('button', {name: 'Done'}));
    expect(back).toHaveBeenCalledOnce();
  });

  it('clears answers on return and requests a fresh challenge for the next check', async () => {
    fixtures.challenge.mockReturnValueOnce([0, 11]).mockReturnValueOnce([1, 10]);
    const confirmed = vi.fn();
    render(<BackupPage onBack={vi.fn()} onRecoveryConfirmed={confirmed}/>);
    await beginCheck();
    fireEvent.change(screen.getByLabelText('Word 1'), {target: {value: 'abandon'}});
    fireEvent.change(screen.getByLabelText('Word 12'), {target: {value: 'wrong'}});
    fireEvent.click(screen.getByRole('button', {name: 'Return to Backup'}));
    expect(screen.queryAllByRole('textbox')).toHaveLength(0);
    expect(screen.queryByText('Recovery Phrase')).toBeNull();
    await beginCheck();
    expect(fixtures.challenge).toHaveBeenLastCalledWith(12, [0, 11]);
    expect(screen.getByLabelText('Word 2')).toHaveValue('');
    expect(screen.getByLabelText('Word 11')).toHaveValue('');
    expect(confirmed).not.toHaveBeenCalled();
  });

  it('keeps recovery content and completion actions behind the existing PIN gate', async () => {
    fixtures.appLockSupported.mockReturnValue(true);
    fixtures.pinEnabled.mockResolvedValue(true);
    render(<BackupPage onBack={vi.fn()} onRecoveryConfirmed={vi.fn()}/>);
    const unlock = await screen.findByRole('button', {name: 'Unlock Backup'});
    expect(screen.queryByRole('button', {name: 'Reveal Words Privately'})).toBeNull();
    expect(screen.queryByRole('button', {name: 'Check My Handwritten Backup'})).toBeNull();
    fireEvent.click(unlock);
    await screen.findByRole('button', {name: 'Reveal Words Privately'});
  });
});

describe('passkey recovery review', () => {
  beforeEach(() => {
    fixtures.passkey.mockReturnValue(true);
    localStorage.removeItem('walletMnemonic');
    localStorage.setItem('passkeyLabel', 'My wallet');
  });

  it('requires an explicit provider/account acknowledgement and does not claim a verified backup', async () => {
    const confirmed = vi.fn();
    render(<BackupPage onBack={vi.fn()} onRecoveryConfirmed={confirmed}/>);
    const reveal = screen.getByRole('button', {name: 'Reveal Words Privately'});
    expect(reveal.closest('footer')).not.toBeNull();
    expect(screen.getByRole('heading', {name: 'Back up before adding funds'})).toBeVisible();
    expect(screen.queryByText(/optional/i)).toBeNull();
    expect(screen.getByTestId('passkey-recovery-details')).not.toHaveAttribute('open');
    fireEvent.click(screen.getByText('Passkey recovery details'));
    const keep = screen.getByRole('button', {name: 'Save Passkey Review'});
    expect(keep.closest('footer')).toBeNull();
    expect(keep).toBeDisabled();
    expect(screen.getByText('My wallet')).toBeVisible();
    expect(screen.getByText(/cannot verify that your passkey has synced/)).toBeVisible();
    expect(fixtures.signIn).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('checkbox', {name: /I know which account and password manager/}));
    expect(confirmed).not.toHaveBeenCalled();
    fireEvent.click(keep);
    expect(confirmed).toHaveBeenCalledExactlyOnceWith('passkey-reviewed');
    expect(screen.getByRole('status')).toHaveTextContent('Passkey recovery reviewed');
    expect(screen.getByText('Your recovery phrase backup still needs to be checked.')).toBeVisible();
    expect(screen.queryByRole('button', {name: 'Done'})).toBeNull();
    expect(screen.getByRole('button', {name: 'Reveal Words Privately'})).toBeDisabled();
    expect(screen.queryByText(/Offline backup verified/)).toBeNull();
    expect(screen.queryByText(/Passkey Protected/)).toBeNull();
    expect(fixtures.signIn).not.toHaveBeenCalled();
  });

  it('leaving or checking only the acknowledgement never records completion', () => {
    const confirmed = vi.fn();
    const back = vi.fn();
    render(<BackupPage onBack={back} onRecoveryConfirmed={confirmed}/>);
    fireEvent.click(screen.getByText('Passkey recovery details'));
    fireEvent.click(screen.getByRole('checkbox', {name: /I know which account and password manager/}));
    fireEvent.click(screen.getByRole('button', {name: 'Go Back'}));
    expect(back).toHaveBeenCalledOnce();
    expect(confirmed).not.toHaveBeenCalled();
    expect(fixtures.signIn).not.toHaveBeenCalled();
  });

  it('preserves pinned passkey reveal and allows a separately verified independent backup', async () => {
    const confirmed = vi.fn();
    render(<BackupPage onBack={vi.fn()} recoveryStatus="passkey-reviewed" onRecoveryConfirmed={confirmed}/>);
    fireEvent.click(screen.getByText('Passkey recovery details'));
    expect(screen.getByRole('status')).toHaveTextContent('Passkey recovery reviewed');
    expect(fixtures.signIn).not.toHaveBeenCalled();
    await beginCheck();
    expect(fixtures.signIn).toHaveBeenCalledExactlyOnceWith('My wallet');
    fireEvent.change(screen.getByLabelText('Word 1'), {target: {value: 'abandon'}});
    fireEvent.change(screen.getByLabelText('Word 12'), {target: {value: 'about'}});
    fireEvent.click(screen.getByRole('button', {name: 'Verify Offline Backup'}));
    expect(confirmed).toHaveBeenCalledExactlyOnceWith('phrase-verified');
    expect(screen.queryByText('Recovery Phrase')).toBeNull();
  });

  it('does not downgrade an already verified phrase to a passkey acknowledgement', async () => {
    const confirmed = vi.fn();
    render(<BackupPage onBack={vi.fn()} recoveryStatus="phrase-verified" onRecoveryConfirmed={confirmed}/>);
    expect(screen.getByRole('status')).toHaveTextContent('Offline backup verified on this device');
    expect(screen.queryByRole('button', {name: 'Save Passkey Review'})).toBeNull();
    fireEvent.click(screen.getByRole('button', {name: 'Done'}));
    await waitFor(() => expect(confirmed).not.toHaveBeenCalled());
    expect(fixtures.signIn).not.toHaveBeenCalled();
  });
});

describe('native backup authentication paths', () => {
  it('keeps a device-vault passkey phrase behind the PIN and privacy checks without another passkey ceremony', async () => {
    fixtures.native.mockReturnValue(true);
    fixtures.passkey.mockReturnValue(true);
    fixtures.appLockSupported.mockReturnValue(true);
    fixtures.pinEnabled.mockResolvedValue(true);
    fixtures.deviceSupported.mockReturnValue(true);
    fixtures.deviceHasSeed.mockResolvedValue(true);
    render(<BackupPage onBack={vi.fn()}/>);
    const unlock = await screen.findByRole('button', {name: 'Unlock Backup'});
    expect(fixtures.deviceRetrieve).not.toHaveBeenCalled();
    fireEvent.click(unlock);
    await waitFor(() => expect(fixtures.deviceRetrieve).toHaveBeenCalledOnce());
    expect(screen.queryByText('Recovery Phrase')).toBeNull();
    await revealWords();
    expect(fixtures.signIn).not.toHaveBeenCalled();
    expect(fixtures.biometricRetrieve).not.toHaveBeenCalled();
  });

  it('reads a biometric-bound phrase only after explicit private viewing', async () => {
    fixtures.native.mockReturnValue(true);
    fixtures.biometricSupported.mockReturnValue(true);
    fixtures.biometricHasSeed.mockResolvedValue(true);
    render(<BackupPage onBack={vi.fn()}/>);
    await screen.findByRole('button', {name: 'Reveal Words Privately'});
    expect(fixtures.biometricRetrieve).not.toHaveBeenCalled();
    await revealWords();
    expect(fixtures.biometricRetrieve).toHaveBeenCalledOnce();
    expect(fixtures.signIn).not.toHaveBeenCalled();
  });

  it('requires a second explicit tap before native fallback after passkey authentication fails', async () => {
    fixtures.native.mockReturnValue(true);
    fixtures.passkey.mockReturnValue(true);
    fixtures.biometricSupported.mockReturnValue(true);
    fixtures.biometricHasSeed.mockResolvedValue(true);
    fixtures.signIn.mockRejectedValueOnce(new Error('Synthetic passkey cancellation'));
    render(<BackupPage onBack={vi.fn()}/>);
    fireEvent.click(screen.getByRole('checkbox', {name: /I am in a private space/}));
    fireEvent.click(screen.getByRole('checkbox', {name: /I understand these words control my wallet/}));
    fireEvent.click(screen.getByRole('button', {name: 'Reveal Words Privately'}));
    await waitFor(() => expect(fixtures.biometricHasSeed).toHaveBeenCalledOnce());
    const fallback = await screen.findByRole('button', {name: 'Reveal Words Privately'});
    expect(fixtures.signIn).toHaveBeenCalledOnce();
    expect(fixtures.biometricRetrieve).not.toHaveBeenCalled();
    expect(screen.queryByText('Recovery Phrase')).toBeNull();
    fireEvent.click(fallback);
    await screen.findByText('Recovery Phrase');
    expect(fixtures.biometricRetrieve).toHaveBeenCalledOnce();
  });
});

describe('backup preserves the selected native identity', () => {
  beforeEach(() => {
    fixtures.native.mockReturnValue(true);
    fixtures.deviceSupported.mockReturnValue(true);
    fixtures.biometricSupported.mockReturnValue(true);
    fixtures.deviceHasSeed.mockResolvedValue(true);
    fixtures.biometricHasSeed.mockResolvedValue(true);
  });

  it('stops after the selected device record fails instead of exposing another stored phrase', async () => {
    fixtures.deviceRetrieve.mockRejectedValue(new Error('Selected record is unavailable'));
    render(<BackupPage onBack={vi.fn()}/>);
    await screen.findByText('Selected record is unavailable');
    expect(fixtures.biometricRetrieve).not.toHaveBeenCalled();
    expect(fixtures.signIn).not.toHaveBeenCalled();
    expect(screen.queryByText('Recovery Phrase')).toBeNull();
    expect(screen.queryByRole('button', {name: 'Reveal Words Privately'})).toBeNull();
  });

  it('retains a selected bound tier when a device-only record also exists', async () => {
    setNativeSeedTier('biometric');
    render(<BackupPage onBack={vi.fn()}/>);
    await revealWords();
    expect(fixtures.biometricRetrieve).toHaveBeenCalledOnce();
    expect(fixtures.deviceRetrieve).not.toHaveBeenCalled();
  });

  it('rejects a selected stored seed whose public identity differs from the active wallet', async () => {
    fixtures.factory.mockReturnValue({
      breezSigner: {free: vi.fn()},
      sparkSigner: {getIdentityPublicKey: vi.fn(async () => ({bytes: [3, ...Array(32).fill(34)]})), free: vi.fn()},
      free: vi.fn(),
    });
    render(<BackupPage onBack={vi.fn()}/>);
    await screen.findByText('Stored seed does not match the connected wallet');
    expect(fixtures.biometricRetrieve).not.toHaveBeenCalled();
    expect(screen.queryByText('Recovery Phrase')).toBeNull();
  });

  it('does not accept words-only verification for a passphrase-dependent wallet', async () => {
    const confirmed = vi.fn();
    fixtures.deviceRetrieve.mockResolvedValue({type: 'mnemonic', mnemonic: fixtures.phrase, passphrase: 'original passphrase'});
    render(<BackupPage onBack={vi.fn()} onRecoveryConfirmed={confirmed}/>);
    await screen.findByText('Words alone cannot recover this wallet. Its original mnemonic passphrase is also required.');
    expect(screen.queryByText('Recovery Phrase')).toBeNull();
    expect(confirmed).not.toHaveBeenCalled();
    expect(fixtures.biometricRetrieve).not.toHaveBeenCalled();
  });

  it('keeps presence errors visible without falling back to legacy or another tier', async () => {
    fixtures.deviceHasSeed.mockRejectedValue(new Error('Presence is unknown'));
    render(<BackupPage onBack={vi.fn()}/>);
    await screen.findByText('Presence is unknown');
    expect(fixtures.deviceRetrieve).not.toHaveBeenCalled();
    expect(fixtures.biometricRetrieve).not.toHaveBeenCalled();
    expect(screen.queryByText('Recovery Phrase')).toBeNull();
  });
});

describe('backup language and recovery-word order', () => {
  it('shows the backup recommendation and privacy actions in the selected language', async () => {
    setAppLanguage('hi');
    render(<BackupPage onBack={vi.fn()}/>);
    const text = backupSetupCopy('hi');
    expect(screen.getByRole('heading', {name: 'पैसे जोड़ने से पहले बैकअप बनाएँ'})).toBeVisible();
    const reveal = await screen.findByRole('button', {name: text.reveal});
    expect(reveal).toBeDisabled();
    fireEvent.click(screen.getByRole('checkbox', {name: text.privateCheck}));
    fireEvent.click(screen.getByRole('checkbox', {name: text.paperCheck}));
    fireEvent.click(reveal);
    expect(screen.getByText(text.phrase)).toBeVisible();
    expect(screen.getByRole('button', {name: text.check})).toBeDisabled();
  });

  it('keeps recovery words in their original order in an Arabic interface', async () => {
    setAppLanguage('ar');
    render(<BackupPage onBack={vi.fn()}/>);
    const text = backupSetupCopy('ar');
    const reveal = await screen.findByRole('button', {name: text.reveal});
    fireEvent.click(screen.getByRole('checkbox', {name: text.privateCheck}));
    fireEvent.click(screen.getByRole('checkbox', {name: text.paperCheck}));
    fireEvent.click(reveal);
    const words = screen.getByTestId('recovery-word-grid');
    expect(words).toHaveAttribute('dir', 'ltr');
    expect(words.children[0]).toHaveTextContent(/^1\.\s*abandon$/);
    expect(words.children[11]).toHaveTextContent(/^12\.\s*about$/);
    fireEvent.click(screen.getByRole('checkbox', {name: text.handwritten}));
    fireEvent.click(screen.getByRole('button', {name: text.check}));
    expect(screen.queryByTestId('recovery-word-grid')).toBeNull();
    expect(screen.getByLabelText('الكلمة 1')).toHaveAttribute('dir', 'ltr');
    expect(screen.getByLabelText('الكلمة 12')).toHaveAttribute('dir', 'ltr');
  });
});

describe('backup PIN-policy and native read readiness', () => {
  it('keeps unreadable PIN policy locked with recovery guidance and a fresh retry', async () => {
    fixtures.appLockSupported.mockReturnValue(true);
    fixtures.pinEnabled.mockRejectedValueOnce(new Error('PIN settings could not be verified. Your wallet is preserved.'));
    render(<BackupPage onBack={vi.fn()}/>);
    await screen.findByText('Backup is locked');
    expect(screen.getByRole('alert')).toHaveTextContent('Your wallet is preserved');
    expect(fixtures.deviceRetrieve).not.toHaveBeenCalled();
    expect(fixtures.biometricRetrieve).not.toHaveBeenCalled();
    expect(fixtures.signIn).not.toHaveBeenCalled();
    expect(screen.queryByText('Recovery Phrase')).toBeNull();
    fixtures.pinEnabled.mockResolvedValue(true);
    fireEvent.click(screen.getByRole('button', {name: 'Retry'}));
    await screen.findByRole('button', {name: 'Unlock Backup'});
    expect(fixtures.deviceRetrieve).not.toHaveBeenCalled();
  });

  it('does not read PIN policy or seeds while native authorization is locked', async () => {
    fixtures.native.mockReturnValue(true);
    fixtures.appLockSupported.mockReturnValue(true);
    lockNativeReadAccess();
    render(<BackupPage onBack={vi.fn()}/>);
    await screen.findByText('Backup is locked');
    expect(fixtures.pinEnabled).not.toHaveBeenCalled();
    expect(fixtures.deviceRetrieve).not.toHaveBeenCalled();
    expect(fixtures.biometricRetrieve).not.toHaveBeenCalled();
    expect(fixtures.signIn).not.toHaveBeenCalled();
  });

  it('clears revealed words and privacy acknowledgements when native access locks', async () => {
    fixtures.native.mockReturnValue(true);
    fixtures.deviceSupported.mockReturnValue(true);
    fixtures.deviceHasSeed.mockResolvedValue(true);
    render(<BackupPage onBack={vi.fn()}/>);
    await waitFor(() => expect(fixtures.deviceRetrieve).toHaveBeenCalledOnce());
    await revealWords();
    expect(screen.getAllByText('abandon')).toHaveLength(11);
    act(() => { lockNativeReadAccess(); });
    await screen.findByText('Backup is locked');
    expect(screen.queryByText('Recovery Phrase')).toBeNull();
    expect(screen.queryAllByText('abandon')).toHaveLength(0);
    expect(screen.queryByRole('checkbox', {name: /I am in a private space/})).toBeNull();
  });

  it('ignores a delayed seed and an old PIN callback after native binding changes', async () => {
    fixtures.native.mockReturnValue(true);
    fixtures.appLockSupported.mockReturnValue(true);
    fixtures.pinEnabled.mockResolvedValue(true);
    fixtures.deviceSupported.mockReturnValue(true);
    fixtures.deviceHasSeed.mockResolvedValue(true);
    let finish!: (seed: {type: 'mnemonic'; mnemonic: string}) => void;
    const pending = new Promise<{type: 'mnemonic'; mnemonic: string}>(resolve => { finish = resolve; });
    fixtures.deviceRetrieve.mockReturnValueOnce(pending);
    render(<BackupPage onBack={vi.fn()}/>);
    const unlock = await screen.findByRole('button', {name: 'Unlock Backup'});
    const oldCallback = fixtures.pinCallbacks[fixtures.pinCallbacks.length - 1];
    fireEvent.click(unlock);
    await waitFor(() => expect(fixtures.deviceRetrieve).toHaveBeenCalledOnce());
    act(() => { invalidateNativeReadBinding(); });
    await screen.findByRole('button', {name: 'Unlock Backup'});
    await act(async () => { finish({type: 'mnemonic', mnemonic: fixtures.phrase}); });
    expect(screen.queryByText('Recovery Phrase')).toBeNull();
    expect(screen.queryAllByText('abandon')).toHaveLength(0);
    act(() => { oldCallback(); });
    await screen.findByText('Backup is locked');
    expect(fixtures.deviceRetrieve).toHaveBeenCalledOnce();
    expect(fixtures.biometricRetrieve).not.toHaveBeenCalled();
    expect(fixtures.signIn).not.toHaveBeenCalled();
  });
});
