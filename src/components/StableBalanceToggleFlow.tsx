import {useEffect,useRef,useState} from 'react';
import type {ConversionEstimate,GetInfoResponse} from '@breeztech/breez-sdk-spark';
import {useWallet} from '../contexts/WalletContext';
import {useStableBalance} from '../contexts/StableBalanceContext';
import {useFiatData} from '../contexts/FiatDataContext';
import {usePresentation} from '../hooks/usePresentation';
import {USDB_TICKER,USDB_TOKEN_IDENTIFIER} from '../constants/stableBalance';
import {getTokenBalance,fiatToSats,buildTokenDisplayConfig,type TokenDisplayConfig} from '../utils/tokenFormatting';
import {STABLE_BALANCE_COPY} from '../locales/stableBalance';
import StableBalanceDisclaimer from './StableBalanceDisclaimer';
import StableBalanceFeeConfirm from './StableBalanceFeeConfirm';
interface Props{isOpen:boolean;direction:'toToken'|'toBitcoin';onComplete:()=>void;onCancel:()=>void}
type Review={source:bigint;activeLabel:string|null;expiresAt:number};
const foreground=()=>document.visibilityState!=='hidden';
/** Existing SDK mode change, now entered deliberately and fail-closed on a missing estimate.
 * A prepare response is indicative: updateUserSettings does NOT execute that signed quote.
 * This does not claim to resolve the separate operation-gateway/security release gates. */
export default function StableBalanceToggleFlow({isOpen,direction,onComplete,onCancel}:Props){
 const wallet=useWallet(),stable=useStableBalance();const {refreshFiatData}=useFiatData();
 const {language}=usePresentation();const copy=STABLE_BALANCE_COPY[language];
 const [step,setStep]=useState<'intro'|'estimating'|'review'|'executing'>('intro');
 const [estimate,setEstimate]=useState<ConversionEstimate|null>(null),[config,setConfig]=useState<TokenDisplayConfig|null>(null);
 const [error,setError]=useState<string|null>(null),[info,setInfo]=useState<string|null>(null),[review,setReview]=useState<Review|null>(null);
 const mounted=useRef(true),executing=useRef(false),generation=useRef(0);
 useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;generation.current+=1;}},[]);
 const sourceOf=(value:GetInfoResponse):bigint=>direction==='toToken'?BigInt(value.balanceSats):getTokenBalance(value.tokenBalances,USDB_TOKEN_IDENTIFIER)?.balance??0n;
 async function prepare(){
  if(executing.current)return;const current=++generation.current;
  setStep('estimating');setError(null);setInfo(null);setEstimate(null);setReview(null);
  try{
   const [balances,settings]=await Promise.all([wallet.getInfo({}),wallet.getUserSettings()]);
   const source=sourceOf(balances);const activeLabel=settings.stableBalanceActiveLabel??null;
   if((direction==='toToken'&&activeLabel!==null)||(direction==='toBitcoin'&&activeLabel!==USDB_TICKER))throw new Error('Mode changed');
   if(source===0n){if(mounted.current&&current===generation.current){setInfo(copy.empty);setReview({source,activeLabel,expiresAt:Date.now()+60000});setStep('review');}return;}
   const [fiat,metadata]=await Promise.all([refreshFiatData(),wallet.getTokensMetadata({tokenIdentifiers:[USDB_TOKEN_IDENTIFIER]})]);
   const token=metadata.tokensMetadata.find(t=>t.identifier===USDB_TOKEN_IDENTIFIER);
   if(!token||!fiat.fetchedAt||Date.now()-fiat.fetchedAt>120000)throw new Error('No fresh conversion data');
   const display=buildTokenDisplayConfig(token,fiat.fiatCurrencies);
   const rate=fiat.fiatRates.find(r=>r.coin===(display.fiatCurrencyId??'USD'))?.value;
   if(!rate||!Number.isFinite(rate)||rate<=0)throw new Error('Rate unavailable');
   const target=direction==='toToken'?Number(source)/100000000*rate*.9*10**token.decimals:fiatToSats(Number(source)/10**token.decimals*.9,rate);
   if(!Number.isSafeInteger(Math.round(target))||target<1)throw new Error('Below conversion minimum');
   const address=await wallet.receivePayment({paymentMethod:{type:'sparkAddress'}});
   if(!address.paymentRequest)throw new Error('No destination');
   const prepared=await wallet.prepareSendPayment({paymentRequest:{type:'input',input:address.paymentRequest},amount:BigInt(Math.round(target)),
    tokenIdentifier:direction==='toToken'?USDB_TOKEN_IDENTIFIER:undefined,
    conversionOptions:{conversionType:direction==='toToken'?{type:'fromBitcoin'}:{type:'toBitcoin',fromTokenIdentifier:USDB_TOKEN_IDENTIFIER}}});
   const quote=prepared.conversionEstimate;
   if(!quote||quote.fee<0n||quote.amountIn<=0n||quote.amountOut<=0n)throw new Error('No conversion estimate');
   if(mounted.current&&current===generation.current){setEstimate(quote);setConfig(display);setReview({source,activeLabel,expiresAt:Date.now()+60000});setStep('review');}
  }catch{if(mounted.current&&current===generation.current){setError(copy.quoteError);setReview(null);setStep('review');}}
 }
 async function confirm(){
  if(executing.current||step!=='review'||!review||error)return;
  if(!foreground()||Date.now()>=review.expiresAt){setReview(null);setError(copy.expired);return;}
  executing.current=true;setStep('executing');
  let submitted=false;
  try{
   const [balances,settings]=await Promise.all([wallet.getInfo({}),wallet.getUserSettings()]);
   if(!mounted.current||!foreground()||Date.now()>=review.expiresAt||sourceOf(balances)!==review.source||(settings.stableBalanceActiveLabel??null)!==review.activeLabel){
    if(mounted.current){setReview(null);setError(copy.expired);setStep('review');}return;
   }
   submitted=true;
   await stable.toggleStableBalance(direction==='toToken'?USDB_TICKER:null);
   // Completion here acknowledges only the saved preference, not conversion settlement.
   if(mounted.current)onComplete();
  }catch{if(mounted.current){setError(submitted?copy.failed:copy.quoteError);setReview(null);setStep('review');}}
  finally{executing.current=false;}
 }
 if(!isOpen)return null;
 if(step==='intro')return <StableBalanceDisclaimer isOpen title={direction==='toToken'?copy.toStable:copy.toBitcoin} onAccept={()=>void prepare()} onCancel={onCancel}/>;
 return <StableBalanceFeeConfirm isOpen direction={direction} conversionEstimate={estimate} displayConfig={config}
  isEstimating={step==='estimating'} isExecuting={step==='executing'} error={error} info={info} canConfirm={review!==null}
  onConfirm={()=>void confirm()} onRefresh={()=>void prepare()} onCancel={onCancel}/>;
}
