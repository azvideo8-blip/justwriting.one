import 'fake-indexeddb/auto';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

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

vi.mock('../AIService', () => ({
  AIService: {
    chat: vi.fn(),
  },
}));

import { AIProfileService } from '../AIProfileService';
import { AIService } from '../AIService';

describe('AIProfileService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
  });

  afterEach(() => {
    localStorage.clear();
  });

  describe('savePortrait', () => {
    it('saves to localStorage and encrypts + syncs to Firestore', async () => {
      mockSetDoc.mockResolvedValue(undefined);

      await AIProfileService.savePortrait('test-portrait-md');

      expect(localStorage.getItem('ai_user_portrait')).toBe('test-portrait-md');
      expect(mockMaybeEncrypt).toHaveBeenCalledWith(
        { aiPortrait: 'test-portrait-md' },
        ['aiPortrait'],
        [],
        true,
      );
      expect(mockSetDoc).toHaveBeenCalled();
    });
  });

  describe('getPortrait', () => {
    it('returns local portrait if stored in localStorage', async () => {
      localStorage.setItem('ai_user_portrait', 'local-portrait');

      const res = await AIProfileService.getPortrait();
      expect(res).toBe('local-portrait');
      expect(mockGetDoc).not.toHaveBeenCalled();
    });

    it('fetches from Firestore and decrypts if not in localStorage', async () => {
      mockGetDoc.mockResolvedValue({
        exists: () => true,
        data: () => ({ aiPortrait: 'encrypted-portrait' }),
      });

      const res = await AIProfileService.getPortrait();
      expect(res).toBe('encrypted-portrait');
      expect(localStorage.getItem('ai_user_portrait')).toBe('encrypted-portrait');
    });

    it('returns null if not found anywhere', async () => {
      mockGetDoc.mockResolvedValue({
        exists: () => false,
      });

      const res = await AIProfileService.getPortrait();
      expect(res).toBeNull();
    });
  });

  describe('generate', () => {
    const dummySummaries = [
      {
        documentId: 'doc-1',
        tone: 'positive',
        frequentWords: ['happy'],
        insights: ['insight 1'],
        themes: ['theme 1'],
        processedAt: 1000,
      },
      {
        documentId: 'doc-2',
        tone: 'neutral',
        frequentWords: ['calm'],
        insights: ['insight 2'],
        themes: ['theme 2'],
        processedAt: 2000,
      },
      {
        documentId: 'doc-3',
        tone: 'sad',
        frequentWords: ['tears'],
        insights: ['insight 3'],
        themes: ['theme 3'],
        processedAt: 3000,
      },
    ];

    it('returns error if there are fewer than 3 summaries', async () => {
      mockGetAll.mockResolvedValue([dummySummaries[0]]);

      const res = await AIProfileService.generate();
      expect(res).toEqual({ ok: false, error: 'NOT_ENOUGH_DATA' });
      expect(AIService.chat).not.toHaveBeenCalled();
    });

    it('calls AI to generate portrait if there are 3 or more summaries', async () => {
      mockGetAll.mockResolvedValue(dummySummaries);
      vi.mocked(AIService.chat).mockResolvedValue({
        ok: true,
        text: 'Generated portrait markdown text',
      });

      const res = await AIProfileService.generate();
      expect(res).toEqual({ ok: true, markdown: 'Generated portrait markdown text' });
      expect(AIService.chat).toHaveBeenCalledWith(expect.objectContaining({
        personaId: 'group_psychology',
      }));
      expect(localStorage.getItem('ai_user_portrait')).toBe('Generated portrait markdown text');
    });
  });
});
