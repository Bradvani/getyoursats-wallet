import {trustCopy} from '@/getyoursats/trustCopy';
import {usePresentation} from '@/hooks/usePresentation';
import {Capacitor} from '@capacitor/core';
import React, { useState } from 'react';
import PageLayout from '../components/layout/PageLayout';
import { PrimaryButton, FIELD_BASE_CLASS } from '../components/ui';
import { SimpleAlert } from '../components/AlertCard';
import { WebSecurityNotice } from '../components/WebSecurityNotice';
import { useScreenCaptureProtection } from '@/utils/screenSecurity';

interface RestorePageProps {
  onConnect: (mnemonic: string) => Promise<void>;
  onUsePasskey: () => void;
  onBack: () => void;
  onClearError: () => void;
  isLoading?: boolean;
}

const RestorePage: React.FC<RestorePageProps> = ({
  onConnect,
  onUsePasskey,
  onBack,
  onClearError,
  isLoading = false,
}) => {
  const {language}=usePresentation(); const text=trustCopy(language);
  const [mnemonic, setMnemonic] = useState<string>('');
  const [manualOpen, setManualOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // The user types their existing recovery phrase here: block capture
  // for the whole screen. Generate (fresh phrase) deliberately does not.
  useScreenCaptureProtection(true);

  const handleSubmit = async () => {
    // Lowercased because BIP39 wordlists are: a typed phrase arrives
    // sentence-cased from the mobile keyboard and would be rejected as an
    // unknown word. Pasting hides this, which is why it reads as fine.
    const cleaned = mnemonic.trim().replace(/\s+/g, ' ').toLowerCase();
    const wordCount = cleaned.split(' ').length;

    if (wordCount !== 12 && wordCount !== 24) {
      setError('Please enter a valid 12 or 24-word recovery phrase');
      return;
    }

    setError(null);
    try {
      await onConnect(cleaned);
    } catch {
      setError('Invalid recovery phrase. Please check your words and try again.');
    }
  };

  const footer = manualOpen ? (
    <div className="max-w-xl mx-auto">
      <PrimaryButton onClick={handleSubmit} disabled={!mnemonic.trim() || isLoading}
        className="w-full" data-testid="restore-confirm-button">
        {isLoading ? 'Restoring...' : 'Restore with offline words'}
      </PrimaryButton>
    </div>
  ) : <div/>;

  return (
    <PageLayout footer={footer} onBack={onBack} title={text.restoreTitle} onClearError={onClearError}>
       <div className="max-w-xl mx-auto w-full space-y-4">
        <div className="rounded-2xl border border-spark-primary/25 bg-spark-dark p-5 space-y-3">
          <h2 className="text-lg font-semibold text-spark-text-primary">{text.restoreTitle}</h2>
          <p className="text-sm text-spark-text-secondary">{text.restoreCompatibility}</p>
          {!Capacitor.isNativePlatform()&&<p className="text-xs text-spark-text-muted">{text.browserLimit}</p>}
          <p className="text-sm text-spark-text-secondary">
            If you saved a GetYourSats passkey with your device's password manager, use it to sign in.
            Face unlock, fingerprint or your screen lock may be used by the operating system.
          </p>
          <PrimaryButton className="w-full" onClick={onUsePasskey}>
            Sign in with my passkey
          </PrimaryButton>
          <p className="text-xs text-spark-text-muted">
            If this device can't find the passkey, check its password manager or return here for offline recovery.
          </p>
        </div>
        <button type="button" className="w-full rounded-xl border border-spark-border px-4 py-3 text-sm text-spark-text-secondary"
          aria-expanded={manualOpen} aria-controls="offline-restore-form"
          onClick={() => setManualOpen(open => !open)}>
          {manualOpen ? 'Hide offline recovery' : 'Restore with handwritten recovery words'}
        </button>
        {manualOpen && <div id="offline-restore-form" className="space-y-4">
        <p className="text-spark-text-secondary text-center">
          Enter your existing 12 or 24-word phrase privately. Words must be in order, separated by spaces.
        </p>

        <div className="relative">
          <textarea
            value={mnemonic}
            onChange={(e) => setMnemonic(e.target.value)}
            className={`${FIELD_BASE_CLASS} h-36 px-4 py-3 resize-none font-mono text-sm`}
            placeholder="word1 word2 word3 ..."
            // A mobile keyboard otherwise sentence-cases and autocorrects
            // BIP39 words into something the SDK rejects.
            autoCapitalize="none"
            autoCorrect="off"
            autoComplete="off"
            spellCheck={false}
            data-testid="mnemonic-input"
          />
        </div>

        {error && (
          <SimpleAlert variant="error" className="mt-4">
            {error}
          </SimpleAlert>
        )}

        <WebSecurityNotice />
        </div>}

        <div className="flex-1" />
      </div>
    </PageLayout>
  );
};

export default RestorePage;
