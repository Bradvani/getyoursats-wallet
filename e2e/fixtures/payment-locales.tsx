import { usePresentation } from '../../src/hooks/usePresentation';
import { PAYMENT_UX } from '../../src/locales/paymentUx';
// Disposable UI doubles. No payment, signing or network SDK connection.
import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import type {
  BreezSdk,
  PrepareLnurlPayResponse,
} from '@breeztech/breez-sdk-spark';
import '../../src/index.css';
import '../../src/getyoursats/premium.css';
import '../../src/getyoursats/appearance.css';
import { initPresentation } from '../../src/services/presentationPreferences';
import { WalletProvider } from '../../src/contexts/WalletContext';
import { FiatDataProvider } from '../../src/contexts/FiatDataContext';
import { StableBalanceProvider } from '../../src/contexts/StableBalanceContext';
import {
  BottomSheetContainer,
  BottomSheetCard,
  DialogHeader,
} from '../../src/components/ui';
import LanguageSelect from '../../src/components/LanguageSelect';
import LnurlWorkflow from '../../src/features/send/workflows/LnurlWorkflow';
const sdk = {
  getUserSettings: async () => ({}),
  getInfo: async () => ({ balanceSats: 2049, tokenBalances: new Map() }),
  listFiatCurrencies: async () => ({ currencies: [] }),
  listFiatRates: async () => ({ rates: [] }),
} as unknown as BreezSdk;
function Fixture() {
  const { language } = usePresentation();
  const [balance, setBalance] = useState<number | undefined>(2049);
  const [open, setOpen] = useState(true);
  const selector = new URLSearchParams(location.search).has('languages');
  return (
    <WalletProvider client={sdk}>
      <FiatDataProvider>
        <StableBalanceProvider>
          <div className="p-4 max-w-lg mx-auto">
            <button onClick={() => setBalance(1500)}>Update balance</button>
            <button onClick={() => setOpen(true)}>Open</button>
          </div>
          <BottomSheetContainer
            isOpen={open}
            onClose={() => setOpen(false)}
            showBackdrop
          >
            <BottomSheetCard>
              <DialogHeader
                title={selector ? 'Languages' : PAYMENT_UX[language].pay}
                onClose={() => setOpen(false)}
              />
              <div className="px-5 pb-5">
                {selector ? (
                  <LanguageSelect />
                ) : (
                  <LnurlWorkflow
                    parsed={{
                      callback: 'https://example.invalid',
                      minSendable: 1000,
                      maxSendable: 200_000_000_000,
                      metadataStr: '[["text/plain","Moto"]]',
                      commentAllowed: 255,
                      domain: 'example.invalid',
                      url: 'https://example.invalid',
                    }}
                    balanceSats={balance}
                    onBack={() => setOpen(false)}
                    onRun={async () => {}}
                    onPay={async () => {}}
                    onPrepare={async (args) =>
                      ({
                        amountSats: Number(args.amount),
                        feeSats: 2,
                      }) as PrepareLnurlPayResponse
                    }
                  />
                )}
              </div>
            </BottomSheetCard>
          </BottomSheetContainer>
        </StableBalanceProvider>
      </FiatDataProvider>
    </WalletProvider>
  );
}
initPresentation();
createRoot(document.getElementById('root')!).render(<Fixture />);
