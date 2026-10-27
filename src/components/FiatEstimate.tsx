import {useEffect, useState} from 'react';
import {useFiatData} from '../contexts/FiatDataContext';
import {usePresentation} from '../hooks/usePresentation';
import {getDisplayFiatCurrency} from '../services/settings';
import {FIAT_ESTIMATE_MAX_AGE_MS, fiatEstimateValue, formatFiat} from '../utils/formatFiat';
import {PAYMENT_EXPERIENCE} from '../locales/paymentExperience';

/** A reference beside the exact sats amount. Never feeds a payment request. */
export default function FiatEstimate({sats}: {sats: number | bigint}) {
  const {fiatRates, fetchedAt} = useFiatData();
  const {language} = usePresentation();
  const text = PAYMENT_EXPERIENCE[language];
  const [currency, setCurrency] = useState(getDisplayFiatCurrency);
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    const sync = () => {setCurrency(getDisplayFiatCurrency()); setNow(Date.now());};
    // One clock refresh and one expiry per rate update, with no polling or fetch.
    const refresh = window.setTimeout(sync, 0);
    const expiry = fetchedAt === undefined ? undefined : window.setTimeout(sync,
      Math.max(0, fetchedAt + FIAT_ESTIMATE_MAX_AGE_MS + 1 - Date.now()));
    window.addEventListener('gys:fiat-pref-changed', sync);
    window.addEventListener('pageshow', sync);
    document.addEventListener('visibilitychange', sync);
    return () => {
      window.clearTimeout(refresh);
      window.clearTimeout(expiry);
      window.removeEventListener('gys:fiat-pref-changed', sync);
      window.removeEventListener('pageshow', sync);
      document.removeEventListener('visibilitychange', sync);
    };
  }, [fetchedAt]);
  const estimate = fiatEstimateValue(sats, fiatRates.find(rate => rate.coin === currency)?.value,
    fetchedAt, now);
  return <p className="gys-fiat-estimate text-sm text-spark-text-secondary mt-2" data-testid="fiat-estimate">
    {estimate.value === null
      ? (estimate.stale ? text.rateStale : text.rateUnavailable)
      : <>{text.estimate}: <bdi dir="ltr">≈ {formatFiat(estimate.value, currency, language)} {currency}</bdi></>}
  </p>;
}
