import {useState} from 'react';
import {createRoot} from 'react-dom/client';
import type {BreezSdk, LightningAddressInfo, Payment} from '@breeztech/breez-sdk-spark';
import '../../src/index.css';
import '../../src/getyoursats/premium.css';
import '../../src/getyoursats/appearance.css';
import {initPresentation} from '../../src/services/presentationPreferences';
import {saveFiatSettings, setDisplayFiatCurrency} from '../../src/services/settings';
import {WalletProvider} from '../../src/contexts/WalletContext';
import {ToastProvider} from '../../src/contexts/ToastContext';
import {FiatDataProvider} from '../../src/contexts/FiatDataContext';
import {StableBalanceProvider} from '../../src/contexts/StableBalanceContext';
import {BottomSheetContainer, BottomSheetCard, DialogHeader} from '../../src/components/ui';
import {usePresentation} from '../../src/hooks/usePresentation';
import {PAYMENT_UX} from '../../src/locales/paymentUx';
import ConfirmStep from '../../src/features/send/steps/ConfirmStep';
import AmountStep from '../../src/features/send/steps/AmountStep';
import ProcessingStep from '../../src/features/send/steps/ProcessingStep';
import ResultStep from '../../src/features/send/steps/ResultStep';
import ReceivePaymentDialog from '../../src/features/receive/ReceivePaymentDialog';
import PaymentCelebration from '../../src/components/PaymentCelebration';
import MarketPulse from '../../src/getyoursats/MarketPulse';

const params = new URLSearchParams(location.search);
const screen = params.get('screen') ?? 'confirm';
const address: LightningAddressInfo = {
  username: 'preview', description: 'Disposable fixture', lightningAddress: 'preview@example.invalid',
  lnurl: {url: 'https://example.invalid/lnurl', bech32: 'lnurl1demonstrationonly'},
};
const personal = {...address, lightningAddress: 'preview@getyoursats.com'};
const sdk = new Proxy({
  getUserSettings: async () => ({sparkPrivateModeEnabled: false}),
  getInfo: async () => ({identityPubkey: 'disposable-fixture', recoverableFundsSats: 0, balanceSats: 2_000_000, tokenBalances: new Map()}),
  getLightningAddress: async () => address,
  listFiatCurrencies: async () => ({currencies: []}),
  listFiatRates: async () => ({rates: params.get('rate') === 'missing' ? [] : [{coin:'USD',value:100_000},{coin:'INR',value:8_000_000}]}),
  receivePayment: async () => ({paymentRequest:'bc1qdisposablefixtureonly',fee:0n}),
  sendPayment: async () => {throw new Error('Sending is forbidden in this fixture');},
} satisfies Partial<BreezSdk>, {get(target, key) {return target[key as keyof typeof target] ?? (async () => ({}));}}) as unknown as BreezSdk;

function Fixture() {
  const [open, setOpen] = useState(true);
  const {language} = usePresentation();
  const close = () => setOpen(false);
  return <ToastProvider><WalletProvider client={sdk} isConnected preferredLightningAddress={screen === 'receive-personal' ? personal : null}>
    <FiatDataProvider><StableBalanceProvider>
      {screen === 'market' ? <MarketPulse />
      : screen.startsWith('receive-') ? <ReceivePaymentDialog isOpen={open} onClose={close} />
      : screen === 'received' && open ? <PaymentCelebration payment={{id:'disposable',paymentType:'receive',status:'completed',amount:5000n,fees:0n,timestamp:1,method:'lightning'} as Payment} onClose={close} />
      : <BottomSheetContainer isOpen={open} onClose={close} showBackdrop><BottomSheetCard>
        <DialogHeader title={PAYMENT_UX[language].pay} onClose={close} />
        {screen === 'confirm' ? <ConfirmStep amountSats={1_500_000n} feesSat={2} balanceSats={2_000_000} destination={{label:PAYMENT_UX[language].recipient,value:'disposable@example.invalid'}} error={null} isLoading={false} onConfirm={close} />
        : screen === 'amount' ? <AmountStep paymentInput="disposable@example.invalid" amount="" balanceSats={2_000_000} isLoading={false} error={null} onBack={close} onNext={close} />
        : screen === 'sent' || screen === 'failed' ? <ResultStep result={screen === 'sent' ? 'success' : 'failure'} error={null} onClose={close} />
        : <ProcessingStep operationType={screen === 'receiving' ? 'withdraw' : 'payment'} processingPhase={screen === 'converting' ? 'converting' : 'sending'} />}
      </BottomSheetCard></BottomSheetContainer>}
      {!open && <p role="status">Disposable preview closed. No payment submitted.</p>}
    </StableBalanceProvider></FiatDataProvider>
  </WalletProvider></ToastProvider>;
}

initPresentation();
saveFiatSettings({selectedCurrencies:['INR','USD']});
setDisplayFiatCurrency(params.get('currency') === 'USD' ? 'USD' : 'INR');
const scale = Number(params.get('scale'));
document.documentElement.style.fontSize = `${[100,150,200].includes(scale) ? scale : 100}%`;
createRoot(document.getElementById('root')!).render(<Fixture />);
