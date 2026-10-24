import {useEffect,useState} from 'react';
import SlideInPage from '../components/layout/SlideInPage';
import GetYourSatsUsernameClaim from './GetYourSatsUsernameClaim';
import {useWallet} from '../contexts/WalletContext';
import {selectedNetwork} from '../services/sdkConnect';

type AccountStatus = {verified:boolean;email:string|null};
type Challenge = {challengeId:string;message:string;expiresIn:number};
type Pending = {requestId:string;expiresIn:number};
type Readiness = {available:boolean};

async function request<T>(body:Record<string,unknown>):Promise<T> {
  const response=await fetch('/api/account/email',{
    method:'POST',headers:{'Content-Type':'application/json'},
    body:JSON.stringify(body),credentials:'omit',cache:'no-store'
  });
  const value=await response.json() as {error?:string};
  if(!response.ok)throw new Error(value.error||'Verification is currently unavailable');
  return value as T;
}

export default function EmailVerificationPage({onBack}:{onBack:()=>void}){
  const sdk=useWallet();
  const [available,setAvailable]=useState<boolean|null>(null);
  const [email,setEmail]=useState('');
  const [code,setCode]=useState('');
  const [pending,setPending]=useState<Pending|null>(null);
  const [verified,setVerified]=useState<AccountStatus|null>(null);
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState('');
  useEffect(()=>{
    let live=true;
    void fetch('/api/account/email',{cache:'no-store',credentials:'omit'})
      .then(r=>r.json() as Promise<Readiness>)
      .then(r=>{if(live)setAvailable(r.available===true)})
      .catch(()=>{if(live)setAvailable(false)});
    return()=>{live=false};
  },[]);
  async function authenticate(purpose:'send'|'status') {
    if(selectedNetwork()!=='mainnet')throw new Error('Email linking is only available for mainnet wallets');
    const info=await sdk.getInfo({ensureSynced:false});
    const walletPubkey=info.identityPubkey;
    if(!walletPubkey)throw new Error('Wallet identity is not ready');
    const challenge=await request<Challenge>({action:'challenge',purpose,walletPubkey});
    // This proves control of this exact self-custodial wallet. It does not
    // send or expose a private key or recovery phrase to the server.
    const signed=await sdk.signMessage({message:challenge.message,compact:true});
    if(signed.pubkey.toLowerCase()!==walletPubkey.toLowerCase())
      throw new Error('Wallet identity changed. Reconnect and retry.');
    return {challengeId:challenge.challengeId,signature:signed.signature};
  }
  async function run<T>(fn:()=>Promise<T>):Promise<T|undefined>{
    if(busy)return;
    setBusy(true);setError('');
    try{return await fn()}
    catch(e){setError(e instanceof Error?e.message:'Verification failed');}
    finally{setBusy(false)}
  }
  const check=()=>void run(async()=>{
    const signed=await authenticate('status');
    const result=await request<AccountStatus>({action:'status',...signed});
    setVerified(result);
    if(result.verified)setPending(null);
  });
  const send=()=>void run(async()=>{
    if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim()))throw new Error('Enter a valid email address');
    const signed=await authenticate('send');
    const result=await request<Pending>({action:'send',email:email.trim(),...signed});
    setPending(result);
    setCode('');
  });
  const verify=()=>void run(async()=>{
    if(!pending)throw new Error('Request a new code');
    if(!/^\d{6}$/.test(code))throw new Error('Enter your six-digit code');
    const result=await request<AccountStatus>({action:'verify',requestId:pending.requestId,code});
    setVerified(result);
    setPending(null);setCode('');
  });
  return <SlideInPage title="Email verification" onClose={onBack} closeStyle="back" slideFrom="left">
    <div className="max-w-xl mx-auto w-full p-5 space-y-5">
      <div className="bg-spark-dark border border-spark-border rounded-2xl p-5 space-y-3">
        <h2 className="font-display text-xl font-semibold text-spark-text-primary">Link an email to this wallet</h2>
        <p className="text-sm leading-relaxed text-spark-text-secondary">
          Verify that you control an email address. Your wallet stays self-custodial: email is not a key backup,
          sign-in method or way to recover lost sats.
        </p>
        {available===null&&<p role="status" className="text-sm text-spark-text-muted">Checking verification service…</p>}
        {available===false&&<p role="status" className="text-sm text-spark-text-muted">
          Email verification isn't activated yet. GetYourSats needs a verified sending domain and secure mail/storage service.
          No email will be marked as verified until a code is successfully confirmed.
        </p>}
        {available===true&&<>
          <button type="button" disabled={busy} onClick={check} className="text-sm text-spark-primary underline underline-offset-4">
            Check existing verified email
          </button>
          {verified?.verified?<p role="status" className="text-sm text-spark-text-primary">
            Verified email: <strong>{verified.email}</strong>
          </p>:pending?<>
            <p className="text-sm text-spark-text-secondary">We sent a six-digit code to the address you entered. Check your inbox.</p>
            <label className="block text-sm text-spark-text-primary space-y-2">Verification code
              <input aria-label="Six-digit email code" value={code}
                inputMode="numeric" autoComplete="one-time-code" maxLength={6}
                onChange={e=>setCode(e.target.value.replace(/\D/g,''))}
                className="block w-full p-3 rounded-xl bg-spark-surface border border-spark-border font-mono tracking-widest"/>
            </label>
            <button type="button" onClick={verify} disabled={busy||code.length!==6}
              className="w-full rounded-xl bg-spark-primary text-spark-dark p-3 font-semibold disabled:opacity-50">
              {busy?'Checking…':'Verify email'}
            </button>
          </>:<>
            <label className="block text-sm text-spark-text-primary space-y-2">Email address
              <input type="email" aria-label="Email address" autoComplete="email" value={email}
                maxLength={254} onChange={e=>setEmail(e.target.value)}
                className="block w-full p-3 rounded-xl bg-spark-surface border border-spark-border"/>
            </label>
            <button type="button" disabled={busy||!email.trim()}
              onClick={send} className="w-full rounded-xl bg-spark-primary text-spark-dark p-3 font-semibold disabled:opacity-50">
              {busy?'Sending…':'Send verification code'}
            </button>
          </>}
        </>}
        {!!error&&<p role="alert" className="text-sm text-spark-warning">{error}</p>}
      </div>
      {verified?.verified && <GetYourSatsUsernameClaim/>}
      <p className="text-xs text-spark-text-muted leading-relaxed">
        Your anonymous Lightning Address remains available whether or not you link an email.
        A personalized username has no activity or purchase threshold, but must be verified as payable before use.
      </p>
    </div>
  </SlideInPage>;
}
