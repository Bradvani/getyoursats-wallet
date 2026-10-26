import type {ReactNode} from 'react';
import {beforeEach, describe, expect, it, vi} from 'vitest';
import {fireEvent, render, screen, waitFor} from '@testing-library/react';
import BackupPage from './BackupPage';

const fixtures = vi.hoisted(() => ({
  phrase: Array(11).fill('abandon').concat('about').join(' '),
  passkey: vi.fn(),
  signIn: vi.fn(),
  appLockSupported: vi.fn(),
  pinEnabled: vi.fn(),
  captureProtection: vi.fn(),
  challenge: vi.fn(),
}));

vi.mock('../components/layout/SlideInPage', () => ({
  default: ({children, footer, onClose}: {children: ReactNode; footer?: ReactNode; onClose: () => void}) => (
    <main><button onClick={onClose}>Go Back</button>{children}<footer>{footer}</footer></main>
  ),
}));
vi.mock('../components/PinEntry', () => ({
  PinGate: ({onUnlocked}: {onUnlocked: () => void}) => <button onClick={onUnlocked}>Unlock Backup</button>,
}));
vi.mock('../components/ui', () => ({LoadingSpinner: () => <span>Loading</span>}));
vi.mock('../components/AlertCard', () => ({
  AlertCard: ({children, title}: {children: ReactNode; title: string}) => <div role="alert"><strong>{title}</strong>{children}</div>,
}));
vi.mock('@capacitor/core', () => ({Capacitor: {isNativePlatform: () => false}}));
vi.mock('@/services/appLock', () => ({
  isAppLockSupported: fixtures.appLockSupported,
  isPinEnabled: fixtures.pinEnabled,
}));
vi.mock('@/services/passkeyService', () => ({
  isPasskeyMode: fixtures.passkey,
  signInPinnedToActiveCredential: fixtures.signIn,
}));
vi.mock('@/services/secureStorage', () => ({
  deviceOnlyStorage: {isSupported: () => false, hasStoredSeed: async () => false},
  secureStorage: {isSupported: () => false, hasStoredSeed: async () => false},
  getBiometryInfo: async () => null,
}));
vi.mock('@/services/logger', () => ({logger: {warn: vi.fn(), error: vi.fn()}, LogCategory: {AUTH: 'auth'}}));
vi.mock('@/utils/screenSecurity', () => ({useScreenCaptureProtection: fixtures.captureProtection}));
vi.mock('../getyoursats/recoveryChallenge', () => ({createRecoveryChallenge: fixtures.challenge}));

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  localStorage.setItem('walletMnemonic', fixtures.phrase);
  fixtures.passkey.mockReturnValue(false);
  fixtures.appLockSupported.mockReturnValue(false);
  fixtures.pinEnabled.mockResolvedValue(false);
  fixtures.challenge.mockReset().mockReturnValue([0, 11]);
  fixtures.signIn.mockResolvedValue({wallet: {seed: {type: 'mnemonic', mnemonic: fixtures.phrase}}});
});

async function revealWords() {
  const reveal = await screen.findByRole('button', {name: /^Reveal words privately/});
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
    expect(screen.queryByRole('status', {name: 'Offline backup verification complete'})).toBeNull();
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
    expect(screen.getByRole('status', {name: 'Offline backup verification complete'})).toBeVisible();
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
    expect(screen.queryByRole('button', {name: /^Reveal words privately/})).toBeNull();
    expect(screen.queryByRole('button', {name: 'Check My Handwritten Backup'})).toBeNull();
    fireEvent.click(unlock);
    await screen.findByRole('button', {name: /^Reveal words privately/});
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
    const keep = screen.getByRole('button', {name: 'Keep Using My Passkey'});
    expect(keep).toBeDisabled();
    expect(screen.getByText('My wallet')).toBeVisible();
    expect(screen.getByText(/cannot verify that your passkey has synced/)).toBeVisible();
    expect(fixtures.signIn).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('checkbox', {name: /I know which password manager and account/}));
    expect(confirmed).not.toHaveBeenCalled();
    fireEvent.click(keep);
    expect(confirmed).toHaveBeenCalledExactlyOnceWith('passkey-reviewed');
    expect(screen.getByRole('status')).toHaveTextContent('Passkey recovery reviewed');
    expect(screen.queryByText(/Offline backup verified/)).toBeNull();
    expect(screen.queryByText(/Passkey Protected/)).toBeNull();
    expect(fixtures.signIn).not.toHaveBeenCalled();
  });

  it('leaving or checking only the acknowledgement never records completion', () => {
    const confirmed = vi.fn();
    const back = vi.fn();
    render(<BackupPage onBack={back} onRecoveryConfirmed={confirmed}/>);
    fireEvent.click(screen.getByRole('checkbox', {name: /I know which password manager and account/}));
    fireEvent.click(screen.getByRole('button', {name: 'Go Back'}));
    expect(back).toHaveBeenCalledOnce();
    expect(confirmed).not.toHaveBeenCalled();
    expect(fixtures.signIn).not.toHaveBeenCalled();
  });

  it('preserves pinned passkey reveal and allows a separately verified independent backup', async () => {
    const confirmed = vi.fn();
    render(<BackupPage onBack={vi.fn()} recoveryStatus="passkey-reviewed" onRecoveryConfirmed={confirmed}/>);
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
    expect(screen.queryByRole('button', {name: 'Keep Using My Passkey'})).toBeNull();
    fireEvent.click(screen.getByRole('button', {name: 'Done'}));
    await waitFor(() => expect(confirmed).not.toHaveBeenCalled());
    expect(fixtures.signIn).not.toHaveBeenCalled();
  });
});
