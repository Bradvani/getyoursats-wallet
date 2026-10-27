// Dev-only component fixture. No real wallet, key, SDK connection or funds.
import {useState} from 'react';
import {createRoot} from 'react-dom/client';
import type {BreezSdk,Payment} from '@breeztech/breez-sdk-spark';
import '../../src/index.css';
import '../../src/getyoursats/premium.css';
import '../../src/getyoursats/appearance.css';
import {initPresentation} from '../../src/services/presentationPreferences';
import {saveFiatSettings,setDisplayFiatCurrency} from '../../src/services/settings';
import {WalletProvider} from '../../src/contexts/WalletContext';
import {FiatDataProvider} from '../../src/contexts/FiatDataContext';
import {StableBalanceProvider} from '../../src/contexts/StableBalanceContext';
import {BottomSheetContainer,BottomSheetCard,DialogHeader} from '../../src/components/ui';
import ConfirmStep from '../../src/features/send/steps/ConfirmStep';
import PaymentCelebration from '../../src/components/PaymentCelebration';
const params=new URLSearchParams(location.search);
const currency=params.get('currency')||'INR';
saveFiatSettings({selectedCurrencies:['INR','USD','EUR','JPY','CHF']});setDisplayFiatCurrency(currency);
const sdk={
 getUserSettings:async()=>({}),getInfo:async()=>({balanceSats:100000,tokenBalances:new Map()}),
 listFiatCurrencies:async()=>({currencies:[]}),
 listFiatRates:async()=>({rates:params.has('missingRate')?[]:[{coin:'USD',value:100000},{coin:'INR',value:9000000},{coin:'EUR',value:90000},{coin:'JPY',value:15000000}]}),
} as unknown as BreezSdk;
function Fixture(){
 const [open,setOpen]=useState(true);const screen=params.get('screen')||'pay';
 const amount=BigInt(params.get('sats')||(screen==='received'?'27':'900'));
 const payment={id:'fiat-fixture-'+screen,paymentType:screen==='sent'?'send':'receive',status:'completed',method:'lightning',amount,fees:0n,timestamp:1700000000} as Payment;
 return <WalletProvider client={sdk} isConnected><FiatDataProvider><StableBalanceProvider>
  {open&&(screen==='pay'?<BottomSheetContainer isOpen onClose={()=>setOpen(false)} showBackdrop><BottomSheetCard><DialogHeader title="Pay" onClose={()=>setOpen(false)}/><div className="px-5 pb-5">
   <ConfirmStep amountSats={amount} feesSat={5} feesIncluded={params.has('feesIncluded')} balanceSats={100000} destination={{label:'Recipient',value:'qa@example.invalid'}} error={null} isLoading={false} onConfirm={()=>{}}/>
  </div></BottomSheetCard></BottomSheetContainer>:<PaymentCelebration payment={payment} onClose={()=>setOpen(false)}/>)}
 </StableBalanceProvider></FiatDataProvider></WalletProvider>;
}
initPresentation();createRoot(document.getElementById('root')!).render(<Fixture/>);
