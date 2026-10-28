// UI-only fixture. No SDK connection, wallet keys, provider calls or real payments.
import {useState} from 'react';
import {createRoot} from 'react-dom/client';
import type {BreezSdk,GetInfoResponse,PrepareSendPaymentRequest,SendPaymentRequest,ReceivePaymentRequest} from '@breeztech/breez-sdk-spark';
import '../../src/index.css';
import '../../src/getyoursats/premium.css';
import '../../src/getyoursats/appearance.css';
import {initPresentation} from '../../src/services/presentationPreferences';
import {WalletProvider,WalletInfoProvider,WalletStatusProvider} from '../../src/contexts/WalletContext';
import {FiatDataProvider} from '../../src/contexts/FiatDataContext';
import {StableBalanceProvider} from '../../src/contexts/StableBalanceContext';
import {ContactsProvider} from '../../src/contexts/ContactsContext';
import {ToastProvider} from '../../src/contexts/ToastContext';
import {BROWSER_SPENDING_POLICY} from '../../src/security/browserReleasePolicy';
import ReceivePaymentDialog from '../../src/features/receive/ReceivePaymentDialog';
import SendPaymentDialog from '../../src/features/send/SendPaymentDialog';

const address='spark1disposable_TEST_01';
const params=new URLSearchParams(location.search);
const fee=params.get('fee')==='7'?7n:0n;
const info={identityPubkey:'02'+'11'.repeat(32),balanceSats:10000,tokenBalances:new Map()} as GetInfoResponse;
const calls={receive:[] as string[],prepared:[] as {destination:string;amount:string}[],sent:[] as {destination:string;amount:string;fee:string}[],lnurl:0};
let changed=()=>{};
const sdk={
 getInfo:async()=>info,getUserSettings:async()=>({}),listContacts:async()=>[],
 addEventListener:async()=> 'disposable',removeEventListener:async()=>{},
 listFiatCurrencies:async()=>({currencies:[]}),listFiatRates:async()=>({rates:[]}),
 getLightningAddress:async()=>null,getTokensMetadata:async()=>({tokensMetadata:[]}),
 receivePayment:async(request:ReceivePaymentRequest)=>{
  calls.receive.push(request.paymentMethod.type);changed();
  if(request.paymentMethod.type!=='sparkAddress')throw new Error('Unexpected receive route');
  if(params.has('fail')&&calls.receive.length===1)throw new Error('Network unavailable: disposable fixture');
  return {paymentRequest:address,fee:0n};
 },
 parse:async(input:string)=>{
  if(input!==address)throw new Error('Unexpected fixture destination');
  return {type:'sparkAddress',address:input,identityPublicKey:info.identityPubkey,network:'regtest',source:{}};
 },
 prepareSendPayment:async(request:PrepareSendPaymentRequest)=>{
  if(request.paymentRequest.type!=='input'||request.paymentRequest.input!==address)throw new Error('Unexpected preparation route');
  calls.prepared.push({destination:request.paymentRequest.input,amount:String(request.amount)});changed();
  return {amount:request.amount,paymentMethod:{type:'sparkAddress',address,fee}};
 },
 sendPayment:async(request:SendPaymentRequest)=>{
  const prepared=request.prepareResponse;
  if(prepared.paymentMethod.type!=='sparkAddress')throw new Error('Unexpected sending route');
  calls.sent.push({destination:prepared.paymentMethod.address,amount:String(prepared.amount),fee:String(prepared.paymentMethod.fee)});changed();
  return {payment:{id:'disposable-ui-result',paymentType:'send',status:'completed',method:'spark',amount:prepared.amount,fees:fee,timestamp:Math.floor(Date.now()/1000)}};
 },
 lnurlPay:async()=>{calls.lnurl+=1;changed();throw new Error('LNURL fallback is forbidden in this fixture');},
} as unknown as BreezSdk;
Reflect.set(sdk,BROWSER_SPENDING_POLICY,true);
function Fixture(){
 const [,redraw]=useState(0);
 changed=()=>redraw(value=>value+1);
 return <ToastProvider><WalletProvider client={sdk} isConnected><WalletInfoProvider walletInfo={info}><WalletStatusProvider hasPendingConversion={false}>
  <FiatDataProvider><StableBalanceProvider><ContactsProvider>
   <output data-testid="fixture-calls" className="sr-only">{JSON.stringify(calls)}</output>
   {params.get('mode')==='send'?<SendPaymentDialog isOpen onClose={()=>{}}/>:<ReceivePaymentDialog isOpen onClose={()=>{}}/>}
  </ContactsProvider></StableBalanceProvider></FiatDataProvider>
 </WalletStatusProvider></WalletInfoProvider></WalletProvider></ToastProvider>;
}
initPresentation();
createRoot(document.getElementById('root')!).render(<Fixture/>);
