// Dev-only doubles. No real wallet, secret, SDK connection or funds.
import {useState} from 'react';
import {createRoot} from 'react-dom/client';
import type {BreezSdk,GetInfoResponse,TokenMetadata} from '@breeztech/breez-sdk-spark';
import '../../src/index.css';
import '../../src/getyoursats/premium.css';
import '../../src/getyoursats/appearance.css';
import {initPresentation} from '../../src/services/presentationPreferences';
import {WalletProvider} from '../../src/contexts/WalletContext';
import {FiatDataProvider} from '../../src/contexts/FiatDataContext';
import {StableBalanceProvider} from '../../src/contexts/StableBalanceContext';
import StableBalanceSettings from '../../src/components/StableBalanceSettings';
import CollapsingWalletHeader from '../../src/components/CollapsingWalletHeader';
import {USDB_TOKEN_IDENTIFIER} from '../../src/constants/stableBalance';
const params=new URLSearchParams(location.search),isStable=params.has('stable'),detected=params.has('detected');
const fixture={changes:[] as Array<string|null>,prepares:0};
Object.assign(window,{__stableModeFixture:fixture});
let mode:string|null=isStable?'USDB':null;
const info={identityPubkey:'a'.repeat(66),balanceSats:isStable?0:100000,recoverableFundsSats:0,tokenBalances:new Map([[USDB_TOKEN_IDENTIFIER,{balance:isStable||detected?100000000n:0n}]])} as GetInfoResponse;
const metadata={identifier:USDB_TOKEN_IDENTIFIER,ticker:'USDB',name:'US Dollar',decimals:6} as TokenMetadata;
const sdk={
 getInfo:async()=>info,getUserSettings:async()=>({stableBalanceActiveLabel:mode}),
 updateUserSettings:async({stableBalanceActiveLabel}: {stableBalanceActiveLabel?:{type:string;label?:string}})=>{if(stableBalanceActiveLabel){mode=stableBalanceActiveLabel.type==='unset'?null:stableBalanceActiveLabel.label??null;fixture.changes.push(mode);}},
 getTokensMetadata:async()=>({tokensMetadata:[metadata]}),listFiatCurrencies:async()=>({currencies:[]}),listFiatRates:async()=>({rates:[{coin:'USD',value:100000}]}),
 receivePayment:async()=>({paymentRequest:'spark-fixture-no-funds'}),
 prepareSendPayment:async()=>{fixture.prepares++;if(params.has('quote-error'))throw Error('quote unavailable');return {conversionEstimate:{amountIn:100000n,amountOut:99000000n,fee:1000000n,options:{conversionType:{type:'fromBitcoin'}}}};},
} as unknown as BreezSdk;
function Fixture(){
 const [settings,setSettings]=useState(params.has('settings'));
 return <WalletProvider client={sdk} isConnected><FiatDataProvider><StableBalanceProvider>
  {settings?<main className="max-w-lg mx-auto p-4"><StableBalanceSettings/></main>:<>
   <CollapsingWalletHeader walletInfo={info} scrollProgress={0} onOpenMenu={()=>setSettings(true)}/>
   <button onClick={()=>setSettings(true)} className="m-4 min-h-11 p-3">Open Settings</button>
  </>}
 </StableBalanceProvider></FiatDataProvider></WalletProvider>;
}
initPresentation();createRoot(document.getElementById('root')!).render(<Fixture/>);
