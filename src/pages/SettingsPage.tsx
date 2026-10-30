import {useFlowText} from '@/hooks/useFlowText';
import StableBalanceSettings from '../components/StableBalanceSettings';
import PaymentFeedbackSetting from '../components/PaymentFeedbackSetting';
import PaymentPushSetting from '../components/PaymentPushSetting';
import LanguageSelect from '@/components/LanguageSelect';
import {trustCopy} from '@/getyoursats/trustCopy';
import { usePresentation } from '@/hooks/usePresentation';
import { walletSetupCopy } from '@/locales/walletSetup';
import { setAppearancePreference, type AppearancePreference } from '@/services/presentationPreferences';
import React, { useEffect, useRef, useState } from 'react';
import {featureAvailability} from '../getyoursats/featureAvailability';
import { ConfirmDialog, FormGroup, FormInput, LoadingSpinner, PrimaryButton, Switch } from '../components/ui';
import { PinGate } from '../components/PinEntry';
import { getSettings, saveSettings, UserSettings, hasBuyProviderSettings, isDevMode as isDevModeEnabled, setDevMode, buildDepositMaxFee, depositMaxFeeDrafts, depositMaxFeeValue, DepositMaxFeeType } from '../services/settings';
import type { Config, Network } from '@breeztech/breez-sdk-spark';
import { useWallet } from '@/contexts/WalletContext';
import { CurrencyIcon, ChevronRightIcon, DownloadIcon, KeyIcon, LockIcon, LogoutIcon, ShieldCheckIcon, TrashIcon, ExternalLinkIcon } from '../components/Icons';
import { ACCOUNT_DELETION_GUIDE_URL } from '@/services/accountDeletion';
import { openExternalUrl } from '@/utils/externalLink';
import { isAppLockSupported, isPinEnabled } from '@/services/appLock';
import SlideInPage from '../components/layout/SlideInPage';
import { logger, LogCategory } from '@/services/logger';
import { shareOrDownloadLogs, exportDatabaseState } from '@/services/logExport';
import { useSecretTap } from '@/hooks/useSecretTap';
import { isPasskeyMode } from '@/services/passkeyService';
import { useAppVersion } from '@/hooks/useAppVersion';

interface SettingsPageProps {
  onBack: () => void;
  config: Config | null;
  onOpenFiatCurrencies: () => void;
  onOpenBuyProviders: () => void;
  onOpenPasskeySettings: () => void;
  onOpenSecurity: () => void;
  onOpenBackup: () => void;
  onOpenEmail: () => void;
  onOpenWalletTour?: () => void;
  onOpenUnilateralExit: () => void;
}

const SettingsPage: React.FC<SettingsPageProps> = ({
  onBack,
  config,
  onOpenFiatCurrencies,
  onOpenBuyProviders,
  onOpenPasskeySettings,
  onOpenSecurity,
  onOpenBackup,
  onOpenEmail,
  onOpenWalletTour,
  onOpenUnilateralExit,
}) => {
  const t=useFlowText();
  const wallet = useWallet();
  const appVersion = useAppVersion();
  const { language, appearance, copy } = usePresentation();
  const setupCopy = walletSetupCopy(language);
  const {
    handleTap: devTap,
    activated: isDevMode,
    tapCount: devTapCount,
    threshold: devTapThreshold,
  } = useSecretTap(5, 2000, isDevModeEnabled);
  // Network and persisted settings only change via handlers that
  // reload the page, so reading once at mount is sufficient.
  const [selectedNetwork, setSelectedNetwork] = useState<Network>(
    () => (new URLSearchParams(window.location.search).get('network') || 'mainnet') as Network,
  );

  const [feeType, setFeeType] = useState<DepositMaxFeeType>(() => getSettings().depositMaxFee.type);
  // One draft per type: the units differ, so carrying a single number across
  // a type change would turn 500 sats into 500 sat/vB.
  const [feeDrafts, setFeeDrafts] = useState<Record<DepositMaxFeeType, string>>(() =>
    depositMaxFeeDrafts(getSettings()),
  );
  const feeValue = feeDrafts[feeType];
  const feeUnit = feeType === 'fixed' ? 'sats' : 'sat/vB';
  const enteredFee = buildDepositMaxFee(feeType, feeValue);
  const feeError = feeType === 'fixed' ? 'Please enter a valid amount' : 'Please enter a valid fee rate';

  // SettingsPage only mounts after wallet connect, so `config` is
  // effectively stable for this lifetime; capture once via lazy init.
  const [syncIntervalSecs, setSyncIntervalSecs] = useState<string>(() => {
    const s = getSettings();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- SDK config type doesn't expose all fields
    const cfg: any = config ?? {};
    if (typeof s.syncIntervalSecs === 'number') return String(s.syncIntervalSecs);
    if (typeof cfg.syncIntervalSecs === 'number') return String(cfg.syncIntervalSecs);
    return '';
  });
  const [preferSparkOverLightning, setPreferSparkOverLightning] = useState<boolean>(() => {
    const s = getSettings();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- SDK config type doesn't expose all fields
    const cfg: any = config ?? {};
    if (typeof s.preferSparkOverLightning === 'boolean') return s.preferSparkOverLightning;
    if (typeof cfg.preferSparkOverLightning === 'boolean') return cfg.preferSparkOverLightning;
    return false;
  });
  const [isDownloadingLogs, setIsDownloadingLogs] = useState<boolean>(false);
  const [isExportingDb, setIsExportingDb] = useState<boolean>(false);

  // Persist the tap toggle only. The first run is skipped because the
  // hook seeds from `?dev=true`, and writing that would turn a link into
  // a permanent local change.
  const devModeSeeded = useRef(false);
  useEffect(() => {
    if (!devModeSeeded.current) {
      devModeSeeded.current = true;
      return;
    }
    setDevMode(isDevMode);
  }, [isDevMode]);

  const handleNetworkChange = (network: Network) => {
    setSelectedNetwork(network);
    // Update URL and reload to reconnect with new network
    const url = new URL(window.location.href);
    url.searchParams.set('network', network);
    if (isDevMode) {
      url.searchParams.set('dev', 'true');
    }
    window.location.assign(url.toString());
  };

  const handleSave = async () => {
    // Save is disabled while the limit field cannot be read, so there is
    // nothing here that would quietly discard what the user typed.
    if (!enteredFee) return;
    const current = getSettings();
    const depositMaxFee = enteredFee;
    const depositMaxFeeByType = { ...current.depositMaxFeeByType };
    for (const [type, value] of Object.entries(feeDrafts)) {
      const parsed = buildDepositMaxFee(type as DepositMaxFeeType, value);
      if (parsed) depositMaxFeeByType[type as DepositMaxFeeType] = depositMaxFeeValue(parsed);
    }
    // Carry the stored settings through: the fields below are the only ones
    // this page edits, and rebuilding the object without them dropped
    // whatever the rest of the app had written.
    const updated: UserSettings = {
      ...current,
      depositMaxFee,
      depositMaxFeeByType,
      ...(isDevMode
        ? {
            syncIntervalSecs: syncIntervalSecs !== '' ? Math.max(0, Math.floor(Number(syncIntervalSecs))) : undefined,
            preferSparkOverLightning,
          }
        : {}),
    };
    saveSettings(updated);
    window.location.reload();
  };

  // The database export carries the whole payment history off the device,
  // so it goes behind the app lock. Where there is no lock to check
  // against (web, or no PIN set) a confirm step is all that is available.
  const [exportGate, setExportGate] = useState<'pin' | 'confirm' | null>(null);

  const handleExportDb = async () => {
    setExportGate((await isPinEnabled()) ? 'pin' : 'confirm');
  };

  const runExportDb = async () => {
    setExportGate(null);
    setIsExportingDb(true);
    try {
      const info = await wallet.getInfo({});
      await exportDatabaseState(info.identityPubkey, config?.network ?? 'mainnet');
    } catch (e) {
      logger.warn(LogCategory.SDK, 'Failed to export database state', {
        error: e instanceof Error ? e.message : String(e),
      });
    } finally {
      setIsExportingDb(false);
    }
  };

  const handleShareLogs = async () => {
    setIsDownloadingLogs(true);
    try {
      await shareOrDownloadLogs();
    } catch (e) {
      logger.warn(LogCategory.SDK, 'Failed to share or download logs', {
        error: e instanceof Error ? e.message : String(e),
      });
    } finally {
      setIsDownloadingLogs(false);
    }
  };

  const footer = (
    <PrimaryButton className="w-full" onClick={handleSave} disabled={!enteredFee}>
      {trustCopy(language).savePayment}
    </PrimaryButton>
  );

  // Same shape as BackupPage: the gate replaces the page body, and the
  // header's close button is the way out.
  if (exportGate === 'pin') {
    return (
      <SlideInPage title={copy.settings} onClose={() => setExportGate(null)} slideFrom="left">
        <PinGate reason="Export database" onUnlocked={() => { void runExportDb(); }} />
      </SlideInPage>
    );
  }

  return (
    <SlideInPage title={copy.settings} onClose={onBack} slideFrom="left" footer={footer}>
      <div className="p-4">
        <div className="max-w-xl mx-auto w-full space-y-4">
<p className="text-xs text-spark-text-muted" role="status">{trustCopy(language).autosave}</p>
          {/* Order: page nav, exports, settings, diagnostics, developer
              options, account deletion last. The "Save Changes" footer
              applies the toggles + inputs; the rest commits on tap. */}

          {/* Lock Screen (native only: app lock needs the Capacitor
              shell). Backup is its own entry below; BackupPage runs its
              own PIN gate when one is set. */}
          {isAppLockSupported() && (
            <div className="bg-spark-dark border border-spark-border rounded-2xl p-4">
              <h3 className="font-display font-semibold text-spark-text-primary mb-3">{t("Security")}</h3>
              <button
                className="flex items-center justify-between w-full px-4 py-3 text-sm font-medium border border-spark-border rounded-xl text-spark-text-secondary hover:text-spark-text-primary hover:bg-white/5 transition-colors"
                type="button"
                onClick={onOpenSecurity}
              >
                <div className="flex items-center gap-3">
                  <LockIcon size="md" />
                  <span>{t("PIN & biometric unlock")}</span>
                </div>
                <ChevronRightIcon size="md" />
              </button>
            </div>
          )}

          {/* Web/PWA imports do not have a secure, wallet-bound app lock.
              Keep the limitation visible, but put implementation details
              behind a disclosure rather than a frightening warning panel. */}
          {!isAppLockSupported() && !isPasskeyMode() && (
            <section className="bg-spark-dark border border-spark-border rounded-2xl p-4 space-y-3" aria-label={t("Wallet security availability")}>
              <div className="flex items-start gap-3">
                <LockIcon size="md" />
                <div className="min-w-0">
                  <h3 className="font-display font-semibold text-spark-text-primary">{t("Wallet protection")}</h3>
                  <p className="text-sm text-spark-text-muted leading-relaxed mt-1">{t("Wallet PIN and biometric approval are not available for imported recovery-word wallets in the browser yet. Keep your recovery words offline and secure your device.")}</p>
                </div>
              </div>
              <details className="border-t border-spark-border pt-3">
                <summary className="cursor-pointer text-xs font-medium text-spark-text-secondary hover:text-spark-text-primary">{t("Why is this unavailable?")}</summary>
                <p className="mt-2 text-xs text-spark-text-muted leading-relaxed">{t("Passkeys are available when creating a new wallet. They cannot be added to an existing wallet restored from recovery words.")}</p>
              </details>
            </section>
          )}

          {/* Backup */}
          <div className="bg-spark-dark border border-spark-border rounded-2xl p-4">
            <h3 className="font-display font-semibold text-spark-text-primary mb-3">{t("Privacy & recovery")}</h3>
            <button
              className="flex items-center justify-between w-full px-4 py-3 text-sm font-medium border border-spark-border rounded-xl text-spark-text-secondary hover:text-spark-text-primary hover:bg-white/5 transition-colors"
              type="button"
              onClick={onOpenBackup}
            >
              <div className="flex items-center gap-3">
                <KeyIcon size="md" />
                <span>{t("Recovery words")}</span>
              </div>
              <ChevronRightIcon size="md" />
            </button>
          </div>

          {/* This is not email-based wallet recovery. Identity must be
              signed by the active Spark wallet and confirmed server-side. */}
          <div className="bg-spark-dark border border-spark-border rounded-2xl p-4 space-y-2">
            <h3 className="font-display font-semibold text-spark-text-primary">{t("Account identity")}</h3>
            <button type="button"
              disabled={!featureAvailability.emailVerification}
              onClick={featureAvailability.emailVerification ? onOpenEmail : undefined}
              className="flex w-full items-center justify-between rounded-xl border border-spark-border px-4 py-3 text-sm text-spark-text-secondary transition-colors disabled:cursor-default disabled:opacity-70">
              <span>{t("Verify Email Address")}</span>
              {featureAvailability.emailVerification ? <ChevronRightIcon size="md"/> : <span className="gys-feature-soon">{t("Coming soon")}</span>}
            </button>
            <p className="text-xs text-spark-text-muted">{featureAvailability.emailVerification
              ? t('Link an email to your wallet. Keep your recovery words or passkey safe.')
              : t('Email verification is coming soon. Keep your recovery words or passkey safe.')}</p>
          </div>

          {selectedNetwork==='mainnet'&&<StableBalanceSettings/>}

          {/* Display */}
          <div className="bg-spark-dark border border-spark-border rounded-2xl p-4">
            <h3 className="font-display font-semibold text-spark-text-primary mb-3">{copy.display}</h3>
            <div className="space-y-2">
              <button
                className="flex items-center justify-between w-full px-4 py-3 text-sm font-medium border border-spark-border rounded-xl text-spark-text-secondary hover:text-spark-text-primary hover:bg-white/5 transition-colors"
                type="button"
                onClick={onOpenFiatCurrencies}
              >
                <div className="flex items-center gap-3">
                  <CurrencyIcon size="md" />
                  <span>{copy.currency}</span>
                </div>
                <ChevronRightIcon size="md" />
              </button>
              <div className="pt-4 border-t border-spark-border mt-3">
                <h4 className="text-sm font-semibold text-spark-text-primary mb-2">{copy.appearance}</h4>
                <div className="grid grid-cols-3 gap-2" role="group" aria-label={copy.appearance}>
                  {(['dark','orange','system'] as const satisfies ReadonlyArray<AppearancePreference>).map(value => (
                    <button key={value} type="button" aria-pressed={appearance===value}
                      data-testid={`settings-appearance-${value}`} onClick={() => setAppearancePreference(value)}
                      className="gys-settings-choice">
                      <strong>{copy[value]}</strong>
                      <small>{value==='dark'?'●':value==='orange'?'◐':'◉'} {appearance===value ? '✓' : ''}</small>
                    </button>
                  ))}
                </div>
                <p className="mt-2 text-xs text-spark-text-muted leading-relaxed">
                  {t('Orange is a warm, light experience. System follows your device appearance.')}
                </p>
              </div>
              <div className="pt-4 border-t border-spark-border mt-3">
                <LanguageSelect />
              </div>
              <PaymentFeedbackSetting/>
              <PaymentPushSetting/>
              {import.meta.env.VITE_GETYOURSATS_ENABLE_LEGACY_BUY === 'true' && hasBuyProviderSettings() && (
                <button
                  className="flex items-center justify-between w-full px-4 py-3 text-sm font-medium border border-spark-border rounded-xl text-spark-text-secondary hover:text-spark-text-primary hover:bg-white/5 transition-colors"
                  type="button"
                  onClick={featureAvailability.buyBitcoin ? onOpenBuyProviders : undefined}
                  disabled={!featureAvailability.buyBitcoin}
                >
                  <div className="flex items-center gap-3">
                    <CurrencyIcon size="md" />
                    <span>{t("Buy Bitcoin")}</span>
                  </div>
                  {featureAvailability.buyBitcoin ? <ChevronRightIcon size="md" /> : <span className="gys-feature-soon">{t("Coming soon")}</span>}
                </button>
              )}
            </div>
          </div>

          {/* Automatic claims. The network-recommended form needs a
              paragraph to explain, so it stays in developer mode unless it
              is already what the user picked. */}
          <div className="bg-spark-dark border border-spark-border rounded-2xl p-4">
            <h3 className="font-display font-semibold text-spark-text-primary mb-1">{t("Automatic Claims")}</h3>
            <p className="text-sm text-spark-text-muted mb-3">{t("On-chain deposits are claimed automatically while the network fee stays under this limit.")}</p>
            <FormGroup>
              <div className="flex gap-2 items-center">
                <select
                  value={feeType}
                  onChange={(e) => setFeeType(e.currentTarget.value as DepositMaxFeeType)}
                  className="min-w-[160px] bg-spark-surface border border-spark-border rounded-xl px-3 py-3 text-spark-text-primary text-sm focus:border-spark-primary focus:ring-2 focus:ring-spark-primary/20"
                  aria-label={t("Max fee type")}
                >
                  <option className="bg-spark-surface" value="fixed">{t("Fixed")}</option>
                  <option className="bg-spark-surface" value="rate">{t("Rate")}</option>
                  {(isDevMode || feeType === 'networkRecommended') && (
                    <option className="bg-spark-surface" value="networkRecommended">{t("Network + leeway")}</option>
                  )}
                </select>
                <div className="flex-1">
                  <FormInput
                    id="deposit-fee-default"
                    type="number"
                    inputMode="decimal"
                    min={0}
                    value={feeValue}
                    onChange={(e) => setFeeDrafts({ ...feeDrafts, [feeType]: e.target.value })}
                  />
                </div>
                {/* Pinned next to the field: a placeholder would carry the
                    unit only while the field is empty. */}
                <span className="text-sm text-spark-text-muted shrink-0">{feeUnit}</span>
              </div>
              {!enteredFee && (
                <p className="text-xs text-spark-warning">{t(feeError)}</p>
              )}
            </FormGroup>
          </div>

          {/* Passkey & Labels. Every page in the hub acts on the active
              passkey, so a mnemonic-only wallet has nothing to open. */}
          {isDevMode && isPasskeyMode() && (
            <div className="bg-spark-dark border border-spark-border rounded-2xl p-4">
              <h3 className="font-display font-semibold text-spark-text-primary mb-3">Passkey</h3>
              <button
                className="flex items-center justify-between w-full px-4 py-3 text-sm font-medium border border-spark-border rounded-xl text-spark-text-secondary hover:text-spark-text-primary hover:bg-white/5 transition-colors"
                type="button"
                onClick={onOpenPasskeySettings}
              >
                <div className="flex items-center gap-3">
                  <ShieldCheckIcon size="md" />
                  <span>Passkey & Labels</span>
                </div>
                <ChevronRightIcon size="md" />
              </button>
            </div>
          )}

          {/* Diagnostics */}
          <div className="bg-spark-dark border border-spark-border rounded-2xl p-4">
            <h3 className="font-display font-semibold text-spark-text-primary mb-3">{t("Diagnostics")}</h3>
            <button
              className="flex items-center gap-2 px-4 py-2.5 text-sm font-medium border border-spark-border rounded-xl text-spark-text-secondary hover:text-spark-text-primary hover:bg-white/5 transition-colors disabled:opacity-50"
              type="button"
              onClick={handleShareLogs}
              disabled={isDownloadingLogs}
            >
              {isDownloadingLogs ? (
                <LoadingSpinner size="small" />
              ) : (
                <DownloadIcon size="md" />
              )}
              {isDownloadingLogs ? t('Preparing...') : t('Download Logs')}
            </button>
          </div>

          {/* Database */}
          {isDevMode && (
            <div className="bg-spark-dark border border-spark-border rounded-2xl p-4">
              <h3 className="font-display font-semibold text-spark-text-primary mb-3">Database</h3>
              <button
                className="flex items-center gap-2 px-4 py-2.5 text-sm font-medium border border-spark-border rounded-xl text-spark-text-secondary hover:text-spark-text-primary hover:bg-white/5 transition-colors disabled:opacity-50"
                type="button"
                onClick={handleExportDb}
                disabled={isExportingDb}
              >
                {isExportingDb ? (
                  <LoadingSpinner size="small" />
                ) : (
                  <DownloadIcon size="md" />
                )}
                {isExportingDb ? 'Exporting...' : 'Export Database'}
              </button>
            </div>
          )}

          {/* Network */}
          {isDevMode && (
            <div className="bg-spark-dark border border-spark-border rounded-2xl p-4">
              <h3 className="font-display font-semibold text-spark-text-primary mb-3">{t("Network")}</h3>
              <div className="flex gap-2">
                {(['mainnet', 'regtest'] as Network[]).map((network) => (
                  <button
                    key={network}
                    onClick={() => handleNetworkChange(network)}
                    className={`flex-1 py-2.5 px-3 rounded-xl text-sm font-medium transition-all ${selectedNetwork === network
                        ? 'bg-spark-primary text-white'
                        : 'bg-spark-surface border border-spark-border text-spark-text-secondary hover:text-spark-text-primary hover:border-spark-border-light'
                      }`}
                  >
                    {network === 'mainnet' ? 'Mainnet' : 'Regtest'}
                  </button>
                ))}
              </div>
              <p className="text-xs text-spark-text-muted mt-2">
                Changing network will reload the app and reconnect.
              </p>
            </div>
          )}

          {/* Prefer Spark */}
          {isDevMode && (
            <div className="bg-spark-dark border border-spark-border rounded-2xl p-4">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <span className="font-display font-medium text-spark-text-primary block">Prefer Spark</span>
                  <span className="text-sm text-spark-text-muted">Use Spark address over Lightning invoice when available</span>
                </div>
                <Switch
                  checked={preferSparkOverLightning}
                  onChange={() => setPreferSparkOverLightning(!preferSparkOverLightning)}
                />
              </div>
            </div>
          )}

          {/* Sync Settings */}
          {isDevMode && (
            <div className="bg-spark-dark border border-spark-border rounded-2xl p-4">
              <h3 className="font-display font-semibold text-spark-text-primary mb-3">Sync Settings</h3>
              <FormGroup>
                <label htmlFor="sync-interval" className="block text-sm text-spark-text-secondary mb-1">
                  Sync interval (seconds)
                </label>
                <FormInput
                  id="sync-interval"
                  type="number"
                  min={0}
                  value={syncIntervalSecs}
                  onChange={(e) => setSyncIntervalSecs(e.target.value)}
                  placeholder="e.g. 30"
                />
              </FormGroup>
            </div>
          )}

          {/* Dev mode only: this is what you reach for if Spark stops operating,
              not a feature, and starting one moves the whole balance on-chain
              at the cost of mining fees. An exit already running stays on the
              transaction list either way, so nothing in flight is stranded by
              turning dev mode back off. */}
          {isDevMode && (
          <div className="bg-spark-dark border border-spark-border rounded-2xl p-4">
            <h3 className="font-display font-semibold text-spark-text-primary mb-1">Unilateral Exit</h3>
            <p className="text-sm text-spark-text-muted mb-3">
              Move your balance on-chain without Spark operators.
            </p>
            <button
              className="flex items-center justify-between w-full px-4 py-3 text-sm font-medium border border-spark-warn-border rounded-xl text-spark-warn-text hover:bg-white/5 transition-colors"
              type="button"
              onClick={onOpenUnilateralExit}
              data-testid="settings-unilateral-exit"
            >
              <div className="flex items-center gap-3">
                <LogoutIcon size="md" />
                <span>Start Unilateral Exit</span>
              </div>
              <ChevronRightIcon size="md" />
            </button>
            {/* The warning belongs with the decision to start, so it is here
                rather than on the first screen of the flow it introduces.
                Under the button, where it reads as the caveat on pressing it
                rather than part of the description above. */}
            <p className="text-xs text-spark-primary mt-2">
              Use this only if Spark stops operating. This is a last-resort action.
            </p>
          </div>
          )}

          {onOpenWalletTour && (
            <section className="bg-spark-dark border border-spark-border rounded-2xl p-4 space-y-3"
              aria-label={copy.help} data-testid="settings-wallet-guide">
              <h3 className="font-display font-semibold text-spark-text-primary">{copy.help}</h3>
              <button type="button" onClick={onOpenWalletTour}
                className="flex min-h-11 w-full items-center justify-between gap-3 rounded-xl border border-spark-border px-4 py-3 text-sm font-medium text-spark-text-secondary hover:text-spark-text-primary hover:bg-white/5">
                <span>{setupCopy.replay}</span><ChevronRightIcon size="md"/>
              </button>
              <p className="text-xs leading-relaxed text-spark-text-muted">{setupCopy.replayDescription}</p>
            </section>
          )}

          {/* Account deletion (App Store 5.1.1(v)): opens the guide
              explaining how to delete the account (logout wipes the
              device) and remove the passkey. Reachable without dev
              mode. Stays the last section: new ones go above it. */}
          <div className="bg-spark-dark border border-spark-border rounded-2xl p-4">
            <h3 className="font-display font-semibold text-spark-text-primary mb-3">{t("Account")}</h3>
            <button
              className="flex items-center justify-between w-full px-4 py-3 text-sm font-medium border border-spark-warning/40 rounded-xl text-spark-warning hover:bg-spark-warning/10 transition-colors"
              type="button"
              onClick={() => { void openExternalUrl(ACCOUNT_DELETION_GUIDE_URL+'?lang='+encodeURIComponent(language)); }}
            >
              <div className="flex items-center gap-3">
                <TrashIcon size="md" />
                <span>{t("How to delete your account")}</span>
              </div>
              <ExternalLinkIcon size="sm" />
            </button>
          </div>

          {/* Version / Dev Mode Toggle */}
          <div className="text-center pt-4">
            <button
              onClick={devTap}
              className="text-spark-text-muted text-xs hover:text-spark-text-secondary transition-colors select-none"
            >
              GetYourSats v{appVersion}
              {isDevMode && <span className="ml-1 text-spark-primary">(dev)</span>}
            </button>
            {devTapCount > 0 && devTapCount < devTapThreshold && (
              <p className="text-xs text-spark-text-muted mt-1">
                {devTapThreshold - devTapCount} more taps to {isDevMode ? 'disable' : 'enable'} dev mode
              </p>
            )}
          </div>
        </div>
      </div>

      <ConfirmDialog
        isOpen={exportGate === 'confirm'}
        title="Export Database"
        message="This saves your full payment history, including invoices and contacts, to a file you can share. Only do this if you were asked for it, and only send it to someone you trust."
        confirmLabel="Export"
        variant="warning"
        onConfirm={() => { void runExportDb(); }}
        onCancel={() => setExportGate(null)}
      />
    </SlideInPage>
  );
};

export default SettingsPage;
