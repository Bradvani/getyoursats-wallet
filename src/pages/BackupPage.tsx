import React, { useEffect, useState } from 'react';
import { WarningIcon, EyeIcon, EyeOffIcon } from '../components/Icons';
import { Capacitor } from '@capacitor/core';
import SlideInPage from '../components/layout/SlideInPage';
import { PinGate } from '../components/PinEntry';
import { LoadingSpinner } from '../components/ui';
import { PrimaryButton, SecondaryButton } from '../components/ui/buttons';
import { FIELD_BASE_CLASS } from '../components/ui/forms';
import { AlertCard } from '../components/AlertCard';
import { createRecoveryChallenge, type RecoveryChallenge } from '../getyoursats/recoveryChallenge';
import { isAppLockSupported, isPinEnabled } from '@/services/appLock';
import {
  isPasskeyMode,
  signInPinnedToActiveCredential,
} from '@/services/passkeyService';
import { deviceOnlyStorage, secureStorage, getBiometryInfo, BiometryInfo } from '@/services/secureStorage';
import { logger, LogCategory } from '@/services/logger';
import { useScreenCaptureProtection } from '@/utils/screenSecurity';

interface BackupPageProps {
  onBack: () => void;
  /** 'back' when opened via drill-in nav from Settings. */
  closeStyle?: 'close' | 'back';
  recoveryStatus?: 'pending' | 'passkey-reviewed' | 'phrase-verified';
  onRecoveryConfirmed?: (status: 'passkey-reviewed' | 'phrase-verified') => void;
}

const BackupPage: React.FC<BackupPageProps> = ({
  onBack, closeStyle = 'close', recoveryStatus = 'pending', onRecoveryConfirmed,
}) => {
  const [mnemonic, setMnemonic] = useState<string | null>(null);
  const [isRevealed, setIsRevealed] = useState(false);
  const [privateViewing, setPrivateViewing] = useState(false);
  const [paperReady, setPaperReady] = useState(false);
  const canReveal = privateViewing && paperReady;
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [stage, setStage] = useState<'view' | 'verify' | 'complete'>('view');
  const [passkeyAcknowledged, setPasskeyAcknowledged] = useState(false);
  const [passkeyReviewConfirmed, setPasskeyReviewConfirmed] = useState(false);
  const [handwritten, setHandwritten] = useState(false);
  const [challenge, setChallenge] = useState<RecoveryChallenge | null>(null);
  const [answers, setAnswers] = useState<[string, string]>(['', '']);
  const [verificationError, setVerificationError] = useState('');
  const passkeyReviewed = recoveryStatus === 'passkey-reviewed' || passkeyReviewConfirmed;
  const phraseVerified = recoveryStatus === 'phrase-verified' || stage === 'complete';

  // App-lock gate at page entry: Backup opens directly from Settings,
  // so when a PIN is set the phrase must sit behind the same gate the
  // Lock Screen settings use. 'checking' avoids a one-frame content
  // flash while the async PIN read resolves; web has no app lock, so
  // it opens synchronously (no spinner flash).
  const [gate, setGate] = useState<'checking' | 'locked' | 'open'>(
    () => (isAppLockSupported() ? 'checking' : 'open'),
  );
  useEffect(() => {
    if (gate !== 'checking') return;
    let cancelled = false;
    void isPinEnabled().then((pin) => {
      if (!cancelled) setGate(pin ? 'locked' : 'open');
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- run once at mount
  }, []);

  // Block screen capture for the whole Backup screen, from mount, so
  // protection is already active before the seed can render (the native
  // toggle is async: gating on the loaded seed left a few unprotected
  // frames on reveal). Generate deliberately does not protect.
  useScreenCaptureProtection(true);

  const isPasskey = isPasskeyMode();
  const passkeyLabel = isPasskey ? localStorage.getItem('passkeyLabel') ?? 'Default' : null;

  // Non-passkey wallet whose seed sits in the biometric-bound tier
  // (biometric unlock enabled in Security settings). Reveal requires
  // an OS biometric prompt instead of the silent device-only read.
  const [biometricSeedPresent, setBiometricSeedPresent] = useState(false);

  // Set when the phrase came from the device-only vault rather than a
  // passkey ceremony, so Hide doesn't drop a seed that costs nothing to
  // read back.
  const [seedFromVault, setSeedFromVault] = useState(false);

  useEffect(() => {
    // Hold the silent seed read until the gate passes so the phrase
    // never sits in memory behind a locked pad.
    if (gate !== 'open') return;
    let cancelled = false;
    (async () => {
      // The device-only tier carries no auth binding, so once the gate
      // has passed there is nothing left to authenticate against: read
      // it for passkey accounts too rather than charging a ceremony for
      // a phrase the OS already hands over.
      if (deviceOnlyStorage.isSupported() && (await deviceOnlyStorage.hasStoredSeed())) {
        try {
          const seed = await deviceOnlyStorage.retrieveSeed();
          if (cancelled) return;
          if (seed.type === 'mnemonic') {
            setMnemonic(seed.mnemonic);
            setSeedFromVault(true);
            return;
          }
        } catch (e) {
          logger.warn(LogCategory.AUTH, 'Failed to read mnemonic from device-only storage', {
            error: e instanceof Error ? e.message : String(e),
          });
        }
      }
      // Remaining tiers are mnemonic-only: a passkey account with no
      // device-only copy falls through to the ceremony below.
      if (cancelled || isPasskey) return;
      // Legacy biometric-bound seed (pre-migration install). Don't read
      // it here (that would fire an OS prompt at page mount); flag it
      // so the reveal tile triggers the prompt on tap.
      if (secureStorage.isSupported() && (await secureStorage.hasStoredSeed())) {
        if (!cancelled) setBiometricSeedPresent(true);
        return;
      }
      if (cancelled) return;
      setMnemonic(localStorage.getItem('walletMnemonic'));
    })();
    return () => {
      cancelled = true;
    };
  }, [isPasskey, gate]);

  // Tracks whether passkey-based reveal failed once, so we can offer a
  // secureStorage fallback button in the error UI. Only reached when no
  // device-only copy exists (web, or a native install whose persist
  // failed): the biometric-bound tier still stays behind an explicit
  // tap, so a deleted or corrupt passkey surfaces instead of being
  // silently papered over.
  const [passkeyAttemptFailed, setPasskeyAttemptFailed] = useState(false);

  // Passkey mode: once the passkey attempt fails, resolve which vault
  // tier holds the cached seed. Drives the fallback tile's copy
  // (biometric prompt vs silent read) and its very existence: with
  // no cached seed in either tier the tile would be a dead button.
  // null = still probing.
  const [fallbackTier, setFallbackTier] = useState<'biometric' | 'device' | 'none' | null>(null);
  useEffect(() => {
    if (!isPasskey || !passkeyAttemptFailed || !secureStorage.isSupported()) return;
    let cancelled = false;
    void (async () => {
      const tier = (await secureStorage.hasStoredSeed().catch(() => false))
        ? 'biometric' as const
        : (await deviceOnlyStorage.hasStoredSeed().catch(() => false))
          ? 'device' as const
          : 'none' as const;
      if (!cancelled) setFallbackTier(tier);
    })();
    return () => { cancelled = true; };
  }, [isPasskey, passkeyAttemptFailed]);

  // Resolved at mount: label ('Face ID', 'Touch ID', 'fingerprint'…)
  // for the fallback tiles' copy, kind ('face' | 'fingerprint') for
  // their icon. Null on web or when no biometry is enrolled; the copy
  // degrades gracefully and the icon falls back to fingerprint.
  const [biometry, setBiometry] = useState<BiometryInfo | null>(null);
  useEffect(() => {
    let cancelled = false;
    getBiometryInfo().then((info) => {
      if (!cancelled) setBiometry(info);
    });
    return () => { cancelled = true; };
  }, []);

  const handleRevealPasskey = async () => {
    setIsLoading(true);
    setError(null);
    try {
      // Resolve the active label from the localStorage `passkeyLabel`
      // key so the SDK derives the right wallet for this device.
      const effectiveLabel = localStorage.getItem('passkeyLabel') ?? undefined;
      // Pinned to the active credential so Backup can only ever reveal the
      // recovery phrase for the currently logged-in passkey: an empty
      // allowCredentials would let the OS substitute a sibling cred and
      // derive a different wallet's seed.
      const response = await signInPinnedToActiveCredential(effectiveLabel);
      const w = response.wallet;
      if (w.seed.type === 'mnemonic' && w.seed.mnemonic) {
        setMnemonic(w.seed.mnemonic);
        setIsRevealed(true);
      } else {
        setError('Could not derive recovery phrase');
        setPasskeyAttemptFailed(true);
      }
    } catch (e) {
      logger.error(LogCategory.AUTH, 'Failed to derive mnemonic from passkey', {
        error: e instanceof Error ? e.message : String(e),
      });
      setError(e instanceof Error ? e.message : 'Failed to authenticate');
      setPasskeyAttemptFailed(true);
    } finally {
      setIsLoading(false);
    }
  };

  // Fallback path: read the cached seed from the given vault tier
  // (legacy biometric-bound prompts, device-only is silent). For
  // passkey wallets this only surfaces after the passkey path failed,
  // so intact passkeys never bypass the ceremony.
  const revealFromVault = async (tier: 'biometric' | 'device') => {
    setIsLoading(true);
    setError(null);
    try {
      const store = tier === 'biometric' ? secureStorage : deviceOnlyStorage;
      const seed = await store.retrieveSeed();
      if (seed.type === 'mnemonic' && seed.mnemonic) {
        setMnemonic(seed.mnemonic);
        setIsRevealed(true);
      } else {
        setError('Could not retrieve recovery phrase');
      }
    } catch (e) {
      logger.error(LogCategory.AUTH, 'Biometric fallback retrieveSeed failed', {
        error: e instanceof Error ? e.message : String(e),
      });
      setError(e instanceof Error ? e.message : 'Failed to authenticate');
    } finally {
      setIsLoading(false);
    }
  };

  const handleHide = () => {
    setIsRevealed(false);
    setPrivateViewing(false);
    setPaperReady(false);
    setHandwritten(false);
    setAnswers(['', '']);
    setVerificationError('');
    if (isPasskey && !seedFromVault) {
      setMnemonic(null);
      setPasskeyAttemptFailed(false);
      setError(null);
    }
  };

  const words = mnemonic ? mnemonic.split(' ') : [];

  const reviewPasskey = () => {
    if (gate !== 'open' || !isPasskey || !passkeyAcknowledged || phraseVerified || passkeyReviewed) return;
    setPasskeyReviewConfirmed(true);
    onRecoveryConfirmed?.('passkey-reviewed');
  };

  const beginVerification = () => {
    if (gate !== 'open' || !isRevealed || !mnemonic || !handwritten) return;
    try {
      setChallenge(createRecoveryChallenge(words.length, challenge ?? undefined));
      setAnswers(['', '']);
      setVerificationError('');
      setIsRevealed(false);
      setStage('verify');
    } catch {
      setVerificationError('Could not start the backup check. Hide the words and try again.');
    }
  };

  const cancelVerification = () => {
    handleHide();
    setStage('view');
  };

  const verifyBackup = () => {
    if (gate !== 'open' || stage !== 'verify' || !challenge || !mnemonic) return;
    if (answers.some((answer, index) => answer.trim().toLowerCase() !== words[challenge[index]])) {
      setVerificationError('Those words do not match. Check your handwritten backup and try again.');
      return;
    }
    setAnswers(['', '']);
    setVerificationError('');
    setMnemonic(null);
    setPrivateViewing(false);
    setPaperReady(false);
    setHandwritten(false);
    setStage('complete');
    onRecoveryConfirmed?.('phrase-verified');
  };

  const closeBackup = () => {
    setAnswers(['', '']);
    setMnemonic(null);
    setIsRevealed(false);
    onBack();
  };

  const footer = gate !== 'open' ? undefined : stage === 'verify' ? (
    <div className="space-y-2">
      <PrimaryButton className="w-full" disabled={!answers[0].trim() || !answers[1].trim()}
        onClick={verifyBackup}>Verify Offline Backup</PrimaryButton>
      <SecondaryButton className="w-full" onClick={cancelVerification}>Return to Backup</SecondaryButton>
    </div>
  ) : stage === 'complete' ? (
    <PrimaryButton className="w-full" onClick={closeBackup}>Done</PrimaryButton>
  ) : isRevealed && mnemonic ? (
    <PrimaryButton className="w-full" disabled={!handwritten} onClick={beginVerification}>
      Check My Handwritten Backup
    </PrimaryButton>
  ) : isPasskey && !passkeyReviewed && !phraseVerified ? (
    <PrimaryButton className="w-full" disabled={!passkeyAcknowledged} onClick={reviewPasskey}>
      Keep Using My Passkey
    </PrimaryButton>
  ) : passkeyReviewed || phraseVerified ? (
    <PrimaryButton className="w-full" onClick={closeBackup}>Done</PrimaryButton>
  ) : undefined;

  return (
    <SlideInPage title="Backup" onClose={closeBackup} slideFrom="left" closeStyle={closeStyle} footer={footer}>
      {/* min-h-full + flexed chain so the PIN gate (the sole child
          while it shows) can split the viewport 1/3 header / 2/3
          input; the card views flow from the top as before. */}
      <div className="p-4 min-h-full flex flex-col">
        <div className="max-w-xl mx-auto w-full space-y-6 flex-1 flex flex-col">
          {gate === 'checking' && (
            <div className="flex justify-center py-16">
              <LoadingSpinner size="small" />
            </div>
          )}

          {gate === 'locked' && (
            <PinGate reason="Unlock Backup" onUnlocked={() => setGate('open')} />
          )}

          {gate === 'open' && stage === 'complete' && (
            <section className="rounded-2xl border border-spark-border bg-spark-dark p-5 space-y-3"
              role="status" aria-label="Offline backup verification complete">
              <h2 className="font-display text-lg font-semibold text-spark-text-primary">Offline backup verified</h2>
              <p className="text-sm text-spark-text-secondary">
                Your two-word check is complete. Keep the full handwritten phrase somewhere secure and separate from your device.
              </p>
              <p className="text-xs text-spark-text-muted">Your recovery words were checked on this device and were not sent anywhere.</p>
            </section>
          )}

          {gate === 'open' && stage === 'verify' && (
            <section className="rounded-2xl border border-spark-border bg-spark-dark p-5 space-y-5"
              aria-label="Verify handwritten backup">
              <div className="space-y-2">
                <h2 className="font-display text-lg font-semibold text-spark-text-primary">Check your handwritten backup</h2>
                <p className="text-sm text-spark-text-secondary">Your recovery words are hidden. Enter the two requested words from your offline copy.</p>
              </div>
              {challenge?.map((position, index) => (
                <label key={position} className="block space-y-2">
                  <span className="text-sm font-medium text-spark-text-secondary">Word {position + 1}</span>
                  <input type="text" autoComplete="off" autoCapitalize="none" autoCorrect="off" spellCheck={false}
                    className={`${FIELD_BASE_CLASS} p-3`} value={answers[index]}
                    onChange={event => {
                      setAnswers(previous => index === 0 ? [event.target.value, previous[1]] : [previous[0], event.target.value]);
                      setVerificationError('');
                    }}/>
                </label>
              ))}
              {verificationError && <AlertCard variant="error" title="Try again">{verificationError}</AlertCard>}
              <p className="text-xs text-spark-text-muted">This check happens only on your device.</p>
            </section>
          )}

          {gate === 'open' && stage === 'view' && (
          <>
          {isPasskey && (
            <section className="bg-spark-dark border border-spark-border rounded-2xl p-5 space-y-3"
              aria-label="Passkey recovery review">
              <h2 className="font-display font-semibold text-spark-text-primary">Know how to recover with your passkey</h2>
              <p className="text-spark-text-secondary text-sm">
                On another compatible device, use the same passkey and wallet label: <strong>{passkeyLabel}</strong>.
                {' '}Keep access to the password manager and account where you saved that passkey.
              </p>
              <p className="text-spark-text-muted text-sm">
                GetYourSats cannot verify that your passkey has synced. Syncing and account recovery depend on your provider.
              </p>
              {!passkeyReviewed && !phraseVerified ? (
                <label className="flex min-h-11 items-start gap-3 text-sm text-spark-text-secondary">
                  <input type="checkbox" checked={passkeyAcknowledged}
                    onChange={event => setPasskeyAcknowledged(event.target.checked)} className="mt-1 accent-spark-primary"/>
                  <span>I know which password manager and account hold my passkey, and I understand I need the same passkey and wallet label to recover this wallet.</span>
                </label>
              ) : passkeyReviewed && !phraseVerified ? (
                <p className="text-sm font-medium text-spark-text-primary" role="status">Passkey recovery reviewed</p>
              ) : null}
              <p className="text-spark-text-muted text-sm">
                A handwritten recovery phrase is an optional, independent backup. You can create and check that copy below when you are somewhere private.
              </p>
            </section>
          )}

          {phraseVerified && <p className="rounded-xl border border-spark-border bg-spark-dark p-4 text-sm text-spark-text-primary"
            role="status">Offline backup verified on this device</p>}


          {!isPasskey && mnemonic && !Capacitor.isNativePlatform() && (
            <aside className="rounded-xl border border-spark-border bg-spark-dark p-4 space-y-2" aria-label="Browser wallet recovery guidance">
              <p className="text-sm font-medium text-spark-text-primary">Keep your recovery words private</p>
              <p className="text-sm text-spark-text-secondary">
                Anyone who sees these words can control your wallet. Use a secure, offline backup before adding real funds.
              </p>
              <details className="text-xs text-spark-text-muted">
                <summary className="cursor-pointer font-medium text-spark-text-secondary">About browser storage</summary>
                <p className="mt-2 leading-relaxed">
                  Browser extensions or a compromised website may be able to expose recovery words stored in a browser.
                  Avoid untrusted extensions and do not store your phrase in screenshots, cloud notes or messages.
                </p>
              </details>
            </aside>
          )}

          {!isRevealed && <section aria-label="Private recovery phrase viewing checklist"
            className="rounded-2xl border border-spark-border bg-spark-dark p-5 space-y-3">
            <h3 className="font-semibold text-spark-text-primary">Before you view recovery words</h3>
            <p className="text-sm text-spark-text-secondary">
              The phrase is hidden by default. {isPasskey
                ? 'A handwritten copy is optional for passkey wallets, but can provide another recovery path.'
                : 'For a recovery-word wallet, these are the words that restore access to your funds.'}
              {' '}Never photograph or share them.
            </p>
            <label className="flex items-start gap-3 text-sm text-spark-text-secondary">
              <input type="checkbox" checked={privateViewing} onChange={e=>setPrivateViewing(e.target.checked)}
                className="mt-1 accent-spark-primary"/>
              <span>I am in a private space away from cameras or people who could read my screen.</span>
            </label>
            <label className="flex items-start gap-3 text-sm text-spark-text-secondary">
              <input type="checkbox" checked={paperReady} onChange={e=>setPaperReady(e.target.checked)}
                className="mt-1 accent-spark-primary"/>
              <span>I understand these words control my wallet, and I will never screenshot, store online or share them.</span>
            </label>
            {!canReveal && <p className="text-xs text-spark-text-muted">Complete both checks to enable viewing.</p>}
          </section>}

          {/* Reveal button (passkey mode, happy path). After a failed
              passkey attempt, the fallback card below replaces this
              one and folds the error + Face ID retry into one tile. */}
          {isPasskey && !isRevealed && !mnemonic && !passkeyAttemptFailed && (
            <button
              onClick={handleRevealPasskey}
              disabled={isLoading || !canReveal}
              className="w-full bg-spark-dark border border-spark-border rounded-2xl p-8 flex flex-col items-center gap-4 hover:border-spark-border-light transition-colors disabled:opacity-50"
            >
              <span className="font-display font-semibold text-spark-text-primary">
                <span className="inline-flex items-center gap-2"><EyeIcon size="sm"/> {isLoading ? 'Authenticating...' : 'Reveal words privately'}</span>
              </span>
              <span className="text-sm text-spark-text-muted">
                {isLoading ? 'Complete passkey authentication' : 'Requires passkey authentication'}
              </span>
            </button>
          )}

          {/* Reveal button for an already-loaded phrase, whichever auth
              mode the account uses. A legacy biometric-bound seed has
              not been read yet, so that tap triggers an OS prompt
              first. App-lock protection happens at page entry via the
              PIN gate above. */}
          {!isRevealed && (mnemonic || (!isPasskey && biometricSeedPresent)) && (
            <button
              onClick={mnemonic
                ? () => setIsRevealed(true)
                : () => { void revealFromVault('biometric'); }}
              disabled={isLoading || !canReveal}
              className="w-full bg-spark-dark border border-spark-border rounded-2xl p-8 flex flex-col items-center gap-4 hover:border-spark-border-light transition-colors disabled:opacity-50"
            >
              <span className="font-display font-semibold text-spark-text-primary">
                <span className="inline-flex items-center gap-2"><EyeIcon size="sm"/> {isLoading ? 'Authenticating...' : 'Reveal words privately'}</span>
              </span>
              <span className="text-sm text-spark-text-muted">
                {mnemonic
                  ? 'Make sure no one is watching'
                  : isLoading
                    ? `Complete ${biometry?.label ?? 'biometric'} authentication`
                    : `Requires ${biometry?.label ?? 'biometric authentication'}`}
              </span>
            </button>
          )}

          {/* Mnemonic-mode error: passkey-mode errors are now folded
              into the fallback card below, so this only renders for
              non-passkey edge cases. */}
          {error && !isPasskey && (
            <div className="bg-spark-warn-surface border border-spark-warn-border rounded-xl p-4 text-center">
              <p className="text-spark-warn-text text-sm">{error}</p>
            </div>
          )}

          {/* Biometric fallback (passkey only, native). Single card that
              replaces both the original reveal tile and the error
              banner once the passkey attempt has failed. Visually
              mirrors the happy-path tile: same title, swap the
              "Requires passkey authentication" subtitle for "Requires
              {biometric}". The label-driven biometric naming matches
              the convention used elsewhere (UnlockPage). */}
          {isPasskey && passkeyAttemptFailed && !isRevealed && !mnemonic
            && (fallbackTier === 'biometric' || fallbackTier === 'device') && (
            <button
              onClick={() => { if (canReveal) void revealFromVault(fallbackTier); }}
              disabled={isLoading || !canReveal}
              className="w-full bg-spark-dark border border-spark-border rounded-2xl p-8 flex flex-col items-center gap-4 hover:border-spark-border-light transition-colors disabled:opacity-50"
            >
              <span className="font-display font-semibold text-spark-text-primary">
                <span className="inline-flex items-center gap-2"><EyeIcon size="sm"/> {isLoading ? 'Authenticating...' : 'Reveal words privately'}</span>
              </span>
              <span className="text-sm text-spark-text-muted">
                {fallbackTier === 'device'
                  ? 'Stored securely on this device'
                  : isLoading
                    ? `Complete ${biometry?.label ?? 'biometric'} authentication`
                    : `Requires ${biometry?.label ?? 'biometric authentication'}`}
              </span>
            </button>
          )}

          {/* Dead-end card (passkey mode): web has no cached copy at
              all, and a native install can lack one too (persist
              failed, vault cleared). Without it the fallback tile
              would be a button that always errors. */}
          {isPasskey && passkeyAttemptFailed && !isRevealed && !mnemonic
            && (!secureStorage.isSupported() || fallbackTier === 'none') && (
            <div className="bg-spark-dark border border-spark-border rounded-2xl p-8 text-center">
              <div className="w-16 h-16 rounded-2xl bg-spark-primary/20 flex items-center justify-center mx-auto mb-4">
                <WarningIcon size="xl" className="text-spark-primary" />
              </div>
              <h3 className="font-display font-semibold text-spark-text-primary mb-2">Passkey Unavailable</h3>
              <p className="text-spark-text-muted text-sm">
                Your recovery phrase is derived from your passkey. Without it, the phrase cannot be retrieved on this device. Sign in on a device where the passkey is still available to view it.
              </p>
            </div>
          )}

          {/* Mnemonic word grid (shared) */}
          {isRevealed && mnemonic && (
            <div className="bg-spark-dark border border-spark-border rounded-2xl p-4 space-y-4">
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium text-spark-text-secondary">Recovery Phrase</span>
                <div className="flex items-center gap-2">
                  <button
                    onClick={handleHide}
                    aria-label="Hide recovery words"
                    className="px-3 py-1.5 text-sm font-medium text-spark-text-muted hover:text-spark-text-primary border border-spark-border rounded-lg hover:bg-white/5 transition-colors"
                  >
                    <span className="inline-flex items-center gap-2"><EyeOffIcon size="sm"/> Hide words</span>
                  </button>

                </div>
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                {words.map((word, index) => (
                  <div
                    key={index}
                    className="flex items-center gap-2 bg-spark-surface rounded-lg px-3 py-2"
                  >
                    <span className="text-spark-text-muted text-xs font-mono w-5 text-right">
                      {index + 1}.
                    </span>
                    <span className="text-spark-text-primary font-mono text-sm font-medium">
                      {word}
                    </span>
                  </div>
                ))}
              </div>
              <label className="flex min-h-11 items-start gap-3 border-t border-spark-border pt-4 text-sm text-spark-text-secondary">
                <input type="checkbox" checked={handwritten} onChange={event => setHandwritten(event.target.checked)}
                  className="mt-1 accent-spark-primary"/>
                <span>I have written down every word in order and kept the copy offline in a secure, private place.</span>
              </label>
              {verificationError && <AlertCard variant="error" title="Backup check unavailable">{verificationError}</AlertCard>}
            </div>
          )}

          {/* No backup found (mnemonic mode only) */}
          {!isPasskey && !mnemonic && !biometricSeedPresent && (
            <div className="bg-spark-dark border border-spark-border rounded-2xl p-8 text-center">
              <div className="w-16 h-16 rounded-2xl bg-spark-primary/20 flex items-center justify-center mx-auto mb-4">
                <WarningIcon size="xl" className="text-spark-primary" />
              </div>
              <h3 className="font-display font-semibold text-spark-text-primary mb-2">No Backup Found</h3>
              <p className="text-spark-text-muted text-sm">
                Could not find a recovery phrase for this wallet.
              </p>
            </div>
          )}
          </>
          )}
        </div>
      </div>
    </SlideInPage>
  );
};

export default BackupPage;
