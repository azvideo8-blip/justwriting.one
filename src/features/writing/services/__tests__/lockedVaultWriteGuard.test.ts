import { describe, it, expect, vi, beforeEach } from 'vitest';
import { LocalStorageService } from '../../../../core/services/LocalStorageService';
import { LocalDocumentService } from '../../../../core/services/LocalDocumentService';
import { CloudSyncService } from '../../../../core/services/CloudSyncService';
import { toggleAIExclusion, updateArchiveField } from '../../../archive/services/archiveCrud';
import { DataProvider } from '../../../../core/data';

vi.mock('../../../../core/data', () => ({
  DataProvider: {
    createDocument: vi.fn(),
    getDocument: vi.fn(),
    getUserDocuments: vi.fn(),
    updateDocumentSessionStats: vi.fn(),
    updateDocument: vi.fn(),
    deleteDocument: vi.fn(),
  },
}));

vi.mock('../../../../core/storage/localDb', () => {
  const store = new Map();
  return {
    getLocalDb: vi.fn().mockResolvedValue({
      get: vi.fn((s, id) => store.get(id)),
      put: vi.fn((s, obj) => store.set(obj.id, obj)),
      delete: vi.fn((s, id) => store.delete(id)),
      getAll: vi.fn(() => Array.from(store.values())),
      getAllFromIndex: vi.fn(() => Array.from(store.values())),
      transaction: vi.fn(() => ({
        store: {
          get: vi.fn((id) => store.get(id)),
          put: vi.fn((obj) => store.set(obj.id, obj)),
          delete: vi.fn((id) => store.delete(id)),
        },
        objectStore: vi.fn(() => ({
          get: vi.fn((id) => store.get(id)),
          put: vi.fn((obj) => store.set(obj.id, obj)),
          delete: vi.fn((id) => store.delete(id)),
          index: vi.fn(() => ({
            get: vi.fn(),
            getAll: vi.fn().mockResolvedValue([]),
          })),
        })),
        done: Promise.resolve(),
      })),
    }),
    randomUUID: () => 'uuid-test',
  };
});

describe('Locked Vault Write Guards (Ticket 1 Data Loss Prevention)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('LocalDocumentService.createDocument refuses locked documents', async () => {
    await expect(
      LocalDocumentService.createDocument('u1', { title: '', _locked: true } as any)
    ).rejects.toThrow('LOCKED: cannot save locked document to local storage');

    await expect(
      LocalDocumentService.createDocument('u1', { title: '', _decryptionError: true } as any)
    ).rejects.toThrow('LOCKED: cannot save locked document to local storage');
  });

  it('LocalStorageService.saveNew refuses locked documents', async () => {
    const data: any = {
      content: 'hello',
      wordCount: 1,
      duration: 10,
      wpm: 6,
      sessionStartedAt: new Date(),
      _locked: true,
    };
    await expect(LocalStorageService.saveNew('u1', data)).rejects.toThrow(
      'LOCKED: cannot save locked document to local storage'
    );
  });

  it('LocalStorageService.saveVersionToLocal refuses locked versions', async () => {
    const data: any = {
      content: 'hello',
      wordCount: 1,
      duration: 10,
      wpm: 6,
      sessionStartedAt: new Date(),
      _locked: true,
    };
    await expect(
      LocalStorageService.saveVersionToLocal({} as any, 'doc1', data, Date.now())
    ).rejects.toThrow('LOCKED: cannot save locked version to local storage');
  });

  it('CloudSyncService.addLocalCopy refuses when cloud document is locked', async () => {
    vi.mocked(DataProvider.getDocument).mockResolvedValue({
      id: 'cloud_locked',
      title: 'cipher_title',
      _encrypted: true,
      currentVersion: 1,
      totalWords: 50,
      totalDuration: 30,
      sessionsCount: 1,
      firstSessionAt: 1000,
      lastSessionAt: 1000,
      tags: 'cipher_tags',
      labelId: null,
    });

    await expect(CloudSyncService.addLocalCopy('u1', 'cloud_locked')).rejects.toThrow(
      'LOCKED: cannot add local copy of locked document'
    );
  });

  it('archiveCrud refuses updates on locked or decryption-error sessions', async () => {
    const lockedSession: any = {
      id: 's1',
      title: undefined,
      _isLocal: true,
      _locked: true,
    };
    const errorSession: any = {
      id: 's2',
      title: undefined,
      _isLocal: true,
      _decryptionError: true,
    };

    await expect(
      updateArchiveField(lockedSession, 'title', 'New Title', null, 'u1')
    ).rejects.toThrow('LOCKED: cannot modify locked session');

    await expect(
      updateArchiveField(errorSession, 'title', 'New Title', null, 'u1')
    ).rejects.toThrow('DECRYPTION_ERROR: cannot modify unreadable session');

    await expect(
      toggleAIExclusion(lockedSession, true, null, 'u1')
    ).rejects.toThrow('LOCKED: cannot modify locked session');

    await expect(
      toggleAIExclusion(errorSession, true, null, 'u1')
    ).rejects.toThrow('DECRYPTION_ERROR: cannot modify unreadable session');
  });
});
