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

// X-4: «что я писал вчера?» отвечалось двухнедельной catch-up-сводкой без текстов
// заметок: ветка `recent` брала десять последних событий таймлайна и не имела
// окна по датам. Вчерашний день обязан быть окном, а заметки этого окна — в
// контексте.
const USER = 'u_x4_window';
const VECTOR = [0.9, 0.1, 0.0];
const DAY = 86_400_000;

const YESTERDAY_ID = 'doc_x4_yesterday';
const OLD_ID = 'doc_x4_old';
const YESTERDAY_CHUNK = 'Вчерашний текст про утренний бег и обещание себе';
const OLD_CHUNK = 'Текст десятидневной давности про тот же бег';

vi.mock('../../../../core/auth', () => ({ getCurrentUser: () => ({ uid: USER }) }));
vi.mock('../../../../shared/errors/reportError', () => ({ reportError: vi.fn() }));

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

async function seedDoc(id: string, title: string, content: string, lastSessionAt: number) {
  const db = await getLocalDb();
  await db.put('documents', {
    id, guestId: USER, title, currentVersion: 1,
    totalWords: 50, totalDuration: 0, sessionsCount: 1,
    firstSessionAt: lastSessionAt, lastSessionAt, tags: [],
  } as never);
  await AIEmbeddingService.save({
    documentId: id, vectors: [VECTOR], chunkTexts: [content],
    model: 'test', dim: 3, contentHash: `hash-${id}`, processedAt: lastSessionAt,
  });
}

describe('X-4: вопрос про вчера получает вчерашний день, а не две недели', () => {
  beforeEach(async () => {
    vi.restoreAllMocks();
    invalidateMiniSearchCache();
    setIndexingConsent(USER, 'granted');
    vi.spyOn(AIProfileService, 'getPortrait').mockResolvedValue(null);
    vi.spyOn(LocalVersionService, 'getLatestContent').mockImplementation(async (id: string) =>
      id === YESTERDAY_ID ? YESTERDAY_CHUNK : id === OLD_ID ? OLD_CHUNK : '');
    vi.spyOn(AIService, 'embed').mockResolvedValue({
      ok: true, vectors: [VECTOR], chunks: ['text'], model: 'test', dim: 3,
    });

    const db = await getLocalDb();
    for (const store of ['documents', 'versions', 'aiSummaries', 'aiEmbeddings', 'aiTimeline'] as const) {
      for (const rec of await db.getAll(store)) {
        const key = (rec as { id?: string; documentId?: string }).id
          ?? (rec as { documentId: string }).documentId!;
        await db.delete(store, key);
      }
    }

    const now = Date.now();
    await seedDoc(YESTERDAY_ID, 'Вчера', YESTERDAY_CHUNK, now - DAY);
    await seedDoc(OLD_ID, 'Десять дней назад', OLD_CHUNK, now - 10 * DAY);
  });

  it('в контексте только вчерашняя заметка, окно названо «вчера»', async () => {
    const ctx = await build('что я писал вчера?');
    const context = ctx.searchContext ?? '';

    expect(context).toContain(YESTERDAY_CHUNK);
    expect(context, 'двухнедельная давность не должна попадать в вчерашний ответ').not.toContain(OLD_CHUNK);
    expect(context).toContain('За вчера');
    expect(context).not.toContain('[Хронологическая сводка]');
  });

  it('пустое окно говорится вслух', async () => {
    const db = await getLocalDb();
    await db.delete('documents', YESTERDAY_ID);
    await db.delete('aiEmbeddings', YESTERDAY_ID);
    invalidateMiniSearchCache();

    const ctx = await build('что я писал вчера?');
    const context = ctx.searchContext ?? '';
    expect(context).toContain('записей нет');
    expect(context).not.toContain(OLD_CHUNK);
  });
});
