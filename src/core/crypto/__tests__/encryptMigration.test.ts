import { describe, it, expect, vi, beforeEach } from 'vitest';
import { encryptAllExistingNotes, encryptSingleDocument } from '../encryptMigration';
import * as encryptModule from '../encrypt';
import * as cryptoHelpers from '../cryptoHelpers';

// Mock getSessionKey
vi.spyOn(encryptModule, 'getSessionKey').mockImplementation(() => ({} as CryptoKey));

// Mock maybeEncrypt
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

// Mock firestoreClient
const mockGetDocs = vi.fn();
const mockWriteBatchCommit = vi.fn().mockResolvedValue(undefined);
const mockWriteBatch = vi.fn(() => ({
  set: vi.fn(),
  update: vi.fn(),
  commit: mockWriteBatchCommit,
}));

vi.mock('../../firebase/firestoreClient', () => ({
  getClient: async () => ({
    db: {} as any,
    mod: {
      collection: (db: any, ...paths: string[]) => ({ path: paths.join('/') }),
      getDocs: mockGetDocs,
      query: (col: any, ...constraints: any[]) => col,
      where: (field: string, op: string, value: any) => ({ field, op, value }),
      doc: (db: any, ...paths: string[]) => ({ path: paths.join('/'), id: paths[paths.length - 1] }),
      writeBatch: mockWriteBatch,
    },
  }),
}));

describe('encryptAllExistingNotes', () => {
  const userId = 'user123';

  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
  });

  const createMockSnapshot = (docs: any[]) => ({
    docs: docs.map(d => ({
      id: d.id,
      data: () => d.data,
    })),
  });

  it('encrypts all unencrypted documents', async () => {
    const sessionDocs = [
      { id: 'sess1', data: { content: 'hello', _encrypted: false } },
    ];
    const userDocList = [
      { id: 'doc1', data: {} },
    ];
    const versionDocs = [
      { id: 'ver1', data: { content: 'world', _encrypted: false } },
    ];
    const draftDocs = [
      { id: 'draft1', data: { content: 'test', _encrypted: false } },
    ];

    mockGetDocs.mockImplementation(async (queryOrCol: any) => {
      if (queryOrCol.path === 'sessions') {
        return createMockSnapshot(sessionDocs);
      }
      if (queryOrCol.path === 'users/user123/documents') {
        return createMockSnapshot(userDocList);
      }
      if (queryOrCol.path === 'users/user123/documents/doc1/versions') {
        return createMockSnapshot(versionDocs);
      }
      if (queryOrCol.path === 'drafts') {
        return createMockSnapshot(draftDocs);
      }
      return createMockSnapshot([]);
    });

    const progressCallback = vi.fn();
    const progress = await encryptAllExistingNotes(userId, progressCallback);

    expect(progress.total).toBe(3); // 1 session + 1 version + 1 draft
    expect(progress.processed).toBe(3);
    expect(progress.encrypted).toBe(3);
    expect(progress.errors).toBe(0);
    expect(progressCallback).toHaveBeenCalled();
  });

  it('skips already encrypted documents', async () => {
    const sessionDocs = [
      { id: 'sess1', data: { content: 'encrypted_val', _encrypted: true } },
    ];
    mockGetDocs.mockResolvedValue(createMockSnapshot([]));
    mockGetDocs.mockImplementation(async (queryOrCol: any) => {
      if (queryOrCol.path === 'sessions') {
        return createMockSnapshot(sessionDocs);
      }
      return createMockSnapshot([]);
    });

    const progress = await encryptAllExistingNotes(userId);
    expect(progress.total).toBe(1);
    expect(progress.processed).toBe(1);
    expect(progress.encrypted).toBe(0);
    expect(progress.errors).toBe(0);
  });

  it('resumes from checkpoint on retry', async () => {
    const sessionDocs = [
      { id: 'sess1', data: { content: 'hello', _encrypted: false } },
      { id: 'sess2', data: { content: 'world', _encrypted: false } },
    ];

    mockGetDocs.mockImplementation(async (queryOrCol: any) => {
      if (queryOrCol.path === 'sessions') {
        return createMockSnapshot(sessionDocs);
      }
      return createMockSnapshot([]);
    });

    // Set checkpoint for first session
    localStorage.setItem(`encryptionMigration_${userId}_checkpoint`, JSON.stringify(['s_sess1']));

    const progress = await encryptAllExistingNotes(userId);
    expect(progress.total).toBe(2);
    expect(progress.processed).toBe(2);
    expect(progress.encrypted).toBe(1); // Only sess2 gets encrypted, sess1 is loaded from checkpoint
  });

  it('aborts when signal is aborted', async () => {
    const sessionDocs = [
      { id: 'sess1', data: { content: 'hello', _encrypted: false } },
      { id: 'sess2', data: { content: 'world', _encrypted: false } },
    ];

    mockGetDocs.mockImplementation(async (queryOrCol: any) => {
      if (queryOrCol.path === 'sessions') {
        return createMockSnapshot(sessionDocs);
      }
      return createMockSnapshot([]);
    });

    const controller = new AbortController();
    controller.abort();

    await expect(encryptAllExistingNotes(userId, undefined, controller.signal)).rejects.toThrow('Migration aborted');
  });

  it('handles individual document encryption failure gracefully', async () => {
    const sessionDocs = [
      { id: 'sess1', data: { content: 'hello', _encrypted: false } },
    ];

    mockGetDocs.mockImplementation(async (queryOrCol: any) => {
      if (queryOrCol.path === 'sessions') {
        return createMockSnapshot(sessionDocs);
      }
      return createMockSnapshot([]);
    });

    vi.spyOn(cryptoHelpers, 'maybeEncrypt').mockRejectedValueOnce(new Error('Crypt error'));

    const progress = await encryptAllExistingNotes(userId);
    expect(progress.total).toBe(1);
    expect(progress.processed).toBe(1);
    expect(progress.encrypted).toBe(0);
    expect(progress.errors).toBe(1);
  });

  it('handles checkpoint save failure without throwing', async () => {
    const sessionDocs = [
      { id: 'sess1', data: { content: 'hello', _encrypted: false } },
    ];

    mockGetDocs.mockImplementation(async (queryOrCol: any) => {
      if (queryOrCol.path === 'sessions') {
        return createMockSnapshot(sessionDocs);
      }
      return createMockSnapshot([]);
    });

    // Mock localStorage.setItem to throw
    vi.spyOn(localStorage, 'setItem').mockImplementationOnce(() => {
      throw new Error('quota exceeded');
    });

    const progress = await encryptAllExistingNotes(userId);
    expect(progress.encrypted).toBe(1);
    expect(progress.errors).toBe(0);
  });

  it('saves checkpoint after batch flush and clears it on completion', async () => {
    const sessionDocs = [
      { id: 'sess1', data: { content: 'hello', _encrypted: false } },
    ];

    mockGetDocs.mockImplementation(async (queryOrCol: any) => {
      if (queryOrCol.path === 'sessions') return createMockSnapshot(sessionDocs);
      return createMockSnapshot([]);
    });

    await encryptAllExistingNotes(userId);

    expect(mockWriteBatchCommit).toHaveBeenCalled();
    expect(localStorage.getItem(`encryptionMigration_${userId}_checkpoint`)).toBeNull();
  });

  it('returns zero progress when no documents exist', async () => {
    mockGetDocs.mockResolvedValue(createMockSnapshot([]));

    const progress = await encryptAllExistingNotes(userId);
    expect(progress.total).toBe(0);
    expect(progress.processed).toBe(0);
    expect(progress.encrypted).toBe(0);
    expect(progress.errors).toBe(0);
  });

  it('handles corrupted checkpoint data gracefully', async () => {
    localStorage.setItem(`encryptionMigration_${userId}_checkpoint`, 'not-valid-json{{{');

    const sessionDocs = [
      { id: 'sess1', data: { content: 'hello', _encrypted: false } },
    ];

    mockGetDocs.mockImplementation(async (queryOrCol: any) => {
      if (queryOrCol.path === 'sessions') return createMockSnapshot(sessionDocs);
      return createMockSnapshot([]);
    });

    const progress = await encryptAllExistingNotes(userId);
    expect(progress.encrypted).toBe(1);
    expect(progress.errors).toBe(0);
  });
});

describe('encryptSingleDocument', () => {
  const userId = 'user123';

  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
  });

  const createMockSnapshot = (docs: any[]) => ({
    docs: docs.map(d => ({
      id: d.id,
      data: () => d.data,
    })),
  });

  it('encrypts all unencrypted versions of a single document', async () => {
    const versionDocs = [
      { id: 'ver1', data: { content: 'hello', _encrypted: false } },
      { id: 'ver2', data: { content: 'world', _encrypted: false } },
    ];

    mockGetDocs.mockResolvedValue(createMockSnapshot(versionDocs));

    const result = await encryptSingleDocument(userId, 'doc1');
    expect(result.processed).toBe(2);
    expect(result.encrypted).toBe(2);
    expect(result.errors).toBe(0);
  });

  it('skips already encrypted versions', async () => {
    const versionDocs = [
      { id: 'ver1', data: { content: 'encrypted_val', _encrypted: true } },
    ];

    mockGetDocs.mockResolvedValue(createMockSnapshot(versionDocs));

    const result = await encryptSingleDocument(userId, 'doc1');
    expect(result.processed).toBe(1);
    expect(result.encrypted).toBe(0);
    expect(result.errors).toBe(0);
  });

  it('handles individual version encryption failure', async () => {
    const versionDocs = [
      { id: 'ver1', data: { content: 'hello', _encrypted: false } },
    ];

    mockGetDocs.mockResolvedValue(createMockSnapshot(versionDocs));
    vi.spyOn(cryptoHelpers, 'maybeEncrypt').mockRejectedValueOnce(new Error('Crypt error'));

    const result = await encryptSingleDocument(userId, 'doc1');
    expect(result.processed).toBe(1);
    expect(result.encrypted).toBe(0);
    expect(result.errors).toBe(1);
  });

  it('throws when versions query fails', async () => {
    mockGetDocs.mockRejectedValue(new Error('Firestore error'));

    await expect(encryptSingleDocument(userId, 'doc1')).rejects.toThrow('Firestore error');
  });
});
