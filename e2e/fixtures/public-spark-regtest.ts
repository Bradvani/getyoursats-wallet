import {defaultConfig,type BreezSdk} from '@breeztech/breez-sdk-spark';
import {entropyToMnemonic} from 'bip39';
import {sdkReady} from '../../src/services/sdkReady';
import {connectSdk} from '../../src/services/sdkConnect';
import {enrollWebWallet} from '../../src/security/webWalletVault';
import {stopBrowserSdk} from '../../src/security/browserSdkLifetime';

// Dev-only Vite fixture, excluded from the production entry. It never reads an
// API key, production storage or an existing wallet. No funding/spending methods
// are exported here. Public-regtest observation is not settlement acceptance.
let wallet:BreezSdk|null=null;
let connecting=false;
const currentNetwork=new URLSearchParams(location.search).get('network');
function regtestOnly(){if(currentNetwork!=='regtest')throw new Error('This fixture only supports explicit regtest');}
const probe={
 async connect(){
  regtestOnly();if(wallet||connecting)throw new Error('Fixture is already connected or connecting');
  if(localStorage.getItem('gys:wallet-vault:v1')!==null||localStorage.getItem('walletMnemonic')!==null)
   throw new Error('Refusing an existing browser wallet; a fresh disposable profile is required');
  connecting=true;
  try{
   await sdkReady();
   const entropy=crypto.getRandomValues(new Uint8Array(16));
   const mnemonic=entropyToMnemonic(Array.from(entropy,b=>b.toString(16).padStart(2,'0')).join(''));
   entropy.fill(0);
   await enrollWebWallet(mnemonic,'disposable-network-probe-not-a-user-wallet');
   const config=defaultConfig('regtest');
   if(config.network!=='regtest')throw new Error('Unexpected SDK network');
   config.apiKey=undefined;config.maxDepositClaimFee=undefined;
   config.realTimeSyncServerUrl=undefined;config.backgroundTasksEnabled=false;
   config.stableBalanceConfig=undefined;config.crossChainConfig=undefined;
   wallet=await connectSdk({config,seed:{type:'mnemonic',mnemonic},storageDir:'gys-public-regtest-probe-'+crypto.randomUUID()});
   const before=await wallet.getInfo({ensureSynced:false});
   await wallet.syncWallet({}); // Browser facade maps this to observation only.
   const info=await wallet.getInfo({ensureSynced:false});
   if(info.identityPubkey!==before.identityPubkey)throw new Error('Identity changed during observation');
   const spark=await wallet.receivePayment({paymentMethod:{type:'sparkAddress'}});
   const bitcoin=await wallet.receivePayment({paymentMethod:{type:'bitcoinAddress'}});
   if(!bitcoin.paymentRequest.startsWith('bcrt1'))throw new Error('Unexpected Bitcoin network address');
   return {network:'regtest',identityPubkey:info.identityPubkey,balanceSats:String(info.balanceSats),
    sparkAddress:spark.paymentRequest,sparkReceiveFee:String(spark.fee),bitcoinAddress:bitcoin.paymentRequest,
    gatewayInstalled:true,spendingAttempted:false,claimsAttempted:false};
  }finally{connecting=false;}
 },
 async observe(){
  regtestOnly();if(!wallet)throw new Error('Not connected');
  await wallet.syncWallet({});
  const info=await wallet.getInfo({ensureSynced:false});
  const history=await wallet.listPayments({offset:0,limit:20});
  // No invoices, preimages, signing material or credential fields are exported.
  return {identityPubkey:info.identityPubkey,balanceSats:String(info.balanceSats),
   payments:history.payments.map(p=>({id:p.id,amount:String(p.amount),fees:String(p.fees),status:p.status,type:p.paymentType,method:p.method}))};
 },
 async stop(){if(wallet){await stopBrowserSdk(wallet);wallet=null;}},
};
Object.assign(window,{gysPublicRegtestProbe:probe});
