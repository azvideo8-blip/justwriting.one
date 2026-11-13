// AN-1 (владелец 13.11, «закрой путь»): текст заметки уходит на векторы только
// после разбора. Раньше согласие на поиск по смыслу (indexPending) и «пересчитать
// всё» (reindexAll) строили векторы всем заметкам без разбора — и обещание
// «ИИ не видит заметку, пока вы её не разобрали» было неправдой.
// Мутации: убрать проверку сводки в indexDocument → красный (c);
// убрать фильтр в findStaleDocuments → красный (a).
import 'fake-indexeddb/auto';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { findStaleDocuments, indexDocument, indexPending, reindexAll } from '../embeddingIndexer';
import { AIService } from '../../services/AIService';
import { AIEmbeddingService } from '../../services/AIEmbeddingService';
import { LocalVersionService } from '../../../../core/services/LocalVersionService';
import { getLocalDb } from '../../../../core/storage/localDb';
import { setIndexingConsent } from '../../../../core/ai/indexingConsent';

vi.mock('../../../../shared/errors/reportError', () => ({ reportError: vi.fn() }));

const DONE = 'local_an1_analysed';
const RAW = 'local_an1_raw';

describe('AN-1: векторы — только у разобранных заметок', () => {
  let embedSpy: { mock: { calls: unknown[][] } };

  beforeEach(async () => {
    vi.restoreAllMocks();
    setIndexingConsent('guest', 'granted');
    const db = await getLocalDb();
    for (const s of ['documents', 'aiEmbeddings', 'aiSummaries'] as const) await db.clear(s);
    for (const id of [DONE, RAW]) {
      await db.put('documents', {
        id, guestId: 'u1', title: 'Т', currentVersion: 1, totalWords: 5, totalDuration: 0,
        sessionsCount: 1, firstSessionAt: 1000, lastSessionAt: 1000, tags: [],
      } as never);
    }
    await db.put('aiSummaries', { documentId: DONE, summary: 'суть', processedAt: 1 } as never);
    vi.spyOn(LocalVersionService, 'getLatestContent').mockImplementation(async (id: string) => `Текст заметки ${id}.`);
    vi.spyOn(AIEmbeddingService, 'getAll').mockResolvedValue([] as never);
    vi.spyOn(AIEmbeddingService, 'save').mockResolvedValue(undefined as never);
    embedSpy = vi.spyOn(AIService, 'embed').mockResolvedValue({
      ok: true, vectors: [[0.1, 0.2]], chunks: ['к'], model: 'm', dim: 2,
    } as never);
  });

  const sentTexts = (): string[] => embedSpy.mock.calls.map(c => JSON.stringify(c[0]));

  it('(a) неразобранная заметка не «ждёт вектора»', async () => {
    const stale = await findStaleDocuments();
    expect(stale).toContain(DONE);
    expect(stale).not.toContain(RAW);
  });

  it('(b) согласие на поиск: indexPending отправляет только разобранную', async () => {
    await indexPending();
    expect(sentTexts().some(t => t.includes(DONE))).toBe(true);
    expect(sentTexts().some(t => t.includes(RAW))).toBe(false);
  });

  it('(c) «пересчитать всё» и прямой вызов — неразобранная пропускается', async () => {
    await reindexAll();
    expect(await indexDocument(RAW, true)).toBe('skip');
    expect(sentTexts().some(t => t.includes(RAW))).toBe(false);
  });
});
