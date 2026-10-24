// Dev-only browser fixture. Vite's production entry never imports this file.
// All SDK methods are local doubles; no wallet or network payment is created.
import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import type { BreezSdk, GetInfoResponse, Payment } from '@breeztech/breez-sdk-spark';
import '../../src/index.css';
import '../../src/getyoursats/premium.css';
import { WalletProvider, WalletInfoProvider } from '../../src/contexts/WalletContext';
import { ToastProvider } from '../../src/contexts/ToastContext';
import { FiatDataProvider } from '../../src/contexts/FiatDataContext';
import { StableBalanceProvider } from '../../src/contexts/StableBalanceContext';
import { ContactsProvider } from '../../src/contexts/ContactsContext';
import WalletPage from '../../src/pages/WalletPage';
import SettingsPage from '../../src/pages/SettingsPage';
import ProcessingStep from '../../src/features/send/steps/ProcessingStep';
import ResultStep from '../../src/features/send/steps/ResultStep';
import PaymentCelebration from '../../src/components/PaymentCelebration';

const info = { balanceSats: 125000, tokenBalances: new Map() } as unknown as GetInfoResponse;
const received = { id: 'fixture-receive', paymentType: 'receive', status: 'completed', amount: 5000n, fees: 0n, timestamp: Math.floor(Date.now()/1000), method: 'lightning' } as Payment;
const sdk = new Proxy({
 getInfo: async () => info,
 listContacts: async () => [],
 addEventListener: async () => 'fixture-listener',
 removeEventListener: async () => undefined,
 getLightningAddress: async () => ({ lightningAddress: 'preview@example.invalid', lnurl: 'lnurl1demonstrationonly' }),
 listFiatCurrencies: async () => ({ currencies: [{ id: 'USD', name: 'US Dollar', info: {name:'US Dollar',fractionSize:2,spacing:0,symbol:{grapheme:'$',template:'$1',rtl:false,position:1}} }] }),
 listFiatRates: async () => ({ rates: [{ coin:'USD', value:90000 }] }),
 getUserSettings: async () => ({}),
 getTokensMetadata: async () => [],
 receivePayment: async () => ({ paymentRequest: 'bc1qdemonstrationonly', fee: 0 }),
 listPayments: async () => ({ payments: [received] }),
}, { get(target, key) { return target[key as keyof typeof target] ?? (async () => ({})); } }) as unknown as BreezSdk;
function Fixture() {
 const [screen,setScreen]=useState(new URLSearchParams(location.search).get('screen') || 'wallet');
 const close=()=>setScreen('wallet');
 return <ToastProvider><WalletProvider client={sdk} isConnected><WalletInfoProvider walletInfo={info}><FiatDataProvider><StableBalanceProvider><ContactsProvider>
  {screen==='wallet' ? <WalletPage walletInfo={info} transactions={[received]} unclaimedDeposits={[]} refreshWalletData={async()=>true} isSyncing={false} error={null} onClearError={()=>{}} onLogout={close} hasRejectedDeposits={false} onOpenGetRefund={()=>{}} onOpenSettings={()=>setScreen('settings')} onOpenBackup={()=>setScreen('backup')} onOpenDca={()=>{}} onOpenUnilateralExit={()=>{}} onBuyBitcoin={async()=>{}} />
  : screen==='settings' ? <SettingsPage onBack={close} config={null} onOpenFiatCurrencies={()=>{}} onOpenBuyProviders={()=>{}} onOpenPasskeySettings={()=>{}} onOpenSecurity={()=>{}} onOpenBackup={()=>setScreen('backup')} onOpenEmail={()=>{}} onOpenUnilateralExit={()=>{}} />
  : screen==='backup' ? <h1>Recovery entry reached</h1>
  : screen==='received' ? <PaymentCelebration payment={received} onClose={close}/>
  : screen==='sent' || screen==='failed' ? <ResultStep result={screen==='sent'?'success':'failure'} error={screen==='failed'?'Network unavailable':null} onClose={close}/>
  : <ProcessingStep processingPhase={screen==='converting'?'converting':'sending'} operationType={screen==='receiving'?'withdraw':'payment'} />}
 </ContactsProvider></StableBalanceProvider></FiatDataProvider></WalletInfoProvider></WalletProvider></ToastProvider>;
}
createRoot(document.getElementById('root')!).render(<Fixture />);
