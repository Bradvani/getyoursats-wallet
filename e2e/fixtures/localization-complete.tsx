import SettingsPage from '../../src/pages/SettingsPage';
import LightningAddressDisplay from '../../src/features/receive/LightningAddressDisplay';
import AmountPanel from '../../src/features/receive/AmountPanel';
import PaymentDetailsDialog from '../../src/components/PaymentDetailsDialog';
import type {Sats} from '../../src/types/sats';
// Disposable UI acceptance. No real network, signer, wallet or funds.
import {useState} from 'react';
import {createRoot} from 'react-dom/client';
import type {BreezSdk,GetInfoResponse,Payment} from '@breeztech/breez-sdk-spark';
import '../../src/index.css';
import '../../src/getyoursats/premium.css';
import '../../src/getyoursats/appearance.css';
import {initPresentation,setAppLanguage,APP_LANGUAGES,type AppLanguage} from '../../src/services/presentationPreferences';
import {usePresentation} from '../../src/hooks/usePresentation';
import {WalletProvider,WalletInfoProvider} from '../../src/contexts/WalletContext';
import {FiatDataProvider} from '../../src/contexts/FiatDataContext';
import {StableBalanceProvider} from '../../src/contexts/StableBalanceContext';
import {ContactsProvider} from '../../src/contexts/ContactsContext';
import {ToastProvider} from '../../src/contexts/ToastContext';
import InputStep from '../../src/features/send/steps/InputStep';
import AmountStep from '../../src/features/send/steps/AmountStep';
import ConfirmStep from '../../src/features/send/steps/ConfirmStep';
import ProcessingStep from '../../src/features/send/steps/ProcessingStep';
import ResultStep from '../../src/features/send/steps/ResultStep';
import ContactsSubView from '../../src/features/send/components/ContactsSubView';
import CollapsingWalletHeader from '../../src/components/CollapsingWalletHeader';
import {FeeRateSelector} from '../../src/components/FeeRateSelector';
import {CrossChainAssetStep} from '../../src/components/crossChain/CrossChainAssetStep';
import {FormError} from '../../src/components/ui';
const info={identityPubkey:'a'.repeat(66),balanceSats:125000,recoverableFundsSats:0,tokenBalances:new Map()} as GetInfoResponse;
const sdk={
 getInfo:async()=>info,getUserSettings:async()=>({}),listContacts:async()=>[],
 addEventListener:async()=> 'disposable-listener',removeEventListener:async()=>{},
 listFiatCurrencies:async()=>({currencies:[]}),listFiatRates:async()=>({rates:[]}),
 getTokensMetadata:async()=>({tokensMetadata:[]})
} as unknown as BreezSdk;
function Fixture(){
 const {language}=usePresentation();
 const [step,setStep]=useState(new URLSearchParams(location.search).get('case')||'input');
 const [destination,setDestination]=useState('');
 const [amount,setAmount]=useState(0n);
 const [receiveAmount,setReceiveAmount]=useState<Sats|null>(null);
 const [description,setDescription]=useState('');
 const [speed,setSpeed]=useState<'slow'|'medium'|'fast'>('medium');
 const noop=()=>{};
 const payment={id:'disposable-result',paymentType:'send',status:'completed',amount,fees:2n,timestamp:Math.floor(Date.now()/1000),method:'spark'} as Payment;
 return <ToastProvider><WalletProvider client={sdk} isConnected><WalletInfoProvider walletInfo={info}><FiatDataProvider><StableBalanceProvider><ContactsProvider>
 <div className="max-w-md mx-auto p-5">
 <select aria-label="Fixture language" value={language} onChange={event=>setAppLanguage(event.target.value as AppLanguage)}>{APP_LANGUAGES.map(l=><option key={l.code} value={l.code}>{l.name}</option>)}</select>
 <output className="sr-only" data-testid="submitted">{JSON.stringify({destination,amount:String(amount)})}</output>
 <main data-testid="localized-surface">
 {step==='settings'&&<SettingsPage onOpenLanguage={()=>{}} onOpenAppearance={()=>{}} onBack={noop} config={null} onOpenFiatCurrencies={noop} onOpenBuyProviders={noop} onOpenPasskeySettings={noop} onOpenSecurity={noop} onOpenBackup={noop} onOpenEmail={noop} onOpenUnilateralExit={noop}/>}
 {step==='receive'&&<LightningAddressDisplay address={null} isLoading={false} isSupported section="qr" onEdit={noop} onCustomizeAmount={()=>setStep('receiveamount')}/>}
 {step==='receiveamount'&&<AmountPanel isOpen amountSats={receiveAmount} setAmountSats={setReceiveAmount} setAmountDisplay={noop} description={description} setDescription={setDescription} isLoading={false} error={null} onCreateInvoice={noop} onClose={noop} resetCount={0}/>}
 {step==='details'&&<PaymentDetailsDialog optionalPayment={payment} onClose={noop}/>}
 {step==='provider-error'&&<FormError error="Network unavailable: disposable provider diagnostic"/>}
 {step==='input'&&<InputStep paymentInput={destination} isLoading={false} error={null} onContinue={value=>{setDestination(value);setStep('amount');}} onOpenContacts={()=>setStep('contacts')}/>}
 {step==='amount'&&<AmountStep paymentInput={destination} amount="" balanceSats={125000} isLoading={false} error={null} onBack={()=>setStep('input')} onNext={value=>{setAmount(value);setStep('confirm');}}/>}
 {step==='confirm'&&<ConfirmStep amountSats={amount} feesSat={2} balanceSats={125000} destination={{label:'To Spark address',value:destination}} error={null} isLoading={false} onConfirm={()=>{setStep('processing');setTimeout(()=>setStep('result'),1500);}}/>}
 {step==='processing'&&<ProcessingStep/>}
 {step==='result'&&<ResultStep result="success" payment={payment} error={null} onClose={noop}/>}
 {step==='failure'&&<ResultStep result="failure" error="Failed to prepare payment" onClose={noop}/>}
 {step==='unknown'&&<ResultStep result="unknown" error={null} onClose={noop}/>}
 {step==='contacts'&&<ContactsSubView onSelect={noop} onBack={()=>setStep('input')}/>}
 {step==='balance'&&<CollapsingWalletHeader walletInfo={info} scrollProgress={0} onOpenMenu={noop} isSyncing/>}
 {step==='fees'&&<FeeRateSelector selected={speed} onSelect={setSpeed} detail={()=> '2 sat/vB'}/>}
 {step==='routes'&&<><CrossChainAssetStep assets={['USDT','USDC']} pending="USDC" onPendingChange={noop} onBack={noop} onContinue={noop}/><FormError error="No supported stablecoin routes available for this address"/></>}
 </main></div>
 </ContactsProvider></StableBalanceProvider></FiatDataProvider></WalletInfoProvider></WalletProvider></ToastProvider>;
}
initPresentation();
createRoot(document.getElementById('root')!).render(<Fixture/>);
