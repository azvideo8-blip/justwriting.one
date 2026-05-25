import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SessionService } from '../../../../core/services/SessionService';
import { Session } from '../../../../types';

const mockSetDoc = vi.fn();
const mockDeleteDoc = vi.fn();
const mockUpdateDoc = vi.fn();
const mockGetDocs = vi.fn();
const mockServerTimestamp = vi.fn(() => 'server-timestamp');

vi.mock('../../../../core/firebase/firestoreClient', () => ({
  getClient: async () => ({
    db: {} as any,
    mod: {
      collection: (db: any, name: string) => ({ type: 'collection', name }),
      doc: (db: any, colName: string, docId: string) => ({ type: 'doc', colName, docId }),
      setDoc: mockSetDoc,
      deleteDoc: mockDeleteDoc,
      updateDoc: mockUpdateDoc,
      getDocs: mockGetDocs,
      serverTimestamp: mockServerTimestamp,
      query: (...args: any[]) => ({ type: 'query', args }),
      where: (field: string, op: string, val: any) => ({ type: 'where', field, op, val }),
      orderBy: (field: string, dir: string) => ({ type: 'orderBy', field, dir }),
      limit: (n: number) => ({ type: 'limit', n }),
    },
  }),
}));

describe('SessionService', () => {
  const dummySession: Session = {
    id: 'session_123',
    userId: 'user_456',
    content: 'Story text',
    title: 'Story title',
    charCount: 10,
    wordCount: 2,
    duration: 10,
    wpm: 60,
    tags: [],
    createdAt: new Date(10000000),
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('saveSession', () => {
    it('strips undefined fields and calls setDoc', async () => {
      mockSetDoc.mockResolvedValue(undefined);

      const sessionWithUndefined: Session = {
        ...dummySession,
        title: undefined as any, // force undefined
      };

      await SessionService.saveSession(sessionWithUndefined);

      expect(mockSetDoc).toHaveBeenCalled();
      const [, data] = mockSetDoc.mock.calls[0];
      expect(data.title).toBeUndefined();
      expect(data.content).toBe('Story text');
      expect(data.id).toBe('session_123');
    });

    it('rethrows firestore errors', async () => {
      mockSetDoc.mockRejectedValue(new Error('Firestore write block'));
      await expect(SessionService.saveSession(dummySession)).rejects.toThrow('Firestore write block');
    });
  });

  describe('deleteSession', () => {
    it('calls deleteDoc with correct doc reference', async () => {
      mockDeleteDoc.mockResolvedValue(undefined);
      await SessionService.deleteSession('session_del');

      expect(mockDeleteDoc).toHaveBeenCalled();
      const [docRef] = mockDeleteDoc.mock.calls[0];
      expect(docRef).toEqual({ type: 'doc', colName: 'sessions', docId: 'session_del' });
    });
  });

  describe('updateSessionTags', () => {
    it('updates doc with tags and serverTimestamp', async () => {
      mockUpdateDoc.mockResolvedValue(undefined);
      await SessionService.updateSessionTags('session_tags', ['fantasy', 'mystery']);

      expect(mockUpdateDoc).toHaveBeenCalled();
      const [, updateData] = mockUpdateDoc.mock.calls[0];
      expect(updateData).toEqual({
        tags: ['fantasy', 'mystery'],
        _updatedAt: 'server-timestamp',
      });
    });
  });

  describe('getAllSessions', () => {
    it('queries sessions and parses documents correctly', async () => {
      const mockSnapshot = {
        docs: [
          {
            id: 'session_123',
            data: () => ({
              ...dummySession,
              id: 'session_123',
            }),
          },
        ],
      };
      mockGetDocs.mockResolvedValue(mockSnapshot);

      const result = await SessionService.getAllSessions('user_456');
      expect(result.sessions).toHaveLength(1);
      expect(result.sessions[0].id).toBe('session_123');
      expect(result.lastDoc).toBeDefined();
    });

    it('returns empty list and logs error on query failure', async () => {
      mockGetDocs.mockRejectedValue(new Error('Network offline'));
      const result = await SessionService.getAllSessions('user_456');
      expect(result.sessions).toEqual([]);
      expect(result.lastDoc).toBeNull();
    });
  });
});
