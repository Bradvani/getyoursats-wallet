import {useState} from 'react';
import {createRoot} from 'react-dom/client';
import WebWalletVaultPage from '../../src/security/WebWalletVaultPage';
import WebVaultRecoveryPage from '../../src/security/WebVaultRecoveryPage';
import SpendingApprovalDialog from '../../src/security/SpendingApprovalDialog';
import {WEB_VAULT_KEY,enrollWebWallet,unlockWebWallet,removeMatchingLegacyMnemonic,
 resetWebWalletPasswordWithWords,hasWebWalletVault} from '../../src/security/webWalletVault';
import {rememberSignerIdentity,createPaymentApprovalObserver} from '../../src/security/spendApproval';
import type {ProvisionalPayment} from '@breeztech/breez-sdk-spark';
import '../../src/index.css';

const TEST_WORDS='abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
type View='enroll'|'unlock'|'recover'|'wallet';
const params=new URLSearchParams(location.search);
if(params.get('seedLegacy')==='yes'&&!localStorage.getItem(WEB_VAULT_KEY))
  localStorage.setItem('walletMnemonic',TEST_WORDS);
function Harness(){
 const [view,setView]=useState<View>(hasWebWalletVault()?'unlock':'enroll');
 const [approved,setApproved]=useState(0),[result,setResult]=useState('idle');
 async function enroll(password:string){
  const mnemonic=localStorage.getItem('walletMnemonic')||TEST_WORDS;
  await enrollWebWallet(mnemonic,password);
  await removeMatchingLegacyMnemonic(password);
  await rememberSignerIdentity({type:'mnemonic',mnemonic});
  setView('wallet');
 }
 async function unlock(password:string){
  const mnemonic=await unlockWebWallet(password);
  await rememberSignerIdentity({type:'mnemonic',mnemonic});
  setView('wallet');
 }
 async function recover(mnemonic:string,password:string){
  await resetWebWalletPasswordWithWords(mnemonic,password);await unlock(password);
 }
 async function send(){
  const payment:ProvisionalPayment={paymentId:'test-payment-1',amount:125n,
    details:{type:'lightning',invoice:'lnbc1demofundless'}};
  setResult('pending');
  try{
   await createPaymentApprovalObserver().beforeSend([payment]);
   setApproved(n=>n+1);
   setResult('authorized');
  }catch{setResult('denied');}
 }
 return <div>
  {view==='enroll'&&<WebWalletVaultPage mode="enroll" isLoading={false} onSubmit={enroll}/>}
  {view==='unlock'&&<WebWalletVaultPage mode="unlock" isLoading={false} onSubmit={unlock} onRecover={()=>setView('recover')}/>}
  {view==='recover'&&<WebVaultRecoveryPage busy={false} onSubmit={recover} onBack={()=>setView('unlock')}/>}
  {view==='wallet'&&<main>
    <h1>Protected test wallet</h1>
    <p data-testid="legacy-status">{localStorage.getItem('walletMnemonic')?'plaintext-present':'plaintext-absent'}</p>
    <p data-testid="vault-status">{localStorage.getItem(WEB_VAULT_KEY)?'encrypted-present':'encrypted-absent'}</p>
    <p data-testid="send-result">{result}</p>
    <p data-testid="executed-count">{approved}</p>
    <button type="button" onClick={()=>void send()}>Send 125 test sats</button>
    <button type="button" onClick={()=>setView('unlock')}>Lock wallet</button>
   </main>}
  <SpendingApprovalDialog/>
 </div>;
}
createRoot(document.getElementById('root')!).render(<Harness/>);
