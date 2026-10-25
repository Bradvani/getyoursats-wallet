// Isolated UI fixture: no SDK connection, keys or real transactions.
import { createRoot } from 'react-dom/client';
import type { BreezSdk, CrossChainRoutePair, GetInfoResponse, PrepareSendPaymentRequest } from '@breeztech/breez-sdk-spark';
import '../../src/index.css';
import '../../src/getyoursats/premium.css';
import '../../src/getyoursats/appearance.css';
import { initPresentation } from '../../src/services/presentationPreferences';
import { WalletProvider, WalletInfoProvider } from '../../src/contexts/WalletContext';
import { FiatDataProvider } from '../../src/contexts/FiatDataContext';
import { StableBalanceProvider } from '../../src/contexts/StableBalanceContext';
import { ContactsProvider } from '../../src/contexts/ContactsContext';
import { ToastProvider } from '../../src/contexts/ToastContext';
import SendPaymentDialog from '../../src/features/send/SendPaymentDialog';

const info = { balanceSats: 100000, tokenBalances: new Map() } as GetInfoResponse;
const route = (chain: string, asset: string) => ({ chain, asset, provider: 'orchestra', decimals: 6,
  acceptedAssets: [{ asset: { type: 'bitcoin' } }], deliveryMethods: ['spark'], exactOutEligible: false }) as CrossChainRoutePair;
const sdk = {
  getUserSettings: async () => ({}),
  getInfo: async () => info,
  listContacts: async () => [],
  addEventListener: async () => 'disposable',
  removeEventListener: async () => {},
  listFiatCurrencies: async () => ({ currencies: [] }),
  listFiatRates: async () => ({ rates: [{ coin: 'USD', value: 100000 }] }),
  parse: async (input: string) => {
    if (!input.startsWith('0x') && !input.startsWith('T') && !input.startsWith('So')) throw new Error('Invalid fixture address');
    return { type: 'crossChainAddress', address: input, addressFamily: input.startsWith('0x') ? 'evm' : input.startsWith('T') ? 'tron' : 'solana' };
  },
  getCrossChainRoutes: async ({ addressDetails }: { addressDetails: { addressFamily: string } }) =>
    addressDetails.addressFamily === 'evm' ? [route('base', 'USDC'), route('ethereum', 'USDC'), route('ethereum', 'USDT')]
      : addressDetails.addressFamily === 'tron' ? [route('tron', 'USDT')] : [route('solana', 'USDC')],
  prepareSendPayment: async (request: PrepareSendPaymentRequest) => {
    if (request.paymentRequest.type !== 'crossChain') throw new Error('Unexpected fixture request');
    return { amount: request.amount, paymentMethod: { type: 'crossChainAddress', route: request.paymentRequest.route,
      recipientAddress: request.paymentRequest.address, amountIn: request.amount, assetAmountIn: 10000000n,
      estimatedOut: 9900000n, feeAmount: 100000n, sourceTransferFeeSats: 0, serviceFeeAmount: 100000n,
      feeMode: 'feesIncluded', expiresAt: '2099-01-01T00:00:00Z', providerContext: {} } };
  },
  sendPayment: async () => { throw new Error('Sending is forbidden in this UI fixture'); },
} as unknown as BreezSdk;

initPresentation();
createRoot(document.getElementById('root')!).render(
  <ToastProvider><WalletProvider client={sdk} isConnected><WalletInfoProvider walletInfo={info}>
    <FiatDataProvider><StableBalanceProvider><ContactsProvider>
      <SendPaymentDialog isOpen onClose={() => {}} />
    </ContactsProvider></StableBalanceProvider></FiatDataProvider>
  </WalletInfoProvider></WalletProvider></ToastProvider>,
);
