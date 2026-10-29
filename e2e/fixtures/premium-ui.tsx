import AppShell from '../../src/components/layout/AppShell';
import {BROWSER_SPENDING_POLICY} from '../../src/security/browserReleasePolicy';
// Dev-only browser fixture. Vite's production entry never imports this file.
// All SDK methods are local doubles; no wallet or network payment is created.
import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import type { BreezSdk, GetInfoResponse, Payment, ReceivePaymentRequest, SdkEvent } from '@breeztech/breez-sdk-spark';
import '../../src/index.css';
import '../../src/getyoursats/premium.css';
import '../../src/getyoursats/appearance.css';
import { initPresentation } from '../../src/services/presentationPreferences';
import { WalletProvider, WalletInfoProvider } from '../../src/contexts/WalletContext';
import { ToastProvider } from '../../src/contexts/ToastContext';
import { FiatDataProvider } from '../../src/contexts/FiatDataContext';
import { StableBalanceProvider } from '../../src/contexts/StableBalanceContext';
import { ContactsProvider } from '../../src/contexts/ContactsContext';
import WalletPage from '../../src/pages/WalletPage';
import SettingsPage from '../../src/pages/SettingsPage';
import ProcessingStep from '../../src/features/send/steps/ProcessingStep';
import ResultStep from '../../src/features/send/steps/ResultStep';
import BrandIntro from '../../src/components/BrandIntro';
import StartupLogo from '../../src/components/StartupLogo';
import PaymentCelebration from '../../src/components/PaymentCelebration';

const info: GetInfoResponse = { identityPubkey: '02'+'a'.repeat(64), balanceSats: 125000, recoverableFundsSats: 0, tokenBalances: new Map() };
const received = { id: 'fixture-receive', paymentType: 'receive', status: 'completed', amount: 5000n, fees: 0n, timestamp: Math.floor(Date.now()/1000), method: 'lightning' } as Payment;

// Explicit, dev-only settlement trigger. This synthetic invoice is not payable.
// Charge never adds a completed receipt until the test requests it.
const merchantInvoice='lnbc1'+'a'.repeat(90);
let merchantAmountSats=1000;
const posReceived = {
  id:'fixture-pos-settled',paymentType:'receive',status:'completed',
  amount:1000n,fees:0n,timestamp:Math.floor(Date.now()/1000),method:'lightning',
  details:{type:'lightning',invoice:merchantInvoice}
} as unknown as Payment;
let merchantPaid=false;
const receiveRequests:string[]=[];
(window as Window & {__gysFixtureReceiveRequests?:string[]}).__gysFixtureReceiveRequests=receiveRequests;
const mockEventSubscribers=new Set<(event:SdkEvent)=>void>();
const subscribeToSdkEvents=(listener:(event:SdkEvent)=>void)=>{
  mockEventSubscribers.add(listener);
  return ()=>{mockEventSubscribers.delete(listener);};
};
(window as Window & {__gysFixtureSettlePos?:()=>void}).__gysFixtureSettlePos=()=>{
  if(merchantPaid)return;
  merchantPaid=true;
  posReceived.amount=BigInt(merchantAmountSats);
  for(const listener of mockEventSubscribers){
    listener({type:'paymentSucceeded',payment:posReceived} as SdkEvent);
  }
};
const sdk = new Proxy({
 parse: async()=>({type:'bolt11Invoice',timestamp:Math.floor(Date.now()/1000),expiry:3600,network:'bitcoin',invoice:{bolt11:merchantInvoice,source:{type:'bolt11'}},paymentHash:'b'.repeat(64),amountMsat:merchantAmountSats*1000}) as unknown as Awaited<ReturnType<BreezSdk['parse']>>,
 getInfo: async () => info,
 listContacts: async () => [],
 addEventListener: async () => 'fixture-listener',
 removeEventListener: async () => true,
 getLightningAddress: async () => ({ description: 'UI preview', username: 'preview', lightningAddress: 'preview@example.invalid', lnurl: { bech32: 'lnurl1demonstrationonly', url: 'https://example.invalid/lnurl' } }),
 listFiatCurrencies: async () => ({ currencies: [{ id: 'USD', name: 'US Dollar', info: {name:'US Dollar',localizedName:[],localeOverrides:[],fractionSize:2,spacing:0,symbol:{grapheme:'$',template:'$1',rtl:false,position:1}} }] }),
 listFiatRates: async () => ({ rates: [{ coin:'USD', value:90000 }] }),
 getUserSettings: async () => ({ sparkPrivateModeEnabled: false }),
 getTokensMetadata: async () => ({tokensMetadata: []}),
 receivePayment: async (request:ReceivePaymentRequest) => {
  receiveRequests.push(request.paymentMethod.type);
  if(request.paymentMethod.type==='bolt11Invoice'){
   merchantAmountSats=request.paymentMethod.amountSats??0;
   merchantPaid=false;
  }
  return {paymentRequest:request.paymentMethod.type==='sparkAddress'?'spark1syntheticfixture':merchantInvoice,fee:0n};
 },
 listPayments: async () => ({ payments: merchantPaid ? [posReceived,received] : [received] }),
} satisfies Partial<BreezSdk>, { get(target, key) {
 if(key===BROWSER_SPENDING_POLICY)return new URLSearchParams(location.search).get('securityPreview')==='yes';
 return target[key as keyof typeof target] ?? (async () => ({}));
} }) as unknown as BreezSdk;
function Fixture() {
 const [screen,setScreen]=useState(new URLSearchParams(location.search).get('screen') || 'wallet');
 const close=()=>setScreen('wallet');
 return <ToastProvider><WalletProvider client={sdk} isConnected subscribeToSdkEvents={subscribeToSdkEvents}><WalletInfoProvider walletInfo={info}><FiatDataProvider><StableBalanceProvider><ContactsProvider>
  {['wallet','settings'].includes(screen) && <WalletPage walletInfo={info} transactions={[received]} unclaimedDeposits={[]} refreshWalletData={async()=>true} isSyncing={false} error={null} onClearError={()=>{}} onLogout={close} hasRejectedDeposits={false} onOpenGetRefund={()=>{}} onReturnToWallet={close} settingsActive={screen!=='wallet'} onOpenSettings={()=>setScreen('settings')} onOpenDca={()=>setScreen('dca')} onOpenUnilateralExit={()=>{}} onBuyBitcoin={async()=>{}} />
  }
  {screen==='settings' ? <SettingsPage onBack={close} config={null} onOpenFiatCurrencies={()=>{}} onOpenBuyProviders={()=>{}} onOpenPasskeySettings={()=>{}} onOpenSecurity={()=>{}} onOpenBackup={()=>setScreen('backup')} onOpenEmail={()=>{}} onOpenUnilateralExit={()=>{}} />
  : screen==='wallet' ? null
  : screen==='dca' ? <h1>Recurring Buys entry reached</h1>
  : screen==='backup' ? <h1>Recovery entry reached</h1>
  : screen==='startup' ? <><BrandIntro inline /><StartupLogo className="w-36 h-36 object-contain" /></>
  : screen==='received' ? <PaymentCelebration payment={received} onClose={close}/>
  : screen==='sent' || screen==='failed' ? <ResultStep payment={screen==='sent'?{...received,id:'fixture-send',paymentType:'send'}:null} result={screen==='sent'?'success':'failure'} error={screen==='failed'?'Network unavailable':null} onClose={close}/>
  : <ProcessingStep processingPhase={screen==='converting'?'converting':'sending'} operationType={screen==='receiving'?'withdraw':'payment'} />}
 </ContactsProvider></StableBalanceProvider></FiatDataProvider></WalletInfoProvider></WalletProvider></ToastProvider>;
}
initPresentation();
createRoot(document.getElementById('root')!).render(<AppShell><Fixture /></AppShell>);
