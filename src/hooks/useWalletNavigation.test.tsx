import { useState } from 'react';
import { act, renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { useWalletNavigation } from './useWalletNavigation';

describe('persistent wallet navigation', () => {
  function useHarness(initialScreen = 'wallet') {
    const [screen, setScreen] = useState(initialScreen);
    const navigation = useWalletNavigation(() => setScreen('wallet'), () => setScreen('settings'));
    return { screen, ...navigation };
  }

  it.each(['settings', 'fiatCurrencies', 'backup', 'security'])('reveals History from %s', initialScreen => {
    const { result } = renderHook(() => useHarness(initialScreen));
    act(() => result.current.navigate('history'));
    expect(result.current.screen).toBe('wallet');
    expect(result.current.historyOpen).toBe(true);
    expect(result.current.gysPosOpen).toBe(false);
  });

  it('supports Settings → Merchant → History → Wallet → Settings without overlapping destinations', () => {
    const { result } = renderHook(() => useHarness('settings'));
    act(() => result.current.navigate('merchant'));
    expect(result.current.screen).toBe('wallet');
    expect(result.current.gysPosOpen).toBe(true);
    act(() => result.current.navigate('history'));
    expect(result.current.gysPosOpen).toBe(false);
    expect(result.current.historyOpen).toBe(true);
    act(() => result.current.navigate('wallet'));
    expect(result.current.historyOpen).toBe(false);
    act(() => result.current.navigate('settings'));
    expect(result.current.screen).toBe('settings');
    expect(result.current.gysPosOpen).toBe(false);
  });
});
