import 'fake-indexeddb/auto';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const {
  mockGet,
  mockPut,
  mockDelete,
  mockGetAll,
  mockGetAllFromIndex,
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
    mockGetAllFromIndex: vi.fn(),
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
    getAllFromIndex: mockGetAllFromIndex,
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
    mockGetAll.mockResolvedValue([]);
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
        'test-user-123',
      );
      expect(mockSetDoc).toHaveBeenCalled();
    });

    it('saves to localStorage and completes successfully even if encryption fails with ENCRYPT_REQUIRED', async () => {
      mockMaybeEncrypt.mockRejectedValueOnce(new Error('ENCRYPT_REQUIRED: session key not available'));

      await expect(AIProfileService.savePortrait('test-portrait-md')).resolves.not.toThrow();

      expect(localStorage.getItem('ai_user_portrait')).toBe('test-portrait-md');
      expect(mockSetDoc).not.toHaveBeenCalled();
    });

    it('queues to syncQueue and does not throw if cloud save fails with a general error (offline)', async () => {
      mockSetDoc.mockRejectedValueOnce(new Error('network connection lost'));

      await expect(AIProfileService.savePortrait('test-portrait-md-offline')).resolves.not.toThrow();

      expect(localStorage.getItem('ai_user_portrait')).toBe('test-portrait-md-offline');
      expect(mockPut).toHaveBeenCalledWith('syncQueue', expect.objectContaining({
        type: 'portrait',
        documentId: 'test-user-123',
      }));
    });
  });

  describe('syncPortraitToCloud', () => {
    it('reads from localStorage and uploads to Firestore', async () => {
      localStorage.setItem('ai_user_portrait', 'test-synced-portrait');
      mockSetDoc.mockResolvedValue(undefined);

      await AIProfileService.syncPortraitToCloud('test-user-123');

      expect(mockMaybeEncrypt).toHaveBeenCalledWith(
        { aiPortrait: 'test-synced-portrait' },
        ['aiPortrait'],
        [],
        'test-user-123',
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

    it('returns null and logs warning if cloud fetch throws LOCKED error', async () => {
      mockGetDoc.mockResolvedValue({
        exists: () => true,
        data: () => ({ aiPortrait: 'encrypted-portrait' }),
      });
      mockMaybeDecrypt.mockRejectedValueOnce(new Error('LOCKED: session key not available'));

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
      // getAll called for: aiProfileFacets, aiChatMemory, documents, aiSummaries
      mockGetAll
        .mockResolvedValueOnce([])  // aiProfileFacets
        .mockResolvedValueOnce([])  // aiChatMemory
        .mockResolvedValueOnce([])  // documents
        .mockResolvedValueOnce([dummySummaries[0]]); // aiSummaries
      mockGetAllFromIndex.mockResolvedValue([]);

      const res = await AIProfileService.generate();
      expect(res).toEqual({ ok: false, error: 'NOT_ENOUGH_DATA' });
      expect(AIService.chat).not.toHaveBeenCalled();
    });

    it('calls AI to generate portrait if there are 3 or more summaries', async () => {
      mockGetAll
        .mockResolvedValueOnce([])  // aiProfileFacets
        .mockResolvedValueOnce([])  // aiChatMemory
        .mockResolvedValueOnce([])  // documents
        .mockResolvedValueOnce(dummySummaries); // aiSummaries
      mockGetAllFromIndex.mockResolvedValue([]);
      vi.mocked(AIService.chat).mockResolvedValue({
        ok: true,
        text: 'Generated portrait markdown text',
      });

      const expectedMarkdown = `# Психологический портрет пользователя\n\n` +
        `## Темы и интересы\nGenerated portrait markdown text\n\n` +
        `## Эмоциональные паттерны\nGenerated portrait markdown text\n\n` +
        `## Сильные стороны\nGenerated portrait markdown text\n\n` +
        `## Зоны роста\nGenerated portrait markdown text\n\n` +
        `## Стиль общения\nGenerated portrait markdown text\n`;

      const res = await AIProfileService.generate();
      expect(res).toEqual({ ok: true, markdown: expectedMarkdown });
      expect(AIService.chat).toHaveBeenCalledWith(expect.objectContaining({
        personaId: 'custom',
      }));
      expect(localStorage.getItem('ai_user_portrait')).toBe(expectedMarkdown);
    });
  });
});
