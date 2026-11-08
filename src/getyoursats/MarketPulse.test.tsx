import {cleanup, render, screen, within} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import MarketPulse from './MarketPulse';

const {fetchedAt, refreshFiatData} = vi.hoisted(() => ({fetchedAt: Date.now(), refreshFiatData: vi.fn()}));
vi.mock('../contexts/FiatDataContext', () => ({useFiatData: () => ({
  fiatRates: [{coin:'USD', value:90000}], fetchedAt, refreshFiatData,
})}));
vi.mock('../hooks/usePresentation', () => ({usePresentation: () => ({language:'en'})}));
vi.mock('../services/settings', () => ({
  getDisplayFiatCurrency: () => 'USD',
  getFiatSettings: () => ({selectedCurrencies:['USD']}),
  setDisplayFiatCurrency: vi.fn(),
}));

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ok:true, json:async () => ({
    supply:{btc:20000000,updatedAt:fetchedAt},
    sentiment:{value:50,classification:'Neutral',updatedAt:fetchedAt},
    change:{percent:1,updatedAt:fetchedAt},
  })}));
});
afterEach(() => {cleanup(); vi.unstubAllGlobals();});

describe('Home market disclosure', () => {
  it('opens and closes with Enter and Space, keeping details inside the card', async () => {
    const user = userEvent.setup();
    render(<MarketPulse compact/>);
    const market = screen.getByTestId('bitcoin-market');
    const toggle = within(market).getByTestId('open-bitcoin-market');
    expect(toggle).toHaveAttribute('aria-expanded','false');
    expect(screen.queryByTestId('market-overview')).not.toBeInTheDocument();
    await user.tab();
    expect(toggle).toHaveFocus();
    await user.keyboard('{Enter}');
    expect(toggle).toHaveAttribute('aria-expanded','true');
    const details = within(market).getByTestId('market-details');
    expect(details.id).toBe(toggle.getAttribute('aria-controls'));
    expect(within(details).getByTestId('market-overview')).toBeVisible();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(market.querySelector('button button')).toBeNull();
    await user.keyboard(' ');
    expect(toggle).toHaveAttribute('aria-expanded','false');
    expect(screen.queryByTestId('market-overview')).not.toBeInTheDocument();
    expect(toggle).toHaveFocus();
  });

  it('keeps the denomination when collapsed, reopened and mounted again', async () => {
    const user = userEvent.setup();
    const view = render(<MarketPulse compact/>);
    const toggle = screen.getByTestId('open-bitcoin-market');
    await user.click(toggle);
    await user.click(screen.getByTestId('market-unit-1k'));
    expect(screen.getByTestId('market-quote-price')).toHaveTextContent('$0.90');
    expect(toggle).toHaveAttribute('aria-expanded','true');
    await user.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded','false');
    expect(screen.getByTestId('market-quote-price')).toHaveTextContent('$0.90');
    await user.click(toggle);
    expect(screen.getByTestId('market-unit-1k')).toHaveAttribute('aria-pressed','true');
    view.unmount();
    render(<MarketPulse compact/>);
    expect(screen.getByTestId('market-quote-price')).toHaveTextContent('$0.90');
    await user.click(screen.getByTestId('open-bitcoin-market'));
    expect(screen.getByTestId('market-unit-1k')).toHaveAttribute('aria-pressed','true');
  });
});
