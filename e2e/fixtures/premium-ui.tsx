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

const info: GetInfoResponse = { identityPubkey: 'fixture-identity', balanceSats: 125000, recoverableFundsSats: 0, tokenBalances: new Map() };
const received = { id: 'fixture-receive', paymentType: 'receive', status: 'completed', amount: 5000n, fees: 0n, timestamp: Math.floor(Date.now()/1000), method: 'lightning' } as Payment;
const sdk = new Proxy({
 getInfo: async () => info,
 listContacts: async () => [],
 addEventListener: async () => 'fixture-listener',
 removeEventListener: async () => true,
 getLightningAddress: async () => ({ description: 'UI preview', username: 'preview', lightningAddress: 'preview@example.invalid', lnurl: { bech32: 'lnurl1demonstrationonly', url: 'https://example.invalid/lnurl' } }),
 listFiatCurrencies: async () => ({ currencies: [{ id: 'USD', name: 'US Dollar', info: {name:'US Dollar',localizedName:[],localeOverrides:[],fractionSize:2,spacing:0,symbol:{grapheme:'$',template:'$1',rtl:false,position:1}} }] }),
 listFiatRates: async () => ({ rates: [{ coin:'USD', value:90000 }] }),
 getUserSettings: async () => ({ sparkPrivateModeEnabled: false }),
 getTokensMetadata: async () => ({tokensMetadata: []}),
 receivePayment: async () => ({ paymentRequest: 'lnbc1'+'a'.repeat(90), fee: 0n }),
 listPayments: async () => ({ payments: [received] }),
} satisfies Partial<BreezSdk>, { get(target, key) { return target[key as keyof typeof target] ?? (async () => ({})); } }) as unknown as BreezSdk;
function Fixture() {
 const [screen,setScreen]=useState(new URLSearchParams(location.search).get('screen') || 'wallet');
 const close=()=>setScreen('wallet');
 return <ToastProvider><WalletProvider client={sdk} isConnected><WalletInfoProvider walletInfo={info}><FiatDataProvider><StableBalanceProvider><ContactsProvider>
  {screen==='wallet' ? <WalletPage walletInfo={info} transactions={[received]} unclaimedDeposits={[]} refreshWalletData={async()=>true} isSyncing={false} error={null} onClearError={()=>{}} onLogout={close} hasRejectedDeposits={false} onOpenGetRefund={()=>{}} onOpenSettings={()=>setScreen('settings')} onOpenDca={()=>setScreen('dca')} onOpenUnilateralExit={()=>{}} onBuyBitcoin={async()=>{}} />
  : screen==='settings' ? <SettingsPage onBack={close} config={null} onOpenFiatCurrencies={()=>{}} onOpenBuyProviders={()=>{}} onOpenPasskeySettings={()=>{}} onOpenSecurity={()=>{}} onOpenBackup={()=>setScreen('backup')} onOpenEmail={()=>{}} onOpenUnilateralExit={()=>{}} />
  : screen==='dca' ? <h1>Recurring Buys entry reached</h1>
  : screen==='backup' ? <h1>Recovery entry reached</h1>
  : screen==='received' ? <PaymentCelebration payment={received} onClose={close}/>
  : screen==='sent' || screen==='failed' ? <ResultStep result={screen==='sent'?'success':'failure'} error={screen==='failed'?'Network unavailable':null} onClose={close}/>
  : <ProcessingStep processingPhase={screen==='converting'?'converting':'sending'} operationType={screen==='receiving'?'withdraw':'payment'} />}
 </ContactsProvider></StableBalanceProvider></FiatDataProvider></WalletInfoProvider></WalletProvider></ToastProvider>;
}
createRoot(document.getElementById('root')!).render(<Fixture />);
