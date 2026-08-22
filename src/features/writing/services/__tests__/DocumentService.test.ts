import { describe, it, expect, vi, beforeEach } from 'vitest';
import { DocumentService } from '../../../../core/services/DocumentService';
import { DataProvider } from '../../../../core/data';
import { setProfileLoaded } from '../../../../core/crypto/cryptoHelpers';

vi.mock('../../../../core/data', () => ({
  DataProvider: {
    createDocument: vi.fn(),
    getDocument: vi.fn(),
    getUserDocuments: vi.fn(),
    updateDocumentSessionStats: vi.fn(),
    updateDocument: vi.fn(),
    deleteDocument: vi.fn(),
    clearLabelFromAllDocs: vi.fn(),
    renameTagInAllDocs: vi.fn(),
    removeTagFromAllDocs: vi.fn(),
  },
}));

describe('DocumentService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setProfileLoaded('u1', true);
  });

  describe('createDocument', () => {
    it('calls DataProvider.createDocument with mapped payload', async () => {
      vi.mocked(DataProvider.createDocument).mockResolvedValue('new_doc_id');
      const data = { title: 'Test', tags: ['a'], labelId: 'lbl' };
      const id = await DocumentService.createDocument('u1', data);
      
      expect(id).toBe('new_doc_id');
      expect(DataProvider.createDocument).toHaveBeenCalledWith('u1', expect.objectContaining({
        title: 'Test',
        tags: ['a'],
        labelId: 'lbl',
        currentVersion: 0
      }));
    });

    it('creates document using provided dates', async () => {
      vi.mocked(DataProvider.createDocument).mockResolvedValue('new_doc_id');
      const first = new Date(1700000000000);
      const last = new Date(1700000005000);

      await DocumentService.createDocument('u1', {
        title: 'Test',
        tags: ['a'],
        labelId: 'lbl',
        firstSessionAt: first,
        lastSessionAt: last,
      });

      expect(DataProvider.createDocument).toHaveBeenCalledWith('u1', expect.objectContaining({
        firstSessionAt: 1700000000000,
        lastSessionAt: 1700000005000,
      }));
    });
  });

  describe('getDocument', () => {
    it('returns parsed document', async () => {
      vi.mocked(DataProvider.getDocument).mockResolvedValue({
        id: 'doc1', title: 'Test', currentVersion: 1, totalWords: 10, totalDuration: 10, sessionsCount: 1, firstSessionAt: 1000, lastSessionAt: 2000, tags: [], labelId: null
      });
      const doc = await DocumentService.getDocument('u1', 'doc1');
      expect(doc?.id).toBe('doc1');
      expect(doc?.title).toBe('Test');
    });

    it('returns null if doc not found', async () => {
      vi.mocked(DataProvider.getDocument).mockResolvedValue(null);
      const doc = await DocumentService.getDocument('u1', 'doc_missing');
      expect(doc).toBeNull();
    });

    it('returns null for corrupted doc', async () => {
      vi.mocked(DataProvider.getDocument).mockResolvedValue({
        id: 'doc_corrupted', title: 'Test', currentVersion: 'invalid' as unknown as number, totalWords: 10, totalDuration: 10, sessionsCount: 1, firstSessionAt: 1000, lastSessionAt: 2000, tags: [], labelId: null
      });
      const doc = await DocumentService.getDocument('u1', 'doc_corrupted');
      expect(doc).toBeNull();
    });
  });

  describe('getUserDocuments', () => {
    it('returns parsed documents sorted by lastSessionAt descending', async () => {
      vi.mocked(DataProvider.getUserDocuments).mockResolvedValue([
        { id: 'doc1', title: 'Doc1', currentVersion: 1, totalWords: 10, totalDuration: 10, sessionsCount: 1, firstSessionAt: 1000, lastSessionAt: 1000, tags: [], labelId: null },
        { id: 'doc2', title: 'Doc2', currentVersion: 1, totalWords: 10, totalDuration: 10, sessionsCount: 1, firstSessionAt: 1000, lastSessionAt: 2000, tags: [], labelId: null }
      ]);
      const docs = await DocumentService.getUserDocuments('u1');
      expect(docs).toHaveLength(2);
      expect(docs[0]?.id).toBe('doc2'); // latest session first
      expect(docs[1]?.id).toBe('doc1');
    });

    it('returns empty array if no documents', async () => {
      vi.mocked(DataProvider.getUserDocuments).mockResolvedValue([]);
      const docs = await DocumentService.getUserDocuments('u1');
      expect(docs).toHaveLength(0);
    });

    it('omits corrupted docs', async () => {
      vi.mocked(DataProvider.getUserDocuments).mockResolvedValue([
        { id: 'doc_valid', title: 'Doc1', currentVersion: 1, totalWords: 10, totalDuration: 10, sessionsCount: 1, firstSessionAt: 1000, lastSessionAt: 1000, tags: [], labelId: null },
        { id: 'doc_corrupted', title: 'Doc2', currentVersion: 'invalid' as unknown as number, totalWords: 10, totalDuration: 10, sessionsCount: 1, firstSessionAt: 1000, lastSessionAt: 2000, tags: [], labelId: null }
      ]);
      const docs = await DocumentService.getUserDocuments('u1');
      expect(docs).toHaveLength(1);
      expect(docs[0]?.id).toBe('doc_valid');
    });

    it('retains locked encrypted documents without dropping them and marks _locked: true', async () => {
      vi.mocked(DataProvider.getUserDocuments).mockResolvedValue([
        { id: 'doc_locked_1', title: 'cipher_1', _encrypted: true, currentVersion: 1, totalWords: 100, totalDuration: 60, sessionsCount: 1, firstSessionAt: 1000, lastSessionAt: 1000, tags: 'cipher_tags_1', labelId: null },
        { id: 'doc_locked_2', title: 'cipher_2', _encrypted: true, currentVersion: 1, totalWords: 200, totalDuration: 120, sessionsCount: 1, firstSessionAt: 1000, lastSessionAt: 2000, tags: 'cipher_tags_2', labelId: null }
      ]);
      const docs = await DocumentService.getUserDocuments('u1');
      expect(docs).toHaveLength(2);
      expect(docs[0]?.id).toBe('doc_locked_2');
      expect(docs[0]?._locked).toBe(true);
      expect(docs[0]?.title).toBeUndefined();
      expect(docs[0]?.totalWords).toBe(200);

      expect(docs[1]?.id).toBe('doc_locked_1');
      expect(docs[1]?._locked).toBe(true);
      expect(docs[1]?.title).toBeUndefined();
      expect(docs[1]?.totalWords).toBe(100);
    });
  });

  describe('locked and decryption error guards', () => {
    it('getDocument returns document with _locked: true when vault is locked', async () => {
      vi.mocked(DataProvider.getDocument).mockResolvedValue({
        id: 'doc_locked', title: 'ciphertext', _encrypted: true, currentVersion: 1, totalWords: 50, totalDuration: 30, sessionsCount: 1, firstSessionAt: 1000, lastSessionAt: 1000, tags: 'cipher_tags', labelId: null
      });
      const doc = await DocumentService.getDocument('u1', 'doc_locked');
      expect(doc).not.toBeNull();
      expect(doc?._locked).toBe(true);
      expect(doc?.title).toBeUndefined();
      expect(doc?.totalWords).toBe(50);
    });

    it('createDocument refuses to save a document marked _locked or _decryptionError', async () => {
      await expect(
        DocumentService.createDocument('u1', { title: 'Test', tags: [], labelId: undefined, _locked: true } as any)
      ).rejects.toThrow('LOCKED: cannot create locked document in cloud');

      await expect(
        DocumentService.createDocument('u1', { title: 'Test', tags: [], labelId: undefined, _decryptionError: true } as any)
      ).rejects.toThrow('LOCKED: cannot create locked document in cloud');
    });
  });

  describe('update functions', () => {
    it('updateDocumentAfterSession calls updateDocumentSessionStats', async () => {
      vi.mocked(DataProvider.updateDocumentSessionStats).mockResolvedValue();
      await DocumentService.updateDocumentAfterSession('u1', 'doc1', { totalWords: 10, totalDuration: 10, currentVersion: 1 });
      expect(DataProvider.updateDocumentSessionStats).toHaveBeenCalledWith('u1', 'doc1', { totalWords: 10, totalDuration: 10, currentVersion: 1, mood: null });
    });

    it('updateTags calls updateDocument', async () => {
      vi.mocked(DataProvider.updateDocument).mockResolvedValue();
      await DocumentService.updateTags('u1', 'doc1', ['x']);
      expect(DataProvider.updateDocument).toHaveBeenCalledWith('u1', 'doc1', { tags: ['x'] });
    });

    it('updateTitle calls updateDocument', async () => {
      vi.mocked(DataProvider.updateDocument).mockResolvedValue();
      await DocumentService.updateTitle('u1', 'doc1', 'New Title');
      expect(DataProvider.updateDocument).toHaveBeenCalledWith('u1', 'doc1', { title: 'New Title' });
    });

    it('updateDate calls updateDocument', async () => {
      vi.mocked(DataProvider.updateDocument).mockResolvedValue();
      await DocumentService.updateDate('u1', 'doc1', { lastSessionAt: new Date(2000) });
      // firstSessionAt по умолчанию не отправляется: правка дня не переписывает
      // начало истории заметки (#102).
      expect(DataProvider.updateDocument).toHaveBeenCalledWith('u1', 'doc1', { lastSessionAt: 2000 });
    });

    it('updateLabelId calls updateDocument', async () => {
      vi.mocked(DataProvider.updateDocument).mockResolvedValue();
      await DocumentService.updateLabelId('u1', 'doc1', 'lbl1');
      expect(DataProvider.updateDocument).toHaveBeenCalledWith('u1', 'doc1', { labelId: 'lbl1' });
    });
  });

  describe('bulk operations', () => {
    it('deleteDocument calls DataProvider', async () => {
      vi.mocked(DataProvider.deleteDocument).mockResolvedValue();
      await DocumentService.deleteDocument('u1', 'doc1');
      expect(DataProvider.deleteDocument).toHaveBeenCalledWith('u1', 'doc1');
    });

    it('clearLabelFromAllDocs calls DataProvider', async () => {
      vi.mocked(DataProvider.clearLabelFromAllDocs).mockResolvedValue();
      await DocumentService.clearLabelFromAllDocs('u1', 'lbl1');
      expect(DataProvider.clearLabelFromAllDocs).toHaveBeenCalledWith('u1', 'lbl1');
    });

    it('renameTagInAllDocs calls DataProvider', async () => {
      vi.mocked(DataProvider.renameTagInAllDocs).mockResolvedValue();
      await DocumentService.renameTagInAllDocs('u1', 'old', 'new');
      expect(DataProvider.renameTagInAllDocs).toHaveBeenCalledWith('u1', 'old', 'new');
    });

    it('removeTagFromAllDocs calls DataProvider', async () => {
      vi.mocked(DataProvider.removeTagFromAllDocs).mockResolvedValue();
      await DocumentService.removeTagFromAllDocs('u1', 'tag');
      expect(DataProvider.removeTagFromAllDocs).toHaveBeenCalledWith('u1', 'tag');
    });
  });
});
