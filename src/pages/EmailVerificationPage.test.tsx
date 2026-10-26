import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import {act, fireEvent, render, screen, waitFor} from '@testing-library/react';
import type {BreezSdk} from '@breeztech/breez-sdk-spark';
import type {ReactNode} from 'react';
import EmailVerificationPage from './EmailVerificationPage';

const wallet = vi.hoisted(() => ({current: null as unknown as BreezSdk}));
vi.mock('../contexts/WalletContext', () => ({useWallet: () => wallet.current}));
vi.mock('../services/sdkConnect', () => ({selectedNetwork: () => 'mainnet'}));
vi.mock('../components/layout/SlideInPage', () => ({
  default: ({children, footer}: {children: ReactNode; footer?: ReactNode}) => <main>{children}{footer}</main>,
}));
vi.mock('./GetYourSatsUsernameClaim', () => ({
  default: ({email}: {email: string}) => <section aria-label="Native Lightning name">Choose your Lightning name <span>{email}</span></section>,
}));

const pubkey = '02' + 'a'.repeat(64);
const challengeId = 'b'.repeat(36);
const requestId = 'c'.repeat(36);
const reply = (value: unknown, status = 200) => Promise.resolve({
  ok: status >= 200 && status < 300, status, json: async () => value,
} as Response);
const requestBody = (init?: RequestInit) => init?.body ? JSON.parse(String(init.body)) as Record<string, unknown> : null;

function client(identity = pubkey) {
  return {
    getInfo: vi.fn().mockResolvedValue({identityPubkey: identity}),
    signMessage: vi.fn().mockResolvedValue({pubkey: identity, signature: 'signed-wallet-proof'}),
  } as unknown as BreezSdk;
}
function availableService(verified = false) {
  return vi.fn((_url: RequestInfo | URL, init?: RequestInit) => {
    const body = requestBody(init);
    if (!body) return reply({available: true});
    if (body.action === 'challenge') return reply({
      challengeId,
      message: `gys-email-v1:${body.purpose}:${body.walletPubkey}:${challengeId}`,
    });
    if (body.action === 'status') return reply({verified, email: verified ? 'linked@example.com' : null});
    if (body.action === 'send') return reply({requestId, expiresIn: 600});
    if (body.action === 'verify') return reply({verified: true, email: 'new@example.com'});
    return reply({error: 'Unexpected request'}, 400);
  });
}

beforeEach(() => {wallet.current = client();});
afterEach(() => {vi.unstubAllGlobals();});

describe('verified email eligibility', () => {
  it('fails closed when readiness is disabled without requesting a signature or sending email', async () => {
    const fetch = vi.fn(() => reply({available: false}));
    vi.stubGlobal('fetch', fetch);
    render(<EmailVerificationPage onBack={vi.fn()}/>);
    expect(await screen.findByText('Email verification is not available yet. Please try again later.')).toBeInTheDocument();
    expect(wallet.current.signMessage).not.toHaveBeenCalled();
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(screen.queryByLabelText('Email address')).not.toBeInTheDocument();
    expect(screen.queryByRole('region', {name: 'Native Lightning name'})).not.toBeInTheDocument();
  });

  it('restores signed email status without sending a code or contacting the legacy alias service', async () => {
    const fetch = availableService(true);
    vi.stubGlobal('fetch', fetch);
    render(<EmailVerificationPage onBack={vi.fn()}/>);
    expect(await screen.findByText('linked@example.com')).toBeInTheDocument();
    expect(screen.getByRole('region', {name: 'Native Lightning name'})).toBeInTheDocument();
    expect(wallet.current.signMessage).toHaveBeenCalledWith({
      message: `gys-email-v1:status:${pubkey}:${challengeId}`, compact: true,
    });
    expect(fetch.mock.calls.every(([url]) => url === '/api/account/email')).toBe(true);
    expect(fetch.mock.calls.some(([, init]) => requestBody(init)?.action === 'send')).toBe(false);
  });

  it('rejects an altered challenge before asking the wallet to sign', async () => {
    const fetch = vi.fn((_url: RequestInfo | URL, init?: RequestInit) => requestBody(init)
      ? reply({challengeId, message: 'gys-email-v1:send:another-wallet:nonce'})
      : reply({available: true}));
    vi.stubGlobal('fetch', fetch);
    render(<EmailVerificationPage onBack={vi.fn()}/>);
    expect(await screen.findByRole('alert')).toHaveTextContent('Could not verify this request. Please try again.');
    expect(wallet.current.signMessage).not.toHaveBeenCalled();
    expect(screen.queryByRole('region', {name: 'Native Lightning name'})).not.toBeInTheDocument();
  });

  it('rejects a signature from another wallet before sending an authenticated request', async () => {
    const fetch = availableService();
    vi.stubGlobal('fetch', fetch);
    vi.mocked(wallet.current.signMessage).mockResolvedValue({pubkey: '03' + 'f'.repeat(64), signature: 'other'});
    render(<EmailVerificationPage onBack={vi.fn()}/>);
    expect(await screen.findByRole('alert')).toHaveTextContent('Your active wallet changed.');
    expect(fetch.mock.calls.some(([, init]) => requestBody(init)?.action === 'status')).toBe(false);
  });

  it('requires an explicit send and successful code confirmation before showing native claims', async () => {
    const fetch = availableService();
    vi.stubGlobal('fetch', fetch);
    render(<EmailVerificationPage onBack={vi.fn()}/>);
    const input = await screen.findByLabelText('Email address');
    expect(fetch.mock.calls.some(([, init]) => requestBody(init)?.action === 'send')).toBe(false);
    fireEvent.change(input, {target: {value: 'new@example.com'}});
    const send = screen.getByRole('button', {name: 'Send Verification Code'});
    fireEvent.click(send);
    fireEvent.click(send);
    const code = await screen.findByLabelText('Verification code');
    expect(fetch.mock.calls.filter(([, init]) => requestBody(init)?.action === 'send')).toHaveLength(1);
    expect(screen.queryByRole('region', {name: 'Native Lightning name'})).not.toBeInTheDocument();
    fireEvent.change(code, {target: {value: '123456'}});
    fireEvent.click(screen.getByRole('button', {name: 'Verify Email'}));
    expect(await screen.findByRole('region', {name: 'Native Lightning name'})).toBeInTheDocument();
    expect(fetch.mock.calls.some(([, init]) => {
      const body = requestBody(init);
      return body?.action === 'verify' && body.requestId === requestId && body.code === '123456';
    })).toBe(true);
  });

  it('ignores a late verified response after switching wallets', async () => {
    let resolveOldStatus!: (value: Response) => void;
    let oldStatusSignal: AbortSignal | null | undefined;
    let statusCount = 0;
    const base = availableService();
    const fetch = vi.fn((url: RequestInfo | URL, init?: RequestInit) => {
      if (requestBody(init)?.action === 'status' && statusCount++ === 0) {
        oldStatusSignal = init?.signal;
        return new Promise<Response>(resolve => {resolveOldStatus = resolve;});
      }
      return base(url, init);
    });
    vi.stubGlobal('fetch', fetch);
    const {rerender} = render(<EmailVerificationPage onBack={vi.fn()}/>);
    await waitFor(() => expect(resolveOldStatus).toBeTypeOf('function'));
    wallet.current = client('03' + 'd'.repeat(64));
    rerender(<EmailVerificationPage onBack={vi.fn()}/>);
    await screen.findByLabelText('Email address');
    expect(oldStatusSignal?.aborted).toBe(true);
    await act(async () => resolveOldStatus(await reply({verified: true, email: 'old-wallet@example.com'})));
    expect(screen.queryByText('old-wallet@example.com')).not.toBeInTheDocument();
    expect(screen.queryByRole('region', {name: 'Native Lightning name'})).not.toBeInTheDocument();
  });

  it('lets an expired-code user request a fresh code without sending automatically', async () => {
    const fetch = availableService();
    vi.stubGlobal('fetch', fetch);
    render(<EmailVerificationPage onBack={vi.fn()}/>);
    fireEvent.change(await screen.findByLabelText('Email address'), {target: {value: 'new@example.com'}});
    fireEvent.click(screen.getByRole('button', {name: 'Send Verification Code'}));
    await screen.findByLabelText('Verification code');
    fireEvent.click(screen.getByRole('button', {name: 'Request a New Code'}));
    expect(screen.getByLabelText('Email address')).toHaveValue('new@example.com');
    expect(fetch.mock.calls.filter(([, init]) => requestBody(init)?.action === 'send')).toHaveLength(1);
  });
});
