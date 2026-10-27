import { describe, it, expect, vi, afterEach } from 'vitest';

// appLock guards on Capacitor.isNativePlatform() at import-call time, so
// each case mocks the platform + an in-memory Preferences and re-imports.
function makePreferencesMock() {
  const store = new Map<string, string>();
  return {
    store,
    Preferences: {
      get: async ({ key }: { key: string }) => ({ value: store.get(key) ?? null }),
      set: async ({ key, value }: { key: string; value: string }) => { store.set(key, value); },
      remove: async ({ key }: { key: string }) => { store.delete(key); },
    },
  };
}

async function loadAppLock(native: boolean) {
  vi.resetModules();
  localStorage.clear();
  vi.doMock('@capacitor/core', () => ({
    Capacitor: {
      isNativePlatform: () => native,
      getPlatform: () => (native ? 'android' : 'web'),
    },
  }));
  const prefs = makePreferencesMock();
  vi.doMock('@capacitor/preferences', () => ({ Preferences: prefs.Preferences }));
  const mod = await import('./appLock');
  return { ...mod, store: prefs.store, preferences: prefs.Preferences };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(finish => { resolve = finish; });
  return { promise, resolve };
}

afterEach(() => {
  vi.doUnmock('@capacitor/core');
  vi.doUnmock('@capacitor/preferences');
});

describe('appLock PIN', () => {
  it('set/verify roundtrip, wrong PIN rejected', async () => {
    const appLock = await loadAppLock(true);
    expect(await appLock.isPinEnabled()).toBe(false);
    await appLock.setPin('123456');
    expect(await appLock.isPinEnabled()).toBe(true);
    expect((await appLock.verifyPin('123456')).ok).toBe(true);
    expect((await appLock.verifyPin('654321')).ok).toBe(false);
  });

  it('stores a salted hash, never the PIN, with a fresh salt per set', async () => {
    const appLock = await loadAppLock(true);
    await appLock.setPin('123456');
    const firstValues = [...appLock.store.values()];
    expect(firstValues).not.toContain('123456');
    await appLock.setPin('123456');
    // Same PIN, rotated salt => different stored hash.
    expect([...appLock.store.values()].sort()).not.toEqual(firstValues.sort());
    expect((await appLock.verifyPin('123456')).ok).toBe(true);
  });

  it('mirrors the enabled flag for synchronous lock gating', async () => {
    const appLock = await loadAppLock(true);
    expect(appLock.isPinEnabledSync()).toBe(false);
    await appLock.setPin('123456');
    expect(appLock.isPinEnabledSync()).toBe(true);
    await appLock.clearPin();
    expect(appLock.isPinEnabledSync()).toBe(false);
  });

  it('clearPin disables the PIN and the biometric gate with it', async () => {
    const appLock = await loadAppLock(true);
    await appLock.setPin('123456');
    await appLock.setBiometricGateEnabled(true);
    expect(await appLock.isBiometricGateEnabled()).toBe(true);
    await appLock.clearPin();
    expect(await appLock.isPinEnabled()).toBe(false);
    expect(await appLock.isBiometricGateEnabled()).toBe(false);
    expect((await appLock.verifyPin('123456')).ok).toBe(false);
  });

  it('mirrors the biometric gate flag for synchronous reads', async () => {
    const appLock = await loadAppLock(true);
    expect(appLock.isBiometricGateEnabledSync()).toBe(false);
    await appLock.setBiometricGateEnabled(true);
    expect(appLock.isBiometricGateEnabledSync()).toBe(true);
    await appLock.setBiometricGateEnabled(false);
    expect(appLock.isBiometricGateEnabledSync()).toBe(false);
    await appLock.setBiometricGateEnabled(true);
    await appLock.clearPin();
    expect(appLock.isBiometricGateEnabledSync()).toBe(false);
  });
  it('checks an automatic cleanup lease again at queued mutation entry', async () => {
    const appLock = await loadAppLock(true);
    await appLock.setPin('123456');
    const lease = await import('./nativeReadLease');
    const original = appLock.store.get('glow.appLock.pin');
    const clearing = appLock.clearPin({
      policyRevision: lease.getNativePinPolicyRevision(), readRevision: lease.getNativeReadLeaseRevision(),
    });
    lease.invalidateNativeReadBinding();
    await expect(clearing).rejects.toBeInstanceOf(appLock.PinRecordUnavailableError);
    expect(appLock.store.get('glow.appLock.pin')).toBe(original);
    expect(() => lease.captureNativeReadLease()).toThrow(/locked/);
  });

  it('does not grant read access when a clear commits before its acknowledgement fails', async () => {
    const appLock = await loadAppLock(true);
    await appLock.setPin('123456');
    const lease = await import('./nativeReadLease');
    vi.spyOn(appLock.preferences, 'remove').mockImplementationOnce(async ({ key }) => {
      appLock.store.delete(key);
      throw new Error('Lost clear acknowledgement');
    });
    await expect(appLock.clearPin()).rejects.toThrow('Lost clear acknowledgement');
    expect(await appLock.isPinEnabled()).toBe(false);
    expect(() => lease.captureNativeReadLease()).toThrow(/locked/);
  });

  it('orders clear after an earlier delayed biometric enable so a new PIN does not inherit it', async () => {
    const appLock = await loadAppLock(true);
    await appLock.setPin('123456');
    const entered = deferred<void>();
    const release = deferred<void>();
    const pinRemoved = deferred<void>();
    vi.spyOn(appLock.preferences, 'set').mockImplementation(async ({ key, value }) => {
      if (key === 'glow.appLock.biometricEnabled') { entered.resolve(); await release.promise; }
      appLock.store.set(key, value);
    });
    vi.spyOn(appLock.preferences, 'remove').mockImplementation(async ({ key }) => {
      appLock.store.delete(key);
      if (key === 'glow.appLock.pin') pinRemoved.resolve();
    });
    const enabling = appLock.setBiometricGateEnabled(true);
    await entered.promise;
    const clearing = appLock.clearPin();
    await pinRemoved.promise;
    release.resolve();
    await Promise.all([enabling, clearing]);
    expect(await appLock.isBiometricGateEnabled()).toBe(false);
    await appLock.setPin('654321');
    expect(await appLock.isBiometricGateEnabled()).toBe(false);
  });

});

describe('appLock failed-attempt backoff', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('locks out after the free attempts and clears on the correct PIN', async () => {
    const appLock = await loadAppLock(true);
    await appLock.setPin('123456');

    // Five free tries: rejected, but nothing to wait for yet.
    for (let i = 0; i < 5; i++) {
      expect(await appLock.verifyPin('000000')).toMatchObject({ ok: false, lockedForMs: 0 });
    }

    vi.useFakeTimers();
    expect((await appLock.verifyPin('000000')).lockedForMs).toBe(30_000);

    // The wait covers every attempt, a correct PIN included: one that
    // only applied to wrong entries would not bound the rate.
    expect((await appLock.verifyPin('123456')).ok).toBe(false);

    vi.advanceTimersByTime(30_000);
    expect((await appLock.verifyPin('123456')).ok).toBe(true);

    // Success resets the counter, so the next failure is free again.
    expect((await appLock.verifyPin('000000')).lockedForMs).toBe(0);
  });

  it('caps a backwards clock at the longest scheduled wait', async () => {
    const appLock = await loadAppLock(true);
    await appLock.setPin('123456');
    vi.useFakeTimers();
    for (let i = 0; i < 6; i++) await appLock.verifyPin('000000');
    // Device clock pushed a year back: still a bounded wait, not a brick.
    vi.setSystemTime(Date.now() - 365 * 24 * 3600_000);
    expect((await appLock.verifyPin('123456')).lockedForMs).toBe(3600_000);
  });
});

describe('appLock auto-lock timeout', () => {
  it('defaults to 120s and roundtrips a chosen value, mirror included', async () => {
    const appLock = await loadAppLock(true);
    expect(await appLock.getAutoLockSeconds()).toBe(120);
    expect(appLock.getAutoLockSecondsSync()).toBe(120);
    await appLock.setAutoLockSeconds(600);
    expect(await appLock.getAutoLockSeconds()).toBe(600);
    expect(appLock.getAutoLockSecondsSync()).toBe(600);
  });

  it('heals an evicted mirror on the next async read', async () => {
    const appLock = await loadAppLock(true);
    await appLock.setAutoLockSeconds(3600);
    // WebView storage eviction, or an install that chose a timeout
    // before the mirror existed. The sync read silently means 2 minutes
    // until something reads through to Preferences.
    localStorage.clear();
    expect(appLock.getAutoLockSecondsSync()).toBe(120);
    await appLock.getAutoLockSeconds();
    expect(appLock.getAutoLockSecondsSync()).toBe(3600);
  });

  it('formats every dropdown option', async () => {
    const appLock = await loadAppLock(true);
    const labels = appLock.AUTO_LOCK_OPTIONS_SECONDS.map(appLock.formatAutoLockOption);
    expect(labels).toEqual([
      'Immediately', '30 seconds', '2 minutes', '5 minutes',
      '10 minutes', '30 minutes', '1 hour',
    ]);
  });
});

describe('appLock idle-lock suppression', () => {
  it('stays suppressed until every overlapping holder releases', async () => {
    const appLock = await loadAppLock(true);
    expect(appLock.isIdleLockSuppressed()).toBe(false);

    // The scanner opening over the send sheet: the inner release must
    // not cancel the outer hold.
    const send = appLock.holdIdleLock();
    const scanner = appLock.holdIdleLock();
    scanner();
    expect(appLock.isIdleLockSuppressed()).toBe(true);
    send();
    expect(appLock.isIdleLockSuppressed()).toBe(false);
  });

  it('ignores a second release from the same holder', async () => {
    const appLock = await loadAppLock(true);
    const receive = appLock.holdIdleLock();
    const scanner = appLock.holdIdleLock();
    receive();
    receive();
    expect(appLock.isIdleLockSuppressed()).toBe(true);
    scanner();
    expect(appLock.isIdleLockSuppressed()).toBe(false);
  });
});

describe('appLock PIN record upgrade', () => {
  // A record written before the derivation cost was raised: no
  // `iterations` field, hash computed at the old count.
  async function legacyRecord(pin: string, saltHex: string) {
    const salt = Uint8Array.from(saltHex.match(/../g)!.map((b) => parseInt(b, 16)));
    const key = await crypto.subtle.importKey(
      'raw', new TextEncoder().encode(pin), 'PBKDF2', false, ['deriveBits'],
    );
    const bits = await crypto.subtle.deriveBits(
      { name: 'PBKDF2', hash: 'SHA-256', salt, iterations: 100_000 }, key, 256,
    );
    const hash = [...new Uint8Array(bits)].map((b) => b.toString(16).padStart(2, '0')).join('');
    return { v: 1, salt: saltHex, hash };
  }

  it('verifies a pre-raise record and re-derives it at the new cost', async () => {
    const appLock = await loadAppLock(true);
    const saltHex = '000102030405060708090a0b0c0d0e0f';
    appLock.store.set('glow.appLock.pin', JSON.stringify(await legacyRecord('123456', saltHex)));

    expect((await appLock.verifyPin('654321')).ok).toBe(false);
    expect((await appLock.verifyPin('123456')).ok).toBe(true);

    const upgraded = JSON.parse(appLock.store.get('glow.appLock.pin')!);
    expect(upgraded.iterations).toBe(600_000);
    expect(upgraded.salt).not.toBe(saltHex);
    // Still the same PIN afterwards, and only that PIN.
    expect((await appLock.verifyPin('123456')).ok).toBe(true);
    expect((await appLock.verifyPin('654321')).ok).toBe(false);
  });

  it('rejects a record whose stored cost was tampered with, without throwing', async () => {
    const appLock = await loadAppLock(true);
    const saltHex = '0f0e0d0c0b0a09080706050403020100';
    const record = { ...(await legacyRecord('123456', saltHex)), iterations: 0 };
    appLock.store.set('glow.appLock.pin', JSON.stringify(record));
    const raw = appLock.store.get('glow.appLock.pin');
    expect(await appLock.verifyPin('123456')).toMatchObject({ ok: false, error: expect.any(String) });
    expect(appLock.store.get('glow.appLock.pin')).toBe(raw);
  });
  it('blocks transitional old-PIN reads while a replacement is being derived, including legacy upgrade', async () => {
    const appLock = await loadAppLock(true);
    const original = JSON.stringify(await legacyRecord('123456', '00'.repeat(16)));
    appLock.store.set('glow.appLock.pin', original);
    const entered = deferred<void>();
    const release = deferred<void>();
    const derive = crypto.subtle.deriveBits.bind(crypto.subtle);
    vi.spyOn(crypto.subtle, 'deriveBits').mockImplementationOnce(async (...args) => {
      entered.resolve();
      await release.promise;
      return derive(...args);
    });
    const write = vi.spyOn(appLock.preferences, 'set');
    const replacement = appLock.setPin('654321');
    await entered.promise;
    expect(appLock.store.get('glow.appLock.pin')).toBe(original);
    await expect(appLock.isPinEnabled()).rejects.toBeInstanceOf(appLock.PinRecordUnavailableError);
    expect(await appLock.verifyPin('123456')).toMatchObject({ ok: false, error: expect.any(String) });
    expect(write).not.toHaveBeenCalled();
    release.resolve();
    await replacement;
    const replaced = appLock.store.get('glow.appLock.pin');
    expect(replaced).not.toBe(original);
    expect(write.mock.calls.filter(([entry]) => entry.key === 'glow.appLock.pin')).toHaveLength(1);
    expect((await appLock.verifyPin('123456')).ok).toBe(false);
    expect((await appLock.verifyPin('654321')).ok).toBe(true);
    expect(appLock.store.get('glow.appLock.pin')).toBe(replaced);
  });

  it('rejects an old legacy verification delayed across a completed replacement without writing an upgrade', async () => {
    const appLock = await loadAppLock(true);
    appLock.store.set('glow.appLock.pin', JSON.stringify(await legacyRecord('123456', '00'.repeat(16))));
    const entered = deferred<void>();
    const release = deferred<void>();
    const derive = crypto.subtle.deriveBits.bind(crypto.subtle);
    vi.spyOn(crypto.subtle, 'deriveBits').mockImplementationOnce(async (...args) => {
      entered.resolve();
      await release.promise;
      return derive(...args);
    });
    const oldVerification = appLock.verifyPin('123456');
    await entered.promise;
    await appLock.setPin('654321');
    const replacement = appLock.store.get('glow.appLock.pin');
    release.resolve();
    expect(await oldVerification).toMatchObject({ ok: false });
    expect(appLock.store.get('glow.appLock.pin')).toBe(replacement);
    expect((await appLock.verifyPin('654321')).ok).toBe(true);
  });

  it('binds a legacy upgrade to the exact record observed before verification', async () => {
    const appLock = await loadAppLock(true);
    const original = JSON.stringify(await legacyRecord('123456', '00'.repeat(16)));
    const replacement = JSON.stringify({ v: 1, salt: '22'.repeat(16), hash: '33'.repeat(32), iterations: 600_000 });
    appLock.store.set('glow.appLock.pin', original);
    let pinReads = 0;
    vi.spyOn(appLock.preferences, 'get').mockImplementation(async ({ key }) => {
      if (key === 'glow.appLock.pin' && ++pinReads === 2) appLock.store.set(key, replacement);
      return { value: appLock.store.get(key) ?? null };
    });
    const write = vi.spyOn(appLock.preferences, 'set');
    expect(await appLock.verifyPin('123456')).toMatchObject({ ok: false });
    expect(pinReads).toBe(2);
    expect(appLock.store.get('glow.appLock.pin')).toBe(replacement);
    expect(write).not.toHaveBeenCalled();
  });

  it('preserves a replacement whose write committed before its acknowledgement failed', async () => {
    const appLock = await loadAppLock(true);
    await appLock.setPin('123456');
    const old = appLock.store.get('glow.appLock.pin');
    vi.spyOn(appLock.preferences, 'set').mockImplementationOnce(async ({ key, value }) => {
      appLock.store.set(key, value);
      throw new Error('Lost write acknowledgement');
    });
    await expect(appLock.setPin('654321')).rejects.toThrow('Lost write acknowledgement');
    const replacement = appLock.store.get('glow.appLock.pin');
    expect(replacement).not.toBe(old);
    const lease = await import('./nativeReadLease');
    expect(() => lease.captureNativeReadLease()).toThrow(/locked/);
    expect((await appLock.verifyPin('123456')).ok).toBe(false);
    expect((await appLock.verifyPin('654321')).ok).toBe(true);
    expect(appLock.store.get('glow.appLock.pin')).toBe(replacement);
    expect(() => lease.captureNativeReadLease()).toThrow(/locked/);
  });
});

describe('appLock on web', () => {
  it('reports unsupported and disabled everywhere', async () => {
    const appLock = await loadAppLock(false);
    expect(appLock.isAppLockSupported()).toBe(false);
    expect(await appLock.isPinEnabled()).toBe(false);
    expect(await appLock.isBiometricGateEnabled()).toBe(false);
  });
});


describe('strict durable PIN policy', () => {
  const valid = { v: 1, salt: '00'.repeat(16), hash: '11'.repeat(32), iterations: 600_000 };
  const malformed: [string, string][] = [
    ['invalid JSON', '{'], ['JSON null', 'null'], ['array', '[]'],
    ['version', JSON.stringify({ ...valid, v: 2 })],
    ['salt length', JSON.stringify({ ...valid, salt: '00'.repeat(15) })],
    ['salt alphabet', JSON.stringify({ ...valid, salt: 'GG'.repeat(16) })],
    ['hash length', JSON.stringify({ ...valid, hash: '11'.repeat(31) })],
    ['hash type', JSON.stringify({ ...valid, hash: [] })],
    ['zero iterations', JSON.stringify({ ...valid, iterations: 0 })],
    ['negative iterations', JSON.stringify({ ...valid, iterations: -1 })],
    ['unbounded iterations', JSON.stringify({ ...valid, iterations: Number.MAX_SAFE_INTEGER })],
    ['unsupported cost', JSON.stringify({ ...valid, iterations: 600_001 })],
    ['string cost', JSON.stringify({ ...valid, iterations: '600000' })],
    ['null cost', JSON.stringify({ ...valid, iterations: null })],
    ['unknown field', JSON.stringify({ ...valid, enabled: false })],
    ['oversized record', ' '.repeat(1025) + JSON.stringify(valid)],
  ];

  it.each(malformed)('preserves %s as unavailable instead of absent', async (_label, raw) => {
    const appLock = await loadAppLock(true);
    appLock.store.set('glow.appLock.pin', raw);
    const derive = vi.spyOn(crypto.subtle, 'deriveBits');
    const remove = vi.spyOn(appLock.preferences, 'remove');
    const write = vi.spyOn(appLock.preferences, 'set');
    await expect(appLock.isPinEnabled()).rejects.toBeInstanceOf(appLock.PinRecordUnavailableError);
    expect(await appLock.verifyPin('123456')).toMatchObject({ ok: false, error: expect.any(String) });
    expect(appLock.store.get('glow.appLock.pin')).toBe(raw);
    expect(appLock.isPinEnabledSync()).toBe(true);
    expect(derive).not.toHaveBeenCalled();
    expect(remove).not.toHaveBeenCalled();
    expect(write).not.toHaveBeenCalled();
  });

  it('heals a missing mirror only after reading a valid durable record', async () => {
    const appLock = await loadAppLock(true);
    await appLock.setPin('123456');
    const raw = appLock.store.get('glow.appLock.pin');
    localStorage.clear();
    expect(appLock.isPinEnabledSync()).toBe(false);
    expect(await appLock.isPinEnabled()).toBe(true);
    expect(appLock.isPinEnabledSync()).toBe(true);
    expect(appLock.store.get('glow.appLock.pin')).toBe(raw);
    const lease = await import('./nativeReadLease');
    expect(() => lease.captureNativeReadLease()).toThrow(/locked/);
  });
});
