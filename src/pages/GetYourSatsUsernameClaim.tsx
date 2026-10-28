import {useEffect, useRef, useState} from 'react';
import type {LightningAddressInfo} from '@breeztech/breez-sdk-spark';
import SlideInPage from '../components/layout/SlideInPage';
import {PrimaryButton, SecondaryButton} from '../components/ui/buttons';
import {FIELD_BASE_CLASS} from '../components/ui/forms';
import {copyToClipboard} from '../utils/clipboard';
import {nativeLightningLookupUrl, NATIVE_LIGHTNING_DOMAIN as DOMAIN} from '../services/nativeLightningAddress';
import {useWalletConnection} from '../contexts/WalletContext';
import {browserReceivingRestriction} from '../security/browserReleasePolicy';

interface Props {
  email: string;
  onBack: () => void;
  nativeAddress?: LightningAddressInfo | null;
  onClaimNativeAddress?: (username: string) => Promise<LightningAddressInfo>;
}

async function confirmPublicAddress(address: LightningAddressInfo, signal: AbortSignal) {
  const lookupUrl = nativeLightningLookupUrl(address);
  const response = await fetch(lookupUrl, {
    cache: 'no-store', credentials: 'omit', redirect: 'error', signal,
  });
  const result = await response.json() as {tag?: string; callback?: string};
  if (!response.ok || result.tag !== 'payRequest'
    || result.callback !== `https://${DOMAIN}/lnurlp/${address.username}/invoice`) {
    throw new Error('Your name is registered, but its payment link is not ready. Please check it again before sharing.');
  }
}

export default function GetYourSatsUsernameClaim({email, onBack, nativeAddress, onClaimNativeAddress}: Props) {
  const {sdk}=useWalletConnection();
  const receivingRestriction=sdk?browserReceivingRestriction(sdk,'bolt11Invoice'):null;
  const [username, setUsername] = useState('');
  const [address, setAddress] = useState<LightningAddressInfo | null>(nativeAddress ?? null);
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(!!nativeAddress);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState('');
  const active = useRef(false);
  const request = useRef<AbortController | null>(null);

  useEffect(() => {
    active.current = true;
    if (nativeAddress) {
      const controller = new AbortController();
      request.current = controller;
      void confirmPublicAddress(nativeAddress, controller.signal).then(() => {
        if (!controller.signal.aborted) setConfirmed(true);
      }).catch(cause => {
        if (!controller.signal.aborted) {
          setError(cause instanceof Error ? cause.message : 'Could not check your payment link. Please try again.');
        }
      }).finally(() => {
        if (request.current === controller) {
          request.current = null;
          if (!controller.signal.aborted) setBusy(false);
        }
      });
    }
    return () => {
      active.current = false;
      request.current?.abort();
      request.current = null;
    };
  }, [nativeAddress]);

  async function run(operation: (signal: AbortSignal) => Promise<void>) {
    if (!active.current || request.current) return;
    const controller = new AbortController();
    request.current = controller;
    setBusy(true);
    setError('');
    try {
      await operation(controller.signal);
    } catch (cause) {
      if (!controller.signal.aborted && active.current) {
        setError(cause instanceof Error ? cause.message : 'Could not set up your Lightning name. Please try again.');
      }
    } finally {
      if (request.current === controller) {
        request.current = null;
        if (active.current) setBusy(false);
      }
    }
  }

  const claim = () => void run(async signal => {
    if (receivingRestriction || !onClaimNativeAddress || address) return;
    const name = username.trim().toLowerCase();
    if (!/^[a-z][a-z0-9]{2,23}$/.test(name)) {
      throw new Error('Enter 3 to 24 lowercase letters and numbers, starting with a letter.');
    }
    const registered = await onClaimNativeAddress(name);
    signal.throwIfAborted();
    nativeLightningLookupUrl(registered);
    setAddress(registered);
    await confirmPublicAddress(registered, signal);
    signal.throwIfAborted();
    setConfirmed(true);
  });

  const check = () => void run(async signal => {
    if (!address) return;
    await confirmPublicAddress(address, signal);
    signal.throwIfAborted();
    setConfirmed(true);
  });

  const copy = () => void run(async signal => {
    if (receivingRestriction || !address || !confirmed) return;
    await copyToClipboard(address.lightningAddress);
    signal.throwIfAborted();
    setCopied(true);
  });

  const footer = receivingRestriction ? (
    <SecondaryButton className="w-full" onClick={onBack}>Done</SecondaryButton>
  ) : address ? (
    <div className="space-y-2">
      <PrimaryButton className="w-full" disabled={busy} onClick={confirmed ? copy : check}>
        {busy ? 'Checking...' : confirmed ? (copied ? 'Copied' : 'Copy Address') : 'Check Payment Link'}
      </PrimaryButton>
      <SecondaryButton className="w-full" disabled={busy} onClick={onBack}>Done</SecondaryButton>
    </div>
  ) : onClaimNativeAddress ? (
    <PrimaryButton className="w-full" disabled={busy || !username.trim()} onClick={claim}>
      {busy ? 'Setting up...' : 'Claim Name'}
    </PrimaryButton>
  ) : null;

  return <SlideInPage title="Your Lightning Name" onClose={onBack} closeStyle="back" footer={footer}>
    <div className="max-w-xl mx-auto w-full p-5 space-y-5">
      <section className="bg-spark-dark border border-spark-border rounded-2xl p-5 space-y-2" aria-label="Verified email">
        <h2 className="font-display font-semibold text-spark-text-primary">Email verified</h2>
        <p className="text-sm text-spark-text-secondary break-words">{email}</p>
        <p className="text-xs text-spark-text-muted">Email cannot restore your wallet. Keep your recovery words or passkey safe.</p>
      </section>
      <section aria-label="Your Lightning username" className="bg-spark-dark border border-spark-border rounded-2xl p-5 space-y-4">
        <h2 className="font-display text-xl font-semibold text-spark-text-primary">{receivingRestriction?'Your saved Lightning name':confirmed ? 'Your GetYourSats address' : 'Choose your Lightning name'}</h2>
        <p className="text-sm text-spark-text-secondary">
          {receivingRestriction?'Existing names are kept for this wallet. Name registration and payment sharing are unavailable in this preview.':'Your existing Breez address continues to receive into this wallet. No purchase or activity requirement applies to your new name.'}
        </p>
        {receivingRestriction ? <div className="rounded-xl border border-spark-border bg-spark-surface p-3 space-y-2">
          {address&&<strong className="break-all text-spark-text-primary">{address.username}</strong>}
          <p role="status" className="text-sm text-spark-text-secondary">{receivingRestriction}</p>
        </div> : !onClaimNativeAddress && !address ? <p role="status" className="text-sm text-spark-text-muted">
          Personalized GetYourSats names are not available yet. You can keep using your current Lightning address.
        </p> : address ? <div className="rounded-xl border border-spark-border bg-spark-surface p-3 space-y-2">
          <strong className="break-all text-spark-text-primary">{address.lightningAddress}</strong>
          <p role="status" className="text-xs text-spark-text-secondary">{confirmed ? 'Ready to receive payments.' : 'Checking the payment link before sharing.'}</p>
        </div> : <div className="space-y-2">
          <label className="block text-sm text-spark-text-secondary" htmlFor="gys-claim-name">Username</label>
          <div className="relative">
            <input id="gys-claim-name" className={`${FIELD_BASE_CLASS} p-3 pr-32`} value={username}
              disabled={busy} maxLength={24} autoComplete="off" autoCapitalize="none" spellCheck={false}
              placeholder="yourname" aria-describedby="gys-name-domain gys-name-rules"
              onChange={event => setUsername(event.target.value.toLowerCase().replace(/[^a-z0-9]/g, ''))}
              onKeyDown={event => {if (event.key === 'Enter' && username.trim()) claim();}}/>
            <span id="gys-name-domain" className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-spark-text-muted">@getyoursats.com</span>
          </div>
          <p id="gys-name-rules" className="text-xs text-spark-text-muted">3 to 24 letters and numbers, starting with a letter. If this wallet already has a GetYourSats name, we will restore it.</p>
        </div>}
        {error ? <p role="alert" className="text-sm text-spark-warning">{error}</p> : null}
      </section>
    </div>
  </SlideInPage>;
}
