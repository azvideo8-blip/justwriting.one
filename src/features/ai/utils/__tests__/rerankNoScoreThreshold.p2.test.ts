// П-2 (08.10.2026): мёртвый порог `RERANK_THRESHOLD = 0.88` удалён.
//
// Замер 08.10 на 116 запросах и 312 синтетических заметках: топ-1 косинус имеет
// медиану 0,564 и максимум 0,722 — за весь прогон ни один запрос не достиг 0,88,
// то есть ветка обхода реранка по «очень высокому сходству» была мертва и на qwen
// (тоже 0/116). Обходят реранк теперь только локальные доказательства: точное
// название и буквальные совпадения.
//
// Мутация, на которой тест краснеет: вернуть `topScore >= RERANK_THRESHOLD` в
// условие обхода (`searchNotes.ts`, `searchNotesMulti.ts`) — красный на
// «реранк вызван при топ-1 = 0,95» и на «константы больше нет».
import { describe, it, expect, vi, beforeEach } from 'vitest';
import 'fake-indexeddb/auto';
import { searchNotes } from '../noteRetriever';
import { searchNotesMulti } from '../retrieval/searchNotesMulti';
import * as retrievalTypes from '../retrieval/types';
import { AIService } from '../../services/AIService';
import { AIEmbeddingService } from '../../services/AIEmbeddingService';
import { getLocalDb } from '../../../../core/storage/localDb';
import { LocalVersionService } from '../../../../core/services/LocalVersionService';
import { setIndexingConsent } from '../../../../core/ai/indexingConsent';

vi.mock('../../../../shared/errors/reportError', () => ({ reportError: vi.fn() }));

const QUERY = 'зачем мне всё это ночью';
// косинус с [1,0,0] = 0,95 — выше старого порога 0,88
const STRONG = [0.95, 0.312249, 0];
const WEAK = [0.5, 0.866025, 0];

async function seed() {
  const db = await getLocalDb();
  await db.clear('documents');
  await db.clear('versions');
  await db.clear('aiSummaries');
  await db.clear('aiEmbeddings');
  for (const [id, title] of [['local_p2_1', 'Прогулка в парке'], ['local_p2_2', 'Список покупок']] as const) {
    await db.put('documents', {
      id, guestId: 'u1', title, currentVersion: 1, totalWords: 40, totalDuration: 0,
      sessionsCount: 1, firstSessionAt: 1000, lastSessionAt: 1000, tags: [],
    } as never);
  }
  vi.spyOn(LocalVersionService, 'getLatestContent').mockImplementation(async (id: string) =>
    id === 'local_p2_1' ? 'Ходили вдоль пруда, ветер с воды.' : 'Молоко, хлеб, свечи и батарейки.');
  vi.spyOn(AIEmbeddingService, 'getAll').mockResolvedValue([
    { documentId: 'local_p2_1', vectors: [STRONG], chunkTexts: ['Ходили вдоль пруда'], contentHash: 'h1', processedAt: 1, model: 'm', dim: 3 },
    { documentId: 'local_p2_2', vectors: [WEAK], chunkTexts: ['Молоко, хлеб'], contentHash: 'h2', processedAt: 1, model: 'm', dim: 3 },
  ] as never);
  vi.spyOn(AIService, 'embed').mockResolvedValue({ ok: true, vectors: [[1, 0, 0]] } as never);
}

describe('П-2: обход реранка без порога по косинусу', () => {
  beforeEach(async () => {
    vi.restoreAllMocks();
    setIndexingConsent('guest', 'granted');
    await seed();
  });

  it('константы порога больше нет в модуле retrieval/types', () => {
    expect(retrievalTypes).not.toHaveProperty('RERANK_THRESHOLD');
  });

  it('одиночный запрос: при топ-1 = 0,95 реранк вызывается, обхода нет', async () => {
    const rerank = vi.spyOn(AIService, 'rerank').mockResolvedValue({ ok: true, documentIds: ['local_p2_1', 'local_p2_2'] } as never);
    let meta: { bypassed: boolean; bypassReason?: string } | undefined;
    const notes = await searchNotes(QUERY, 5, { onRerankMeta: m => { meta = m; } });

    expect(rerank, 'реранк не вызван — мёртвый порог живой').toHaveBeenCalled();
    expect(meta?.bypassed).toBe(false);
    expect(meta?.bypassReason ?? null).not.toBe('score_threshold');
    expect(notes.length).toBeGreaterThan(0);
  });

  it('мульти-запрос: тот же контракт, обход только по локальным доказательствам', async () => {
    const rerank = vi.spyOn(AIService, 'rerank').mockResolvedValue({ ok: true, documentIds: ['local_p2_1', 'local_p2_2'] } as never);
    const res = await searchNotesMulti([QUERY], 5);
    expect(rerank, 'в мульти-пути порог остался').toHaveBeenCalled();
    expect(res.notes.length).toBeGreaterThan(0);
  });

  it('точное название по-прежнему обходит реранк', async () => {
    const rerank = vi.spyOn(AIService, 'rerank').mockResolvedValue({ ok: true, documentIds: [] } as never);
    let meta: { bypassed: boolean; bypassReason?: string } | undefined;
    await searchNotes('Список покупок', 5, { onRerankMeta: m => { meta = m; } });
    expect(rerank).not.toHaveBeenCalled();
    expect(meta?.bypassed).toBe(true);
    expect(meta?.bypassReason).toBe('exact_title');
  });
});
