import { describe, it, expect, vi, beforeEach } from 'vitest';
import { encryptAllExistingNotes, encryptSingleDocument } from '../encryptMigration';
import * as encryptModule from '../encrypt';
import * as cryptoHelpers from '../cryptoHelpers';

vi.spyOn(encryptModule, 'getSessionKey').mockImplementation(() => ({} as CryptoKey));

vi.spyOn(cryptoHelpers, 'maybeEncrypt').mockImplementation(async (doc, fields, arrayFields) => {
  const result = { ...doc };
  fields.forEach(f => {
    if (typeof result[f] === 'string') {
      result[f] = 'encrypted_' + result[f];
    }
  });
  arrayFields.forEach(f => {
    if (Array.isArray(result[f])) {
      result[f] = 'encrypted_arr_' + JSON.stringify(result[f]);
    }
  });
  result._encrypted = true;
  return result;
});

const {
  mockGetDocument,
  mockGetUserDocuments,
  mockGetVersions,
  mockGetMigrationDrafts,
  mockExecuteMigrationBatch
} = vi.hoisted(() => ({
  mockGetDocument: vi.fn(),
  mockGetUserDocuments: vi.fn(),
  mockGetVersions: vi.fn(),
  mockGetMigrationDrafts: vi.fn(),
  mockExecuteMigrationBatch: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../data', () => ({
  DataProvider: {
    getDocument: mockGetDocument,
    getUserDocuments: mockGetUserDocuments,
    getVersions: mockGetVersions,
    getMigrationDrafts: mockGetMigrationDrafts,
    executeMigrationBatch: mockExecuteMigrationBatch,
    // Проход шифрует ещё и производные ИИ. Метода, которого нет в подделке,
    // достаточно, чтобы проход счёл себя упавшим и оставил контрольную точку:
    // добавляя сюда хранилище, добавь его и в миграцию.
    getUserSummaries: vi.fn(async () => []),
    getUserEmbeddings: vi.fn(async () => []),
    getLocalStoreRecords: vi.fn(async () => []),
  },
}));

describe('encryptAllExistingNotes', () => {
  const userId = 'user123';

  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    mockGetDocument.mockResolvedValue(null);
  });

  it('encrypts all unencrypted documents, versions, and drafts', async () => {
    mockGetUserDocuments.mockResolvedValue([{ id: 'doc1' }]);
    mockGetVersions.mockImplementation(async (_u, docId) => docId === 'doc1' ? [{ id: 'ver1', content: 'world', _encrypted: false }] : []);
    mockGetMigrationDrafts.mockResolvedValue([{ id: 'draft1', data: { content: 'test', _encrypted: false } }]);

    const progressCallback = vi.fn();
    const progress = await encryptAllExistingNotes(userId, progressCallback);

    expect(progress.total).toBe(3); // 1 doc + 1 version + 1 draft
    expect(progress.processed).toBe(3);
    expect(progress.encrypted).toBe(3);
    expect(progress.errors).toBe(0);
    expect(progressCallback).toHaveBeenCalled();
  });

  it('skips already encrypted documents', async () => {
    mockGetUserDocuments.mockResolvedValue([]);
    mockGetMigrationDrafts.mockResolvedValue([]);

    const progress = await encryptAllExistingNotes(userId);
    expect(progress.total).toBe(0);
    expect(progress.processed).toBe(0);
    expect(progress.encrypted).toBe(0);
    expect(progress.errors).toBe(0);
  });

  it('resumes from checkpoint on retry', async () => {
    mockGetUserDocuments.mockResolvedValue([]);
    mockGetMigrationDrafts.mockResolvedValue([]);

    localStorage.setItem(`encryptionMigration_${userId}_checkpoint`, JSON.stringify(['s_sess1']));

    const progress = await encryptAllExistingNotes(userId);
    expect(progress.total).toBe(0);
    expect(progress.processed).toBe(0);
    expect(progress.encrypted).toBe(0);
  });

  it('aborts when signal is aborted', async () => {
    mockGetUserDocuments.mockResolvedValue([]);
    mockGetMigrationDrafts.mockResolvedValue([]);

    const controller = new AbortController();
    controller.abort();

    await expect(encryptAllExistingNotes(userId, undefined, controller.signal)).rejects.toThrow('Migration aborted');
  });

  it('handles individual document encryption failure gracefully', async () => {
    mockGetUserDocuments.mockResolvedValue([{ id: 'doc1' }]);
    mockGetVersions.mockResolvedValue([{ id: 'ver1', content: 'hello', _encrypted: false }]);
    mockGetMigrationDrafts.mockResolvedValue([]);

    vi.spyOn(cryptoHelpers, 'maybeEncrypt').mockRejectedValueOnce(new Error('Crypt error'));

    const progress = await encryptAllExistingNotes(userId);
    expect(progress.total).toBe(2); // 1 doc + 1 version
    expect(progress.processed).toBe(2);
    expect(progress.encrypted).toBe(1);
    expect(progress.errors).toBe(1);
  });

  it('V-2: passes required=true as 4th arg to maybeEncrypt', async () => {
    mockGetUserDocuments.mockResolvedValue([{ id: 'doc1' }]);
    mockGetVersions.mockResolvedValue([{ id: 'ver1', content: 'hello', _encrypted: false }]);
    mockGetMigrationDrafts.mockResolvedValue([]);

    const spy = vi.spyOn(cryptoHelpers, 'maybeEncrypt');
    await encryptAllExistingNotes(userId);

    expect(spy).toHaveBeenCalled();
    for (const call of spy.mock.calls) {
      expect(call[3]).toBe(true);
    }
  });

  it('V-2: aborts with VaultLockedError when getSessionKey returns null mid-run', async () => {
    mockGetUserDocuments.mockResolvedValue([{ id: 'doc1' }]);
    mockGetVersions.mockResolvedValue([{ id: 'ver1', content: 'hello', _encrypted: false }]);
    mockGetMigrationDrafts.mockResolvedValue([]);

    let callCount = 0;
    const spy = vi.spyOn(encryptModule, 'getSessionKey');
    spy.mockImplementation(() => {
      callCount++;
      if (callCount <= 1) return {} as CryptoKey;
      return null;
    });

    await expect(encryptAllExistingNotes(userId)).rejects.toThrow('Vault locked during migration');

    spy.mockImplementation(() => ({} as CryptoKey));
  });

  it('handles checkpoint save failure without throwing', async () => {
    mockGetUserDocuments.mockResolvedValue([{ id: 'doc1' }]);
    mockGetVersions.mockResolvedValue([{ id: 'ver1', content: 'hello', _encrypted: false }]);
    mockGetMigrationDrafts.mockResolvedValue([]);

    vi.spyOn(localStorage, 'setItem').mockImplementationOnce(() => {
      throw new Error('quota exceeded');
    });

    const progress = await encryptAllExistingNotes(userId);
    expect(progress.encrypted).toBe(2);
    expect(progress.errors).toBe(0);
  });

  it('saves checkpoint after batch flush and clears it on completion', async () => {
    mockGetUserDocuments.mockResolvedValue([{ id: 'doc1' }]);
    mockGetVersions.mockResolvedValue([{ id: 'ver1', content: 'hello', _encrypted: false }]);
    mockGetMigrationDrafts.mockResolvedValue([]);

    await encryptAllExistingNotes(userId);

    expect(mockExecuteMigrationBatch).toHaveBeenCalled();
    expect(localStorage.getItem(`encryptionMigration_${userId}_checkpoint`)).toBeNull();
  });

  it('returns zero progress when no documents exist', async () => {
    mockGetUserDocuments.mockResolvedValue([]);
    mockGetMigrationDrafts.mockResolvedValue([]);

    const progress = await encryptAllExistingNotes(userId);
    expect(progress.total).toBe(0);
    expect(progress.processed).toBe(0);
    expect(progress.encrypted).toBe(0);
    expect(progress.errors).toBe(0);
  });

  it('handles corrupted checkpoint data gracefully', async () => {
    localStorage.setItem(`encryptionMigration_${userId}_checkpoint`, 'not-valid-json{{{');

    mockGetUserDocuments.mockResolvedValue([{ id: 'doc1' }]);
    mockGetVersions.mockResolvedValue([{ id: 'ver1', content: 'hello', _encrypted: false }]);
    mockGetMigrationDrafts.mockResolvedValue([]);

    const progress = await encryptAllExistingNotes(userId);
    expect(progress.encrypted).toBe(2);
    expect(progress.errors).toBe(0);
  });
});

describe('encryptSingleDocument', () => {
  const userId = 'user123';

  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    mockGetDocument.mockResolvedValue({ id: 'doc1', _encrypted: true });
  });

  it('encrypts all unencrypted versions of a single document', async () => {
    const versionDocs = [
      { id: 'ver1', content: 'hello', _encrypted: false },
      { id: 'ver2', content: 'world', _encrypted: false },
    ];
    mockGetVersions.mockResolvedValue(versionDocs);

    const result = await encryptSingleDocument(userId, 'doc1');
    expect(result.processed).toBe(2);
    expect(result.encrypted).toBe(2);
    expect(result.errors).toBe(0);
  });

  it('skips already encrypted versions', async () => {
    const versionDocs = [
      { id: 'ver1', content: 'encrypted_val', _encrypted: true },
    ];
    mockGetVersions.mockResolvedValue(versionDocs);

    const result = await encryptSingleDocument(userId, 'doc1');
    expect(result.processed).toBe(1);
    expect(result.encrypted).toBe(0);
    expect(result.errors).toBe(0);
  });

  it('handles individual version encryption failure', async () => {
    const versionDocs = [
      { id: 'ver1', content: 'hello', _encrypted: false },
    ];
    mockGetVersions.mockResolvedValue(versionDocs);
    vi.spyOn(cryptoHelpers, 'maybeEncrypt').mockRejectedValueOnce(new Error('Crypt error'));

    const result = await encryptSingleDocument(userId, 'doc1');
    expect(result.processed).toBe(1);
    expect(result.encrypted).toBe(0);
    expect(result.errors).toBe(1);
  });

  it('throws when versions query fails', async () => {
    mockGetVersions.mockRejectedValue(new Error('Firestore error'));
    await expect(encryptSingleDocument(userId, 'doc1')).rejects.toThrow('Firestore error');
  });

  it('encrypts unencrypted document row as well', async () => {
    mockGetDocument.mockResolvedValue({ id: 'doc1', title: 'Hello', _encrypted: false });
    mockGetVersions.mockResolvedValue([]);

    const result = await encryptSingleDocument(userId, 'doc1');
    expect(result.processed).toBe(1);
    expect(result.encrypted).toBe(1);
    expect(result.errors).toBe(0);
  });
});
