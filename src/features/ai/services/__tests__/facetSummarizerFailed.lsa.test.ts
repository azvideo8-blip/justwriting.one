// 0.11.22: пересказ граней отказывал возвратом без счёта отказов — «Обновить
// профиль» говорил «обновлён». Теперь failed — грани, оставшиеся несвежими.
// Мутации: не считать failedCount (в обоих проходах) — красный; грань без
// выдержек засчитать отказом — красный КОНТРОЛЬ.
import { describe, it, expect, vi, beforeEach } from 'vitest';

const facets = vi.hoisted(() => ({ rows: [] as Record<string, unknown>[] }));
const db = { getAll: vi.fn(async () => facets.rows) };
vi.mock('../../../../core/storage/localDb', () => ({ getLocalDb: async () => db }));
vi.mock('../../../../core/services/facetLock', () => ({
  writeFacetStore: async <T>(fn: (store: { put: (f: unknown) => Promise<void> }) => Promise<T>) => fn({ put: async () => {} }),
}));
vi.mock('../../../../core/services/LocalStoreSyncService', () => ({ LocalStoreSyncService: { scheduleStoreSync: vi.fn() } }));
vi.mock('../../utils/retrieval/docSnapshot', () => ({ loadVisibleNoteKeys: async () => new Set(['n1']) }));
vi.mock('../AIEmbeddingService', () => ({ AIEmbeddingService: { getAll: async () => [{ documentId: 'n1', chunkTexts: ['синтетический фрагмент'] }] } }));
vi.mock('../AIBackgroundBudget', () => ({ AIBackgroundBudget: { canSpend: () => true, spend: vi.fn() } }));
const summarizeFacet = vi.hoisted(() => vi.fn());
vi.mock('../AIService', () => ({ AIService: { summarizeFacet } }));
vi.mock('../../../../shared/errors/reportError', () => ({ reportError: vi.fn() }));

import { AIProfileFacetSummarizer } from '../AIProfileFacetSummarizer';

describe('пересказ граней: отказы посчитаны', () => {
  beforeEach(() => { vi.clearAllMocks(); vi.useFakeTimers({ shouldAdvanceTime: true }); });

  it('несвежая грань, поставщик отказал — failed 1', async () => {
    facets.rows = [{ id: 'f1', label: 'тема', summary: 'старое', noteIds: ['n1'], dirty: true }];
    summarizeFacet.mockResolvedValue({ ok: false, error: 'UPSTREAM' });
    await expect(AIProfileFacetSummarizer.resummarizeDirty()).resolves.toEqual({ count: 0, failed: 1 });
  });

  it('новая грань, поставщик отказал — failed 1', async () => {
    facets.rows = [{ id: 'f2', label: 'тема', summary: '', noteIds: ['n1'], pendingSummary: true }];
    summarizeFacet.mockResolvedValue({ ok: false, error: 'UPSTREAM' });
    await expect(AIProfileFacetSummarizer.summarizePending()).resolves.toEqual({ done: 0, failed: 1 });
  });

  it('КОНТРОЛЬ: выдержек нет — не отказ', async () => {
    facets.rows = [{ id: 'f3', label: 'тема', summary: '', noteIds: ['n-нет'], pendingSummary: true }];
    await expect(AIProfileFacetSummarizer.summarizePending()).resolves.toEqual({ done: 0, failed: 0 });
    expect(summarizeFacet).not.toHaveBeenCalled();
  });
});
