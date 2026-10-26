import { describe, expect, it, vi } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import type { BreezSdk, LightningAddressInfo, SdkEvent } from '@breeztech/breez-sdk-spark';
import { WalletProvider } from '@/contexts/WalletContext';
import { createMockClient } from '@/test/mocks/mockWalletApi';
import { useLightningAddress } from './useLightningAddress';

// The LNURL server reaches the WebView as an opaque fetch failure, which is
// what the user reported seeing pasted verbatim into the Receive sheet.
const RAW_SDK_ERROR = new Error(
  'Network error: Request error: error sending request : JsValue(TypeError: Load failed\nundefined)',
);

function renderLightningAddress(client: BreezSdk) {
  return renderHook(() => useLightningAddress(), {
    wrapper: ({ children }) => (
      <WalletProvider client={client} isConnected>
        {children}
      </WalletProvider>
    ),
  });
}

function address(username: string, domain = 'breez.tips'): LightningAddressInfo {
  return {
    username,
    description: `Pay to ${username}@${domain}`,
    lightningAddress: `${username}@${domain}`,
    lnurl: { url: `https://${domain}/.well-known/lnurlp/${username}`, bech32: `lnurl1${username}` },
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}

function events() {
  const listeners = new Set<(event: SdkEvent) => void>();
  return {
    listeners,
    subscribe: (listener: (event: SdkEvent) => void) => {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
    emit: (event: SdkEvent) => listeners.forEach(listener => listener(event)),
  };
}

describe('useLightningAddress error copy', () => {
  it('shows a generic message instead of the raw SDK error when loading fails', async () => {
    const client = createMockClient() as unknown as BreezSdk;
    vi.mocked(client.getLightningAddress).mockRejectedValue(RAW_SDK_ERROR);

    const { result } = renderLightningAddress(client);

    await waitFor(() => expect(result.current.error).not.toBeNull());
    expect(result.current.error).toBe("Couldn't load your Lightning address. Please try again.");
    expect(result.current.error).not.toContain('Load failed');
  });

  it('shows a generic message instead of the raw SDK error when saving fails', async () => {
    const client = createMockClient() as unknown as BreezSdk;
    vi.mocked(client.registerLightningAddress).mockRejectedValue(RAW_SDK_ERROR);

    const { result } = renderLightningAddress(client);
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    act(() => result.current.setEditValue('umiyahara'));
    await act(async () => {
      await result.current.save();
    });

    expect(result.current.error).toBe("Couldn't save your Lightning address. Please try again.");
    expect(result.current.error).not.toContain('Load failed');
  });

  it('still names a taken username rather than falling back to the generic message', async () => {
    const client = createMockClient() as unknown as BreezSdk;
    vi.mocked(client.checkLightningAddressAvailable).mockResolvedValue(false);

    const { result } = renderLightningAddress(client);
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    act(() => result.current.setEditValue('umiyahara'));
    await act(async () => {
      await result.current.save();
    });

    expect(result.current.error).toBe('This username is not available');
  });
});

describe('shared Lightning address state', () => {
  it('retries a colliding anonymous name with a four-digit Web Crypto suffix', async () => {
    const values = [0, 0, 8999];
    const random = vi.spyOn(globalThis.crypto, 'getRandomValues').mockImplementation(array => {
      if (!(array instanceof Uint32Array)) throw new Error('Expected a 32-bit sample');
      array[0] = values.shift() ?? 0;
      return array;
    });
    const registered = address('SalmonBat9999');
    const client = createMockClient({
      checkLightningAddressAvailable: vi.fn().mockResolvedValueOnce(false).mockResolvedValue(true),
      registerLightningAddress: vi.fn().mockResolvedValue(registered),
    });
    const { result } = renderLightningAddress(client);

    await waitFor(() => expect(result.current.address).toEqual(registered));
    expect(client.checkLightningAddressAvailable).toHaveBeenNthCalledWith(1, { username: 'SalmonBat' });
    expect(client.checkLightningAddressAvailable).toHaveBeenNthCalledWith(2, { username: 'SalmonBat9999' });
    expect(client.registerLightningAddress).toHaveBeenCalledWith({ username: 'SalmonBat9999' });
    expect(random).toHaveBeenCalledTimes(3);
  });

  it('registers once for concurrent home and Receive consumers and uses the SDK result', async () => {
    const registered = address('calmfox');
    const client = createMockClient({ registerLightningAddress: vi.fn().mockResolvedValue(registered) });
    const { result } = renderHook(() => ({ home: useLightningAddress(), receive: useLightningAddress() }), {
      wrapper: ({ children }) => <WalletProvider client={client} isConnected>{children}</WalletProvider>,
    });

    await waitFor(() => expect(result.current.home.address).toEqual(registered));
    expect(result.current.receive.address).toEqual(registered);
    expect(client.registerLightningAddress).toHaveBeenCalledTimes(1);
    expect(client.registerLightningAddress).toHaveBeenCalledWith({ username: expect.any(String) });
    expect(client.getLightningAddress).toHaveBeenCalledTimes(1);
  });

  it('shares native registration address and QR data without relying on a later cached read', async () => {
    const original = address('calmfox');
    const registered = address('bharat', 'getyoursats.com');
    const client = createMockClient({
      getLightningAddress: vi.fn().mockResolvedValue(original),
      registerLightningAddress: vi.fn().mockResolvedValue(registered),
    });
    const { result } = renderHook(() => ({ home: useLightningAddress(), receive: useLightningAddress() }), {
      wrapper: ({ children }) => <WalletProvider client={client} isConnected>{children}</WalletProvider>,
    });
    await waitFor(() => expect(result.current.home.address).toEqual(original));

    act(() => result.current.receive.setEditValue('bharat'));
    await act(async () => { await result.current.receive.save(); });

    expect(client.registerLightningAddress).toHaveBeenCalledWith({ username: 'bharat' });
    expect(result.current.home.address).toEqual(registered);
    expect(result.current.receive.address?.lnurl).toEqual(registered.lnurl);
    expect(client.getLightningAddress).toHaveBeenCalledTimes(1);
  });

  it.each([address('previous'), undefined])('ignores an old SDK read after a wallet switch (%s)', async oldAddress => {
    const late = deferred<LightningAddressInfo | undefined>();
    const previous = createMockClient({ getLightningAddress: vi.fn().mockReturnValue(late.promise) });
    const nextAddress = address('nextwallet');
    const next = createMockClient({ getLightningAddress: vi.fn().mockResolvedValue(nextAddress) });
    let active = previous;
    const { result, rerender } = renderHook(() => useLightningAddress(), {
      wrapper: ({ children }) => <WalletProvider client={active} isConnected>{children}</WalletProvider>,
    });
    await waitFor(() => expect(previous.getLightningAddress).toHaveBeenCalledTimes(1));

    active = next;
    rerender();
    await waitFor(() => expect(result.current.address).toEqual(nextAddress));
    await act(async () => { late.resolve(oldAddress); await late.promise; });

    expect(result.current.address).toEqual(nextAddress);
    expect(result.current.isLoading).toBe(false);
    expect(previous.registerLightningAddress).not.toHaveBeenCalled();
    expect(next.registerLightningAddress).not.toHaveBeenCalled();
  });

  it('does not carry an unsupported domain or editor state into the next wallet', async () => {
    const previous = createMockClient({ getLightningAddress: vi.fn().mockRejectedValue(new Error('LNURL server is not configured')) });
    const nextAddress = address('nextwallet');
    const next = createMockClient({ getLightningAddress: vi.fn().mockResolvedValue(nextAddress) });
    let active = previous;
    const { result, rerender } = renderHook(() => useLightningAddress(), {
      wrapper: ({ children }) => <WalletProvider client={active} isConnected>{children}</WalletProvider>,
    });
    await waitFor(() => expect(result.current.isSupported).toBe(false));
    act(() => result.current.setEditValue('oldedit'));
    active = next;
    rerender();

    await waitFor(() => expect(result.current.address).toEqual(nextAddress));
    expect(result.current.isSupported).toBe(true);
    expect(result.current.error).toBeNull();
    expect(result.current.editValue).toBe('');
    expect(result.current.isEditing).toBe(false);
  });

  it('keeps the next wallet intact when an already submitted registration finishes late', async () => {
    const registration = deferred<LightningAddressInfo>();
    const previous = createMockClient({
      getLightningAddress: vi.fn().mockResolvedValue(address('previous')),
      registerLightningAddress: vi.fn().mockReturnValue(registration.promise),
    });
    const nextAddress = address('nextwallet');
    const next = createMockClient({ getLightningAddress: vi.fn().mockResolvedValue(nextAddress) });
    let active = previous;
    const { result, rerender } = renderHook(() => useLightningAddress(), {
      wrapper: ({ children }) => <WalletProvider client={active} isConnected>{children}</WalletProvider>,
    });
    await waitFor(() => expect(result.current.address?.username).toBe('previous'));
    act(() => result.current.setEditValue('oldrename'));
    let save!: Promise<void>;
    act(() => { save = result.current.save(); });
    await waitFor(() => expect(previous.registerLightningAddress).toHaveBeenCalledTimes(1));

    active = next;
    rerender();
    await waitFor(() => expect(result.current.address).toEqual(nextAddress));
    act(() => result.current.setEditValue('newedit'));
    await act(async () => { registration.resolve(address('oldrename')); await save; });

    expect(result.current.address).toEqual(nextAddress);
    expect(result.current.editValue).toBe('newedit');
    expect(result.current.isLoading).toBe(false);
  });

  it('publishes a remote name change to both consumers and discards an older read', async () => {
    const late = deferred<LightningAddressInfo>();
    const remote = address('newname', 'getyoursats.com');
    const client = createMockClient({
      getLightningAddress: vi.fn().mockReturnValueOnce(late.promise).mockResolvedValue(remote),
    });
    const bus = events();
    const { result, unmount } = renderHook(() => ({ home: useLightningAddress(), receive: useLightningAddress() }), {
      wrapper: ({ children }) => <WalletProvider client={client} isConnected subscribeToSdkEvents={bus.subscribe}>{children}</WalletProvider>,
    });
    expect(bus.listeners.size).toBe(1);
    act(() => bus.emit({ type: 'lightningAddressChanged', lightningAddress: remote }));
    await waitFor(() => expect(result.current.home.address).toEqual(remote));
    await act(async () => { late.resolve(address('stale')); await late.promise; });

    expect(result.current.home.address).toEqual(remote);
    expect(result.current.receive.address).toEqual(remote);
    expect(client.registerLightningAddress).not.toHaveBeenCalled();
    unmount();
    expect(bus.listeners.size).toBe(0);
  });

  it('clears a remotely removed address without silently registering a replacement', async () => {
    const client = createMockClient({ getLightningAddress: vi.fn().mockResolvedValue(address('previous')) });
    const bus = events();
    const { result } = renderHook(() => useLightningAddress(), {
      wrapper: ({ children }) => <WalletProvider client={client} isConnected subscribeToSdkEvents={bus.subscribe}>{children}</WalletProvider>,
    });
    await waitFor(() => expect(result.current.address?.username).toBe('previous'));
    vi.mocked(client.getLightningAddress).mockResolvedValue(undefined);
    act(() => bus.emit({ type: 'lightningAddressChanged' }));

    await waitFor(() => expect(result.current.address).toBeNull());
    expect(client.registerLightningAddress).not.toHaveBeenCalled();
  });

  it('reads the current SDK when the shared bus delivers a previous session payload', async () => {
    const nextAddress = address('nextwallet');
    const client = createMockClient({ getLightningAddress: vi.fn().mockResolvedValue(nextAddress) });
    const bus = events();
    const { result } = renderHook(() => useLightningAddress(), {
      wrapper: ({ children }) => <WalletProvider client={client} isConnected subscribeToSdkEvents={bus.subscribe}>{children}</WalletProvider>,
    });
    await waitFor(() => expect(result.current.address).toEqual(nextAddress));
    await act(async () => {
      bus.emit({ type: 'lightningAddressChanged', lightningAddress: address('previouswallet') });
    });

    expect(client.getLightningAddress).toHaveBeenCalledTimes(2);
    expect(result.current.address).toEqual(nextAddress);
  });
});
