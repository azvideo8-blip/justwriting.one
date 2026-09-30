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

// EA-17: облачная запись портрета — только при включённой синхронизации.
let mockSyncOn = true;
vi.mock('../../../../core/sync/cloudSyncEnabled', () => ({ cloudSyncEnabled: () => mockSyncOn }));
vi.mock('../../../../core/storage/localDb', () => ({
  getLocalDb: async () => ({
    get: mockGet,
    put: mockPut,
    delete: mockDelete,
    getAll: mockGetAll,
    getAllFromIndex: mockGetAllFromIndex,
  }),
}));

vi.mock('../../../../core/data', () => ({
  DataProvider: {
    updateProfile: mockSetDoc,
    getProfile: mockGetDoc,
  },
}));

vi.mock('../../../../core/auth', () => ({
  getCurrentUser: () => mockCurrentUser,
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
import { invalidatePortrait } from '../../../../core/ai/portraitEpoch';

describe('AIProfileService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // clearAllMocks стирает вызовы, но НЕ реализации: без явного умолчания
    // mockResolvedValue из одного теста протекал в следующие.
    mockGet.mockResolvedValue(undefined);
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

      expect(localStorage.getItem('ai_user_portrait_test-user-123')).toBe('test-portrait-md');
      expect(mockMaybeEncrypt).toHaveBeenCalledWith(
        { aiPortrait: 'test-portrait-md' },
        ['aiPortrait'],
        [],
        'test-user-123',
      );
      expect(mockSetDoc).toHaveBeenCalled();
    });

    it('EA-17: keeps the portrait on the device when sync is off', async () => {
      mockSyncOn = false;
      try {
        await AIProfileService.savePortrait('test-portrait-md');
        expect(localStorage.getItem('ai_user_portrait_test-user-123')).toBe('test-portrait-md');
        expect(mockSetDoc).not.toHaveBeenCalled();
      } finally {
        mockSyncOn = true;
      }
    });

    it('saves to localStorage and completes successfully even if encryption fails with ENCRYPT_REQUIRED', async () => {
      mockMaybeEncrypt.mockRejectedValueOnce(new Error('ENCRYPT_REQUIRED: session key not available'));

      await expect(AIProfileService.savePortrait('test-portrait-md')).resolves.not.toThrow();

      expect(localStorage.getItem('ai_user_portrait_test-user-123')).toBe('test-portrait-md');
      expect(mockSetDoc).not.toHaveBeenCalled();
    });

    it('queues to syncQueue and does not throw if cloud save fails with a general error (offline)', async () => {
      mockSetDoc.mockRejectedValueOnce(new Error('network connection lost'));

      await expect(AIProfileService.savePortrait('test-portrait-md-offline')).resolves.not.toThrow();

      expect(localStorage.getItem('ai_user_portrait_test-user-123')).toBe('test-portrait-md-offline');
      expect(mockPut).toHaveBeenCalledWith('syncQueue', expect.objectContaining({
        type: 'portrait',
        documentId: 'test-user-123',
      }));
    });
  });

  describe('syncPortraitToCloud', () => {
    /**
     * Источник — IndexedDB, а не кэш в localStorage. Кэш привязан к аккаунту и
     * может быть пуст в момент, когда очередь синхронизации доходит до задачи:
     * именно поэтому колонка users.ai_portrait стояла пустой при живом
     * портрете на устройстве.
     */
    it('reads the portrait from the local store and uploads it', async () => {
      mockGet.mockResolvedValueOnce({ id: 'singleton', portrait: 'test-synced-portrait' });
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
      localStorage.setItem('ai_user_portrait_test-user-123', 'local-portrait');

      const res = await AIProfileService.getPortrait();
      expect(res).toBe('local-portrait');
      expect(mockGetDoc).not.toHaveBeenCalled();
    });

    it('fetches from Firestore and decrypts if not in localStorage', async () => {
      mockGetDoc.mockResolvedValue({ aiPortrait: 'encrypted-portrait' });

      const res = await AIProfileService.getPortrait();
      expect(res).toBe('encrypted-portrait');
      expect(localStorage.getItem('ai_user_portrait_test-user-123')).toBe('encrypted-portrait');
    });

    it('returns null if not found anywhere', async () => {
      mockGetDoc.mockResolvedValue(null);

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
      expect(localStorage.getItem('ai_user_portrait_test-user-123')).toBe(expectedMarkdown);
    });

    // R3-009: удаление заметки посреди прохода сносит портрет; проход, начатый
    // до удаления, не должен дописать его обратно (и увезти в облако).
    it('does not save a portrait when a note was deleted during generation', async () => {
      mockGetAll
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce(dummySummaries);
      mockGetAllFromIndex.mockResolvedValue([]);
      vi.mocked(AIService.chat).mockImplementation(async () => {
        invalidatePortrait();
        return { ok: true, text: 'stale section' };
      });

      const res = await AIProfileService.generate();
      expect(res).toEqual({ ok: false, error: 'invalidated_during_generation' });
      expect(localStorage.getItem('ai_user_portrait_test-user-123')).toBeNull();
      expect(mockPut).not.toHaveBeenCalledWith('aiPortrait', expect.anything());
    });

    // Backlog "de-personalised portrait": all five section prompts must carry
    // the abstraction instruction, not just some of them — a prompt edited in
    // four of five places and missed in the fifth is exactly the class of bug
    // this repo keeps finding in review.
    it('sends the character-not-events abstraction rule in every one of the five section prompts', async () => {
      mockGetAll
        .mockResolvedValueOnce([])  // aiProfileFacets
        .mockResolvedValueOnce([])  // aiChatMemory
        .mockResolvedValueOnce([])  // documents
        .mockResolvedValueOnce(dummySummaries); // aiSummaries
      mockGetAllFromIndex.mockResolvedValue([]);
      vi.mocked(AIService.chat).mockResolvedValue({ ok: true, text: 'x' });

      await AIProfileService.generate();

      const calls = vi.mocked(AIService.chat).mock.calls;
      expect(calls).toHaveLength(5);
      for (const [call] of calls) {
        expect(call.customSystemPrompt).toContain('Не называй имена людей');
        expect(call.customSystemPrompt).toContain('устойчивые черты характера');
      }
    });

    it('changing a section prompt invalidates its cache even when the underlying input is unchanged', async () => {
      mockGetAll
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce(dummySummaries);
      mockGetAllFromIndex.mockResolvedValue([]);
      vi.mocked(AIService.chat).mockResolvedValue({ ok: true, text: 'fresh text' });

      // A cache entry keyed on the OLD prompt formula (input-only hash) for
      // the exact input this run will produce.
      const oldStyleInput = dummySummaries.map((s, i) => {
        const parts = [`Запись ${i + 1}:`];
        if (s.tone) parts.push(`  Тон: ${s.tone}`);
        if (s.themes?.length) parts.push(`  Темы: ${s.themes.join(', ')}`);
        if (s.insights?.length) s.insights.forEach(ins => parts.push(`  • ${ins}`));
        return parts.join('\n');
      }).join('\n\n');
      const crypto = globalThis.crypto;
      const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(oldStyleInput));
      const oldHash = Array.from(new Uint8Array(digest)).map(b => b.toString(16).padStart(2, '0')).join('');
      localStorage.setItem(
        'ai_portrait_sections_test-user-123',
        JSON.stringify({ growth: { hash: oldHash, content: 'STALE pre-abstraction-rule content' } })
      );

      await AIProfileService.generate();

      // Falsify: if the hash still ignored the prompt, this call would be
      // skipped (cache hit) and the section would stay the stale text.
      expect(AIService.chat).toHaveBeenCalled();
      const growthMarkdown = localStorage.getItem('ai_user_portrait_test-user-123');
      expect(growthMarkdown).not.toContain('STALE pre-abstraction-rule content');
    });
  });
});
