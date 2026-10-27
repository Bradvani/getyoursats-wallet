import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { waitFor } from '@testing-library/react';
import { exportDatabaseState } from './logExport';

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((finish, fail) => { resolve = finish; reject = fail; });
  return { promise, resolve, reject };
}

function database({ manualOpen = false, manualRows = false } = {}) {
  const rows = {
    result: [{ id: 'synthetic-payment', preimage: 'ab'.repeat(32), description: 'Retained receipt' }],
    onsuccess: null as null | (() => void), onerror: null as null | (() => void), error: new Error('Read failed'),
  };
  const getAll = vi.fn(() => {
    if (!manualRows) queueMicrotask(() => rows.onsuccess?.());
    return rows;
  });
  const db = {
    objectStoreNames: ['payments'], version: 1, close: vi.fn(),
    transaction: vi.fn(() => ({ objectStore: () => ({ getAll }) })),
  };
  const request = {
    result: db, onsuccess: null as null | (() => void), onerror: null as null | (() => void),
    onupgradeneeded: null as null | (() => void),
  };
  const open = vi.fn(() => {
    if (!manualOpen) queueMicrotask(() => request.onsuccess?.());
    return request;
  });
  vi.stubGlobal('indexedDB', { open });
  return { db, open, getAll, request, rows };
}

const identity = `02${'11'.repeat(32)}`;
let share: ReturnType<typeof vi.fn>;
let click: ReturnType<typeof vi.spyOn>;
let createUrl: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  share = vi.fn(async () => {});
  vi.stubGlobal('navigator', { ...navigator, share, canShare: () => true });
  click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
  createUrl = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:synthetic-export');
  vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
});
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe('database export publication authorization', () => {
  it('preserves redaction and shares a current authorized export once', async () => {
    const storage = database();
    const authorize = vi.fn();
    await exportDatabaseState(identity, 'regtest', authorize);
    expect(share).toHaveBeenCalledOnce();
    const file = (share.mock.calls[0][0] as { files: File[] }).files[0];
    const content = await file.text();
    expect(content).toContain('Retained receipt');
    expect(content).not.toContain('ab'.repeat(32));
    expect(authorize).toHaveBeenCalled();
    expect(storage.db.close).toHaveBeenCalledOnce();
    expect(click).not.toHaveBeenCalled();
  });

  it('does not access the database when authorization has already expired', async () => {
    const storage = database();
    await expect(exportDatabaseState(identity, 'regtest', () => { throw new Error('Authorization expired'); })).rejects.toThrow('Authorization expired');
    expect(storage.open).not.toHaveBeenCalled();
    expect(share).not.toHaveBeenCalled();
    expect(createUrl).not.toHaveBeenCalled();
  });

  it('checks authorization after the asynchronous database-name derivation', async () => {
    const storage = database();
    const pending = deferred<ArrayBuffer>();
    vi.spyOn(crypto.subtle, 'digest').mockReturnValueOnce(pending.promise);
    let allowed = true;
    const result = exportDatabaseState(identity, 'regtest', () => { if (!allowed) throw new Error('Authorization expired'); });
    const rejected = expect(result).rejects.toThrow('Authorization expired');
    allowed = false;
    pending.resolve(new ArrayBuffer(32));
    await rejected;
    expect(storage.open).not.toHaveBeenCalled();
    expect(share).not.toHaveBeenCalled();
    expect(createUrl).not.toHaveBeenCalled();
  });

  it('closes a database opened after authorization expired without reading its rows', async () => {
    const storage = database({ manualOpen: true });
    let allowed = true;
    const result = exportDatabaseState(identity, 'regtest', () => { if (!allowed) throw new Error('Authorization expired'); });
    const rejected = expect(result).rejects.toThrow('Authorization expired');
    await waitFor(() => expect(storage.open).toHaveBeenCalledOnce());
    allowed = false;
    storage.request.onsuccess?.();
    await rejected;
    expect(storage.getAll).not.toHaveBeenCalled();
    expect(storage.db.close).toHaveBeenCalledOnce();
    expect(share).not.toHaveBeenCalled();
    expect(createUrl).not.toHaveBeenCalled();
  });

  it('discards a delayed dump when access is revoked before the records arrive', async () => {
    const storage = database({ manualRows: true });
    let allowed = true;
    const result = exportDatabaseState(identity, 'regtest', () => { if (!allowed) throw new Error('Authorization expired'); });
    const rejected = expect(result).rejects.toThrow('Authorization expired');
    await waitFor(() => expect(storage.getAll).toHaveBeenCalledOnce());
    allowed = false;
    storage.rows.onsuccess?.();
    await rejected;
    expect(storage.db.close).toHaveBeenCalledOnce();
    expect(share).not.toHaveBeenCalled();
    expect(click).not.toHaveBeenCalled();
    expect(createUrl).not.toHaveBeenCalled();
  });

  it('does not start a fallback download after a failed share outlives its authorization', async () => {
    const storage = database();
    const pending = deferred<void>();
    share.mockReturnValueOnce(pending.promise);
    let allowed = true;
    const result = exportDatabaseState(identity, 'regtest', () => { if (!allowed) throw new Error('Authorization expired'); });
    const rejected = expect(result).rejects.toThrow('Authorization expired');
    await waitFor(() => expect(share).toHaveBeenCalledOnce());
    allowed = false;
    pending.reject(new Error('Share service unavailable'));
    await rejected;
    expect(createUrl).not.toHaveBeenCalled();
    expect(click).not.toHaveBeenCalled();
    expect(storage.db.close).toHaveBeenCalledOnce();
  });

  it('keeps the authorized download fallback available after a non-cancelled share failure', async () => {
    const storage = database();
    share.mockRejectedValueOnce(new Error('Share service unavailable'));
    await exportDatabaseState(identity, 'regtest', () => {});
    expect(share).toHaveBeenCalledOnce();
    expect(click).toHaveBeenCalledOnce();
    expect(storage.db.close).toHaveBeenCalledOnce();
  });
});
