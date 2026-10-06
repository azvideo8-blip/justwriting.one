import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import 'fake-indexeddb/auto';
import { useAIChatContext } from '../aiChatContext';
import { AIService } from '../AIService';
import { AIEmbeddingService } from '../AIEmbeddingService';
import { getLocalDb } from '../../../../core/storage/localDb';
import { setIndexingConsent } from '../../../../core/ai/indexingConsent';
import { AIProfileService } from '../AIProfileService';
import { LocalVersionService } from '../../../../core/services/LocalVersionService';
import { invalidateMiniSearchCache } from '../../utils/noteRetriever';

// X-1: «привет» в новом диалоге получал ~3 100 знаков архива: сводку последних
// заметок, динамику настроения и три тела заметок из лайт-поиска. Светский ход
// обязан идти без них — и без векторизации реплики, потому что без вектора
// лайт-поиск не работает в принципе. Вопрос про архив при этом ничего не теряет.
const USER = 'u_x1_smalltalk';
const VECTOR = [0.9, 0.1, 0.0];

vi.mock('../../../../core/auth', () => ({
  getCurrentUser: () => ({ uid: USER }),
}));
vi.mock('../../../../shared/errors/reportError', () => ({ reportError: vi.fn() }));

const NOTE_ID = 'doc_x1_note';
const NOTE_CHUNK = 'Кусок заметки про утренние пробежки и дисциплину';

async function build(text: string) {
  const { result } = renderHook(() => useAIChatContext('editor'));
  return result.current.buildContext({
    text,
    attached: null,
    mood: undefined,
    messageHistory: [],
    isFirstTurn: true,
  });
}

describe('X-1: светский ход идёт без архива', () => {
  beforeEach(async () => {
    vi.restoreAllMocks();
    invalidateMiniSearchCache();
    setIndexingConsent(USER, 'granted');
    vi.spyOn(AIProfileService, 'getPortrait').mockResolvedValue(null);
    vi.spyOn(LocalVersionService, 'getLatestContent').mockResolvedValue(NOTE_CHUNK);
    vi.spyOn(AIService, 'embed').mockResolvedValue({
      ok: true, vectors: [VECTOR], chunks: ['text'], model: 'test', dim: 3,
    });

    const db = await getLocalDb();
    for (const store of ['documents', 'versions', 'aiSummaries', 'aiEmbeddings'] as const) {
      for (const rec of await db.getAll(store)) {
        await db.delete(store, (rec as { id?: string; documentId?: string }).id ?? (rec as { documentId: string }).documentId);
      }
    }
    const now = Date.now();
    await db.put('documents', {
      id: NOTE_ID, guestId: USER, title: 'Пробежки', currentVersion: 1,
      totalWords: 50, totalDuration: 0, sessionsCount: 1,
      firstSessionAt: now, lastSessionAt: now, tags: [],
    } as never);
    // Проактивному блоку нужен разбор последней заметки.
    await db.put('aiSummaries', { documentId: NOTE_ID, summary: 'Бег по утрам и что мешало', processedAt: now } as never);
    // Лайт-поиску — вектор с текстом куска.
    await AIEmbeddingService.save({
      documentId: NOTE_ID, vectors: [VECTOR], chunkTexts: [NOTE_CHUNK],
      model: 'test', dim: 3, contentHash: 'hash-x1', processedAt: now,
    });
  });

  it('«привет»: ни «недавнего», ни релевантных заметок, ни запроса на векторизацию', async () => {
    const embed = AIService.embed as unknown as ReturnType<typeof vi.fn>;
    const ctx = await build('привет');

    // База (851204bb) на этом же стенде даёт оба блока и один вызов embed.
    expect(ctx.searchContext ?? '').not.toContain('[Что ты писал недавно]');
    expect(ctx.searchContext ?? '').not.toContain('[Возможно релевантные заметки]');
    expect(ctx.memoryContext ?? '').not.toContain('[Что ты писал недавно]');
    expect(embed).not.toHaveBeenCalled();
  });

  it('вопрос про архив получает свой контекст целиком', async () => {
    const embed = AIService.embed as unknown as ReturnType<typeof vi.fn>;
    const ctx = await build('что я писал вчера?');

    expect(embed).toHaveBeenCalledTimes(1);
    // X-4: у «вчера» своё окно по датам, поэтому блок называется иначе, чем
    // двухнедельная catch-up-сводка.
    expect(ctx.searchContext ?? '').toContain('[Результаты поиска по хронологии]');

    const long = await build('расскажи, о чём была моя заметка про утренние пробежки');
    expect(long.searchContext ?? '').toContain(NOTE_CHUNK);
  });

  it('короткое сообщение о себе контекста не лишается', async () => {
    const ctx = await build('мне плохо');
    expect(ctx.searchContext ?? '').toContain('[Что ты писал недавно]');
    expect(ctx.searchContext ?? '').toContain(NOTE_CHUNK);
  });
});
