import {createRoot} from 'react-dom/client';
import {QRCode} from 'react-qr-code';
import type {BreezSdk, GetInfoResponse, InputType} from '@breeztech/breez-sdk-spark';
import '../../src/index.css';
import '../../src/getyoursats/premium.css';
import '../../src/getyoursats/appearance.css';
import AppShell from '../../src/components/layout/AppShell';
import {WalletProvider, WalletInfoProvider, WalletStatusProvider} from '../../src/contexts/WalletContext';
import {ToastProvider} from '../../src/contexts/ToastContext';
import {FiatDataProvider} from '../../src/contexts/FiatDataContext';
import {StableBalanceProvider} from '../../src/contexts/StableBalanceContext';
import {ContactsProvider} from '../../src/contexts/ContactsContext';
import WalletPage from '../../src/pages/WalletPage';
import {initWebViewportManager} from '../../src/utils/webViewportManager';
import {initPresentation} from '../../src/services/presentationPreferences';

// Production never imports this fixture. All destinations and balances are synthetic.
const fixed = new URLSearchParams(location.search).get('kind') === 'fixed';
const rawInput = fixed ? 'lnbc1synthetic' : 'alice@example.invalid';
const info = {identityPubkey: `02${'c'.repeat(64)}`, balanceSats: 500000, recoverableFundsSats: 0,
  tokenBalances: new Map()} as GetInfoResponse;
const parsed = fixed ? {
  type: 'bolt11Invoice', amountMsat: 100000, invoice: {bolt11: rawInput},
} : {
  type: 'lightningAddress', address: rawInput,
  payRequest: {callback: 'https://example.invalid/pay', minSendable: 1000, maxSendable: 100000000,
    metadataStr: '[["text/plain","Synthetic recipient"]]', commentAllowed: new URLSearchParams(location.search).has('comments') ? 100 : 0,
    domain: 'example.invalid', url: 'https://example.invalid/pay', address: rawInput},
};
let parseCalls = 0;
let mutations = 0;
let pending: {resolve: (value: InputType) => void; reject: (error: Error) => void} | null = null;
const reads = {
  getInfo: async () => info,
  listContacts: async () => [],
  addEventListener: async () => 'isolated-scan-listener',
  removeEventListener: async () => true,
  getLightningAddress: async () => ({
    description: 'Isolated scan fixture', username: 'fixture', lightningAddress: 'fixture@example.invalid',
    lnurl: {bech32: 'lnurl1fixture', url: 'https://example.invalid/lnurl'},
  }),
  listFiatCurrencies: async () => ({currencies: []}),
  listFiatRates: async () => ({rates: [{coin: 'USD', value: 90000}]}),
  getUserSettings: async () => ({sparkPrivateModeEnabled: false}),
  getTokensMetadata: async () => ({tokensMetadata: []}),
  listPayments: async () => ({payments: []}),
  parse: (input: string) => {
    if (input !== rawInput) return Promise.reject(new Error('Unexpected synthetic input'));
    parseCalls += 1;
    return new Promise<InputType>((resolve, reject) => {pending = {resolve, reject};});
  },
} satisfies Partial<BreezSdk>;
const sdk = new Proxy(reads, {
  get(target, key) {
    if (key === 'then') return undefined;
    if (key in target) return target[key as keyof typeof target];
    return async () => {mutations += 1; throw new Error('SDK mutations are forbidden in the scan fixture');};
  },
}) as unknown as BreezSdk;

(window as Window & {__gysScanFixture?: unknown}).__gysScanFixture = {
  resolveInput() {const request = pending; pending = null; request?.resolve(parsed as InputType);},
  rejectInput() {const request = pending; pending = null; request?.reject(new Error('Destination service unavailable'));},
  evidence() {return {parseCalls, mutations, pending: pending !== null};},
};

initPresentation();
initWebViewportManager();
createRoot(document.getElementById('root')!).render(
  <AppShell><ToastProvider><WalletProvider client={sdk} isConnected><WalletInfoProvider walletInfo={info}>
    <WalletStatusProvider hasPendingConversion={false}><FiatDataProvider><StableBalanceProvider><ContactsProvider>
      <WalletPage walletInfo={info} transactions={[]} unclaimedDeposits={[]} refreshWalletData={async () => true}
        isSyncing={false} error={null} onClearError={() => {}} onLogout={() => {}} hasRejectedDeposits={false}
        onOpenGetRefund={() => {}} onOpenSettings={() => {}} onReturnToWallet={() => {}} settingsActive={false}
        onOpenDca={() => {}} onOpenUnilateralExit={() => {}} onBuyBitcoin={async () => {}}/>
      <div aria-hidden="true" data-fixture-qr style={{position: 'fixed', left: -10000, top: 0}}>
        <QRCode value={rawInput} size={256}/>
      </div>
    </ContactsProvider></StableBalanceProvider></FiatDataProvider></WalletStatusProvider>
  </WalletInfoProvider></WalletProvider></ToastProvider></AppShell>,
);
