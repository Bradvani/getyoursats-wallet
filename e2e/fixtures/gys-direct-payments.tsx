// Isolated presentation and authorization fixture. No keys, SDK connection or real funds.
import {createRoot} from 'react-dom/client';
import type {BreezSdk,GetInfoResponse,InputType,Payment} from '@breeztech/breez-sdk-spark';
import '../../src/index.css';
import '../../src/getyoursats/premium.css';
import '../../src/getyoursats/appearance.css';
import AppShell from '../../src/components/layout/AppShell';
import {WalletProvider,WalletInfoProvider} from '../../src/contexts/WalletContext';
import {ToastProvider} from '../../src/contexts/ToastContext';
import {FiatDataProvider} from '../../src/contexts/FiatDataContext';
import {StableBalanceProvider} from '../../src/contexts/StableBalanceContext';
import {ContactsProvider} from '../../src/contexts/ContactsContext';
import SendPaymentDialog from '../../src/features/send/SendPaymentDialog';
import {initPresentation} from '../../src/services/presentationPreferences';

const params=new URLSearchParams(location.search);
const key='0279be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798';
const spark='spark1synthetic-browser-recipient';
const address='alice@getyoursats.com';
const details={domain:'getyoursats.com',url:'https://getyoursats.com/.well-known/lnurlp/alice',
  callback:'https://getyoursats.com/lnurlp/alice/invoice',minSendable:1000,maxSendable:100000000000,
  metadataStr:JSON.stringify([['text/identifier',address]]),commentAllowed:0};
const info:GetInfoResponse={identityPubkey:key,balanceSats:500000,recoverableFundsSats:0,tokenBalances:new Map()};
const sent:Array<{amount:string;id:string|undefined}>=[];
let lnurlSends=0;
const receipt=(id:string,amount:bigint,fees=0n)=>({id,amount,fees,paymentType:'send',status:'completed',method:'spark',timestamp:1700000000} as Payment);
const reads:Partial<BreezSdk>={
  addEventListener:async()=> 'isolated-listener',removeEventListener:async()=>true,
  getInfo:async()=>info,listContacts:async()=>[],getUserSettings:async()=>({sparkPrivateModeEnabled:false}),
  listFiatCurrencies:async()=>({currencies:[]}),listFiatRates:async()=>({rates:[{coin:'USD',value:90000}]}),
  getPayment:async({paymentId})=>{
    if(params.has('reconciled'))return {payment:receipt(paymentId,100n)};
    throw new Error('Receipt not available');
  },
  parse:async(input:string)=>(input===spark?{type:'sparkAddress',address:spark,identityPublicKey:key,network:'bitcoin',source:{type:'string'}}:
    input.startsWith('lnurl')?{type:'lnurlPay',...details}:{type:'lightningAddress',address:input,payRequest:details}) as InputType,
  prepareSendPayment:async request=>({amount:request.amount!,feePolicy:'feesExcluded',
    paymentMethod:{type:'sparkAddress',address:spark,fee:params.has('changedFee')?1n:0n}}),
  sendPayment:async request=>{
    sent.push({amount:request.prepareResponse.amount.toString(),id:request.idempotencyKey});
    if(params.has('interrupted'))throw new Error('Connection interrupted');
    return {payment:receipt(request.idempotencyKey!,request.prepareResponse.amount)};
  },
  prepareLnurlPay:async request=>({amountSats:Number(request.amount),feeSats:3,feePolicy:'feesExcluded',
    payRequest:details,invoiceDetails:{invoice:{bolt11:'lnbc1fixture'}}} as never),
  lnurlPay:async()=>{lnurlSends++;throw new Error('External settlement is forbidden in this fixture');},
};
const sdk=new Proxy(reads,{get(target,key){
  if(key==='then')return undefined;
  if(key in target)return target[key as keyof typeof target];
  return async()=>{throw new Error('Unexpected fixture SDK operation: '+String(key));};
}}) as BreezSdk;
(window as Window&{__gysDirectEvidence?:unknown}).__gysDirectEvidence=()=>({sent,lnurlSends});
initPresentation();
createRoot(document.getElementById('root')!).render(<AppShell><ToastProvider><WalletProvider client={sdk} isConnected>
  <WalletInfoProvider walletInfo={info}><FiatDataProvider><StableBalanceProvider><ContactsProvider>
    <SendPaymentDialog isOpen onClose={()=>{}} initialRawInput={params.has('qr')?'lnurl1synthetic-native-qr':undefined}/>
  </ContactsProvider></StableBalanceProvider></FiatDataProvider></WalletInfoProvider>
</WalletProvider></ToastProvider></AppShell>);
