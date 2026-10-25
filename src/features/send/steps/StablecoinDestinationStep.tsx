import { useEffect, useState } from 'react';
import type { CrossChainAddressDetails, CrossChainRoutePair } from '@breeztech/breez-sdk-spark';
import { usePresentation } from '../../../hooks/usePresentation';
import { sendDestinationCopy } from '../../../locales/sendDestination';
import { useWallet } from '../../../contexts/WalletContext';
import { FIELD_BASE_CLASS, PrimaryButton, SecondaryButton } from '../../../components/ui';
import { useSheetBack } from '../../../components/ui/sheets/BottomSheetCardContext';
import { formatChainName } from '../../../utils/crossChainFormat';
import { normalizeChainName } from '../../../utils/crossChainRoutes';

import type { StablecoinDestination } from '../utils/stablecoinDestination';

export default function StablecoinDestinationStep({ initialInput, initialSelection, onBack, onContinue }: {
  initialInput: string;
  initialSelection?: StablecoinDestination | null;
  onBack: () => void;
  onContinue: (destination: StablecoinDestination) => void;
}) {
  const wallet = useWallet();
  const { language } = usePresentation();
  const text = sendDestinationCopy(language);
  const [input, setInput] = useState(initialInput);
  const [asset, setAsset] = useState(initialSelection?.asset ?? '');
  const [chain, setChain] = useState(initialSelection?.chain ?? '');
  const [retry, setRetry] = useState(0);
  const [result, setResult] = useState<{
    input: string; routes: CrossChainRoutePair[]; details?: CrossChainAddressDetails; error?: 'invalid' | 'noRoutes' | 'timeout';
  } | null>(null);
  useSheetBack(onBack);

  // Bind each response to its exact input. Editing disables Continue immediately;
  // a slow response from an older address cannot restore a stale selection.
  useEffect(() => {
    let cancelled = false;
    if (!input.trim()) return;
    const deadline = setTimeout(() => {
      cancelled = true;
      setResult({ input, routes: [], error: 'timeout' });
    }, 15_000);
    const timer = setTimeout(async () => {
      try {
        const parsed = await wallet.parse(input.trim());
        if (cancelled) return;
        if (parsed.type !== 'crossChainAddress') {
          setResult({ input, routes: [], error: 'invalid' });
          return;
        }
        const routes = await wallet.getCrossChainRoutes({ type: 'send', addressDetails: parsed });
        if (!cancelled) setResult({ input, routes, details: parsed,
          error: routes.length ? undefined : 'noRoutes' });
      } catch {
        if (!cancelled) setResult({ input, routes: [], error: 'invalid' });
      } finally {
        clearTimeout(deadline);
      }
    }, 300);
    return () => { cancelled = true; clearTimeout(timer); clearTimeout(deadline); };
  }, [input, wallet, retry]);

  const current = result?.input === input ? result : null;
  const loading = !!input.trim() && !current;
  const routes = current?.routes ?? [];
  const assets = [...new Set(['USDC', 'USDT', ...routes.map(r => r.asset)])];
  const chains = [...new Set(routes.filter(r => r.asset === asset).map(r => normalizeChainName(r.chain)))].sort();
  const valid = !!current?.details && !!asset && !!chain && chains.includes(chain);
  const mismatch = !!current?.details && !!asset && !!chain && !valid && !current.error;

  return <div className="flex flex-col gap-4" data-testid="stablecoin-destination">
    <label className="text-sm text-spark-text-primary" htmlFor="send-destination-asset">{text.receives}</label>
    <select id="send-destination-asset" className={`${FIELD_BASE_CLASS} p-3`} value={asset}
      onChange={e => { setAsset(e.target.value); setChain(''); }}>
      <option value="">{text.asset}</option>
      {assets.map(a => <option key={a} value={a}>{a}</option>)}
    </select>
    <label className="text-sm text-spark-text-primary" htmlFor="send-destination-address">{text.address}</label>
    <textarea id="send-destination-address" dir="ltr" autoCapitalize="none" autoCorrect="off" spellCheck={false}
      className={`${FIELD_BASE_CLASS} p-3 font-mono text-sm resize-none`} rows={3} value={input}
      placeholder={text.placeholder}
      onChange={e => { setInput(e.target.value); setResult(null); }} />
    <label className="text-sm text-spark-text-primary" htmlFor="send-destination-network">{text.network}</label>
    <select id="send-destination-network" className={`${FIELD_BASE_CLASS} p-3`} value={chain}
      disabled={loading || !asset || !current?.details} onChange={e => setChain(e.target.value)}>
      <option value="">{input.trim() ? text.chooseNetwork : text.enterAddress}</option>
      {chain && !chains.includes(chain) && <option value={chain}>{formatChainName(chain)} · {text.unavailable}</option>}
      {chains.map(c => <option key={c} value={c}>{formatChainName(c)}</option>)}
    </select>
    <p className="text-xs text-spark-text-muted">{text.guidance}</p>
    {loading && <p role="status" className="text-sm text-spark-text-muted">{text.checking}</p>}
    {(current?.error || mismatch) && <p role="alert" className="text-sm text-spark-text-primary">
      {current?.error ? text[current.error] : `${text.unavailable}. ${text.guidance}`}
    </p>}
    {current?.error && <SecondaryButton onClick={() => { setResult(null); setRetry(v => v + 1); }}>{text.retry}</SecondaryButton>}
    <PrimaryButton disabled={!valid} onClick={() => {
      if (valid && current?.details) onContinue({ rawInput: input.trim(), details: current.details, asset, chain });
    }}>{text.continueAmount}</PrimaryButton>
  </div>;
}
