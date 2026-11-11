import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import type {Network} from '@breeztech/breez-sdk-spark';
import {assertNoLegacyExternalSignerStorage} from './browserSdkStorage';

const root = 'spark-wallet-example';
let databases: ReturnType<typeof vi.fn>;
let open: ReturnType<typeof vi.fn>;
let remove: ReturnType<typeof vi.fn>;

beforeEach(() => {
  databases = vi.fn(async () => []);
  open = vi.fn(() => {throw new Error('Storage opening is forbidden in this preflight');});
  remove = vi.fn(() => {throw new Error('Storage deletion is forbidden in this preflight');});
  vi.stubGlobal('indexedDB', {databases, open, deleteDatabase: remove});
});
afterEach(() => {
  expect(open).not.toHaveBeenCalled();
  expect(remove).not.toHaveBeenCalled();
  vi.unstubAllGlobals();
});

describe('legacy external-signer storage preservation', () => {
  it.each([
    ['mainnet','9ce7940a'], ['regtest','2687e55a'], ['signet','2687e55a'],
  ] as const)('blocks either SDK or durable tree namespace on %s', async (network, suffix) => {
    for (const tree of ['', '-tree']) {
      const record = Object.freeze({name: `${root}/${network}/${suffix}${tree}`, version:23});
      const records = Object.freeze([record]);
      databases.mockResolvedValueOnce(records);
      await expect(assertNoLegacyExternalSignerStorage(root, network))
        .rejects.toMatchObject({code:'LEGACY_SHARED_STORAGE'});
      expect(records[0]).toBe(record);
    }
  });

  it('retains seeded-production and unrelated namespaces without opening any store', async () => {
    const records = Object.freeze([
      Object.freeze({name:`${root}/mainnet/d2ea863c`,version:23}),
      Object.freeze({name:`${root}/mainnet/d2ea863c-tree`,version:1}),
      Object.freeze({name:'unrelated/mainnet/9ce7940a',version:1}),
      Object.freeze({name:`${root}/regtest/2687e55a`,version:23}),
      Object.freeze({name:`${root}/mainnet/9ce7940a-other`,version:1}),
      Object.freeze({name:'',version:1}),
    ]);
    databases.mockResolvedValueOnce(records);
    await expect(assertNoLegacyExternalSignerStorage(root, 'mainnet')).resolves.toBeUndefined();
    expect(records).toHaveLength(6);
  });

  it('rechecks metadata on every attempt instead of caching absence', async () => {
    databases.mockResolvedValueOnce([]).mockResolvedValueOnce([{name:`${root}/mainnet/9ce7940a-tree`}]);
    await assertNoLegacyExternalSignerStorage(root, 'mainnet');
    await expect(assertNoLegacyExternalSignerStorage(root, 'mainnet')).rejects.toMatchObject({code:'LEGACY_SHARED_STORAGE'});
    expect(databases).toHaveBeenCalledTimes(2);
  });

  it('treats rejected metadata access as unknown, even if the error claims there is no database', async () => {
    databases.mockRejectedValueOnce(new Error('No stored databases'));
    await expect(assertNoLegacyExternalSignerStorage(root, 'mainnet')).rejects.toMatchObject({code:'STORAGE_PRESENCE_UNKNOWN'});
  });

  it.each([undefined,null,{}, {databases:42}])('fails closed without supported database enumeration: %j', async value => {
    vi.stubGlobal('indexedDB',value);
    await expect(assertNoLegacyExternalSignerStorage(root, 'mainnet')).rejects.toMatchObject({code:'STORAGE_PRESENCE_UNKNOWN'});
  });

  it.each([undefined,null,{},'[]',[null],[{}],[{name:null}],[{name:33}],[['name']]])(
    'does not interpret malformed metadata as absence: %j', async value => {
      databases.mockResolvedValueOnce(value);
      await expect(assertNoLegacyExternalSignerStorage(root, 'mainnet')).rejects.toMatchObject({code:'STORAGE_PRESENCE_UNKNOWN'});
    });

  it.each(['','../wallet','wallet/root','wallet\\root','wallet\0root'])('rejects an unsupported directory shape %j before querying', async directory => {
    await expect(assertNoLegacyExternalSignerStorage(directory, 'mainnet')).rejects.toMatchObject({code:'STORAGE_PRESENCE_UNKNOWN'});
    expect(databases).not.toHaveBeenCalled();
  });

  it.each(['__proto__','testnet','',undefined])('rejects an unknown network %j before querying', async network => {
    await expect(assertNoLegacyExternalSignerStorage(root, network as Network)).rejects.toMatchObject({code:'STORAGE_PRESENCE_UNKNOWN'});
    expect(databases).not.toHaveBeenCalled();
  });
});
