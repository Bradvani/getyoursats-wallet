import {useFlowText} from '@/hooks/useFlowText';
import LocalizedErrorText from '@/components/LocalizedErrorText';
import React, { useLayoutEffect, useMemo, useRef, useState } from 'react';
import { SimpleAlert } from '../../../components/AlertCard';
import { PrimaryButton, FIELD_BASE_CLASS } from '../../../components/ui';
import ContactAutocomplete from '../components/ContactAutocomplete';
import { useContactsContext } from '../../../contexts/ContactsContext';
import { searchContacts } from '../../../hooks/useContacts';
import { logger, LogCategory } from '@/services/logger';
import { ClipboardIcon, QrCodeIcon, SpinnerIcon, ContactsIcon, CloseIcon } from '@/components/Icons';
import type { Contact } from '@breeztech/breez-sdk-spark';
import { dismissKeyboard } from '../../../utils/keyboard';
import { Capacitor } from '@capacitor/core';
import { Clipboard } from '@capacitor/clipboard';
import { useLatest } from '../../../hooks/useLatest';

export interface InputStepProps {
  paymentInput: string;
  selectedContactAddress?: string | null;
  isLoading: boolean;
  suspended?: boolean;
  error: string | null;
  onClearError?: () => void;
  onContinue: (paymentInput: string, opts?: { requireReview?: boolean }) => void;
  onStablecoin?: () => void;
  onScanQr?: () => void;
  onOpenContacts?: () => void;
}

// Parent (SendPaymentDialog) keys this on `selectedContactAddress` so
// a fresh contact pick remounts and lazy-init re-reads the props.
const InputStep: React.FC<InputStepProps> = ({ paymentInput, selectedContactAddress, isLoading, suspended = false, error, onClearError, onContinue, onScanQr, onOpenContacts, onStablecoin }) => {
  const t=useFlowText();
  const { contacts } = useContactsContext();
  const [localPaymentInput, setLocalPaymentInput] = useState<string>(() =>
    selectedContactAddress || paymentInput || ''
  );
  const [isInputFocused, setIsInputFocused] = useState(false);
  // The shortcut guides the input; the SDK remains the authority for the actual
  // protocol, asset, routes and fees once a destination has been parsed.
  const [preferredRail, setPreferredRail] = useState<'auto' | 'bitcoin' | 'lightning' | 'stablecoin'>('auto');
  const [selectedContact, setSelectedContact] = useState<Contact | null>(() => {
    const initialAddress = selectedContactAddress || paymentInput;
    if (!initialAddress) return null;
    return contacts.find(c => c.paymentIdentifier === initialAddress) || null;
  });

  const autocompleteContacts = useMemo(() => searchContacts(contacts, localPaymentInput), [contacts, localPaymentInput]);

  const inputRef = useRef<HTMLTextAreaElement>(null);
  const inputAction = useRef(0);
  const canSubmit = useLatest(!suspended && !isLoading);
  useLayoutEffect(() => {
    inputAction.current += 1;
    return () => {inputAction.current += 1;};
  }, [suspended]);

  const handleContinue = async () => {
    if (!canSubmit.current) return;
    const action = ++inputAction.current;
    await dismissKeyboard();
    if (action === inputAction.current && canSubmit.current && localPaymentInput.trim()) {
      onContinue(localPaymentInput);
    }
  };

  const recipientPlaceholder = preferredRail === 'bitcoin'
    ? t("Bitcoin address (bc1...)")
    : preferredRail === 'lightning'
      ? t("Lightning address or invoice (lnbc...)")
      : preferredRail === 'stablecoin'
        ? t("Recipient address for USDT / USDC")
        : t("Lightning address, invoice, Bitcoin or stablecoin destination");

  const handlePaste = async () => {
    if (!canSubmit.current) return;
    const action = ++inputAction.current;
    try {
      // Read via the native Clipboard plugin in the Capacitor app: the
      // WebView's navigator.clipboard is blocked on Android and shows
      // iOS's in-page paste pill. Native read goes through the OS paste
      // flow, which honors the per-app "Paste from Other Apps" setting.
      let text: string | null;
      if (Capacitor.isNativePlatform()) {
        text = (await Clipboard.read()).value ?? null;
      } else if (navigator.clipboard?.readText) {
        text = await navigator.clipboard.readText();
      } else {
        // Old Firefox / non-secure context: no readText(). Focus the
        // field so the user can paste manually.
        inputRef.current?.focus();
        return;
      }
      if (action !== inputAction.current || !canSubmit.current) return;
      if (text?.trim()) {
        setLocalPaymentInput(text);
        setSelectedContact(null);
        onContinue(text, { requireReview: true });
      }
    } catch (err) {
      if (action !== inputAction.current || !canSubmit.current) return;
      logger.error(LogCategory.UI, 'Failed to read clipboard contents', {
        error: err instanceof Error ? err.message : String(err),
      });
      inputRef.current?.focus();
    }
  };

  const handleContactSelect = (paymentIdentifier: string) => {
    inputAction.current += 1;
    const match = contacts.find(c => c.paymentIdentifier === paymentIdentifier);
    if (match) {
      setSelectedContact(match);
      setLocalPaymentInput(paymentIdentifier);
    } else {
      onContinue(paymentIdentifier);
    }
  };

  const handleClearContact = () => {
    inputAction.current += 1;
    setSelectedContact(null);
    setLocalPaymentInput('');
    onClearError?.();
  };

  return (
    <div className="flex flex-col gap-4">
      {/* Scan/Paste first: reduce technical input friction without bypassing SDK parsing. */}
      <div className="space-y-2">
        <p className="text-sm font-medium text-spark-text-primary">{t("Where would you like to send?")}</p>
        <div className="grid grid-cols-2 gap-3">
          <button
            type="button"
            onClick={() => {inputAction.current += 1; onScanQr?.();}}
            disabled={isLoading || !onScanQr}
            className="flex min-h-14 items-center justify-center gap-2 rounded-xl border border-[#F7931A] bg-[#F7931A] px-3 py-3 text-sm font-semibold text-[#0B0B0B] hover:bg-[#FFB25E] disabled:opacity-50"
          >
            <QrCodeIcon size="sm" />
            {t("Scan QR")}
          </button>
          <button
            type="button"
            onClick={handlePaste}
            disabled={isLoading}
            className="flex min-h-14 items-center justify-center gap-2 rounded-xl border border-spark-border bg-spark-surface px-3 py-3 text-sm font-semibold text-spark-text-primary hover:border-[#F7931A] disabled:opacity-50"
          >
            <ClipboardIcon size="sm" />
            {t("Paste")}
          </button>
        </div>
      </div>
      <p className="text-xs text-spark-text-muted">{t("Or enter a destination below. We’ll recognize the payment format.")}</p>
      {/* Input with autocomplete */}
      <div className="h-20">
        {selectedContact ? (
          // Selected contact chip
          <div className="w-full h-full px-4 bg-spark-dark border border-spark-border rounded-xl flex items-center gap-3">
            <div className="w-8 h-8 rounded-full bg-spark-primary/15 flex items-center justify-center shrink-0">
              <span className="text-spark-primary font-display font-bold text-xs">
                {selectedContact.name.charAt(0).toUpperCase()}
              </span>
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium text-spark-text-primary truncate">{selectedContact.name}</p>
              <p className="text-xs text-spark-text-muted truncate font-mono">{selectedContact.paymentIdentifier}</p>
            </div>
            <button
              onClick={handleClearContact}
              disabled={isLoading}
              className="p-1 text-spark-text-muted hover:text-spark-text-primary rounded-lg hover:bg-white/5 transition-colors shrink-0"
              aria-label={t("Clear contact")}
            >
              <CloseIcon size="sm" />
            </button>
          </div>
        ) : (
          // Text input with autocomplete. Rendered as a <textarea> so
          // long bolt11 invoices wrap visually instead of scrolling
          // horizontally, but Enter is intercepted and submits
          // instead of inserting a newline — this input never
          // accepts multi-line content, so the newline default is
          // user-hostile. Shift+Enter still inserts a newline for
          // desktop users who want to paste formatted content.
          <div className="relative h-full">
            <textarea
              ref={inputRef}
              value={localPaymentInput}
              onChange={(e) => {inputAction.current += 1; setLocalPaymentInput(e.target.value);}}
              onPaste={(e) => {
                // A user-initiated paste fills the field but doesn't
                // advance. Auto-advance so it matches the Paste button.
                // This path also needs no readText(), so no iOS
                // clipboard permission pill.
                const text = e.clipboardData.getData('text');
                if (text?.trim()) {
                  e.preventDefault();
                  inputAction.current += 1;
                  setLocalPaymentInput(text);
                  setSelectedContact(null);
                  onContinue(text, { requireReview: true });
                }
              }}
              onFocus={() => setIsInputFocused(true)}
              onBlur={() => setTimeout(() => setIsInputFocused(false), 100)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  // Always dismiss the keyboard on Enter, even when
                  // the field is empty — tapping Go on an empty
                  // field should at minimum retract the keyboard
                  // so the user can see the Paste / Scan / Contacts
                  // shortcut buttons underneath. Only advance to
                  // the next step if there's actually content to
                  // submit.
                  void handleContinue();
                }
              }}
              enterKeyHint="go"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              placeholder={recipientPlaceholder}
              className={`${FIELD_BASE_CLASS} h-full p-4 resize-none font-mono text-sm outline-hidden`}
              disabled={isLoading}
              data-testid="payment-input"
            />
            <ContactAutocomplete
              contacts={autocompleteContacts}
              isVisible={isInputFocused}
              isLoading={isLoading}
              onSelect={handleContactSelect}
            />
          </div>
        )}
      </div>

      {/* Error */}
      {error && (
        <SimpleAlert variant="error" dataTestId="send-error-banner">
          <LocalizedErrorText message={error}/>
        </SimpleAlert>
      )}

      {/* Compact shortcuts are input guidance, not hardcoded payment routes.
          SDK address parsing and cross-chain route availability control settlement. */}
      <div className="space-y-2">
        <p className="text-xs font-medium text-spark-text-muted">{t("Payment type")}</p>
        <div className="grid grid-cols-3 gap-2" role="group" aria-label={t("Payment type shortcuts")}>
          {([
            { rail: 'bitcoin', label: 'Bitcoin' },
            { rail: 'lightning', label: 'Lightning' },
            { rail: 'stablecoin', label: 'USDT / USDC' },
          ] as const).map(({ rail, label }) => (
            <button
              key={rail}
              type="button"
              aria-pressed={preferredRail === rail}
              disabled={isLoading}
              onClick={() => { inputAction.current += 1; setPreferredRail(rail); if (rail === 'stablecoin' && onStablecoin) onStablecoin(); else inputRef.current?.focus(); }}
              className={preferredRail === rail
                ? 'min-h-11 rounded-xl border border-[#F7931A] bg-[#2A2117] px-2 py-2 text-xs font-semibold text-[#F7931A]'
                : 'min-h-11 rounded-xl border border-spark-border bg-spark-surface px-2 py-2 text-xs font-semibold text-spark-text-secondary hover:border-[#F7931A]'}
            >
              {label}
            </button>
          ))}
        </div>
        <p className="text-xs text-spark-text-muted">{t("Available networks, assets and fees are verified after you enter a destination.")}</p>
      </div>
      <button
        type="button"
        onClick={() => {inputAction.current += 1; onOpenContacts?.();}}
        disabled={isLoading || !onOpenContacts}
        className="flex min-h-11 items-center justify-center gap-2 rounded-xl border border-spark-border bg-spark-surface px-3 py-2 text-sm font-medium text-spark-text-secondary hover:text-spark-text-primary"
      >
        <ContactsIcon size="sm" />
        {t("Choose a contact")}
      </button>

      {/* Continue button */}
      <PrimaryButton
        onClick={handleContinue}
        disabled={isLoading || !localPaymentInput.trim()}
        className="w-full"
        data-testid="continue-button"
      >
        {isLoading ? (
          <span className="flex items-center justify-center gap-2">
            <SpinnerIcon />
            {t("Processing...")}
          </span>
        ) : t("Continue")}
      </PrimaryButton>

    </div>
  );
};

export default InputStep;
