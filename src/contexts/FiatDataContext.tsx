import React, {createContext, useContext, useState, useEffect, useCallback, useRef} from 'react';
import type {Rate, FiatCurrency, BreezSdk} from '@breeztech/breez-sdk-spark';
import {useWalletConnection} from './WalletContext';
import {logger, LogCategory} from '../services/logger';
import {boundedFiatRequest, currenciesForRates, loadFiatRates} from '../services/fiatRates';

interface FiatData {
  fiatRates: Rate[];
  fiatCurrencies: FiatCurrency[];
  /** Retrieval time of the successful rate snapshot; failures never refresh it. */
  fetchedAt?: number;
}
interface FiatDataContextValue extends FiatData {
  refreshFiatData: () => Promise<FiatData>;
}
const FiatDataContext = createContext<FiatDataContextValue | null>(null);

export const FiatDataProvider: React.FC<{children: React.ReactNode}> = ({children}) => {
  const {sdk, isConnected} = useWalletConnection();
  const [data, setData] = useState<FiatData>({fiatRates: [], fiatCurrencies: []});
  const known = useRef<FiatData>({fiatRates: [], fiatCurrencies: []});
  const generation = useRef(0);
  const inFlight = useRef<{sdk: BreezSdk; promise: Promise<FiatData>} | null>(null);

  const refreshFiatData = useCallback((): Promise<FiatData> => {
    if (!sdk || !isConnected) return Promise.resolve(known.current);
    if (inFlight.current?.sdk === sdk) return inFlight.current.promise;
    const current = generation.current;
    const promise: Promise<FiatData> = (async () => {
      try {
        const result = await loadFiatRates(sdk);
        if (generation.current !== current) return known.current;
        const next = {fiatRates: result.rates, fetchedAt: result.fetchedAt,
          fiatCurrencies: currenciesForRates(result.rates, known.current.fiatCurrencies)};
        known.current = next; setData(next);
        return next;
      } catch {
        logger.warn(LogCategory.SDK, 'Fiat rate refresh unavailable; retaining the previous timestamp');
        return known.current;
      }
    })().finally(() => {
      if (inFlight.current?.promise === promise) inFlight.current = null;
    });
    inFlight.current = {sdk, promise};
    return promise;
  }, [sdk, isConnected]);

  useEffect(() => {
    const current = ++generation.current;
    if (!isConnected || !sdk) return;
    void refreshFiatData();
    // Currency labels must never discard or delay a successful rate response.
    void boundedFiatRequest(Promise.resolve().then(() => sdk.listFiatCurrencies())).then(result => {
      if (generation.current !== current || !Array.isArray(result.currencies)) return;
      const currencies = result.currencies.filter(currency => currency && /^[A-Z]{3}$/.test(currency.id)
        && typeof currency.info?.name === 'string');
      const next = {...known.current, fiatCurrencies: currenciesForRates(known.current.fiatRates, currencies)};
      known.current = next; setData(next);
    }).catch(() => { /* Display metadata is derived locally from available rates. */ });
    const interval = setInterval(() => {void refreshFiatData();}, 60000);
    let resumeTimer: ReturnType<typeof setTimeout> | undefined;
    const refetchOnResume = () => {
      if (document.visibilityState !== 'visible') return;
      clearTimeout(resumeTimer);
      // WebKit may reject a fetch started directly from visibilitychange.
      resumeTimer = setTimeout(() => {
        if (document.visibilityState === 'visible') void refreshFiatData();
      }, 1500);
    };
    document.addEventListener('visibilitychange', refetchOnResume);
    window.addEventListener('pageshow', refetchOnResume);
    window.addEventListener('online', refetchOnResume);
    return () => {
      generation.current = current + 1;
      inFlight.current = null;
      clearInterval(interval); clearTimeout(resumeTimer);
      document.removeEventListener('visibilitychange', refetchOnResume);
      window.removeEventListener('pageshow', refetchOnResume);
      window.removeEventListener('online', refetchOnResume);
    };
  }, [isConnected, sdk, refreshFiatData]);

  return <FiatDataContext.Provider value={{...data, refreshFiatData}}>{children}</FiatDataContext.Provider>;
};

export const useFiatData = (): FiatDataContextValue => {
  const ctx = useContext(FiatDataContext);
  if (!ctx) throw new Error('useFiatData must be used within a FiatDataProvider');
  return ctx;
};
