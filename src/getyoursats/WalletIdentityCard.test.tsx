import {cleanup, fireEvent, render, screen, waitFor} from '@testing-library/react';
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import type {LightningAddressInfo} from '@breeztech/breez-sdk-spark';
import WalletIdentityCard from './WalletIdentityCard';
import {isGetYourSatsAddress} from './walletIdentity';
import {APP_LANGUAGES, setAppLanguage} from '../services/presentationPreferences';
import {WALLET_HOME} from '../locales/walletHome';

const {showToast, writeText} = vi.hoisted(() => ({showToast: vi.fn(), writeText: vi.fn()}));
vi.mock('../contexts/ToastContext', () => ({useToast: () => ({showToast})}));
const address = (value: string) => ({lightningAddress: value}) as LightningAddressInfo;
const identity = {address: address('provider123@breez.tips'), isLoading: false, error: null, isSupported: true};
beforeEach(() => {
  vi.clearAllMocks(); setAppLanguage('en'); writeText.mockResolvedValue(undefined);
  vi.stubGlobal('navigator', {...navigator, clipboard: {writeText}});
});
afterEach(() => {cleanup(); vi.unstubAllGlobals(); localStorage.clear();});

describe('Home username identity', () => {
  it('prioritises claiming a name and never copies the domain placeholder', () => {
    const onPersonalize = vi.fn();
    render(<WalletIdentityCard identity={identity} onPersonalize={onPersonalize}/>);
    expect(screen.queryByText('provider123@breez.tips')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', {name: 'Choose your username @getyoursats.com'}));
    expect(onPersonalize).toHaveBeenCalledOnce(); expect(writeText).not.toHaveBeenCalled();
  });
  it('copies only the confirmed custom address and preserves a known address during refresh', async () => {
    render(<WalletIdentityCard identity={{...identity, address: address('bharat@getyoursats.com'), isLoading: true}}/>);
    fireEvent.click(screen.getByRole('button', {name: /Copy your Lightning address/}));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith('bharat@getyoursats.com'));
    expect(screen.queryByText(/Choose your username/)).not.toBeInTheDocument();
  });
  it.each([{isLoading: true, error: null}, {isLoading: false, error: 'offline'}])('uses a neutral pending/error state without claiming a name was lost: %j', state => {
    render(<WalletIdentityCard identity={{...identity, ...state}} onPersonalize={vi.fn()}/>);
    expect(screen.getByRole('status')).toBeVisible(); expect(screen.queryByRole('button')).not.toBeInTheDocument();
    expect(writeText).not.toHaveBeenCalled();
  });
  it('does not advertise claiming on an unsupported network', () => {
    render(<WalletIdentityCard identity={{...identity, isSupported: false}} onPersonalize={vi.fn()}/>);
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });
  it('reports copy failures without a false success', async () => {
    writeText.mockRejectedValue(new Error('Clipboard denied'));
    render(<WalletIdentityCard identity={{...identity, address: address('test@getyoursats.com')}}/>);
    fireEvent.click(screen.getByRole('button'));
    await waitFor(() => expect(showToast).toHaveBeenCalledWith('error', expect.any(String)));
    expect(showToast).not.toHaveBeenCalledWith('success', expect.any(String));
  });
  it.each(APP_LANGUAGES)('localises the primary action in $code', ({code}) => {
    setAppLanguage(code);
    render(<WalletIdentityCard identity={identity} onPersonalize={vi.fn()}/>);
    expect(screen.getByRole('button')).toHaveTextContent(WALLET_HOME[code].chooseName);
  });
  it.each(['@getyoursats.com', 'a@getyoursats.com.evil.example', 'x@y@getyoursats.com', 'a b@getyoursats.com', 'a@breez.tips'])('rejects an unconfirmed-looking domain: %s', value => {
    expect(isGetYourSatsAddress(value)).toBe(false);
  });
});
