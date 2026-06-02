import { describe, it, expect, vi, beforeEach } from 'vitest';
import { DocumentService } from '../../../../core/services/DocumentService';

const mockAddDoc = vi.fn();
const mockGetDoc = vi.fn();
const mockGetDocs = vi.fn();
const mockUpdateDoc = vi.fn();
const mockDeleteDoc = vi.fn();
const mockBatchDelete = vi.fn();
const mockBatchUpdate = vi.fn();
const mockBatchCommit = vi.fn(() => Promise.resolve());

const mockWriteBatch = vi.fn(() => ({
  delete: mockBatchDelete,
  update: mockBatchUpdate,
  commit: mockBatchCommit,
}));

const mockTimestampNow = { seconds: 12345678, nanoseconds: 0 };
const mockTimestampFromDate = (date: Date) => ({ seconds: Math.floor(date.getTime() / 1000), nanoseconds: 0 });

vi.mock('../../../../core/firebase/firestoreClient', () => ({
  getClient: async () => ({
    db: { type: 'db' } as any,
    mod: {
      collection: (db: any, ...paths: string[]) => ({ type: 'collection', paths }),
      doc: (db: any, ...paths: string[]) => ({ type: 'doc', paths }),
      addDoc: mockAddDoc,
      getDoc: mockGetDoc,
      getDocs: mockGetDocs,
      updateDoc: mockUpdateDoc,
      deleteDoc: mockDeleteDoc,
      writeBatch: mockWriteBatch,
      Timestamp: {
        now: () => mockTimestampNow,
        fromDate: mockTimestampFromDate,
      },
      increment: (n: number) => ({ type: 'increment', n }),
      query: (col: any, ...constraints: any[]) => ({ type: 'query', col, constraints }),
      where: (field: string, op: string, val: any) => ({ type: 'where', field, op, val }),
    },
  }),
}));

describe('DocumentService', () => {
  const dummyDocData = {
    title: 'My Document',
    tags: ['fiction', 'daily'],
    labelId: 'label_123',
  };

  const dummyDocRaw = {
    userId: 'user_123',
    title: 'My Document',
    currentVersion: 2,
    totalWords: 500,
    totalDuration: 120,
    sessionsCount: 3,
    firstSessionAt: { seconds: 10000000, nanoseconds: 0 },
    lastSessionAt: { seconds: 10002000, nanoseconds: 0 },
    tags: ['fiction', 'daily'],
    labelId: 'label_123',
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('createDocument', () => {
    it('creates document with given title, tags, and label, defaulting firstSessionAt/lastSessionAt to now', async () => {
      mockAddDoc.mockResolvedValue({ id: 'new_doc_id' });

      const id = await DocumentService.createDocument('user_123', dummyDocData);

      expect(id).toBe('new_doc_id');
      expect(mockAddDoc).toHaveBeenCalled();
      const call0 = mockAddDoc.mock.calls[0];
      expect(call0).toBeDefined();
      const [colRef, docPayload] = call0!;
      expect(colRef).toEqual({ type: 'collection', paths: ['users', 'user_123', 'documents'] });
      expect(docPayload.title).toBe('My Document');
      expect(docPayload.firstSessionAt).toEqual(mockTimestampNow);
      expect(docPayload.lastSessionAt).toEqual(mockTimestampNow);
      expect(docPayload.currentVersion).toBe(0);
      expect(docPayload.totalWords).toBe(0);
      expect(docPayload.totalDuration).toBe(0);
      expect(docPayload.sessionsCount).toBe(0);
    });

    it('creates document using provided dates', async () => {
      mockAddDoc.mockResolvedValue({ id: 'new_doc_id' });
      const first = new Date(1700000000000);
      const last = new Date(1700000005000);

      await DocumentService.createDocument('user_123', {
        ...dummyDocData,
        firstSessionAt: first,
        lastSessionAt: last,
      });

      const [, docPayload] = mockAddDoc.mock.calls[0]!;
      expect(docPayload.firstSessionAt).toEqual(mockTimestampFromDate(first));
      expect(docPayload.lastSessionAt).toEqual(mockTimestampFromDate(last));
    });

    it('rethrows write failure', async () => {
      mockAddDoc.mockRejectedValue(new Error('Write blocked by security rules'));
      await expect(DocumentService.createDocument('user_123', dummyDocData)).rejects.toThrow('Write blocked by security rules');
    });
  });

  describe('getDocument', () => {
    it('returns document when exists and passes validation', async () => {
      mockGetDoc.mockResolvedValue({
        exists: () => true,
        id: 'doc_123',
        data: () => dummyDocRaw,
      });

      const doc = await DocumentService.getDocument('user_123', 'doc_123');
      expect(doc).not.toBeNull();
      expect(doc?.id).toBe('doc_123');
      expect(doc?.title).toBe('My Document');
    });

    it('returns null if document does not exist', async () => {
      mockGetDoc.mockResolvedValue({
        exists: () => false,
      });

      const doc = await DocumentService.getDocument('user_123', 'doc_missing');
      expect(doc).toBeNull();
    });

    it('returns fallback object if validation fails', async () => {
      mockGetDoc.mockResolvedValue({
        exists: () => true,
        id: 'doc_123',
        data: () => ({
          ...dummyDocRaw,
          currentVersion: 'not-a-number',
        }),
      });

      const doc = await DocumentService.getDocument('user_123', 'doc_123');
      expect(doc).toBeNull();
    });
  });

  describe('getUserDocuments', () => {
    it('returns parsed and sorted user documents', async () => {
      mockGetDocs.mockResolvedValue({
        docs: [
          {
            id: 'doc_1',
            data: () => ({ ...dummyDocRaw, lastSessionAt: { seconds: 10000000, nanoseconds: 0 } }),
          },
          {
            id: 'doc_2',
            data: () => ({ ...dummyDocRaw, lastSessionAt: { seconds: 10005000, nanoseconds: 0 } }),
          },
        ],
      });

      const docs = await DocumentService.getUserDocuments('user_123');
      expect(docs).toHaveLength(2);
      // Sorted descending by lastSessionAt
      expect(docs[0]?.id).toBe('doc_2');
      expect(docs[1]?.id).toBe('doc_1');
    });

    it('returns fallback objects for documents that fail Zod validation', async () => {
      mockGetDocs.mockResolvedValue({
        docs: [
          {
            id: 'doc_1',
            data: () => ({ ...dummyDocRaw, lastSessionAt: { seconds: 10000000, nanoseconds: 0 } }),
          },
          {
            id: 'doc_corrupted',
            data: () => ({ ...dummyDocRaw, totalWords: 'not-a-number' }),
          },
        ],
      });

      const docs = await DocumentService.getUserDocuments('user_123');
      expect(docs).toHaveLength(1);
      expect(docs[0]?.id).toBe('doc_1');
    });
  });

  describe('updateDocumentAfterSession', () => {
    it('calls updateDoc with incremented sessionsCount and lastSessionAt set to now', async () => {
      mockUpdateDoc.mockResolvedValue(undefined);

      await DocumentService.updateDocumentAfterSession('user_123', 'doc_123', {
        totalWords: 1000,
        totalDuration: 500,
        currentVersion: 5,
        mood: 'happy',
      });

      expect(mockUpdateDoc).toHaveBeenCalled();
      const [, payload] = mockUpdateDoc.mock.calls[0]!;
      expect(payload).toEqual({
        totalWords: 1000,
        totalDuration: 500,
        currentVersion: 5,
        mood: 'happy',
        sessionsCount: { type: 'increment', n: 1 },
        lastSessionAt: mockTimestampNow,
      });
    });

    it('calls updateDoc with custom sessionsCount and lastSessionAt if provided', async () => {
      mockUpdateDoc.mockResolvedValue(undefined);
      const customDate = new Date(1700000000000);

      await DocumentService.updateDocumentAfterSession('user_123', 'doc_123', {
        totalWords: 1000,
        totalDuration: 500,
        currentVersion: 5,
        mood: 'happy',
        sessionsCount: 42,
        lastSessionAt: customDate,
      });

      expect(mockUpdateDoc).toHaveBeenCalled();
      const [, payload2] = mockUpdateDoc.mock.calls[0]!;
      expect(payload2).toEqual({
        totalWords: 1000,
        totalDuration: 500,
        currentVersion: 5,
        mood: 'happy',
        sessionsCount: 42,
        lastSessionAt: mockTimestampFromDate(customDate),
      });
    });
  });

  describe('updateTags', () => {
    it('updates tags list on document', async () => {
      mockUpdateDoc.mockResolvedValue(undefined);
      await DocumentService.updateTags('user_123', 'doc_123', ['tagA', 'tagB']);
      const [, payload3] = mockUpdateDoc.mock.calls[0]!;
      expect(payload3).toEqual({ tags: ['tagA', 'tagB'] });
    });
  });

  describe('updateTitle', () => {
    it('updates title on document', async () => {
      mockUpdateDoc.mockResolvedValue(undefined);
      await DocumentService.updateTitle('user_123', 'doc_123', 'New Title');
      const [, payload4] = mockUpdateDoc.mock.calls[0]!;
      expect(payload4).toEqual({ title: 'New Title' });
    });
  });

  describe('updateDate', () => {
    it('updates firstSessionAt and lastSessionAt', async () => {
      mockUpdateDoc.mockResolvedValue(undefined);
      const d1 = new Date(1700000000000);
      const d2 = new Date(1700000010000);
      await DocumentService.updateDate('user_123', 'doc_123', d1, d2);
      const [, payload5] = mockUpdateDoc.mock.calls[0]!;
      expect(payload5).toEqual({
        firstSessionAt: mockTimestampFromDate(d1),
        lastSessionAt: mockTimestampFromDate(d2),
      });
    });
  });

  describe('updateLabelId', () => {
    it('updates labelId or sets it to null if undefined', async () => {
      mockUpdateDoc.mockResolvedValue(undefined);
      await DocumentService.updateLabelId('user_123', 'doc_123', 'label_abc');
      let [, payload6] = mockUpdateDoc.mock.calls[0]!;
      expect(payload6).toEqual({ labelId: 'label_abc' });

      await DocumentService.updateLabelId('user_123', 'doc_123', undefined);
      [, payload6] = mockUpdateDoc.mock.calls[1]!;
      expect(payload6).toEqual({ labelId: null });
    });
  });

  describe('deleteDocument', () => {
    it('deletes versions in batches and then deletes document', async () => {
      const mockVersionsDocs = Array.from({ length: 600 }, (_, i) => ({
        ref: { type: 'version-ref', id: `v_${i}` },
      }));

      mockGetDocs.mockResolvedValue({
        docs: mockVersionsDocs,
      });

      await DocumentService.deleteDocument('user_123', 'doc_to_delete');

      // Check batching: 600 versions should require 2 batches (499 + 101)
      expect(mockWriteBatch).toHaveBeenCalledTimes(3); // 2 for versions, 1 final for doc
      expect(mockBatchDelete).toHaveBeenCalledTimes(601); // 600 versions + 1 doc
      expect(mockBatchCommit).toHaveBeenCalledTimes(3);
    });
  });

  describe('clearLabelFromAllDocs', () => {
    it('queries and clears labels in batches', async () => {
      const mockMatchingDocs = Array.from({ length: 50 }, (_, i) => ({
        ref: { type: 'doc-ref', id: `d_${i}` },
      }));

      mockGetDocs.mockResolvedValue({
        docs: mockMatchingDocs,
      });

      await DocumentService.clearLabelFromAllDocs('user_123', 'label_to_remove');

      expect(mockGetDocs).toHaveBeenCalled();
      expect(mockWriteBatch).toHaveBeenCalledTimes(1);
      expect(mockBatchUpdate).toHaveBeenCalledTimes(50);
      const [, updatePayload] = mockBatchUpdate.mock.calls[0]!;
      expect(updatePayload).toEqual({ labelId: null });
    });
  });

  describe('renameTagInAllDocs', () => {
    it('queries and updates renamed tags in batches', async () => {
      const mockMatchingDocs = [
        {
          ref: { type: 'doc-ref', id: 'doc_a' },
          data: () => ({ tags: ['draft', 'fantasy'] }),
        },
        {
          ref: { type: 'doc-ref', id: 'doc_b' },
          data: () => ({ tags: ['fantasy', 'scifi'] }),
        },
      ];

      mockGetDocs.mockResolvedValue({
        docs: mockMatchingDocs,
      });

      await DocumentService.renameTagInAllDocs('user_123', 'fantasy', 'romance');

      expect(mockGetDocs).toHaveBeenCalled();
      expect(mockWriteBatch).toHaveBeenCalledTimes(1);
      expect(mockBatchUpdate).toHaveBeenCalledTimes(2);

      const [, update1] = mockBatchUpdate.mock.calls[0]!;
      expect(update1).toEqual({ tags: ['draft', 'romance'] });

      const [, update2] = mockBatchUpdate.mock.calls[1]!;
      expect(update2).toEqual({ tags: ['romance', 'scifi'] });
    });
  });

  describe('removeTagFromAllDocs', () => {
    it('queries and filters out tag in matches in batches', async () => {
      const mockMatchingDocs = [
        {
          ref: { type: 'doc-ref', id: 'doc_a' },
          data: () => ({ tags: ['draft', 'fantasy'] }),
        },
      ];

      mockGetDocs.mockResolvedValue({
        docs: mockMatchingDocs,
      });

      await DocumentService.removeTagFromAllDocs('user_123', 'fantasy');

      expect(mockGetDocs).toHaveBeenCalled();
      expect(mockWriteBatch).toHaveBeenCalledTimes(1);
      expect(mockBatchUpdate).toHaveBeenCalledTimes(1);

      const [, update] = mockBatchUpdate.mock.calls[0]!;
      expect(update).toEqual({ tags: ['draft'] });
    });
  });
});
