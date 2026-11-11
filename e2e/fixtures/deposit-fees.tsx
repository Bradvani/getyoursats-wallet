// Development-only acceptance fixture. It imports production UI but never
// connects an SDK, loads a wallet seed or sends any real funds.
import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import type { BreezSdk, ClaimDepositRequest, DepositInfo, FetchClaimDepositQuoteResponse, GetInfoResponse } from '@breeztech/breez-sdk-spark';
import '../../src/index.css';
import '../../src/getyoursats/premium.css';
import '../../src/getyoursats/appearance.css';
import AppShell from '../../src/components/layout/AppShell';
import { WalletProvider, WalletInfoProvider } from '../../src/contexts/WalletContext';
import { ToastProvider } from '../../src/contexts/ToastContext';
import { FiatDataProvider } from '../../src/contexts/FiatDataContext';
import { StableBalanceProvider } from '../../src/contexts/StableBalanceContext';
import ReceivePaymentDialog from '../../src/features/receive/ReceivePaymentDialog';
import UnclaimedDepositDetailsPage from '../../src/pages/UnclaimedDepositDetailsPage';
import { initPresentation, setAppearancePreference } from '../../src/services/presentationPreferences';
import { getSettings, saveSettings } from '../../src/services/settings';

if (!import.meta.env.DEV) throw new Error('Deposit acceptance fixture must not run in production');

const params = new URLSearchParams(location.search);
const mode = params.get('mode') ?? 'deposit';
const automatic = params.has('automatic');
const future = params.has('future');
const claims: ClaimDepositRequest[] = [];
const deposit: DepositInfo = { txid: 'a'.repeat(64), vout: 0, amountSats: 100_000, isMature: false };
const quote: FetchClaimDepositQuoteResponse = {
  amountSats: 100_000,
  confirmations: future ? 0 : 1,
  mature: { confirmationsRequired: 3, feeSats: 198, creditAmountSats: 99_802, isEstimate: true },
  instant: { confirmationsRequired: 1, feeSats: automatic ? 347 : 3_200, creditAmountSats: automatic ? 99_653 : 96_800, isEstimate: false },
};
const info: GetInfoResponse = { identityPubkey: 'a'.repeat(66), balanceSats: 0, recoverableFundsSats: 0, tokenBalances: new Map() };
const methods: Partial<BreezSdk> = {
  getInfo: async () => info,
  getUserSettings: async () => ({ sparkPrivateModeEnabled: false }),
  getLightningAddress: async () => ({ description: 'Synthetic fixture address', username: 'fixture', lightningAddress: 'fixture@example.invalid', lnurl: { bech32: 'lnurl1syntheticfixture', url: 'https://example.invalid/lnurl' } }),
  listFiatCurrencies: async () => ({ currencies: [] }),
  listFiatRates: async () => ({ rates: [{ coin: 'USD', value: 90_000 }] }),
  getTokensMetadata: async () => ({ tokensMetadata: [] }),
  receivePayment: async ({ paymentMethod }) => {
    if (paymentMethod.type !== 'bitcoinAddress') throw new Error('Only a synthetic Bitcoin address is available');
    return { paymentRequest: 'bc1qsyntheticdepositfixture0000000000000000000', fee: 0n };
  },
  fetchClaimDepositQuote: async () => quote,
  listUnclaimedDeposits: async () => ({ deposits: [deposit] }),
  claimDeposit: async request => {
    claims.push(request);
    deposit.maxClaimFee = request.maxFee;
    return { outcome: { type: 'deferred', reason: { type: 'noEarlyClaimAvailable' } } };
  },
};
const sdk = new Proxy(methods, {
  get(target, key) {
    if (key === 'then') return undefined;
    if (key in target) return target[key as keyof typeof target];
    return async () => { throw new Error('Unexpected fixture SDK operation: ' + String(key)); };
  },
}) as BreezSdk;

Object.assign(window, { __depositFeeEvidence: () => ({ claims, settings: getSettings() }) });
saveSettings({ depositMaxFee: { type: 'fixed', amount: 500 } });
initPresentation();
setAppearancePreference(params.get('theme') === 'dark' ? 'dark' : 'orange');

function Fixture() {
  const [open, setOpen] = useState(true);
  return <AppShell><ToastProvider><WalletProvider client={sdk} isConnected><WalletInfoProvider walletInfo={info}><FiatDataProvider><StableBalanceProvider>
    {open ? mode === 'receive'
      ? <ReceivePaymentDialog isOpen onClose={() => setOpen(false)}/>
      : <UnclaimedDepositDetailsPage deposit={deposit} onBack={() => setOpen(false)}/>
      : <p data-testid="deposit-fixture-closed">Closed</p>}
  </StableBalanceProvider></FiatDataProvider></WalletInfoProvider></WalletProvider></ToastProvider></AppShell>;
}

createRoot(document.getElementById('root')!).render(<Fixture/>);
