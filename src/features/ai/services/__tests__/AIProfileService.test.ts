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
  mockReportError,
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
    mockReportError: vi.fn(),
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
    // TR-9: «разобрана» = есть строка в aiSummaries; ключи — из тех же посеянных сводок.
    getAllKeys: async (store: string) => ((await mockGetAll(store)) as { documentId?: string; id?: string }[]).map(r => r.documentId ?? r.id),
    transaction: () => ({ store: { index: () => ({ openCursor: async () => null }) } }),
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

// PX-2: предупреждение о форме раздела проверяется как факт вызова; текст в него
// не попадает, поэтому в тесте важен сам вызов и только длина в сообщении.
vi.mock('../../../../shared/errors/reportError', () => ({
  reportError: (...args: unknown[]) => mockReportError(...args),
}));

import { AIProfileService } from '../AIProfileService';
import { AIService } from '../AIService';
import { LocalVersionService } from '../../../../core/services/LocalVersionService';
import { invalidatePortrait } from '../../../../core/ai/portraitEpoch';
import { SYSTEM_TASK_PROMPTS, portraitPromptsVersion } from '../../../../shared/ai/systemTaskPrompts';

function summaryReads(summaries: Array<{ documentId: string }>) {
  mockGetAll.mockImplementation(async (store: string) => {
    if (store === 'aiSummaries') return summaries;
    if (store === 'documents') return summaries.map(s => ({
      id: s.documentId, guestId: 'test-user-123', title: s.documentId, currentVersion: 1,
      totalWords: 10, totalDuration: 1, sessionsCount: 1, firstSessionAt: 1, lastSessionAt: 1, tags: [],
    }));
    return [];
  });
}

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

    // Владелец 11.11: «Обновить профиль» на архиве в сотни заметок — четыре раздела
    // «Invalid payload»: все сводки в одном сообщении больше 50 000 знаков схемы чата.
    // Мутация: убрать потолок (PORTRAIT_INPUT_MAX = Infinity) → красный.
    it('большой архив: вход раздела проходит схему чата, свежие сводки — в нём', async () => {
      const many = Array.from({ length: 400 }, (_, i) => ({
        documentId: `doc-${i}`, tone: 'спокойный', frequentWords: [], themes: ['тема'],
        insights: [`мысль номер ${i} `.padEnd(280, 'ж')], processedAt: 1000 + i,
      }));
      summaryReads(many);
      mockGetAllFromIndex.mockResolvedValue([]);
      vi.mocked(AIService.chat).mockResolvedValue({ ok: true, text: 'Раздел.' });

      await AIProfileService.generate();
      const { chatInputSchema } = await import('../../../../shared/ai/buildChatPrompt');
      const calls = vi.mocked(AIService.chat).mock.calls.map(c => c[0]);
      expect(calls.length).toBe(5);
      for (const p of calls) expect(chatInputSchema.safeParse(p).success).toBe(true);
      const themes = String(calls[0]!.messages[0]!.content);
      expect(themes).toContain('мысль номер 399');
      expect(themes).not.toContain('мысль номер 0 ');
    });

    it('returns error if there are fewer than 3 summaries', async () => {
      summaryReads(dummySummaries.slice(0, 1));
      mockGetAllFromIndex.mockResolvedValue([]);

      const res = await AIProfileService.generate();
      expect(res).toEqual({ ok: false, error: 'NOT_ENOUGH_DATA' });
      expect(AIService.chat).not.toHaveBeenCalled();
    });

    // TR-9: числа стиля письма считаются по тексту заметок и уходят в портрет.
    // Текст неразобранной заметки для них не читается.
    // Мутация: убрать `&& visibleKeys.has(d.id)` в AIProfileService.generate → красный.
    it('TR-9: числа стиля — только по разобранным заметкам', async () => {
      mockGetAll.mockImplementation(async (store: string) => {
        if (store === 'aiSummaries') return dummySummaries;
        if (store === 'documents') return [...dummySummaries.map(s => s.documentId), 'raw-no-summary'].map(id => ({
          id, guestId: 'test-user-123', title: id, currentVersion: 1,
          totalWords: 10, totalDuration: 1, sessionsCount: 1, firstSessionAt: 1, lastSessionAt: 1, tags: [],
        }));
        return [];
      });
      mockGetAllFromIndex.mockResolvedValue([]);
      const read = vi.spyOn(LocalVersionService, 'getLatestContent').mockImplementation(async (id: string) => `Текст заметки ${id}.`);
      vi.mocked(AIService.chat).mockResolvedValue({ ok: true, text: 'Раздел портрета' });

      await AIProfileService.generate();

      const readIds = read.mock.calls.map(c => c[0]);
      read.mockRestore();
      expect(readIds).toContain(dummySummaries[0]!.documentId);
      expect(readIds).not.toContain('raw-no-summary');
    });

    it('calls AI to generate portrait if there are 3 or more summaries', async () => {
      summaryReads(dummySummaries);
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
      expect(res).toEqual({ ok: true, markdown: expectedMarkdown, partial: false });
      expect(AIService.chat).toHaveBeenCalledWith(expect.objectContaining({
        personaId: 'custom',
      }));
      expect(localStorage.getItem('ai_user_portrait_test-user-123')).toBe(expectedMarkdown);
    });

    // Ревью 0.9.39: пересборка, которая взяла раздел из кэша прежних промптов
    // (вызов упал или кончился лимит фона), не помечает портрет текущей версией —
    // иначе строка «собран по прежним правилам» пропала бы при старом тексте.
    // Мутация: всегда ставить promptVersion → красный первый кейс.
    it('раздел из кэша прежних промптов — портрет сохраняется без текущей версии', async () => {
      const old = { content: 'Старый текст раздела.', hash: 'hash-of-old-prompts' };
      localStorage.setItem('ai_portrait_sections_test-user-123', JSON.stringify({
        themes: old, emotional_patterns: old, strengths: old, growth: old, communication_prefs: old,
      }));
      summaryReads(dummySummaries);
      mockGetAllFromIndex.mockResolvedValue([]);
      vi.mocked(AIService.chat).mockResolvedValue({ ok: false, error: 'provider down' } as never);

      const res = await AIProfileService.generate();
      expect(res.ok).toBe(true);
      const saved = mockPut.mock.calls.find(c => c[0] === 'aiPortrait')?.[1] as { promptVersion?: string } | undefined;
      expect(saved).toBeDefined();
      expect(saved).not.toHaveProperty('promptVersion');
    });

    it('все разделы свежие — портрет сохраняется с текущей версией', async () => {
      summaryReads(dummySummaries);
      mockGetAllFromIndex.mockResolvedValue([]);
      vi.mocked(AIService.chat).mockResolvedValue({ ok: true, text: 'Свежий текст раздела.' });

      await AIProfileService.generate();
      const saved = mockPut.mock.calls.find(c => c[0] === 'aiPortrait')?.[1] as { promptVersion?: string } | undefined;
      expect(saved?.promptVersion).toBe(portraitPromptsVersion());
    });

    // R3-009: удаление заметки посреди прохода сносит портрет; проход, начатый
    // до удаления, не должен дописать его обратно (и увезти в облако).
    it('does not save a portrait when a note was deleted during generation', async () => {
      summaryReads(dummySummaries);
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
      summaryReads(dummySummaries);
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
      summaryReads(dummySummaries);
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

  // PX-2: раздел «Стиль общения» строится на данных о коммуникации, а не на всех
  // сводках с их темами и инсайтами (иначе модель пересказывает темы — кейс 9.9).
  // Сводки ниже выдуманные: имена, сюжеты и детали не из живого архива.
  describe('PX-2: вход и форма раздела «Стиль общения»', () => {
    const pxSummaries = [
      { documentId: 'px-1', summary: 'Ремонт в гараже и разговор с братом про крышу', tone: 'тревожный', themes: ['гараж'], insights: ['боюсь просить о помощи'], frequentWords: [], processedAt: 1 },
      { documentId: 'px-2', summary: 'Соревнование по жиму и запись в секцию', tone: 'спокойный', themes: ['секция'], insights: ['довожу начатое до конца'], frequentWords: [], processedAt: 2 },
      { documentId: 'px-3', summary: 'Поездка к тёте и разговор про старую машину', tone: 'усталый', themes: ['машина'], insights: ['откладываю трудный разговор'], frequentWords: [], processedAt: 3 },
    ];

    const stub = () => {
      summaryReads(pxSummaries);
      mockGetAllFromIndex.mockResolvedValue([]);
    };
    type ChatArg = { customSystemPrompt?: string; messages: Array<{ content: string }> };
    const calls = () => vi.mocked(AIService.chat).mock.calls.map(c => c[0] as unknown as ChatArg);
    const commCall = () => calls().find(c => c.customSystemPrompt === SYSTEM_TASK_PROMPTS.profileCommunication);

    it('вход раздела — метрики, тона и предпочтения; ни сути сводок, ни тем, ни инсайтов', async () => {
      stub();
      vi.mocked(AIService.chat).mockResolvedValue({ ok: true, text: 'Обращение на «ты», короткие ответы.' });

      await AIProfileService.generate();

      const content = commCall()!.messages[0]!.content;
      expect(content).toContain('Метрики стиля письма');
      expect(content).toContain('Тоны записей: тревожный, спокойный, усталый');
      for (const leak of ['Ремонт в гараже', 'гараж', 'секцию', 'крышу', 'боюсь просить о помощи', 'Суть:', 'Темы:', 'Запись 1:']) {
        expect(content, leak).not.toContain(leak);
      }
    });

    it('остальные четыре раздела остаются на прежнем входе', async () => {
      stub();
      vi.mocked(AIService.chat).mockResolvedValue({ ok: true, text: 'текст раздела' });

      await AIProfileService.generate();

      const others = calls().filter(c => c.customSystemPrompt !== SYSTEM_TASK_PROMPTS.profileCommunication);
      expect(others).toHaveLength(4);
      for (const c of others) {
        expect(c.messages[0]!.content).toContain('Ремонт в гараже');
        expect(c.messages[0]!.content).not.toContain('Тоны записей');
      }
    });

    it('плохая форма раздела — ровно один повтор, текст остаётся, в журнал идёт только длина', async () => {
      stub();
      vi.mocked(AIService.chat).mockImplementation(async (params) => ({
        ok: true,
        text: (params as ChatArg).customSystemPrompt === SYSTEM_TASK_PROMPTS.profileCommunication
          ? '### Темы\n- ремонт в гараже\n- секция'
          : 'текст раздела',
      }));

      const res = await AIProfileService.generate();

      expect(res.ok).toBe(true);
      // Фальсификация: без ретрая было бы 5 вызовов, со вторым ретраем — 7.
      expect(vi.mocked(AIService.chat)).toHaveBeenCalledTimes(6);
      const markdown = (res as { ok: true; markdown: string }).markdown;
      expect(markdown).toContain('### Темы');
      expect(mockReportError).toHaveBeenCalledTimes(1);
      const message = String((mockReportError.mock.calls[0]![0] as Error).message);
      expect(message).toMatch(/\d+ зн/);
      expect(message).not.toContain('гараж');
    });

    it('хорошая форма раздела — повтора нет', async () => {
      stub();
      vi.mocked(AIService.chat).mockResolvedValue({ ok: true, text: 'Обращение на «ты», женский род, короткие ответы без списков.' });

      await AIProfileService.generate();

      expect(vi.mocked(AIService.chat)).toHaveBeenCalledTimes(5);
      expect(mockReportError).not.toHaveBeenCalled();
    });
  });

  // PX-3: портреты прежних правил (до правила абстракции 2026-09-23) обслуживаются
  // до сих пор, потому что перегенерация идёт только по нажатию. Рядом с портретом
  // хранится версия промптов разделов; без неё портрет считается устаревшим.
  describe('PX-3: версия промптов у сохранённого портрета', () => {
    it('savePortrait пишет promptVersion', async () => {
      mockSetDoc.mockResolvedValue(undefined);

      await AIProfileService.savePortrait('# Портрет\n');

      const rec = mockPut.mock.calls.find(c => c[0] === 'aiPortrait')?.[1] as { promptVersion?: string };
      expect(rec.promptVersion).toMatch(/^[0-9a-f]{8}$/);
      expect(rec.promptVersion).toBe(portraitPromptsVersion());
    });

    it('запись без версии (портрет прежних правил) — устаревший', async () => {
      mockGet.mockResolvedValueOnce({ id: 'singleton', portrait: 'старый портрет', updatedAt: 1, generatedAtDelta: 3 });
      expect(await AIProfileService.isPortraitStale()).toBe(true);
    });

    it('версия совпадает — не устаревший', async () => {
      mockGet.mockResolvedValueOnce({ id: 'singleton', portrait: 'портрет', updatedAt: 1, generatedAtDelta: 3, promptVersion: portraitPromptsVersion() });
      expect(await AIProfileService.isPortraitStale()).toBe(false);
    });

    it('версия расходится — устаревший', async () => {
      mockGet.mockResolvedValueOnce({ id: 'singleton', portrait: 'портрет', updatedAt: 1, generatedAtDelta: 3, promptVersion: 'deadbeef' });
      expect(await AIProfileService.isPortraitStale()).toBe(true);
    });

    it('в локальном хранилище портрет без версии (облако после очистки устройства) — устаревший', async () => {
      mockGet.mockResolvedValueOnce(undefined);
      localStorage.setItem('ai_user_portrait_test-user-123', 'портрет из облака');
      expect(await AIProfileService.isPortraitStale()).toBe(true);
    });

    it('портрета нет вовсе — ничего не устарело', async () => {
      mockGet.mockResolvedValueOnce(undefined);
      expect(await AIProfileService.isPortraitStale()).toBe(false);
    });

    it('чтение записи упало — отказ пробрасывается, а не «свежий» (NB-12)', async () => {
      mockGet.mockRejectedValueOnce(new Error('db'));
      await expect(AIProfileService.isPortraitStale()).rejects.toThrow('db');
    });

    it('isPortraitStale не обращается к ИИ', async () => {
      mockGet.mockResolvedValueOnce({ id: 'singleton', portrait: 'портрет', updatedAt: 1, promptVersion: 'ffffffff' });
      await AIProfileService.isPortraitStale();
      expect(AIService.chat).not.toHaveBeenCalled();
    });
  });
});
