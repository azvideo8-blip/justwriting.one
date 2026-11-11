import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getLocalDb, type AIDocumentSummary, type AIProfileFacet, type LocalDocument } from '../../../../core/storage/localDb';
import { getCurrentUser } from '../../../../core/auth';
import { _resetAuthStateForTesting } from '../../../../core/auth/supabaseAuthProvider';
import { setIndexingConsent } from '../../../../core/ai/indexingConsent';
import { DataProvider } from '../../../../core/data';
import { invalidateEmbeddingIndexCache } from '../../../../core/services/embeddingIndexCache';
import { AIService } from '../AIService';
import { NoteAnalysisService } from '../NoteAnalysisService';
import { AISummaryService } from '../AISummaryService';
import { AIProfileFacetBuilder } from '../AIProfileFacetBuilder';
import { AIProfileFacetSummarizer } from '../AIProfileFacetSummarizer';
import { AIProfileService } from '../AIProfileService';
import { writeFacetStore } from '../../../../core/services/facetLock';
import { LocalVersionService } from '../../../../core/services/LocalVersionService';
import { indexDocument } from '../../utils/embeddingIndexer';
import { AICommitmentService } from '../AICommitmentService';

const auth = vi.hoisted(() => ({ callback: (_event: string, _session: unknown) => {} }));
vi.mock('../../../../core/supabase/client', () => ({ getSupabase: () => ({ auth: {
  onAuthStateChange: (callback: typeof auth.callback) => {
    auth.callback = callback;
    return { data: { subscription: { unsubscribe() {} } } };
  },
} }) }));
const uid = 'ap2-analysis-user';
const hidden = 'ap2-hidden';
const marker = 'AP2_ANALYSIS_PRIVATE';
const publicMarker = 'AP2_ANALYSIS_VISIBLE';
const now = Date.now();
const doc = (id: string, extra: Partial<LocalDocument> = {}): LocalDocument => ({
  id, uuid: `uuid-${id}`, guestId: uid, title: id, currentVersion: 1, totalWords: 40,
  totalDuration: 1, sessionsCount: 1, firstSessionAt: now, lastSessionAt: now, tags: [], ...extra,
});
const summary = (id: string): AIDocumentSummary => ({
  documentId: id, summary: id === hidden || id === 'missing' ? marker : publicMarker,
  tone: 'нейтральный', frequentWords: [], insights: [], themes: ['прогулка'],
  extractedFacts: ['синтетический факт'], processedAt: now,
});
const facet = (id: string, noteIds: string[]): AIProfileFacet => ({
  id, label: 'Синтетическая тема', summary: publicMarker, centroid: [1, 0], noteIds,
  noteCount: noteIds.length, firstAt: now, lastAt: now, updatedAt: now, buildId: 'test',
});
async function seed(id: string) {
  const db = await getLocalDb();
  await db.put('documents', doc(id));
  await db.put('versions', { id: `v-${id}`, documentId: id, version: 1, guestId: uid,
    content: `${id === hidden ? marker : publicMarker} синтетическая прогулка в парке для проверки анализа заметок.`,
    savedAt: now, sessionStartedAt: now, wordCount: 20, wordsAdded: 20, charsAdded: 100, duration: 1, wpm: 20 });
  await db.put('aiEmbeddings', { documentId: id, vectors: [[1, 0]], chunkTexts: [id === hidden ? marker : publicMarker],
    model: 'test', dim: 2, contentHash: 'synthetic', processedAt: now });
}
beforeEach(async () => {
  vi.restoreAllMocks();
  localStorage.clear();
  _resetAuthStateForTesting();
  getCurrentUser();
  auth.callback('SIGNED_IN', { user: { id: uid } });
  setIndexingConsent(uid, 'granted');
  const db = await getLocalDb();
  for (const store of ['documents', 'versions', 'aiSummaries', 'aiTimeline', 'aiEmbeddings', 'aiBeliefs',
    'aiChatMemory', 'aiCommitments', 'aiThemeLedger', 'lifeStory', 'aiProfileFacets', 'aiPortrait', 'aiMonthlyDigest', 'aiDomainVectors'] as const) await db.clear(store);
  invalidateEmbeddingIndexCache();
  for (const id of [hidden, 'visible-1', 'visible-2', 'visible-3']) await seed(id);
  vi.spyOn(DataProvider, 'deleteSummary').mockResolvedValue(undefined);
  vi.spyOn(DataProvider, 'deleteEmbedding').mockResolvedValue(undefined);
  vi.spyOn(AIService, 'embed').mockResolvedValue({ ok: true, vectors: [[1, 0]], chunks: ['синтетический фрагмент'], model: 'test', dim: 2 });
});
afterEach(() => { _resetAuthStateForTesting(); vi.restoreAllMocks(); });

describe('AP2-3: анализ не восстанавливает скрытые производные', () => {
  it.each(['excludedFromAI', 'trashedAt'] as const)('ответ summarize после %s и clear не записывается', async field => {
    const db = await getLocalDb();
    let release = (_value: Awaited<ReturnType<typeof AIService.summarize>>) => {};
    const response = new Promise<Awaited<ReturnType<typeof AIService.summarize>>>(resolve => { release = resolve; });
    const summarize = vi.spyOn(AIService, 'summarize').mockReturnValue(response);
    const analyzing = NoteAnalysisService.analyze(hidden);
    await vi.waitFor(() => expect(summarize).toHaveBeenCalledOnce());
    await db.put('documents', doc(hidden, field === 'trashedAt' ? { trashedAt: now } : { excludedFromAI: true }));
    await NoteAnalysisService.clear(hidden);
    release({ ok: true, summary: summary(hidden) });
    expect(await analyzing).toEqual({ ok: false, error: 'EXCLUDED' });
    expect(await db.get('aiSummaries', hidden)).toBeUndefined();
    expect(await db.get('aiTimeline', hidden)).toBeUndefined();
    expect(AIService.embed).not.toHaveBeenCalled();
  });

  it('сохранение сводки само отсекает скрытую заметку', async () => {
    const db = await getLocalDb();
    await db.put('documents', doc(hidden, { excludedFromAI: true }));
    await AISummaryService.save(summary(hidden));
    expect(await db.get('aiSummaries', hidden)).toBeUndefined();
    expect(await db.get('aiTimeline', hidden)).toBeUndefined();
  });

  it.each(['resummarizeDirty', 'summarizePending'] as const)('%s не передаёт остатки и старую затравку', async method => {
    const db = await getLocalDb();
    await db.put('documents', doc(hidden, { excludedFromAI: true }));
    await writeFacetStore(store => store.put({ ...facet('mixed', [hidden, 'visible-1']), dirty: true, pendingSummary: true, _excerptSeed: [marker] }));
    const summarize = vi.spyOn(AIService, 'summarizeFacet').mockResolvedValue({ ok: true, label: 'Тема', summary: 'Синтетический результат' });
    await AIProfileFacetSummarizer[method]();
    expect(summarize).toHaveBeenCalledOnce();
    expect(JSON.stringify(summarize.mock.calls)).toContain(publicMarker);
    expect(JSON.stringify(summarize.mock.calls)).not.toContain(marker);
  });

  // Приёмка 0.10.6: заметку скрыли посреди прохода пересказа граней — следующая
  // грань её фрагменты модели не несёт. Мутация: читать видимость один раз — красный.
  it.each(['resummarizeDirty', 'summarizePending'] as const)('%s перечитывает видимость перед каждой гранью', async method => {
    const db = await getLocalDb();
    await writeFacetStore(async store => {
      await store.put({ ...facet('a-first', ['visible-1']), dirty: true, pendingSummary: true });
      await store.put({ ...facet('b-second', [hidden, 'visible-2']), dirty: true, pendingSummary: true });
    });
    let calls = 0;
    const summarize = vi.spyOn(AIService, 'summarizeFacet').mockImplementation(async () => {
      calls++;
      if (calls === 1) await db.put('documents', doc(hidden, { excludedFromAI: true }));
      return { ok: true, label: 'Тема', summary: 'Синтетический результат' };
    });
    await AIProfileFacetSummarizer[method]();
    expect(summarize).toHaveBeenCalledTimes(2);
    expect(JSON.stringify(summarize.mock.calls[1])).not.toContain(marker);
  });

  it('строитель граней не сохраняет скрытые фрагменты в затравках', async () => {
    const db = await getLocalDb();
    await db.put('documents', doc(hidden, { excludedFromAI: true }));
    expect((await AIProfileFacetBuilder.build()).ok).toBe(true);
    const facets = await db.getAll('aiProfileFacets');
    expect(facets.length).toBeGreaterThan(0);
    expect(JSON.stringify(facets)).toContain(publicMarker);
    expect(JSON.stringify(facets)).not.toContain(marker);
    expect(facets.flatMap(f => f.noteIds)).not.toContain(hidden);
  });

  it('портрет фильтрует остатки сводок, тона и грани без документа', async () => {
    const db = await getLocalDb();
    await db.put('documents', doc(hidden, { excludedFromAI: true }));
    for (const id of [hidden, 'missing', 'visible-1', 'visible-2', 'visible-3']) await db.put('aiSummaries', summary(id));
    await writeFacetStore(async store => {
      for (let i = 0; i < 3; i++) await store.put({ ...facet(`orphan-${i}`, ['missing']), summary: marker });
    });
    const chat = vi.spyOn(AIService, 'chat').mockResolvedValue({ ok: true, text: 'Синтетический портрет.' });
    expect((await AIProfileService.generate()).ok).toBe(true);
    expect(chat).toHaveBeenCalled();
    expect(JSON.stringify(chat.mock.calls)).toContain(publicMarker);
    expect(JSON.stringify(chat.mock.calls)).not.toContain(marker);
  });

});

// Ревью AP2 (M3): векторы и обязательства тоже пишутся после вызова провайдера.
describe('AP2-3: векторы и обязательства скрытой посреди работы заметки', () => {
  const hide = async () => (await getLocalDb()).put('documents', doc(hidden, { excludedFromAI: true }));

  it('скрыли, пока читался текст, — провайдер текст не получает', async () => {
    const read = LocalVersionService.getLatestContent.bind(LocalVersionService);
    vi.spyOn(LocalVersionService, 'getLatestContent').mockImplementation(async id => { await hide(); return read(id); });
    expect(await indexDocument(hidden, true)).toBe('skip');
    expect(AIService.embed).not.toHaveBeenCalled();
  });

  it('скрыли, пока шёл вызов провайдера, — вектор и чанки не записываются', async () => {
    const db = await getLocalDb();
    await db.delete('aiEmbeddings', hidden);
    vi.mocked(AIService.embed).mockImplementation(async () => {
      await hide();
      return { ok: true, vectors: [[1, 0]], chunks: [marker], model: 'test', dim: 2 };
    });
    await indexDocument(hidden, true);
    expect(await db.get('aiEmbeddings', hidden)).toBeUndefined();
  });

  it('обязательства: после скрытия ни вызова провайдера, ни записи', async () => {
    vi.mocked(AIService.embed).mockImplementation(async () => {
      await hide();
      return { ok: true, vectors: [[1, 0]], chunks: [], model: 'test', dim: 2 };
    });
    await AICommitmentService.upsertCommitments(hidden, ['синтетический план', `${marker} второй план`], '2026-10-21');
    expect(AIService.embed).toHaveBeenCalledOnce();
    expect(JSON.stringify(vi.mocked(AIService.embed).mock.calls)).not.toContain(marker);
    expect(await (await getLocalDb()).getAll('aiCommitments')).toEqual([]);
  });

  it('обязательства: первое — дубль, второе после скрытия к провайдеру не уходит', async () => {
    const db = await getLocalDb();
    const seeded = { id: 'c-open', text: 'синтетический план', documentId: 'visible-1', createdAt: now,
      date: '2026-10-20', status: 'open' as const, vector: [1, 0] };
    await db.put('aiCommitments', seeded);
    vi.mocked(AIService.embed).mockImplementation(async () => {
      await hide();
      return { ok: true, vectors: [[1, 0]], chunks: [], model: 'test', dim: 2 };
    });
    await AICommitmentService.upsertCommitments(hidden, ['синтетический план', `${marker} второй план`], '2026-10-21');
    expect(AIService.embed).toHaveBeenCalledOnce();
    expect(await db.getAll('aiCommitments')).toEqual([seeded]);
  });
});
