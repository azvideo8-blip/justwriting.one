import { describe, it, expect, vi, beforeEach } from 'vitest';
import 'fake-indexeddb/auto';
import { findStaleDocuments, indexDocument } from '../embeddingIndexer';
import { AIService } from '../../services/AIService';
import { AIEmbeddingService } from '../../services/AIEmbeddingService';
import { LocalVersionService } from '../../../../core/services/LocalVersionService';
import { getLocalDb } from '../../../../core/storage/localDb';
import { setIndexingConsent } from '../../../../core/ai/indexingConsent';

// D-1: заметки «Не показывать ИИ» и заметки в корзине не должны попадать на
// построение векторов — их текст уходит провайдеру, что прямо противоречит
// обещанию окна согласия на поиск по смыслу.
vi.mock('../../../../shared/errors/reportError', () => ({ reportError: vi.fn() }));

describe('embeddingIndexer excludes AI-hidden and trashed notes (D-1)', () => {
  const NORMAL_ID = 'local_visible_note';
  const HIDDEN_ID = 'local_hidden_note';
  const TRASHED_ID = 'local_trashed_note';

  const CONTENTS: Record<string, string> = {
    [NORMAL_ID]: 'Обычная заметка про маршрут выходного дня.',
    [HIDDEN_ID]: 'Личные переживания, скрытые от ИИ.',
    [TRASHED_ID]: 'Заметка, удалённая в корзину.',
  };

  beforeEach(async () => {
    vi.restoreAllMocks();
    setIndexingConsent('guest', 'granted');
    setIndexingConsent('u1', 'granted');

    const db = await getLocalDb();
    for (const store of ['documents', 'aiEmbeddings'] as const) {
      const all = await db.getAll(store);
      for (const rec of all) {
        const key = (rec as { id?: string; documentId?: string }).id
          ?? (rec as { documentId: string }).documentId!;
        await db.delete(store, key as never);
      }
    }

    const put = (id: string, extra: Record<string, unknown> = {}) => db.put('documents', {
      id,
      guestId: 'u1',
      title: 'Тест',
      currentVersion: 1,
      totalWords: 6,
      totalDuration: 0,
      sessionsCount: 1,
      firstSessionAt: 1000,
      lastSessionAt: 1000,
      tags: [],
      ...extra,
    } as never);

    await put(NORMAL_ID, { excludedFromAI: false });
    await put(HIDDEN_ID, { excludedFromAI: true });
    await put(TRASHED_ID, { excludedFromAI: false, trashedAt: Date.now() });

    vi.spyOn(LocalVersionService, 'getLatestContent').mockImplementation(async (id: string) => CONTENTS[id] ?? '');
    vi.spyOn(AIEmbeddingService, 'getAll').mockResolvedValue([] as never);
    vi.spyOn(AIEmbeddingService, 'save').mockResolvedValue(undefined as never);
    vi.spyOn(AIService, 'embed').mockResolvedValue({
      ok: true,
      vectors: [[0.1, 0.2]],
      chunks: [CONTENTS[NORMAL_ID]!],
      model: 'test-model',
      dim: 2,
    } as never);
  });

  it('findStaleDocuments skips hidden and trashed notes', async () => {
    const stale = await findStaleDocuments();
    expect(stale).toContain(NORMAL_ID);
    expect(stale).not.toContain(HIDDEN_ID);
    expect(stale).not.toContain(TRASHED_ID);
  });

  it('indexDocument returns skip for a hidden note without calling embed', async () => {
    await expect(indexDocument(HIDDEN_ID)).resolves.toBe('skip');
    expect(AIService.embed).not.toHaveBeenCalled();
    expect(AIEmbeddingService.save).not.toHaveBeenCalled();
  });

  it('indexDocument returns skip for a trashed note without calling embed', async () => {
    await expect(indexDocument(TRASHED_ID)).resolves.toBe('skip');
    expect(AIService.embed).not.toHaveBeenCalled();
  });

  it('force re-index does not embed a hidden note either', async () => {
    await expect(indexDocument(HIDDEN_ID, true)).resolves.toBe('skip');
    expect(AIService.embed).not.toHaveBeenCalled();
  });

  it('still indexes a visible note', async () => {
    await expect(indexDocument(NORMAL_ID)).resolves.toBe('ok');
    expect(AIService.embed).toHaveBeenCalledWith({ content: CONTENTS[NORMAL_ID] });
  });

  it('a note that no longer exists is skipped', async () => {
    await expect(indexDocument('local_missing_note')).resolves.toBe('skip');
    expect(AIService.embed).not.toHaveBeenCalled();
  });
});
