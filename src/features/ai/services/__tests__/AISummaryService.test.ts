import 'fake-indexeddb/auto';
import { describe, it, expect, vi, beforeEach } from 'vitest';

const {
  mockGet,
  mockPut,
  mockDelete,
  mockGetAll,
  mockSetDoc,
  mockGetDoc,
  mockCurrentUser,
  mockMaybeEncrypt,
  mockMaybeDecrypt,
} = vi.hoisted(() => {
  return {
    mockGet: vi.fn(),
    mockPut: vi.fn(),
    mockDelete: vi.fn(),
    mockGetAll: vi.fn(),
    mockSetDoc: vi.fn(),
    mockGetDoc: vi.fn(),
    mockCurrentUser: { uid: 'test-user-123' },
    mockMaybeEncrypt: vi.fn((data) => Promise.resolve({ ...data, encrypted: true })),
    mockMaybeDecrypt: vi.fn((data) => Promise.resolve({ ...data, decrypted: true })),
  };
});

vi.mock('../../../../core/storage/localDb', () => ({
  getLocalDb: async () => ({
    get: mockGet,
    put: mockPut,
    delete: mockDelete,
    getAll: mockGetAll,
  }),
}));

vi.mock('../../../../core/firebase/firestoreClient', () => ({
  getClient: async () => ({
    db: {} as any,
    mod: {
      doc: (db: any, ...path: string[]) => ({ type: 'doc', path }),
      setDoc: mockSetDoc,
      getDoc: mockGetDoc,
    },
  }),
}));

vi.mock('firebase/auth', () => ({
  getAuth: () => ({
    currentUser: mockCurrentUser,
  }),
}));

vi.mock('../../../../core/crypto/cryptoHelpers', () => ({
  maybeEncrypt: mockMaybeEncrypt,
  maybeDecrypt: mockMaybeDecrypt,
}));

import { AISummaryService } from '../AISummaryService';

describe('AISummaryService', () => {
  const dummySummary = {
    documentId: 'doc-123',
    tone: 'neutral',
    frequentWords: ['hello', 'world'],
    insights: ['insight 1'],
    themes: ['theme 1'],
    extractedFacts: ['fact 1'],
    mentionedPeople: [],
    processedAt: 1672531200000,
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('get', () => {
    it('returns local summary if available', async () => {
      mockGet.mockResolvedValue(dummySummary);

      const res = await AISummaryService.get('doc-123');
      expect(res).toEqual(dummySummary);
      expect(mockGet).toHaveBeenCalledWith('aiSummaries', 'doc-123');
      expect(mockGetDoc).not.toHaveBeenCalled();
    });

    it('fetches from cloud if not available locally and user is logged in', async () => {
      mockGet.mockResolvedValue(undefined);
      mockGetDoc.mockResolvedValue({
        exists: () => true,
        data: () => ({ ...dummySummary, encrypted: true }),
      });

      const res = await AISummaryService.get('doc-123');
      expect(res).toEqual({
        documentId: 'doc-123',
        tone: 'neutral',
        frequentWords: ['hello', 'world'],
        insights: ['insight 1'],
        themes: ['theme 1'],
        extractedFacts: ['fact 1'],
        mentionedPeople: [],
        processedAt: 1672531200000,
      });

      expect(mockGetDoc).toHaveBeenCalled();
      expect(mockMaybeDecrypt).toHaveBeenCalled();
      expect(mockPut).toHaveBeenCalledWith('aiSummaries', expect.any(Object));
    });
  });

  describe('save', () => {
    it('saves locally and encrypts + syncs to firestore', async () => {
      mockPut.mockResolvedValue(undefined);
      mockSetDoc.mockResolvedValue(undefined);

      await AISummaryService.save(dummySummary);

      expect(mockPut).toHaveBeenCalledWith('aiSummaries', dummySummary);
      expect(mockMaybeEncrypt).toHaveBeenCalledWith(
        expect.objectContaining({ documentId: 'doc-123' }),
        ['tone'],
        ['frequentWords', 'insights', 'themes', 'extractedFacts'],
        true,
      );
      expect(mockSetDoc).toHaveBeenCalled();
    });
  });

  describe('delete', () => {
    it('deletes summary from local database', async () => {
      mockDelete.mockResolvedValue(undefined);
      await AISummaryService.delete('doc-123');
      expect(mockDelete).toHaveBeenCalledWith('aiSummaries', 'doc-123');
    });
  });

  describe('exportAsMarkdown', () => {
    it('returns empty string if summary not found', async () => {
      mockGet.mockResolvedValue(undefined);
      const md = await AISummaryService.exportAsMarkdown('doc-123', 'My Doc');
      expect(md).toBe('');
    });

    it('formats summary correctly to markdown', async () => {
      mockGet.mockResolvedValue(dummySummary);
      const md = await AISummaryService.exportAsMarkdown('doc-123', 'My Doc');
      expect(md).toContain('# Анализ документа: My Doc');
      expect(md).toContain('**Тональность:** neutral');
      expect(md).toContain('- insight 1');
      expect(md).toContain('- fact 1');
    });
  });

  describe('hasAll', () => {
    it('returns a map of existing summaries', async () => {
      mockGetAll.mockResolvedValue([dummySummary]);
      const map = await AISummaryService.hasAll();
      expect(map).toEqual({ 'doc-123': true });
    });
  });
});
