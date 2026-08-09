import { describe, it, expect, vi, beforeEach } from 'vitest';
import { DocumentService } from '../../../../core/services/DocumentService';
import { DataProvider } from '../../../../core/data';

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
      await DocumentService.updateDate('u1', 'doc1', new Date(1000), new Date(2000));
      expect(DataProvider.updateDocument).toHaveBeenCalledWith('u1', 'doc1', { firstSessionAt: 1000, lastSessionAt: 2000 });
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
