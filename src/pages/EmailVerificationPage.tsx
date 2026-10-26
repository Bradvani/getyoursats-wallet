import {useEffect, useRef, useState} from 'react';
import type {BreezSdk, LightningAddressInfo} from '@breeztech/breez-sdk-spark';
import SlideInPage from '../components/layout/SlideInPage';
import {PrimaryButton, SecondaryButton, TextButton} from '../components/ui/buttons';
import {FIELD_BASE_CLASS} from '../components/ui/forms';
import GetYourSatsUsernameClaim from './GetYourSatsUsernameClaim';
import {useWallet} from '../contexts/WalletContext';
import {selectedNetwork} from '../services/sdkConnect';

type AccountStatus = {verified: boolean; email: string | null};
type Challenge = {challengeId: string; message: string};
type RetryTiming = {retryAt?: unknown; retryAfterSeconds?: unknown};
type Pending = {requestId: string; expiresIn: number} & RetryTiming;
type Readiness = {available: boolean};
type SendPause = {until: number; message?: string};
interface NativeAddressProps {
  nativeAddress?: LightningAddressInfo | null;
  onClaimNativeAddress?: (username: string) => Promise<LightningAddressInfo>;
}

type Step = 'loading' | 'unavailable' | 'email' | 'code' | 'verified' | 'failed';

function retryDeadline(value: RetryTiming): number {
  const now = Date.now();
  const seconds = value.retryAfterSeconds;
  if (typeof seconds === 'number' && Number.isSafeInteger(seconds) && seconds >= 0 && seconds <= 86_400) {
    return now + seconds * 1000;
  }
  const timestamp = typeof value.retryAt === 'string' ? Date.parse(value.retryAt) : NaN;
  if (Number.isFinite(timestamp) && timestamp >= now && timestamp <= now + 86_400_000) return timestamp;
  return now + 60_000;
}

class EmailSendLimitError extends Error {
  readonly retryAt: number;

  constructor(message: string, timing: RetryTiming) {
    super(message);
    this.retryAt = retryDeadline(timing);
  }
}

async function request<T>(body: Record<string, unknown>, signal: AbortSignal): Promise<T> {
  const response = await fetch('/api/account/email', {
    method: 'POST',
    headers: {'Content-Type': 'application/json'},
    body: JSON.stringify(body),
    credentials: 'omit',
    cache: 'no-store',
    signal,
  });
  const value = await response.json() as {error?: string; code?: string} & RetryTiming;
  if (!response.ok) {
    if (response.status === 429) {
      const messages: Record<string, string> = {
        daily_capacity: 'Today\'s verification email limit has been reached. Your wallet and existing Lightning address still work.',
        send_rate_limit: 'Too many verification codes have been requested. You can still use any valid code you already received.',
        resend_cooldown: 'Please wait before requesting another verification code.',
      };
      if (value.code && Object.prototype.hasOwnProperty.call(messages, value.code)) {
        throw new EmailSendLimitError(messages[value.code], value);
      }
    }
    throw new Error(value.error || 'Email verification is temporarily unavailable. Please try again.');
  }
  return value as T;
}

async function authenticate(sdk: BreezSdk, purpose: 'send' | 'status', signal: AbortSignal) {
  const info = await sdk.getInfo({ensureSynced: false});
  signal.throwIfAborted();
  const walletPubkey = info.identityPubkey?.toLowerCase();
  if (!walletPubkey || !/^(02|03)[0-9a-f]{64}$/.test(walletPubkey)) {
    throw new Error('Your wallet is still connecting. Please try again.');
  }
  const challenge = await request<Challenge>({action: 'challenge', purpose, walletPubkey}, signal);
  signal.throwIfAborted();
  if (!/^[0-9a-f]{36}$/.test(challenge.challengeId)
    || challenge.message !== `gys-email-v1:${purpose}:${walletPubkey}:${challenge.challengeId}`) {
    throw new Error('Could not verify this request. Please try again.');
  }
  const signed = await sdk.signMessage({message: challenge.message, compact: true});
  signal.throwIfAborted();
  if (signed.pubkey.toLowerCase() !== walletPubkey) {
    throw new Error('Your active wallet changed. Reopen Email Verification to continue.');
  }
  return {challengeId: challenge.challengeId, signature: signed.signature};
}

function checkedStatus(value: AccountStatus): AccountStatus {
  if (value.verified !== true && value.verified !== false) throw new Error('Could not check your email. Please try again.');
  if (value.verified && (typeof value.email !== 'string' || !value.email.includes('@'))) {
    throw new Error('Could not check your email. Please try again.');
  }
  return value;
}

function EmailVerificationSession({sdk, onBack, nativeAddress, onClaimNativeAddress}: {sdk: BreezSdk; onBack: () => void} & NativeAddressProps) {
  const [step, setStep] = useState<Step>('loading');
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [pending, setPending] = useState<Pending | null>(null);
  const [verified, setVerified] = useState<AccountStatus | null>(null);
  const [operation, setOperation] = useState<'send' | 'verify' | null>(null);
  const busy = operation !== null;
  const [error, setError] = useState('');
  const [sendPause, setSendPause] = useState<SendPause | null>(null);
  const [retry, setRetry] = useState(0);
  const activeRequest = useRef<AbortController | null>(null);
  const active = useRef(false);

  useEffect(() => {
    if (!sendPause) return;
    const timer = setTimeout(() => setSendPause(null), Math.max(0, sendPause.until - Date.now()));
    return () => clearTimeout(timer);
  }, [sendPause]);

  useEffect(() => {
    const controller = new AbortController();
    active.current = true;
    activeRequest.current = controller;
    void (async () => {
      try {
        if (selectedNetwork() !== 'mainnet') {
          setStep('unavailable');
          return;
        }
        const response = await fetch('/api/account/email', {
          cache: 'no-store', credentials: 'omit', signal: controller.signal,
        });
        const readiness = await response.json() as Readiness;
        controller.signal.throwIfAborted();
        if (!response.ok || readiness.available !== true) {
          setStep('unavailable');
          return;
        }
        const signed = await authenticate(sdk, 'status', controller.signal);
        const status = checkedStatus(await request<AccountStatus>({action: 'status', ...signed}, controller.signal));
        controller.signal.throwIfAborted();
        setVerified(status);
        setStep(status.verified ? 'verified' : 'email');
      } catch (cause) {
        if (controller.signal.aborted) return;
        setError(cause instanceof Error ? cause.message : 'Could not check your email. Please try again.');
        setStep('failed');
      } finally {
        if (activeRequest.current === controller) activeRequest.current = null;
      }
    })();
    return () => {
      active.current = false;
      controller.abort();
      activeRequest.current?.abort();
      activeRequest.current = null;
    };
  }, [sdk, retry]);

  async function run(kind: 'send' | 'verify', operation: (signal: AbortSignal) => Promise<void>) {
    if (!active.current || activeRequest.current) return;
    const controller = new AbortController();
    activeRequest.current = controller;
    setOperation(kind);
    setError('');
    try {
      await operation(controller.signal);
    } catch (cause) {
      if (!controller.signal.aborted && active.current) {
        if (cause instanceof EmailSendLimitError) setSendPause({until: cause.retryAt, message: cause.message});
        else setError(cause instanceof Error ? cause.message : 'Could not verify your email. Please try again.');
      }
    } finally {
      if (activeRequest.current === controller) {
        activeRequest.current = null;
        if (active.current) setOperation(null);
      }
    }
  }

  const send = () => {
    if (sendPause && Date.now() < sendPause.until) return;
    void run('send', async signal => {
      const normalizedEmail = email.trim();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)) throw new Error('Enter a valid email address.');
      const signed = await authenticate(sdk, 'send', signal);
      const result = await request<Pending>({action: 'send', email: normalizedEmail, ...signed}, signal);
      signal.throwIfAborted();
      if (!/^[0-9a-f]{36}$/.test(result.requestId)) throw new Error('Could not send your code. Please try again.');
      setPending(result);
      setSendPause({until: retryDeadline(result)});
      setCode('');
      setStep('code');
    });
  };

  const verify = () => void run('verify', async signal => {
    if (!pending) throw new Error('Request a new verification code.');
    if (!/^\d{6}$/.test(code)) throw new Error('Enter the six-digit code from your email.');
    const result = checkedStatus(await request<AccountStatus>({action: 'verify', requestId: pending.requestId, code}, signal));
    signal.throwIfAborted();
    if (!result.verified) throw new Error('Could not verify your email. Request a new code and try again.');
    setVerified(result);
    setPending(null);
    setCode('');
    setStep('verified');
  });

  if (step === 'verified' && verified?.email) {
    return <GetYourSatsUsernameClaim key={nativeAddress?.lightningAddress ?? 'unclaimed'} email={verified.email}
      onBack={onBack} nativeAddress={nativeAddress} onClaimNativeAddress={onClaimNativeAddress}/>;
  }

  const footer = step === 'email' || step === 'code' ? (
    <div className="space-y-2">
      <PrimaryButton className="w-full" onClick={step === 'code' ? verify : send}
        disabled={busy || (step === 'code' ? code.length !== 6 : !!sendPause || !email.trim())}>
        {busy ? (operation === 'verify' ? 'Verifying...' : 'Sending...') : (step === 'code' ? 'Verify Email' : 'Send Verification Code')}
      </PrimaryButton>
      {step === 'code' ? <SecondaryButton className="w-full" disabled={busy || !!sendPause}
        onClick={send}>Request a New Code</SecondaryButton> : null}
    </div>
  ) : step === 'failed' || step === 'unavailable' ? (
    <SecondaryButton className="w-full" onClick={() => {setStep('loading'); setError(''); setRetry(value => value + 1);}}>Try Again</SecondaryButton>
  ) : null;

  return <SlideInPage title="Email Verification" onClose={onBack} closeStyle="back" slideFrom="left" footer={footer}>
    <div className="max-w-xl mx-auto w-full p-5 space-y-5">
      <section className="bg-spark-dark border border-spark-border rounded-2xl p-5 space-y-4" aria-label="Email verification">
        <h2 className="font-display text-xl font-semibold text-spark-text-primary">Link an email to this wallet</h2>
        <p className="text-sm leading-relaxed text-spark-text-secondary">
          A verified email lets you choose your GetYourSats Lightning name. You can keep using your wallet without one.
        </p>
        {step === 'loading' ? <p role="status" className="text-sm text-spark-text-muted">Checking your wallet...</p> : null}
        {step === 'unavailable' ? <p role="status" className="text-sm text-spark-text-muted">
          {selectedNetwork() !== 'mainnet' ? 'Email verification is available for mainnet wallets.' : 'Email verification is not available yet. Please try again later.'}
        </p> : null}
        {step === 'code' ? <>
          <p className="text-sm text-spark-text-secondary">Enter the six-digit code sent to <strong className="break-words">{email.trim()}</strong>. It expires in 10 minutes.</p>
          <TextButton type="button" className="min-h-[44px] px-2" aria-disabled={busy} onClick={() => {
            if (busy) return;
            setPending(null); setCode(''); setError(''); setStep('email');
          }}>Change Email</TextButton>
          <label className="block text-sm text-spark-text-primary space-y-2" htmlFor="gys-email-code">
            <span>Verification code</span>
            <input id="gys-email-code" value={code} disabled={busy}
              inputMode="numeric" autoComplete="one-time-code" maxLength={6}
              onChange={event => setCode(event.target.value.replace(/\D/g, ''))}
              onKeyDown={event => {if (event.key === 'Enter' && code.length === 6) verify();}}
              className={`${FIELD_BASE_CLASS} p-3 font-mono tracking-widest`}/>
          </label>
        </> : null}
        {step === 'email' ? <label className="block text-sm text-spark-text-primary space-y-2" htmlFor="gys-email-address">
          <span>Email address</span>
          <input id="gys-email-address" type="email" autoComplete="email" value={email} disabled={busy}
            autoCapitalize="none" spellCheck={false} maxLength={254}
            onChange={event => setEmail(event.target.value)}
            onKeyDown={event => {if (event.key === 'Enter' && email.trim()) send();}}
            className={`${FIELD_BASE_CLASS} p-3`}/>
        </label> : null}
        {error ? <p role="alert" className="text-sm text-spark-warning">{error}</p> : null}
        {sendPause ? <div className="space-y-2">
          {sendPause.message ? <p role="alert" className="text-sm text-spark-warning">{sendPause.message}</p> : null}
          <p role="status" className="text-sm text-spark-text-muted">
            You can request a code after {new Date(sendPause.until).toLocaleString(undefined, {
              month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', second: '2-digit', timeZoneName: 'short',
            })}.
          </p>
        </div> : null}
        <p className="text-xs text-spark-text-muted leading-relaxed">
          Email cannot restore your wallet. Keep your recovery words or passkey safe.
        </p>
      </section>
    </div>
  </SlideInPage>;
}

export default function EmailVerificationPage({onBack, nativeAddress, onClaimNativeAddress}: {onBack: () => void} & NativeAddressProps) {
  const sdk = useWallet();
  const [session, setSession] = useState({sdk, version: 0});
  if (session.sdk !== sdk) setSession({sdk, version: session.version + 1});
  return <EmailVerificationSession key={session.version} sdk={sdk} onBack={onBack}
    nativeAddress={nativeAddress} onClaimNativeAddress={onClaimNativeAddress}/>;
}
