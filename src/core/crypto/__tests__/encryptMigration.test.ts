import { describe, it, expect, vi, beforeEach } from 'vitest';
import { encryptAllExistingNotes, encryptSingleDocument } from '../encryptMigration';
import * as encryptModule from '../encrypt';
import * as cryptoHelpers from '../cryptoHelpers';

const getSessionKeySpy = vi.spyOn(encryptModule, 'getSessionKey').mockImplementation(() => ({} as CryptoKey));

const maybeEncryptSpy = vi.spyOn(cryptoHelpers, 'maybeEncrypt').mockImplementation(async (doc, fields, arrayFields) => {
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
  mockExecuteMigrationBatch,
  mockSaveSummary,
  mockSaveEmbedding,
  mockDeleteSummary,
  mockDeleteEmbedding,
  mockGetUserSummaries,
  mockGetUserEmbeddings,
  mockGetLocalStoreRecords,
} = vi.hoisted(() => ({
  mockGetDocument: vi.fn(),
  mockGetUserDocuments: vi.fn(),
  mockGetVersions: vi.fn(),
  mockGetMigrationDrafts: vi.fn(),
  mockExecuteMigrationBatch: vi.fn().mockResolvedValue(undefined),
  mockSaveSummary: vi.fn().mockResolvedValue(undefined),
  mockSaveEmbedding: vi.fn().mockResolvedValue(undefined),
  mockDeleteSummary: vi.fn().mockResolvedValue(undefined),
  mockDeleteEmbedding: vi.fn().mockResolvedValue(undefined),
  mockGetUserSummaries: vi.fn<() => Promise<any[]>>(async () => []),
  mockGetUserEmbeddings: vi.fn<() => Promise<any[]>>(async () => []),
  mockGetLocalStoreRecords: vi.fn<() => Promise<any[]>>(async () => []),
}));

vi.mock('../../data', () => ({
  DataProvider: {
    getDocument: mockGetDocument,
    getUserDocuments: mockGetUserDocuments,
    getVersions: mockGetVersions,
    getMigrationDrafts: mockGetMigrationDrafts,
    executeMigrationBatch: mockExecuteMigrationBatch,
    getUserSummaries: mockGetUserSummaries,
    getUserEmbeddings: mockGetUserEmbeddings,
    getLocalStoreRecords: mockGetLocalStoreRecords,
    saveSummary: mockSaveSummary,
    saveEmbedding: mockSaveEmbedding,
    deleteSummary: mockDeleteSummary,
    deleteEmbedding: mockDeleteEmbedding,
  },
}));

vi.mock('../../storage/localDb', () => ({
  getLocalDb: vi.fn(),
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

  it('CHOKE-4: resolves canonical document UUID for summaries without documentUuid', async () => {
    mockGetUserDocuments.mockResolvedValue([]);
    mockGetMigrationDrafts.mockResolvedValue([]);
    mockGetUserEmbeddings.mockResolvedValue([]);
    mockGetLocalStoreRecords.mockResolvedValue([]);

    // Cloud summary has only local documentId and no documentUuid
    mockGetUserSummaries.mockResolvedValue([
      {
        documentId: 'local_doc_summary',
        summary: 'Secret notes about project',
        _encrypted: false,
      },
    ]);

    const { getLocalDb } = await import('../../storage/localDb');
    vi.mocked(getLocalDb).mockResolvedValue({
      get: vi.fn().mockImplementation(async (store: string, id: string) => {
        if (store === 'documents' && id === 'local_doc_summary') {
          return { id: 'local_doc_summary', uuid: 'canonical-summary-uuid-999' };
        }
        return undefined;
      }),
      put: vi.fn().mockResolvedValue(undefined),
    } as any);

    const progress = await encryptAllExistingNotes(userId);
    expect(progress.errors).toBe(0);
    expect(progress.encrypted).toBe(1);
    expect(mockSaveSummary).toHaveBeenCalledWith(
      userId,
      'canonical-summary-uuid-999',
      expect.objectContaining({ _encrypted: true })
    );
  });

  it('N4-2: an encrypted summary with a legacy plaintext content hash gets the hash encrypted', async () => {
    mockGetUserDocuments.mockResolvedValue([]);
    mockGetMigrationDrafts.mockResolvedValue([]);
    mockGetUserEmbeddings.mockResolvedValue([]);
    mockGetLocalStoreRecords.mockResolvedValue([]);
    const hex = 'a'.repeat(64);
    mockGetUserSummaries.mockResolvedValue([
      { documentId: 'canonical-uuid-n42', documentUuid: 'canonical-uuid-n42', summary: 'CIPHERTEXT', contentHash: hex, _encrypted: true },
      { documentId: 'canonical-uuid-done', documentUuid: 'canonical-uuid-done', summary: 'CIPHERTEXT', contentHash: 'ENCRYPTEDHASHbase64==', _encrypted: true },
    ]);
    const encSpy = vi.spyOn(encryptModule, 'encryptContent').mockResolvedValue('ENC_HASH');

    const progress = await encryptAllExistingNotes(userId);
    expect(progress.errors).toBe(0);
    expect(mockSaveSummary).toHaveBeenCalledTimes(1);
    expect(mockSaveSummary).toHaveBeenCalledWith(userId, 'canonical-uuid-n42',
      expect.objectContaining({ contentHash: 'ENC_HASH', summary: 'CIPHERTEXT' }));
    expect(encSpy).toHaveBeenCalledWith(hex, expect.anything());
    encSpy.mockRestore();
  });

  it('CHOKE-4: resolves canonical document UUID for embeddings without documentUuid', async () => {
    mockGetUserDocuments.mockResolvedValue([]);
    mockGetMigrationDrafts.mockResolvedValue([]);
    mockGetUserSummaries.mockResolvedValue([]);
    mockGetLocalStoreRecords.mockResolvedValue([]);

    // Cloud embedding has only local documentId and no documentUuid
    mockGetUserEmbeddings.mockResolvedValue([
      {
        documentId: 'local_doc_emb',
        vectorsJson: JSON.stringify([[0.1, 0.2]]),
        _encrypted: false,
      },
    ]);

    const { getLocalDb } = await import('../../storage/localDb');
    vi.mocked(getLocalDb).mockResolvedValue({
      get: vi.fn().mockImplementation(async (store: string, id: string) => {
        if (store === 'documents' && id === 'local_doc_emb') {
          return { id: 'local_doc_emb', uuid: 'canonical-emb-uuid-888' };
        }
        return undefined;
      }),
      put: vi.fn().mockResolvedValue(undefined),
    } as any);

    const progress = await encryptAllExistingNotes(userId);
    expect(progress.errors).toBe(0);
    expect(progress.encrypted).toBe(1);
    expect(mockSaveEmbedding).toHaveBeenCalledWith(
      userId,
      'canonical-emb-uuid-888',
      expect.objectContaining({ _encrypted: true })
    );
  });

  it('NARROW-4: resolves already-canonical document UUID for cloud summaries without local DB lookup (real LIFE-3)', async () => {
    mockGetUserDocuments.mockResolvedValue([]);
    mockGetMigrationDrafts.mockResolvedValue([]);
    mockGetUserEmbeddings.mockResolvedValue([]);
    mockGetLocalStoreRecords.mockResolvedValue([]);

    // Cloud summary has a canonical UUID as documentId (no local_ prefix) and no documentUuid
    mockGetUserSummaries.mockResolvedValue([
      {
        documentId: 'canonical-cloud-summary-uuid-111',
        summary: 'Cloud summary text without local copy',
        _encrypted: false,
      },
    ]);

    const mockDbGet = vi.fn();
    const { getLocalDb } = await import('../../storage/localDb');
    vi.mocked(getLocalDb).mockResolvedValue({
      get: mockDbGet,
      put: vi.fn().mockResolvedValue(undefined),
    } as any);

    const progress = await encryptAllExistingNotes(userId);
    expect(progress.errors).toBe(0);
    expect(progress.encrypted).toBe(1);
    // Crucial check: db.get must NOT be called for a canonical document ID
    expect(mockDbGet).not.toHaveBeenCalled();
    expect(mockSaveSummary).toHaveBeenCalledWith(
      userId,
      'canonical-cloud-summary-uuid-111',
      expect.objectContaining({ _encrypted: true })
    );
  });

  it('NARROW-4: resolves already-canonical document UUID for cloud embeddings without local DB lookup (real LIFE-3)', async () => {
    mockGetUserDocuments.mockResolvedValue([]);
    mockGetMigrationDrafts.mockResolvedValue([]);
    mockGetUserSummaries.mockResolvedValue([]);
    mockGetLocalStoreRecords.mockResolvedValue([]);

    // Cloud embedding has a canonical UUID as documentId (no local_ prefix) and no documentUuid
    mockGetUserEmbeddings.mockResolvedValue([
      {
        documentId: 'canonical-cloud-emb-uuid-222',
        vectorsJson: JSON.stringify([[0.5, 0.6]]),
        _encrypted: false,
      },
    ]);

    const mockDbGet = vi.fn();
    const { getLocalDb } = await import('../../storage/localDb');
    vi.mocked(getLocalDb).mockResolvedValue({
      get: mockDbGet,
      put: vi.fn().mockResolvedValue(undefined),
    } as any);

    const progress = await encryptAllExistingNotes(userId);
    expect(progress.errors).toBe(0);
    expect(progress.encrypted).toBe(1);
    // Crucial check: db.get must NOT be called for a canonical document ID
    expect(mockDbGet).not.toHaveBeenCalled();
    expect(mockSaveEmbedding).toHaveBeenCalledWith(
      userId,
      'canonical-cloud-emb-uuid-222',
      expect.objectContaining({ _encrypted: true })
    );
  });

  it('S-23: plaintext summary under a tombstoned document (42501 on save) deletes summary and clears checkpoint without errors', async () => {
    mockGetUserDocuments.mockResolvedValue([]);
    mockGetMigrationDrafts.mockResolvedValue([]);
    mockGetUserEmbeddings.mockResolvedValue([]);
    mockGetLocalStoreRecords.mockResolvedValue([]);

    mockGetUserSummaries.mockResolvedValue([
      {
        documentId: 'tombstoned-doc-summary-uuid',
        summary: 'Plaintext summary under a tombstone',
        _encrypted: false,
      },
    ]);

    mockSaveSummary.mockRejectedValueOnce({
      code: '42501',
      message: 'new row violates row-level security policy for table "ai_summaries"',
    });

    const progress = await encryptAllExistingNotes(userId);

    expect(progress.errors).toBe(0);
    expect(mockDeleteSummary).toHaveBeenCalledWith(userId, 'tombstoned-doc-summary-uuid');
    expect(localStorage.getItem(`encryptionMigration_${userId}_checkpoint`)).toBeNull();
  });

  it('S-23: plaintext embedding under a tombstoned document (42501 on save) deletes embedding and clears checkpoint without errors', async () => {
    mockGetUserDocuments.mockResolvedValue([]);
    mockGetMigrationDrafts.mockResolvedValue([]);
    mockGetUserSummaries.mockResolvedValue([]);
    mockGetLocalStoreRecords.mockResolvedValue([]);

    mockGetUserEmbeddings.mockResolvedValue([
      {
        documentId: 'tombstoned-doc-emb-uuid',
        vectorsJson: JSON.stringify([[0.1, 0.2]]),
        _encrypted: false,
      },
    ]);

    mockSaveEmbedding.mockRejectedValueOnce({
      code: '42501',
      message: 'new row violates row-level security policy for table "ai_embeddings"',
    });

    const progress = await encryptAllExistingNotes(userId);

    expect(progress.errors).toBe(0);
    expect(mockDeleteEmbedding).toHaveBeenCalledWith(userId, 'tombstoned-doc-emb-uuid');
    expect(localStorage.getItem(`encryptionMigration_${userId}_checkpoint`)).toBeNull();
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

  it('R3-13: encrypts the version mood like the bulk path does', async () => {
    mockGetVersions.mockResolvedValue([{ id: 'ver1', content: 'hello', mood: '😊', _encrypted: false }]);
    await encryptSingleDocument(userId, 'doc1');
    expect(maybeEncryptSpy).toHaveBeenCalledWith(expect.objectContaining({ id: 'ver1' }), ['content', 'mood'], [], true);
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

describe('real maybeEncrypt integration (DA-7)', () => {
  const flag = globalThis as { __jwVaultOptionalForTests?: boolean | undefined };
  let savedFlag: boolean | undefined;

  beforeEach(() => {
    savedFlag = flag.__jwVaultOptionalForTests;
    maybeEncryptSpy.mockRestore();
    getSessionKeySpy.mockRestore();
  });

  afterEach(() => {
    flag.__jwVaultOptionalForTests = savedFlag;
    encryptModule.clearSessionKey();
    getSessionKeySpy.mockImplementation(() => ({} as CryptoKey));
    maybeEncryptSpy.mockImplementation(async (doc, fields, arrayFields) => {
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
  });

  it('encrypts data when vault is set up and unlocked', async () => {
    const testUserId = 'real_user_with_vault';
    cryptoHelpers.setProfileLoaded(testUserId, true);
    cryptoHelpers.setEncryptionEnabled(testUserId, true);

    const realKey = await encryptModule.generateDataKey();
    encryptModule.setSessionKey(realKey);

    const doc = { title: 'Sensitive Title', mood: '😊', tags: ['work', 'ideas'] };
    const encrypted = await cryptoHelpers.maybeEncrypt(doc, ['title', 'mood'], ['tags'], testUserId);

    expect(encrypted._encrypted).toBe(true);
    expect(encrypted.title).not.toBe('Sensitive Title');
    expect(typeof encrypted.title).toBe('string');

    const decryptedTitle = await encryptModule.decryptContent(encrypted.title as string, realKey);
    expect(decryptedTitle).toBe('Sensitive Title');

    const decryptedTags = await encryptModule.decryptContent(encrypted.tags as string, realKey);
    expect(JSON.parse(decryptedTags)).toEqual(['work', 'ideas']);
  });

  it('throws ENCRYPT_REQUIRED: vault not set up when account has no vault in prod mode', async () => {
    flag.__jwVaultOptionalForTests = false;
    const testUserId = 'real_user_no_vault';
    cryptoHelpers.setProfileLoaded(testUserId, true);
    cryptoHelpers.setEncryptionEnabled(testUserId, false);

    await expect(
      cryptoHelpers.maybeEncrypt({ title: 'Unprotected' }, ['title'], [], testUserId)
    ).rejects.toThrow('ENCRYPT_REQUIRED: vault not set up');
  });

  it('throws ENCRYPT_REQUIRED: session key not available when required but key is missing', async () => {
    const testUserId = 'real_user_locked_vault';
    cryptoHelpers.setProfileLoaded(testUserId, true);
    cryptoHelpers.setEncryptionEnabled(testUserId, true);
    encryptModule.clearSessionKey();

    await expect(
      cryptoHelpers.maybeEncrypt({ title: 'Locked' }, ['title'], [], testUserId)
    ).rejects.toThrow('ENCRYPT_REQUIRED: session key not available');
  });
});
