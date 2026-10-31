import {useEffect, useMemo, useState} from 'react';
import {createRoot} from 'react-dom/client';
import type {BreezSdk, GetInfoResponse, LightningAddressInfo} from '@breeztech/breez-sdk-spark';
import '../../src/index.css';
import '../../src/getyoursats/premium.css';
import '../../src/getyoursats/appearance.css';
import AppShell from '../../src/components/layout/AppShell';
import SlideInPage from '../../src/components/layout/SlideInPage';
import {PrimaryButton, SecondaryButton} from '../../src/components/ui/buttons';
import {WalletProvider, WalletInfoProvider} from '../../src/contexts/WalletContext';
import {ToastProvider} from '../../src/contexts/ToastContext';
import {FiatDataProvider} from '../../src/contexts/FiatDataContext';
import {StableBalanceProvider} from '../../src/contexts/StableBalanceContext';
import {ContactsProvider} from '../../src/contexts/ContactsContext';
import WalletPage from '../../src/pages/WalletPage';
import SettingsPage from '../../src/pages/SettingsPage';
import {initPresentation} from '../../src/services/presentationPreferences';
import {useNewWalletSetup, useWalletSetup} from '../../src/hooks/useWalletSetup';
import {confirmWalletRecovery, type WalletRecoveryMethod} from '../../src/getyoursats/walletSetupState';

// The production entry never imports this fixture. No key, credential or SDK connection exists here.
const identities = {a: `02${'a'.repeat(64)}`, b: `03${'b'.repeat(64)}`} as const;
const unexpectedSdkCalls: string[] = [];
type FixtureWallet = keyof typeof identities;
type FixtureScreen = 'wallet' | 'settings' | 'recovery' | 'identity';
type FixtureControls = {
  selectWallet: (wallet: FixtureWallet) => void;
  setTourAllowed: (allowed: boolean) => void;
  unexpectedSdkCalls: readonly string[];
};
type FixtureWindow = Window & {__gysWalletSetupFixture?: FixtureControls};

function createReadOnlySdk(info: GetInfoResponse): BreezSdk {
  const reads = {
    getInfo: async () => info,
    listContacts: async () => [],
    addEventListener: async () => 'isolated-setup-listener',
    removeEventListener: async () => true,
    getLightningAddress: async () => ({
      description: 'Isolated setup fixture', username: 'setup', lightningAddress: 'setup@example.invalid',
      lnurl: {bech32: 'lnurl1fixture', url: 'https://example.invalid/lnurl'},
    }),
    listFiatCurrencies: async () => ({currencies: [{id: 'USD', name: 'US Dollar', info: {
      name: 'US Dollar', localizedName: [], localeOverrides: [], fractionSize: 2, spacing: 0,
      symbol: {grapheme: '$', template: '$1', rtl: false, position: 1},
    }}]}),
    listFiatRates: async () => ({rates: [{coin: 'USD', value: 90000}]}),
    getUserSettings: async () => ({sparkPrivateModeEnabled: false}),
    getTokensMetadata: async () => ({tokensMetadata: []}),
    listPayments: async () => ({payments: []}),
    receivePayment: async request => {
      // Receive preloads its Bitcoin address. Keep the response synthetic and
      // reject invoice creation so the POS preview cannot create a payment.
      if (request.paymentMethod.type === 'bitcoinAddress') {
        return {paymentRequest: 'fixture-bitcoin-address', fee: 0n};
      }
      unexpectedSdkCalls.push(`receivePayment:${request.paymentMethod.type}`);
      throw new Error('Payment creation is unavailable in the isolated setup fixture');
    },
  } satisfies Partial<BreezSdk>;
  return new Proxy(reads, {
    get(target, key) {
      if (key === 'then') return undefined;
      if (key in target) return target[key as keyof typeof target];
      return async () => {
        unexpectedSdkCalls.push(String(key));
        throw new Error('SDK mutations are unavailable in the isolated setup fixture');
      };
    },
  }) as unknown as BreezSdk;
}

function Fixture() {
  const parameters = useMemo(() => new URLSearchParams(location.search), []);
  const recoveryMethod: WalletRecoveryMethod = parameters.get('method') === 'phrase' ? 'phrase' : 'passkey';
  const fresh = parameters.get('entry') !== 'existing';
  const [wallet, setWallet] = useState<FixtureWallet>('a');
  const [screen, setScreen] = useState<FixtureScreen>('wallet');
  const [guideReplay, setGuideReplay] = useState(0);
  const [tourAllowed, setTourAllowed] = useState(parameters.get('covered') !== '1');
  const preferredAddress = useMemo<LightningAddressInfo | null>(() => parameters.get('named') === '1' ? {
    description: 'Synthetic named wallet', username: 'setupfixture', lightningAddress: 'setupfixture@getyoursats.com',
    lnurl: {bech32: 'lnurl1fixture', url: 'https://getyoursats.com/.well-known/lnurlp/setupfixture'},
  } : null, [parameters]);
  const info = useMemo<GetInfoResponse>(() => ({
    identityPubkey: identities[wallet], balanceSats: 0, recoverableFundsSats: 0, tokenBalances: new Map(),
  }), [wallet]);
  const sdk = useMemo(() => createReadOnlySdk(info), [info]);
  const setup = useWalletSetup(info.identityPubkey, 'mainnet');
  const creation = useMemo(() => fresh ? {client: sdk, phraseVerified: recoveryMethod === 'phrase'} : null,
    [fresh, sdk, recoveryMethod]);
  useNewWalletSetup({creation, client: sdk, connected: true, scope: setup.scope});
  const close = () => setScreen('wallet');

  useEffect(() => {
    const controls: FixtureControls = {
      selectWallet(next) {
        if (!(next in identities)) throw new Error('Unknown synthetic wallet');
        setScreen('wallet');
        setWallet(next);
      },
      setTourAllowed,
      unexpectedSdkCalls,
    };
    (window as FixtureWindow).__gysWalletSetupFixture = controls;
    return () => {delete (window as FixtureWindow).__gysWalletSetupFixture;};
  }, []);

  const confirmFixtureRecovery = (status: 'passkey-reviewed' | 'phrase-verified') => {
    confirmWalletRecovery(setup.scope, status);
    close();
  };
  const openTour = () => {
    setup.beginTour(true);
    setGuideReplay(value => value + 1);
    close();
  };

  return (
    <ToastProvider><WalletProvider client={sdk} isConnected preferredLightningAddress={preferredAddress}><WalletInfoProvider walletInfo={info}>
      <FiatDataProvider><StableBalanceProvider><ContactsProvider>
        <WalletPage key={guideReplay} walletInfo={info} transactions={[]} unclaimedDeposits={[]}
          refreshWalletData={async () => true} isSyncing={false} error={null} onClearError={() => {}}
          onLogout={close} hasRejectedDeposits={false} onOpenGetRefund={() => {}}
          onReturnToWallet={close} settingsActive={screen !== 'wallet'} onOpenSettings={() => setScreen('settings')}
          onOpenDca={() => {}} onOpenUnilateralExit={() => {}} onBuyBitcoin={async () => {}}
          walletSetup={setup} recoveryMethod={recoveryMethod} setupTourAllowed={screen === 'wallet' && tourAllowed}
          onReviewRecovery={() => setScreen('recovery')} onPersonalizeAddress={() => setScreen('identity')}/>
        {screen === 'settings' && <SettingsPage onOpenLanguage={()=>{}} onOpenAppearance={()=>{}} onBack={close} config={null}
          onOpenFiatCurrencies={() => {}} onOpenBuyProviders={() => {}} onOpenPasskeySettings={() => {}}
          onOpenSecurity={() => {}} onOpenBackup={() => setScreen('recovery')}
          onOpenEmail={() => setScreen('identity')} onOpenUnilateralExit={() => {}}
          onOpenWalletTour={openTour}/>}
        {screen === 'recovery' && <SlideInPage title="Recovery Fixture" onClose={close}
          footer={<div className="space-y-2">
            <PrimaryButton className="w-full" onClick={() => confirmFixtureRecovery('phrase-verified')}>Confirm Fixture Backup</PrimaryButton>
            {recoveryMethod === 'passkey' && <SecondaryButton className="w-full"
              onClick={() => confirmFixtureRecovery('passkey-reviewed')}>Confirm Fixture Passkey Review</SecondaryButton>}
          </div>}>
          <div className="p-6 text-spark-text-primary">
            <p>This isolated test destination models a completed recovery review. It never opens recovery words or a passkey prompt.</p>
            <button type="button" className="min-h-11" onClick={close}>Cancel Fixture Recovery</button>
          </div>
        </SlideInPage>}
        {screen === 'identity' && <SlideInPage title="Personalise Fixture" onClose={close}
          footer={<PrimaryButton className="w-full" onClick={close}>Return to Wallet</PrimaryButton>}>
          <div className="p-6 text-spark-text-primary">No verification email or name registration occurs in this fixture.</div>
        </SlideInPage>}
      </ContactsProvider></StableBalanceProvider></FiatDataProvider>
    </WalletInfoProvider></WalletProvider></ToastProvider>
  );
}

initPresentation();
createRoot(document.getElementById('root')!).render(<AppShell><Fixture/></AppShell>);
