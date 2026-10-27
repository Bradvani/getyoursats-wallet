import {getUnlockedWebMnemonic} from '../security/webWalletVault';
import React, { useEffect, useRef, useState } from 'react';
import { EyeIcon, EyeOffIcon } from '../components/Icons';
import { Capacitor } from '@capacitor/core';
import type { Seed } from '@breeztech/breez-sdk-spark';
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
import { secureStorage } from '@/services/secureStorage';
import { chooseNativeSeedTier, readSeedForActiveNativeWallet, readSelectedNativeSeed } from '@/services/nativeSeedSelection';
import { assertNativeReadLease, captureNativeReadLease, getNativeReadLeaseRevision, subscribeNativeReadLease, type NativeReadLease } from '@/services/nativeReadLease';
import { logger, LogCategory } from '@/services/logger';
import { useScreenCaptureProtection } from '@/utils/screenSecurity';
import { usePresentation } from '@/hooks/usePresentation';
import { backupSetupCopy } from '@/locales/backupSetup';

interface BackupPageProps {
  onBack: () => void;
  /** 'back' when opened via drill-in nav from Settings. */
  closeStyle?: 'close' | 'back';
  recoveryStatus?: 'pending' | 'passkey-reviewed' | 'phrase-verified';
  onRecoveryConfirmed?: (status: 'passkey-reviewed' | 'phrase-verified') => void;
}

function mnemonicForBackup(seed: Seed): string {
  if (seed.type !== 'mnemonic' || !seed.mnemonic) throw new Error('Could not retrieve this wallet\'s recovery phrase');
  if (seed.passphrase !== undefined && seed.passphrase !== null && seed.passphrase !== '') {
    throw new Error('Words alone cannot recover this wallet. Its original mnemonic passphrase is also required.');
  }
  return seed.mnemonic;
}

const BackupPage: React.FC<BackupPageProps> = ({
  onBack, closeStyle = 'close', recoveryStatus = 'pending', onRecoveryConfirmed,
}) => {
  const {language} = usePresentation();
  const text = backupSetupCopy(language);
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
  const [gate, setGate] = useState<'checking' | 'locked' | 'open' | 'unavailable'>(
    () => (isAppLockSupported() ? 'checking' : 'open'),
  );
  const [readRevision, setReadRevision] = useState(getNativeReadLeaseRevision);
  const [gateLease, setGateLease] = useState<NativeReadLease | null>(null);
  const generation = useRef(0);

  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return;
    const unsubscribe = subscribeNativeReadLease(() => {
      generation.current += 1;
      setGateLease(null);
      setMnemonic(null);
      setIsRevealed(false);
      setIsLoading(false);
      setPrivateViewing(false);
      setPaperReady(false);
      setHandwritten(false);
      setAnswers(['', '']);
      setStage('view');
      setGate('checking');
      setReadRevision(getNativeReadLeaseRevision());
    });
    return () => { generation.current += 1; unsubscribe(); };
  }, []);

  useEffect(() => {
    if (gate !== 'checking') return;
    let cancelled = false;
    void (async () => {
      const lease = Capacitor.isNativePlatform() ? captureNativeReadLease() : null;
      const pin = await isPinEnabled();
      if (cancelled) return;
      if (lease !== null) assertNativeReadLease(lease);
      setGateLease(lease);
      setError(null);
      setGate(pin ? 'locked' : 'open');
    })().catch(e => {
      if (cancelled) return;
      setGateLease(null);
      setError(e instanceof Error ? e.message : 'PIN settings could not be verified. Your wallet data is preserved.');
      setGate('unavailable');
    });
    return () => {
      cancelled = true;
    };
  }, [gate, readRevision]);

  const unlockBackup = () => {
    try {
      if (Capacitor.isNativePlatform()) {
        if (gateLease === null) throw new Error('Unlock the wallet and retry backup.');
        assertNativeReadLease(gateLease);
      }
      setGate('open');
    } catch {
      setError('Wallet access changed. Unlock the wallet and retry backup. Saved wallet data is preserved.');
      setGate('unavailable');
    }
  };

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
      const lease = Capacitor.isNativePlatform() ? captureNativeReadLease() : null;
      // The device-only tier carries no auth binding, so once the gate
      // has passed there is nothing left to authenticate against: read
      // it for passkey accounts too rather than charging a ceremony for
      // a phrase the OS already hands over.
      const tier = await chooseNativeSeedTier();
      if (cancelled) return;
      if (tier === 'device') {
        const seed = await readSelectedNativeSeed();
        if (cancelled) return;
        if (lease !== null) assertNativeReadLease(lease);
        if (!seed) throw new Error('The selected wallet is unavailable');
        setMnemonic(mnemonicForBackup(seed));
        setSeedFromVault(true);
        return;
      }
      // Remaining tiers are mnemonic-only: a passkey account with no
      // device-only copy falls through to the ceremony below.
      if (cancelled || isPasskey) return;
      // Legacy biometric-bound seed (pre-migration install). Don't read
      // it here (that would fire an OS prompt at page mount); flag it
      // so the reveal tile triggers the prompt on tap.
      if (tier === 'biometric') {
        if (!cancelled) setBiometricSeedPresent(true);
        return;
      }
      if (cancelled) return;
      const words = getUnlockedWebMnemonic() ?? localStorage.getItem('walletMnemonic');
      if (Capacitor.isNativePlatform() && words) {
        const seed = await readSeedForActiveNativeWallet(async () => ({ type: 'mnemonic', mnemonic: words }));
        if (!cancelled) {
          if (lease !== null) assertNativeReadLease(lease);
          setMnemonic(mnemonicForBackup(seed));
        }
      } else setMnemonic(words);
    })().catch(e => {
      logger.warn(LogCategory.AUTH, 'Failed to read the selected wallet for backup', {
        error: e instanceof Error ? e.message : String(e),
      });
      if (!cancelled) setError(e instanceof Error ? e.message : 'Could not read the selected wallet');
    });
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
      const tier = await chooseNativeSeedTier();
      if (!cancelled) setFallbackTier(tier ?? 'none');
    })().catch(e => {
      if (!cancelled) {
        setFallbackTier('none');
        setError(e instanceof Error ? e.message : 'Could not check the selected wallet');
      }
    });
    return () => { cancelled = true; };
  }, [isPasskey, passkeyAttemptFailed]);

  const handleRevealPasskey = async () => {
    const started = generation.current;
    setIsLoading(true);
    setError(null);
    try {
      const lease = Capacitor.isNativePlatform() ? captureNativeReadLease() : null;
      // Resolve the active label from the localStorage `passkeyLabel`
      // key so the SDK derives the right wallet for this device.
      const effectiveLabel = localStorage.getItem('passkeyLabel') ?? undefined;
      // Pinned to the active credential so Backup can only ever reveal the
      // recovery phrase for the currently logged-in passkey: an empty
      // allowCredentials would let the OS substitute a sibling cred and
      // derive a different wallet's seed.
      const read = async () => (await signInPinnedToActiveCredential(effectiveLabel)).wallet.seed;
      const seed = Capacitor.isNativePlatform() ? await readSeedForActiveNativeWallet(read) : await read();
      if (started !== generation.current) return;
      if (lease !== null) assertNativeReadLease(lease);
      setMnemonic(mnemonicForBackup(seed));
      setIsRevealed(true);
    } catch (e) {
      if (started !== generation.current) return;
      logger.error(LogCategory.AUTH, 'Failed to derive mnemonic from passkey', {
        error: e instanceof Error ? e.message : String(e),
      });
      setError(e instanceof Error ? e.message : 'Failed to authenticate');
      setPasskeyAttemptFailed(true);
    } finally {
      if (started === generation.current) setIsLoading(false);
    }
  };

  // Fallback path: read the cached seed from the already selected vault tier
  // (legacy biometric-bound prompts, device-only is silent). For
  // passkey wallets this only surfaces after the passkey path failed,
  // so intact passkeys never bypass the ceremony.
  const revealFromVault = async () => {
    const started = generation.current;
    setIsLoading(true);
    setError(null);
    try {
      const lease = Capacitor.isNativePlatform() ? captureNativeReadLease() : null;
      const seed = await readSelectedNativeSeed();
      if (started !== generation.current) return;
      if (lease !== null) assertNativeReadLease(lease);
      if (!seed) throw new Error('The selected wallet is unavailable');
      setMnemonic(mnemonicForBackup(seed));
      setIsRevealed(true);
    } catch (e) {
      if (started !== generation.current) return;
      logger.error(LogCategory.AUTH, 'Biometric fallback retrieveSeed failed', {
        error: e instanceof Error ? e.message : String(e),
      });
      setError(e instanceof Error ? e.message : 'Failed to authenticate');
    } finally {
      if (started === generation.current) setIsLoading(false);
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
      setVerificationError(text.startFailed);
    }
  };

  const cancelVerification = () => {
    handleHide();
    setStage('view');
  };

  const verifyBackup = () => {
    if (gate !== 'open' || stage !== 'verify' || !challenge || !mnemonic) return;
    if (answers.some((answer, index) => answer.trim().toLowerCase() !== words[challenge[index]])) {
      setVerificationError(text.mismatch);
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
    generation.current += 1;
    setAnswers(['', '']);
    setMnemonic(null);
    setIsRevealed(false);
    onBack();
  };

  const phraseAvailable = Boolean(mnemonic || (!isPasskey && biometricSeedPresent) ||
    (isPasskey && (!passkeyAttemptFailed || fallbackTier === 'biometric' || fallbackTier === 'device')));
  const revealWords = () => {
    if (gate !== 'open' || !canReveal || isLoading || isRevealed) return;
    if (mnemonic) setIsRevealed(true);
    else if (isPasskey && !passkeyAttemptFailed) void handleRevealPasskey();
    else if (isPasskey && (fallbackTier === 'biometric' || fallbackTier === 'device')) void revealFromVault();
    else if (!isPasskey && biometricSeedPresent) void revealFromVault();
  };

  const footer = gate !== 'open' ? undefined : stage === 'verify' ? (
    <div className="space-y-2">
      <PrimaryButton className="w-full" disabled={!answers[0].trim() || !answers[1].trim()}
        onClick={verifyBackup}>{text.verify}</PrimaryButton>
      <SecondaryButton className="w-full" onClick={cancelVerification}>{text.return}</SecondaryButton>
    </div>
  ) : stage === 'complete' ? (
    <PrimaryButton className="w-full" onClick={closeBackup}>{text.done}</PrimaryButton>
  ) : isRevealed && mnemonic ? (
    <PrimaryButton className="w-full" disabled={!handwritten} onClick={beginVerification}>
      {text.check}
    </PrimaryButton>
  ) : phraseAvailable ? (
    <div className="space-y-2">
      <PrimaryButton className="w-full" disabled={isLoading || !canReveal} onClick={revealWords}
        aria-busy={isLoading} data-testid="backup-reveal">
        <span className="inline-flex items-center justify-center gap-2">
          <EyeIcon size="sm"/>{isLoading ? text.authenticating : text.reveal}
        </span>
      </PrimaryButton>
      {phraseVerified && <SecondaryButton className="w-full" onClick={closeBackup}>{text.done}</SecondaryButton>}
    </div>
  ) : phraseVerified ? (
    <PrimaryButton className="w-full" onClick={closeBackup}>{text.done}</PrimaryButton>
  ) : undefined;

  return (
    <SlideInPage title={text.title} onClose={closeBackup} slideFrom="left" closeStyle={closeStyle} footer={footer}>
      <div className="p-4 min-h-full flex flex-col">
        <div className="max-w-xl mx-auto w-full space-y-5 flex-1 flex flex-col">
          {gate === 'checking' && (
            <div className="flex justify-center py-16">
              <LoadingSpinner size="small" />
            </div>
          )}

          {gate === 'locked' && (
            <PinGate reason={text.unlock} onUnlocked={unlockBackup} />
          )}

          {gate === 'unavailable' && (
            <div className="space-y-4">
              <AlertCard variant="error" title="Backup is locked">
                {error ?? 'Wallet access could not be verified. Saved wallet data is preserved.'}
              </AlertCard>
              <SecondaryButton onClick={() => setGate('checking')}>Retry</SecondaryButton>
            </div>
          )}

          {gate === 'open' && stage === 'complete' && (
            <section className="rounded-2xl border border-spark-border bg-spark-dark p-5 space-y-3"
              role="status" aria-label={text.completeTitle} data-testid="backup-complete">
              <h2 className="font-display text-lg font-semibold text-spark-text-primary">{text.completeTitle}</h2>
              <p className="text-sm text-spark-text-secondary">{text.completeBody}</p>
              <p className="text-xs text-spark-text-muted">{text.completeLocal}</p>
            </section>
          )}

          {gate === 'open' && stage === 'verify' && (
            <section className="rounded-2xl border border-spark-border bg-spark-dark p-5 space-y-5"
              aria-label={text.checkTitle}>
              <div className="space-y-2">
                <h2 className="font-display text-lg font-semibold text-spark-text-primary">{text.checkTitle}</h2>
                <p className="text-sm text-spark-text-secondary">{text.checkBody}</p>
              </div>
              {challenge?.map((position, index) => (
                <label key={position} className="block space-y-2">
                  <span className="text-sm font-medium text-spark-text-secondary">{text.word} {position + 1}</span>
                  <input type="text" dir="ltr" autoComplete="off" autoCapitalize="none" autoCorrect="off" spellCheck={false}
                    className={`${FIELD_BASE_CLASS} p-3`} value={answers[index]}
                    onChange={event => {
                      setAnswers(previous => index === 0 ? [event.target.value, previous[1]] : [previous[0], event.target.value]);
                      setVerificationError('');
                    }}/>
                </label>
              ))}
              {verificationError && <AlertCard variant="error" title={text.tryAgain}>{verificationError}</AlertCard>}
              <p className="text-xs text-spark-text-muted">{text.localCheck}</p>
            </section>
          )}

          {gate === 'open' && stage === 'view' && (
            <>
              {!isRevealed && (
                <section className="rounded-2xl border border-spark-border bg-spark-dark p-5 space-y-3"
                  aria-label={phraseVerified ? text.completeTitle : text.introTitle}>
                  <h2 className="font-display text-xl font-semibold tracking-tight text-spark-text-primary">
                    {phraseVerified ? text.completeTitle : text.introTitle}
                  </h2>
                  {phraseVerified
                    ? <p className="text-sm text-spark-text-secondary" role="status">{text.verified}</p>
                    : <>
                      <p className="text-sm leading-relaxed text-spark-text-secondary">{text.introBody}</p>
                      {isPasskey && <p className="text-sm leading-relaxed text-spark-text-muted">{text.passkeyBackup}</p>}
                    </>}
                </section>
              )}

              {!isRevealed && (
                <section aria-label={text.privacyTitle}
                  className="rounded-2xl border border-spark-border bg-spark-dark p-5 space-y-4">
                  <div className="space-y-2">
                    <h3 className="font-semibold text-spark-text-primary">{text.privacyTitle}</h3>
                    <p className="text-sm leading-relaxed text-spark-text-secondary">{text.privacyBody}</p>
                  </div>
                  <label className="flex min-h-11 items-start gap-3 text-sm text-spark-text-secondary">
                    <input type="checkbox" checked={privateViewing} onChange={e => setPrivateViewing(e.target.checked)}
                      className="mt-1 accent-spark-primary"/>
                    <span>{text.privateCheck}</span>
                  </label>
                  <label className="flex min-h-11 items-start gap-3 text-sm text-spark-text-secondary">
                    <input type="checkbox" checked={paperReady} onChange={e => setPaperReady(e.target.checked)}
                      className="mt-1 accent-spark-primary"/>
                    <span>{text.paperCheck}</span>
                  </label>
                  <p className="text-xs leading-relaxed text-spark-text-muted">
                    {!canReveal ? text.privacyHint : mnemonic ? text.screenPrivate : isPasskey && !passkeyAttemptFailed
                      ? text.passkeyAuth : text.deviceAuth}
                  </p>
                </section>
              )}

              {error && !isPasskey && (
                <div className="bg-spark-warn-surface border border-spark-warn-border rounded-xl p-4 text-center" role="alert">
                  <p className="text-spark-warn-text text-sm">{error}</p>
                </div>
              )}

              {isPasskey && passkeyAttemptFailed && !isRevealed && !mnemonic
                && (!secureStorage.isSupported() || fallbackTier === 'none') && (
                  <section className="bg-spark-dark border border-spark-border rounded-2xl p-5 space-y-2" role="alert">
                    <h3 className="font-display font-semibold text-spark-text-primary">{text.passkeyUnavailableTitle}</h3>
                    <p className="text-spark-text-secondary text-sm leading-relaxed">{text.passkeyUnavailableBody}</p>
                  </section>
                )}

              {isRevealed && mnemonic && (
                <div className="bg-spark-dark border border-spark-border rounded-2xl p-4 space-y-4">
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-sm font-medium text-spark-text-secondary">{text.phrase}</span>
                    <button onClick={handleHide}
                      className="min-h-11 px-3 py-2 text-sm font-medium text-spark-text-muted hover:text-spark-text-primary border border-spark-border rounded-lg hover:bg-white/5 transition-colors">
                      <span className="inline-flex items-center gap-2"><EyeOffIcon size="sm"/> {text.hide}</span>
                    </button>
                  </div>
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-2" dir="ltr" data-testid="recovery-word-grid">
                    {words.map((word, index) => (
                      <div key={index} className="flex items-center gap-2 bg-spark-surface rounded-lg px-3 py-2">
                        <span className="text-spark-text-muted text-xs font-mono w-5 text-right">{index + 1}.</span>
                        <span className="text-spark-text-primary font-mono text-sm font-medium">{word}</span>
                      </div>
                    ))}
                  </div>
                  <label className="flex min-h-11 items-start gap-3 border-t border-spark-border pt-4 text-sm text-spark-text-secondary">
                    <input type="checkbox" checked={handwritten} onChange={event => setHandwritten(event.target.checked)}
                      className="mt-1 accent-spark-primary"/>
                    <span>{text.handwritten}</span>
                  </label>
                  {verificationError && <AlertCard variant="error" title={text.unavailable}>{verificationError}</AlertCard>}
                </div>
              )}

              {isPasskey && !isRevealed && (
                <details className="rounded-2xl border border-spark-border bg-spark-dark p-5" data-testid="passkey-recovery-details">
                  <summary className="min-h-11 cursor-pointer content-center text-sm font-semibold text-spark-text-secondary">
                    {text.passkeyTitle}
                  </summary>
                  <div className="mt-3 space-y-3">
                    <p className="text-sm leading-relaxed text-spark-text-secondary">
                      {text.passkeyLabel} <strong><bdi>{passkeyLabel}</bdi></strong>
                    </p>
                    <p className="text-sm leading-relaxed text-spark-text-secondary">{text.passkeyAccess}</p>
                    <p className="text-xs leading-relaxed text-spark-text-muted">{text.passkeySync}</p>
                    {!passkeyReviewed && !phraseVerified ? (
                      <>
                        <label className="flex min-h-11 items-start gap-3 text-sm text-spark-text-secondary">
                          <input type="checkbox" checked={passkeyAcknowledged}
                            onChange={event => setPasskeyAcknowledged(event.target.checked)} className="mt-1 accent-spark-primary"/>
                          <span>{text.passkeyCheck}</span>
                        </label>
                        <SecondaryButton className="w-full" disabled={!passkeyAcknowledged} onClick={reviewPasskey}>
                          {text.review}
                        </SecondaryButton>
                      </>
                    ) : passkeyReviewed && !phraseVerified ? (
                      <div className="space-y-1">
                        <p className="text-sm font-medium text-spark-text-primary" role="status">{text.reviewed}</p>
                        <p className="text-xs text-spark-text-muted">{text.reviewedHint}</p>
                      </div>
                    ) : null}
                  </div>
                </details>
              )}

              {!isPasskey && mnemonic && !Capacitor.isNativePlatform() && !isRevealed && (
                <details className="rounded-2xl border border-spark-border bg-spark-dark p-5">
                  <summary className="min-h-11 cursor-pointer content-center text-sm font-semibold text-spark-text-secondary">
                    {text.browserTitle}
                  </summary>
                  <p className="mt-3 text-xs leading-relaxed text-spark-text-muted">{text.browserBody}</p>
                </details>
              )}

              {!isPasskey && !mnemonic && !biometricSeedPresent && (
                <section className="bg-spark-dark border border-spark-border rounded-2xl p-5 space-y-2" role="alert">
                  <h3 className="font-display font-semibold text-spark-text-primary">{text.noBackupTitle}</h3>
                  <p className="text-spark-text-secondary text-sm">{text.noBackupBody}</p>
                </section>
              )}
            </>
          )}
        </div>
      </div>
    </SlideInPage>
  );
};

export default BackupPage;
