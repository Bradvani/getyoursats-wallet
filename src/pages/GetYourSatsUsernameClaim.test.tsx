import {afterEach, describe, expect, it, vi} from 'vitest';
import {act, fireEvent, render, screen} from '@testing-library/react';
import type {LightningAddressInfo} from '@breeztech/breez-sdk-spark';
import type {ReactNode} from 'react';
import GetYourSatsUsernameClaim from './GetYourSatsUsernameClaim';
import {WalletProvider} from '../contexts/WalletContext';
import {createMockClient} from '../test/mocks/mockWalletApi';
import {BROWSER_SPENDING_POLICY} from '../security/browserReleasePolicy';

const mocks = vi.hoisted(() => ({copy: vi.fn().mockResolvedValue(undefined)}));
vi.mock('../utils/clipboard', () => ({copyToClipboard: mocks.copy}));
vi.mock('../components/layout/SlideInPage', () => ({
  default: ({children, footer}: {children: ReactNode; footer?: ReactNode}) => <main>{children}{footer}</main>,
}));

const address = (username = 'bharat', domain = 'getyoursats.com') => ({
  username, lightningAddress: `${username}@${domain}`, description: `Pay ${username}`,
  lnurl: {bech32: 'LNURL1TEST', url: `https://${domain}/.well-known/lnurlp/${username}`},
} as LightningAddressInfo);
function lookup(tag = 'payRequest') {
  return vi.fn((url: string) => Promise.resolve({ok: true, json: async () => ({
    tag, callback: `https://getyoursats.com/lnurlp/${url.split('/').slice(-1)[0]}/invoice`,
  })} as Response));
}
const props = () => ({email: 'verified@example.com', onBack: vi.fn()});
afterEach(() => {vi.unstubAllGlobals();});

describe('native Lightning name claims', () => {
  it.each([false,true])('keeps names in a restricted browser without offering payment addresses or new registration (saved=%s)',async saved=>{
    vi.stubGlobal('fetch',lookup());
    const client=createMockClient(),claim=vi.fn();Reflect.set(client,BROWSER_SPENDING_POLICY,true);
    render(<WalletProvider client={client} isConnected><GetYourSatsUsernameClaim {...props()}
      nativeAddress={saved?address():null} onClaimNativeAddress={claim}/></WalletProvider>);
    expect(screen.getByText(/Lightning receiving is unavailable/)).toBeInTheDocument();
    if(saved)expect(screen.getByText('bharat')).toBeInTheDocument();
    expect(screen.queryByText('bharat@getyoursats.com')).toBeNull();
    expect(screen.queryByText('Ready to receive payments.')).toBeNull();
    expect(screen.queryByRole('button',{name:'Copy Address'})).toBeNull();
    expect(screen.queryByRole('button',{name:'Claim Name'})).toBeNull();
    expect(claim).not.toHaveBeenCalled();expect(mocks.copy).not.toHaveBeenCalled();
  });
  it('stays unavailable without a native lifecycle action and never calls legacy aliases', () => {
    const fetch = vi.fn();
    vi.stubGlobal('fetch', fetch);
    render(<GetYourSatsUsernameClaim {...props()}/>);
    expect(screen.getByText(/Personalized GetYourSats names are not available yet/)).toBeInTheDocument();
    expect(screen.queryByRole('button', {name: 'Claim Name'})).not.toBeInTheDocument();
    expect(fetch).not.toHaveBeenCalled();
  });

  it('shows an existing authoritative name without requesting another claim', async () => {
    const fetch = lookup();
    const claim = vi.fn();
    vi.stubGlobal('fetch', fetch);
    render(<GetYourSatsUsernameClaim {...props()} nativeAddress={address()} onClaimNativeAddress={claim}/>);
    expect(await screen.findByRole('button', {name: 'Copy Address'})).toBeInTheDocument();
    expect(screen.getByText('bharat@getyoursats.com')).toBeInTheDocument();
    expect(claim).not.toHaveBeenCalled();
    expect(fetch).toHaveBeenCalledWith('https://getyoursats.com/.well-known/lnurlp/bharat', expect.objectContaining({cache: 'no-store'}));
  });

  it('allows existing names to be copied when new registration is disabled', async () => {
    vi.stubGlobal('fetch', lookup());
    render(<GetYourSatsUsernameClaim {...props()} nativeAddress={address()}/>);
    fireEvent.click(await screen.findByRole('button', {name: 'Copy Address'}));
    expect(await screen.findByRole('button', {name: 'Copied'})).toBeInTheDocument();
    expect(mocks.copy).toHaveBeenCalledWith('bharat@getyoursats.com');
  });

  it.each(['restored', 'claimed'])('checks a %s SDK lnurlp address using HTTPS before copying', async mode => {
    const value = address();
    value.lnurl.url = 'lnurlp://getyoursats.com/lnurlp/bharat';
    const fetch = lookup();
    vi.stubGlobal('fetch', fetch);
    const claim = vi.fn().mockResolvedValue(value);
    render(<GetYourSatsUsernameClaim {...props()} nativeAddress={mode === 'restored' ? value : null} onClaimNativeAddress={claim}/>);
    if (mode === 'claimed') {
      fireEvent.change(screen.getByLabelText('Username'), {target: {value: 'bharat'}});
      fireEvent.click(screen.getByRole('button', {name: 'Claim Name'}));
    }
    fireEvent.click(await screen.findByRole('button', {name: 'Copy Address'}));
    expect(await screen.findByRole('button', {name: 'Copied'})).toBeInTheDocument();
    expect(fetch).toHaveBeenCalledExactlyOnceWith('https://getyoursats.com/lnurlp/bharat',
      expect.objectContaining({redirect: 'error', credentials: 'omit', cache: 'no-store'}));
    expect(mocks.copy).toHaveBeenCalledWith('bharat@getyoursats.com');
  });

  it.each([
    'lnurlp://attacker.example/lnurlp/bharat',
    'http://getyoursats.com/lnurlp/bharat',
    'lnurlp://getyoursats.com/lnurlp/someoneelse',
    'lnurlp://getyoursats.com/lnurlp/bharat?amount=1',
  ])('rejects an untrusted SDK URL before public lookup or copying: %s', async url => {
    const value = address();value.lnurl.url = url;
    const fetch = vi.fn();vi.stubGlobal('fetch', fetch);
    render(<GetYourSatsUsernameClaim {...props()} nativeAddress={value}/>);
    expect(await screen.findByRole('alert')).toHaveTextContent('Could not confirm your GetYourSats address.');
    expect(fetch).not.toHaveBeenCalled();
    expect(screen.queryByRole('button', {name: 'Copy Address'})).not.toBeInTheDocument();
  });

  it.each([
    'http://getyoursats.com/lnurlp/bharat/invoice',
    'lnurlp://getyoursats.com/lnurlp/bharat/invoice',
    'https://getyoursats.com:443/lnurlp/bharat/invoice',
    'https://user@getyoursats.com/lnurlp/bharat/invoice',
    'https://getyoursats.com/lnurlp/bharat/invoice?amount=1',
    'https://getyoursats.com/lnurlp/bharat/invoice#fragment',
    'https://attacker.example/lnurlp/bharat/invoice',
  ])('rejects an altered invoice callback without fetching it: %s', async callback => {
    const fetch = vi.fn().mockResolvedValue({ok: true, json: async () => ({tag: 'payRequest', callback})});
    vi.stubGlobal('fetch', fetch);
    render(<GetYourSatsUsernameClaim {...props()} nativeAddress={address()}/>);
    expect(await screen.findByRole('alert')).toHaveTextContent('payment link is not ready');
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('button', {name: 'Copy Address'})).not.toBeInTheDocument();
  });

  it('submits the chosen name once and copies the authoritative returned address', async () => {
    const fetch = lookup();
    vi.stubGlobal('fetch', fetch);
    const claim = vi.fn().mockResolvedValue(address('newname'));
    render(<GetYourSatsUsernameClaim {...props()} onClaimNativeAddress={claim}/>);
    fireEvent.change(screen.getByLabelText('Username'), {target: {value: 'NewName'}});
    const button = screen.getByRole('button', {name: 'Claim Name'});
    fireEvent.click(button);
    fireEvent.click(button);
    const copy = await screen.findByRole('button', {name: 'Copy Address'});
    expect(claim).toHaveBeenCalledExactlyOnceWith('newname');
    fireEvent.click(copy);
    expect(await screen.findByRole('button', {name: 'Copied'})).toBeInTheDocument();
    expect(mocks.copy).toHaveBeenCalledWith('newname@getyoursats.com');
    expect(fetch.mock.calls.every(([url]) => url.startsWith('https://getyoursats.com/.well-known/lnurlp/'))).toBe(true);
  });

  it('keeps an existing recovered name even when the user entered a different one', async () => {
    vi.stubGlobal('fetch', lookup());
    const claim = vi.fn().mockResolvedValue(address('existingname'));
    render(<GetYourSatsUsernameClaim {...props()} onClaimNativeAddress={claim}/>);
    fireEvent.change(screen.getByLabelText('Username'), {target: {value: 'newname'}});
    fireEvent.click(screen.getByRole('button', {name: 'Claim Name'}));
    await screen.findByRole('button', {name: 'Copy Address'});
    expect(screen.getByText('existingname@getyoursats.com')).toBeInTheDocument();
    expect(screen.queryByText('newname@getyoursats.com')).not.toBeInTheDocument();
    expect(claim).toHaveBeenCalledTimes(1);
  });

  it('rejects invalid names before starting a wallet operation', async () => {
    const claim = vi.fn();
    render(<GetYourSatsUsernameClaim {...props()} onClaimNativeAddress={claim}/>);
    fireEvent.change(screen.getByLabelText('Username'), {target: {value: '1bad'}});
    fireEvent.click(screen.getByRole('button', {name: 'Claim Name'}));
    expect(await screen.findByRole('alert')).toHaveTextContent('starting with a letter');
    expect(claim).not.toHaveBeenCalled();
  });

  it('rejects an old-domain result instead of displaying it as a branded address', async () => {
    const fetch = vi.fn();
    vi.stubGlobal('fetch', fetch);
    render(<GetYourSatsUsernameClaim {...props()} onClaimNativeAddress={async () => address('oldname', 'breez.tips')}/>);
    fireEvent.change(screen.getByLabelText('Username'), {target: {value: 'newname'}});
    fireEvent.click(screen.getByRole('button', {name: 'Claim Name'}));
    expect(await screen.findByRole('alert')).toHaveTextContent('Could not confirm your GetYourSats address.');
    expect(fetch).not.toHaveBeenCalled();
    expect(screen.queryByRole('button', {name: 'Copy Address'})).not.toBeInTheDocument();
  });

  it('rechecks public resolution without claiming again after a lookup failure', async () => {
    const fetch = lookup('ERROR');
    vi.stubGlobal('fetch', fetch);
    const claim = vi.fn().mockResolvedValue(address());
    render(<GetYourSatsUsernameClaim {...props()} onClaimNativeAddress={claim}/>);
    fireEvent.change(screen.getByLabelText('Username'), {target: {value: 'bharat'}});
    fireEvent.click(screen.getByRole('button', {name: 'Claim Name'}));
    expect(await screen.findByRole('alert')).toHaveTextContent('Please check it again before sharing.');
    expect(screen.queryByRole('button', {name: 'Copy Address'})).not.toBeInTheDocument();
    fetch.mockImplementation(lookup());
    fireEvent.click(screen.getByRole('button', {name: 'Check Payment Link'}));
    expect(await screen.findByRole('button', {name: 'Copy Address'})).toBeInTheDocument();
    expect(claim).toHaveBeenCalledTimes(1);
  });

  it('ignores a late claim result after the wallet screen unmounts', async () => {
    const fetch = vi.fn();
    vi.stubGlobal('fetch', fetch);
    let resolve!: (value: LightningAddressInfo) => void;
    const claim = vi.fn(() => new Promise<LightningAddressInfo>(done => {resolve = done;}));
    const {unmount} = render(<GetYourSatsUsernameClaim {...props()} onClaimNativeAddress={claim}/>);
    fireEvent.change(screen.getByLabelText('Username'), {target: {value: 'bharat'}});
    fireEvent.click(screen.getByRole('button', {name: 'Claim Name'}));
    unmount();
    await act(async () => resolve(address()));
    expect(fetch).not.toHaveBeenCalled();
  });
});
