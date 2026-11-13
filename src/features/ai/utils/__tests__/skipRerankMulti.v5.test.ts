// V-5 (2026-10-09, план MIND: 0 новых вызовов LLM на горячем пути чата).
// Дополнительный поиск блока «что в записях говорит человек» (Q-9) идёт без
// облачного переранжирования. Флаг `skipRerank` обязан соблюдаться и при одном
// запросе (уходит в searchNotes), и при нескольких (свой реранк в searchNotesMulti).
//
// Мутация: убрать `opts?.skipRerank ||` из условия обхода в searchNotesMulti —
// красный «несколько запросов с skipRerank».
import { describe, it, expect, vi, beforeEach } from 'vitest';
import 'fake-indexeddb/auto';
import { searchNotesMulti } from '../retrieval/searchNotesMulti';
import { AIService } from '../../services/AIService';
import { AIEmbeddingService } from '../../services/AIEmbeddingService';
import { getLocalDb } from '../../../../core/storage/localDb';
import { LocalVersionService } from '../../../../core/services/LocalVersionService';
import { setIndexingConsent } from '../../../../core/ai/indexingConsent';
import { markAllAnalysed } from '../../../../test/utils/markAnalysed';

vi.mock('../../../../shared/errors/reportError', () => ({ reportError: vi.fn() }));

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
    await markAllAnalysed(db);
  }
  vi.spyOn(LocalVersionService, 'getLatestContent').mockImplementation(async (id: string) =>
    id === 'local_p2_1' ? 'Ходили вдоль пруда, ветер с воды.' : 'Молоко, хлеб, свечи и батарейки.');
  vi.spyOn(AIEmbeddingService, 'getAll').mockResolvedValue([
    { documentId: 'local_p2_1', vectors: [STRONG], chunkTexts: ['Ходили вдоль пруда'], contentHash: 'h1', processedAt: 1, model: 'm', dim: 3 },
    { documentId: 'local_p2_2', vectors: [WEAK], chunkTexts: ['Молоко, хлеб'], contentHash: 'h2', processedAt: 1, model: 'm', dim: 3 },
  ] as never);
  vi.spyOn(AIService, 'embed').mockResolvedValue({ ok: true, vectors: [[1, 0, 0]] } as never);
}

describe('V-5: вызывающий запрещает облачный реранк', () => {
  beforeEach(async () => {
    vi.restoreAllMocks();
    setIndexingConsent('guest', 'granted');
    await seed();
  });

  it('один запрос с skipRerank — реранк не вызывается', async () => {
    const rerank = vi.spyOn(AIService, 'rerank').mockResolvedValue({ ok: true, documentIds: ['local_p2_1'] } as never);
    const res = await searchNotesMulti(['что было у пруда ночью'], 5, { skipRerank: true });
    expect(rerank).not.toHaveBeenCalled();
    expect(res.notes.length).toBeGreaterThan(0);
  });

  it('несколько запросов с skipRerank — реранк не вызывается', async () => {
    const rerank = vi.spyOn(AIService, 'rerank').mockResolvedValue({ ok: true, documentIds: ['local_p2_1'] } as never);
    const res = await searchNotesMulti(['ветер с воды вечером', 'прогулка у пруда'], 5, { skipRerank: true });
    expect(rerank).not.toHaveBeenCalled();
    expect(res.notes.length).toBeGreaterThan(0);
  });

  it('без флага несколько запросов по-прежнему идут в реранк', async () => {
    const rerank = vi.spyOn(AIService, 'rerank').mockResolvedValue({ ok: true, documentIds: ['local_p2_1'] } as never);
    await searchNotesMulti(['тихий берег зачем', 'что ночью у воды'], 5);
    expect(rerank).toHaveBeenCalled();
  });
});
