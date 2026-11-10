import {useEffect, useRef, useState} from 'react';
import type {Network} from '@breeztech/breez-sdk-spark';
import {useWallet} from '../../contexts/WalletContext';
import {BottomSheetContainer, BottomSheetCard, DialogHeader, PrimaryButton, SecondaryButton, FormError} from '../../components/ui';
import {createRampnowBrowserClient, RampnowClientError, type RampnowBuyInput, type RampnowCheckoutStatus, type RampnowPreparedCheckout} from '../../services/rampnow';
import {canOpenPurchaseCheckout, canReviewPurchaseAgain, checkoutAmounts, createPurchaseController, PurchaseFlowError, purchaseReferences, purchaseStatusText, rampnowPreviewAccess, type PurchaseReference} from './rampnowPurchase';
import {openExternalUrl} from '../../utils/externalLink';

type Props = {walletPubkey: string; network?: Network; returnIntent?: string | null; onClose: () => void};
const emptyProfile: RampnowBuyInput['user'] = {firstName:'',lastName:'',email:'',phone:'',dateOfBirth:'',gender:'unknown',country:'IN'};
const fields = [{key:'firstName',label:'First name',type:'text'}, {key:'lastName',label:'Last name',type:'text'},
  {key:'email',label:'Email',type:'email'}, {key:'phone',label:'Phone with country code',type:'tel'},
  {key:'dateOfBirth',label:'Date of birth',type:'date'}] as const;

/** Preview-only purchase flow. Availability remains a server decision. */
export default function RampnowBuyDialog({walletPubkey,network,returnIntent,onClose}: Props) {
  const wallet = useWallet();
  const [session,setSession] = useState<{client:ReturnType<typeof createRampnowBrowserClient>; controller:ReturnType<typeof createPurchaseController>;
    wallet:typeof wallet; walletPubkey:string; network:Network | undefined; returnIntent:string | null | undefined} | null>(null);
  const currentSession = session?.wallet===wallet && session.walletPubkey===walletPubkey && session.network===network
    && session.returnIntent===returnIntent ? session : null;
  const [available,setAvailable] = useState(false);
  const [refs,setRefs] = useState<PurchaseReference[]>([]);
  const [busy,setBusy] = useState(false);
  const [error,setError] = useState<string | null>(null);
  const [amount,setAmount] = useState('');
  const [profile,setProfile] = useState({...emptyProfile});
  const [prepared,setPrepared] = useState<RampnowPreparedCheckout | null>(null);
  const [fee,setFee] = useState('');
  const [selected,setSelected] = useState<string | null>(returnIntent ?? null);
  const [status,setStatus] = useState<RampnowCheckoutStatus | null>(null);
  const [agreed,setAgreed] = useState(false);
  const [freshReview,setFreshReview] = useState(false);
  const generation = useRef(0);
  const active = useRef<number | null>(null);

  useEffect(() => {
    const current = ++generation.current;
    let controller: ReturnType<typeof createPurchaseController> | undefined;
    const initialise = async () => {
      if (!rampnowPreviewAccess(window.location.origin,network)) throw new Error('This checkout is unavailable for this wallet network.');
      const references = purchaseReferences(localStorage,walletPubkey);
      const client = createRampnowBrowserClient({walletPubkey,signMessage: async message => {
        if(generation.current!==current) throw new Error('Wallet session changed.');
        const signed = await wallet.signMessage({message,compact:true});
        if(generation.current!==current) throw new Error('Wallet session changed.');
        return signed;
      }});
      controller = createPurchaseController(client,references);
      const saved = references.list();
      const availability = await client.availability().catch(()=>({available:false}));
      return {client,controller,saved,available:availability.available};
    };
    void initialise().then(value=>{
      if(generation.current!==current) return;
      setError(null);setPrepared(null);setStatus(null);setProfile({...emptyProfile});setAvailable(value.available);
      setFreshReview(false);setAgreed(false);setBusy(false);setSelected(returnIntent ?? null);
      setRefs(value.saved);setSession({client:value.client,controller:value.controller,wallet,walletPubkey,network,returnIntent});
    }).catch(()=>{
      if(generation.current===current) setError('Could not open purchase history. Reopen the original wallet or contact support.');
    });
    return () => {generation.current=current+1;controller?.dispose();};
  },[wallet,walletPubkey,network,returnIntent]);

  async function run(action: () => Promise<void>) {
    const current = generation.current;
    if(active.current===current || !currentSession) return;
    active.current = current; setBusy(true); setError(null);
    try {await action();}
    catch(e) {if(generation.current===current) setError(e instanceof RampnowClientError || e instanceof PurchaseFlowError ? e.message
      : 'Could not confirm this step. Check the saved purchase status before continuing.');}
    finally {if(active.current===current) active.current=null;if(generation.current===current) setBusy(false);}
  }
  async function review() {
    if(!currentSession || !available) return;
    const current = generation.current;
    const received = await wallet.receivePayment({paymentMethod:{type:'bitcoinAddress',newAddress:true}});
    if(generation.current!==current) return;
    const parsed = await wallet.parse(received.paymentRequest);
    if(generation.current!==current) return;
    if(parsed.type!=='bitcoinAddress' || parsed.network!=='signet' || parsed.address!==received.paymentRequest
      || typeof received.fee!=='bigint' || received.fee<0n) throw new Error('Unverified deposit address.');
    const result = await currentSession.controller.prepare({srcAmount:amount,destination:received.paymentRequest,network:'signet',user:profile});
    if(generation.current!==current) return;
    setPrepared(result);setSelected(result.externalOrderUid);setFee(String(received.fee));setAgreed(false);setFreshReview(false);
    setRefs(purchaseReferences(localStorage,walletPubkey).list());
  }
  async function submit() {
    if(!currentSession || !prepared || !agreed) return;
    // Remove the submit control even if the response is lost. The saved ID
    // survives closing, reload and the provider's hosted return.
    setPrepared(null);setProfile({...emptyProfile});
    const result = await currentSession.controller.submit();setStatus(result);
  }
  async function check(id: string) {
    if(!currentSession) return;
    setSelected(id);setPrepared(null);setStatus(null);setProfile({...emptyProfile});setFreshReview(false);
    setStatus(await currentSession.controller.reconcile(id));
    setRefs(purchaseReferences(localStorage,walletPubkey).list());
  }
  function startFreshReview() {
    if(!currentSession || !available || busy || !status || !canReviewPurchaseAgain(status)) return;
    setSelected(null);setStatus(null);setPrepared(null);setAgreed(false);setFreshReview(true);setError(null);
  }
  async function continueCheckout() {
    if(!currentSession || !status || !canOpenPurchaseCheckout(status)) return;
    await openExternalUrl(status.checkoutUrl!);
  }
  return <BottomSheetContainer isOpen onClose={onClose} showBackdrop>
    <BottomSheetCard>
      <DialogHeader title="Buy Bitcoin" onClose={onClose}/>
      <div className="space-y-4 px-4 pb-6 text-spark-text-primary">
        <p className="text-sm text-spark-text-secondary">Purchases are handled by RampNow. Review its price, identity checks and delivery terms before paying.</p>
        {currentSession && !available && <p role="status">Bitcoin purchases are currently unavailable. You can still check a saved purchase.</p>}
        {!currentSession && !error && <p role="status">Opening purchase history…</p>}
        {error && <FormError error={error}/>}
        {currentSession && available && !selected && (refs.length===0 || freshReview) && <form onSubmit={event=>{event.preventDefault();void run(review);}} className="space-y-4">
          <label className="block">Amount (INR)<input required inputMode="decimal" pattern="[0-9]+(\.[0-9]{1,2})?" maxLength={15}
            className="block w-full rounded-lg bg-spark-surface p-3 text-base" value={amount} onChange={e=>setAmount(e.target.value)}/></label>
          {fields.map(field=><label key={field.key} className="block">{field.label}<input required type={field.type} maxLength={100}
            autoComplete="off" className="block w-full rounded-lg bg-spark-surface p-3 text-base" value={profile[field.key]}
            onChange={e=>setProfile({...profile,[field.key]:e.target.value})}/></label>)}
          <p className="text-sm">Country: India. Your details are sent to the payment provider and are not saved in browser purchase history.</p>
          <PrimaryButton type="submit" disabled={busy}>Review purchase</PrimaryButton>
        </form>}
        {currentSession && prepared && <section className="space-y-3" aria-label="Purchase review">
          <dl className="space-y-2">
            <div><dt>Purchase amount</dt><dd>{prepared.quote.srcAmount} INR</dd></div>
            <div><dt>Estimated Bitcoin delivery</dt><dd>{prepared.quote.dstAmount} BTC</dd></div>
            <div><dt>Payment method</dt><dd>{prepared.quote.paymentMode.replace(/_/g,' ')}</dd></div>
            {prepared.quote.feeDetails.map((item,index)=><div key={index}><dt>{item.type.replace(/_/g,' ')} fee</dt>
              <dd>{item.fee} {item.currency} ({item.isInclusive?'included':'additional'})</dd></div>)}
            <div><dt>Quoted amounts including additional fees</dt><dd>{checkoutAmounts(prepared.quote).map(item=>`${item.amount} ${item.currency}`).join(' + ')}</dd></div>
            <div><dt>Wallet receiving fee estimate</dt><dd>{fee} sats</dd></div>
            <div><dt>Delivery address</dt><dd className="break-all text-sm">{prepared.destination}</dd></div>
          </dl>
          <p className="text-sm">The final amount available in your wallet depends on delivery and deposit claim fees. A payment-provider confirmation alone does not confirm receipt.</p>
          <label className="flex gap-2"><input type="checkbox" checked={agreed} onChange={e=>setAgreed(e.target.checked)}/>
            <span>I have reviewed the amount, every listed fee and the receiving address.</span></label>
          <PrimaryButton disabled={busy || !agreed} onClick={()=>void run(submit)}>Create checkout</PrimaryButton>
        </section>}
        {currentSession && selected && !prepared && <section className="space-y-3" aria-label="Purchase status">
          <p role="status">{status?purchaseStatusText(status):'Check this purchase with the wallet that started it. Returning from checkout does not confirm payment.'}</p>
          <p className="break-all text-xs">Reference: {selected}</p>
          <SecondaryButton disabled={busy} onClick={()=>void run(()=>check(selected))}>Check purchase status</SecondaryButton>
          {status && canOpenPurchaseCheckout(status) &&
            <PrimaryButton disabled={busy} onClick={()=>void run(continueCheckout)}>Continue to secure checkout</PrimaryButton>}
          {available && status && canReviewPurchaseAgain(status) &&
            <SecondaryButton disabled={busy} onClick={startFreshReview}>Review a new quote</SecondaryButton>}
        </section>}
        {currentSession && refs.length>0 && <section aria-label="Saved purchases" className="space-y-2"><h3>Saved purchases</h3>
          {refs.map(item=><button key={item.id} type="button" disabled={busy} className="block w-full break-all rounded-lg border p-3 text-left text-xs"
            onClick={()=>void run(()=>check(item.id))}>{item.id}</button>)}
        </section>}
      </div>
    </BottomSheetCard>
  </BottomSheetContainer>;
}
