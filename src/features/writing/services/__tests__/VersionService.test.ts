import { describe, it, expect, vi, beforeEach } from 'vitest';
import { VersionService } from '../../../../core/services/VersionService';

const mockAddDoc = vi.fn();
const mockSetDoc = vi.fn();
const mockGetDocs = vi.fn();
const mockTimestampNow = { seconds: 12345678, nanoseconds: 0 };
const mockTimestampFromDate = (date: Date) => ({ seconds: Math.floor(date.getTime() / 1000), nanoseconds: 0 });

vi.mock('../../../../core/firebase/firestoreClient', () => ({
  getClient: async () => ({
    db: { type: 'db' } as unknown,
    mod: {
      collection: (db: any, ...paths: string[]) => ({ type: 'collection', paths }),
      doc: (db: any, ...paths: string[]) => ({ type: 'doc', paths }),
      addDoc: mockAddDoc,
      setDoc: mockSetDoc,
      getDocs: mockGetDocs,
      Timestamp: {
        now: () => mockTimestampNow,
        fromDate: mockTimestampFromDate,
      },
      query: (col: any, ...constraints: any[]) => ({ type: 'query', col, constraints }),
      orderBy: (field: string, dir: string) => ({ type: 'orderBy', field, dir }),
      limit: (n: number) => ({ type: 'limit', n }),
    },
  }),
}));

// Mock DiffService
vi.mock('../../../../core/services/DiffService', () => ({
  computeWordDelta: (_prev: string, _curr: string) => ({
    wordsAdded: 10,
    charsAdded: 50,
  }),
}));

describe('VersionService', () => {
  const dummyVersionData = {
    content: 'Some new story content.',
    previousContent: 'Some content.',
    wordCount: 15,
    duration: 60,
    wpm: 15,
    versionNumber: 3,
    goalWords: 100,
    goalTime: 600,
    goalReached: false,
    sessionStartedAt: new Date(1700000000000),
    mood: 'focused',
  };

  const dummyRawVersion = {
    documentId: 'doc_123',
    userId: 'user_123',
    version: 3,
    content: 'Some new story content.',
    wordCount: 15,
    wordsAdded: 10,
    charsAdded: 50,
    duration: 60,
    wpm: 15,
    goalWords: 100,
    goalTime: 600,
    goalReached: false,
    savedAt: { seconds: 12345678, nanoseconds: 0 },
    sessionStartedAt: { seconds: 1700000000, nanoseconds: 0 },
    mood: 'focused',
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('addVersion', () => {
    it('successfully computes diff and writes version document to firestore', async () => {
      mockSetDoc.mockResolvedValue(undefined);

      const id = await VersionService.addVersion('user_123', 'doc_123', dummyVersionData);

      expect(id).toBe('v3');
      expect(mockSetDoc).toHaveBeenCalled();
      const [docRef, docPayload] = mockSetDoc.mock.calls[0]!;
      expect(docRef).toEqual({
        type: 'doc',
        paths: ['users', 'user_123', 'documents', 'doc_123', 'versions', 'v3'],
      });
      expect(docPayload).toEqual({
        documentId: 'doc_123',
        userId: 'user_123',
        version: 3,
        content: 'Some new story content.',
        wordCount: 15,
        wordsAdded: 10,
        charsAdded: 50,
        duration: 60,
        wpm: 15,
        goalWords: 100,
        goalTime: 600,
        goalReached: false,
        savedAt: mockTimestampNow,
        sessionStartedAt: mockTimestampFromDate(dummyVersionData.sessionStartedAt),
        mood: 'focused',
      });
    });

    it('rejects adding version if estimated document size exceeds 900KB', async () => {
      const hugeContent = 'a'.repeat(400_000);
      const hugePrevContent = 'b'.repeat(300_000);

      await expect(
        VersionService.addVersion('user_123', 'doc_123', {
          ...dummyVersionData,
          content: hugeContent,
          previousContent: hugePrevContent,
        })
      ).rejects.toThrow(/Document too large/);
    });

    it('includes _encrypted: true when encrypted flag is set', async () => {
      mockSetDoc.mockResolvedValue(undefined);

      await VersionService.addVersion('user_123', 'doc_123', {
        ...dummyVersionData,
        _encrypted: true,
      });

      const [, docPayload1] = mockSetDoc.mock.calls[0]!;
      expect(docPayload1._encrypted).toBe(true);
    });

    it('uses custom savedAt date if provided', async () => {
      mockSetDoc.mockResolvedValue(undefined);
      const customSavedAt = new Date(1700000005000);

      await VersionService.addVersion('user_123', 'doc_123', {
        ...dummyVersionData,
        savedAt: customSavedAt,
      });

      const [, docPayload2] = mockSetDoc.mock.calls[0]!;
      expect(docPayload2.savedAt).toEqual(mockTimestampFromDate(customSavedAt));
    });

    it('rethrows write error', async () => {
      mockSetDoc.mockRejectedValue(new Error('Firestore error'));
      await expect(
        VersionService.addVersion('user_123', 'doc_123', dummyVersionData)
      ).rejects.toThrow('Firestore error');
    });
  });

  describe('getVersions', () => {
    it('returns parsed and sorted versions', async () => {
      mockGetDocs.mockResolvedValue({
        docs: [
          {
            id: 'ver_2',
            data: () => ({ ...dummyRawVersion, version: 2 }),
          },
          {
            id: 'ver_1',
            data: () => ({ ...dummyRawVersion, version: 1 }),
          },
        ],
      });

      const versions = await VersionService.getVersions('user_123', 'doc_123');
      expect(versions).toHaveLength(2);
      expect(versions[0]?.version).toBe(1);
      expect(versions[1]?.version).toBe(2);
    });

    it('returns fallback objects for versions failing validation', async () => {
      mockGetDocs.mockResolvedValue({
        docs: [
          {
            id: 'ver_1',
            data: () => ({ ...dummyRawVersion, version: 1 }),
          },
          {
            id: 'ver_corrupted',
            data: () => ({ ...dummyRawVersion, version: 'not-a-number' }),
          },
        ],
      });

      const versions = await VersionService.getVersions('user_123', 'doc_123');
      expect(versions).toHaveLength(2);
      const corrupted = versions.find(v => v.id === 'ver_corrupted');
      expect(corrupted).toBeDefined();
      expect(corrupted?.version).toBe('not-a-number');
    });
  });

  describe('getLatestContent', () => {
    it('returns content of the latest version', async () => {
      mockGetDocs.mockResolvedValue({
        docs: [
          {
            id: 'ver_latest',
            data: () => ({ ...dummyRawVersion, content: 'latest content', version: 10 }),
          },
        ],
      });

      const content = await VersionService.getLatestContent('user_123', 'doc_123');
      expect(content).toBe('latest content');
    });

    it('returns empty string if no versions exist', async () => {
      mockGetDocs.mockResolvedValue({
        docs: [],
      });

      const content = await VersionService.getLatestContent('user_123', 'doc_123');
      expect(content).toBe('');
    });

    it('returns empty string if parsing fails', async () => {
      mockGetDocs.mockResolvedValue({
        docs: [
          {
            id: 'ver_invalid',
            data: () => ({ ...dummyRawVersion, version: 'invalid' }),
          },
        ],
      });

      const content = await VersionService.getLatestContent('user_123', 'doc_123');
      expect(content).toBe('');
    });
  });

  describe('getLatestVersion', () => {
    it('returns the latest version object', async () => {
      mockGetDocs.mockResolvedValue({
        docs: [
          {
            id: 'ver_latest',
            data: () => ({ ...dummyRawVersion, content: 'latest content', version: 10 }),
          },
        ],
      });

      const version = await VersionService.getLatestVersion('user_123', 'doc_123');
      expect(version).not.toBeNull();
      expect(version?.content).toBe('latest content');
      expect(version?.version).toBe(10);
    });

    it('returns null if no versions exist', async () => {
      mockGetDocs.mockResolvedValue({
        docs: [],
      });

      const version = await VersionService.getLatestVersion('user_123', 'doc_123');
      expect(version).toBeNull();
    });

    it('returns null if parsing fails', async () => {
      mockGetDocs.mockResolvedValue({
        docs: [
          {
            id: 'ver_invalid',
            data: () => ({ ...dummyRawVersion, version: 'invalid' }),
          },
        ],
      });

      const version = await VersionService.getLatestVersion('user_123', 'doc_123');
      expect(version).toBeNull();
    });
  });
});
