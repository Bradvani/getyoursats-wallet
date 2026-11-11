import {it, expect, vi} from 'vitest';
const mocks = vi.hoisted(() => ({init: vi.fn(), unlock: vi.fn(), config: vi.fn(), factory: vi.fn(), builder: vi.fn()}));
vi.mock('@breeztech/breez-sdk-spark', () => ({default: mocks.init, defaultConfig: mocks.config,
  defaultExternalSignersFromSeed: mocks.factory, SdkBuilder: {newWithSigner: mocks.builder}}));
vi.mock('./webWalletVault', () => ({unlockWebWallet: mocks.unlock, clearUnlockedWebMnemonic: vi.fn()}));

it('direct fixture invocation remains blocked before storage, unlock, SDK init or builder access', async () => {
  const storage = vi.spyOn(Storage.prototype, 'getItem');
  await import('../../e2e/fixtures/settled-incoming-observation');
  storage.mockClear();
  await expect(window.gysSettledIncomingObservation.observe('wallet-0')).rejects.toThrow('BLOCKED_PENDING_SUCCESSOR_STORAGE_PROVENANCE');
  expect(storage).not.toHaveBeenCalled();
  for (const fn of Object.values(mocks)) expect(fn).not.toHaveBeenCalled();
  storage.mockRestore();
});
