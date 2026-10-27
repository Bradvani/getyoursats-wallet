import {act, cleanup, render, screen} from '@testing-library/react';
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import {saveFiatSettings, setDisplayFiatCurrency} from '../services/settings';
import {setAppLanguage} from '../services/presentationPreferences';
import {FIAT_ESTIMATE_MAX_AGE_MS} from '../utils/formatFiat';
import FiatEstimate from './FiatEstimate';

const data = vi.hoisted(() => ({
  fiatRates: [{coin: 'USD', value: 100_000}, {coin: 'INR', value: 8_000_000}],
  fetchedAt: 1_000_000,
}));
vi.mock('../contexts/FiatDataContext', () => ({useFiatData: () => data}));

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(1_000_000);
  data.fetchedAt = 1_000_000;
  data.fiatRates = [{coin: 'USD', value: 100_000}, {coin: 'INR', value: 8_000_000}];
  saveFiatSettings({selectedCurrencies: ['INR', 'USD']});
  setDisplayFiatCurrency('INR');
  setAppLanguage('en');
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  saveFiatSettings({selectedCurrencies: ['USD']});
  setDisplayFiatCurrency('USD');
  setAppLanguage('en');
});

describe('indicative fiat display', () => {
  it('tracks the selected currency without changing the sats amount', () => {
    render(<FiatEstimate sats={1_500_002n} />);
    expect(screen.getByTestId('fiat-estimate')).toHaveTextContent('₹1,20,000.16 INR');
    act(() => setDisplayFiatCurrency('USD'));
    expect(screen.getByTestId('fiat-estimate')).toHaveTextContent('$1,500.00 USD');
  });

  it('expires a cached rate without polling the SDK', () => {
    render(<FiatEstimate sats={1000n} />);
    act(() => vi.advanceTimersByTime(FIAT_ESTIMATE_MAX_AGE_MS + 1));
    expect(screen.getByTestId('fiat-estimate')).toHaveTextContent('out of date');
    expect(screen.getByTestId('fiat-estimate')).not.toHaveTextContent('≈');
  });

  it('uses a new rate and cancels its previous expiry deadline', () => {
    const view = render(<FiatEstimate sats={1000n} />);
    act(() => vi.advanceTimersByTime(60_000));
    data.fetchedAt = Date.now();
    data.fiatRates = [{coin: 'INR', value: 9_000_000}];
    view.rerender(<FiatEstimate sats={1000n} />);
    act(() => vi.advanceTimersByTime(60_001));
    expect(screen.getByTestId('fiat-estimate')).toHaveTextContent('₹90.00 INR');
  });

  it('hides a stale estimate immediately on foreground resume', () => {
    render(<FiatEstimate sats={1000n} />);
    vi.setSystemTime(1_000_000 + FIAT_ESTIMATE_MAX_AGE_MS + 1);
    act(() => document.dispatchEvent(new Event('visibilitychange')));
    expect(screen.getByTestId('fiat-estimate')).toHaveTextContent('out of date');
  });

  it('explains a missing rate instead of displaying zero', () => {
    data.fiatRates = [];
    render(<FiatEstimate sats={1000n} />);
    expect(screen.getByTestId('fiat-estimate')).toHaveTextContent('Fiat estimate unavailable');
    expect(screen.getByTestId('fiat-estimate')).not.toHaveTextContent('0.00');
  });

  it('removes its timers on dismissal', () => {
    const view = render(<FiatEstimate sats={1000n} />);
    view.unmount();
    expect(vi.getTimerCount()).toBe(0);
  });
});
