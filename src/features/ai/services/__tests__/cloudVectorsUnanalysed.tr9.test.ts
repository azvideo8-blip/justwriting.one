// TR-9: облачные векторы неразобранных заметок (записаны до 0.11.13) владелец
// решил пока не трогать. Этот тест подтверждает, что они безвредны: догрузка из
// облака привозит такой вектор на устройство, но поиск его не берёт, пересчёт не
// запускается, а после разбора заметки вектор работает сразу, без нового вызова ИИ.
//
// Настоящие AIRestoreService, embeddingIndexer и поиск на fake-indexeddb; замокано
// только облако (как в vectorRestoreFromCloud.p6).
//
// Мутации (прогнаны):
//  1. searchNotes: убрать `!analysed.has(doc.id)` из отбора векторов → красный («не занимает место»);
//  2. docSnapshot.loadVisibleNoteKeys: убрать `!analysed.has(d.id)` → красный («поиск по словам»);
//  3. fusion.loadNotes: убрать `!analysed.has(doc.id)` → здесь зелёный: вектор отсеян
//     раньше, в отборе. Сам рубеж проверяет analysedOnly.tr9, тест (3).
import { describe, it, expect, vi, beforeEach } from 'vitest';
import 'fake-indexeddb/auto';

vi.mock('../../../../shared/errors/reportError', () => ({ reportError: vi.fn() }));

const getUserEmbeddingsPaginated = vi.fn();
const fallback = vi.fn(async () => undefined);
vi.mock('../../../../core/data', () => ({
  DataProvider: new Proxy({
    getUserSummaries: async () => [],
    getLocalStoreRecords: async () => [],
    getUserEmbeddingsPaginated: (...a: unknown[]) => getUserEmbeddingsPaginated(...a),
  } as Record<string, unknown>, {
    get: (target, prop: string) => (prop in target ? target[prop] : fallback),
  }),
}));

import { getLocalDb } from '../../../../core/storage/localDb';
import { AIService } from '../AIService';
import { restoreAIDataFromCloud } from '../AIRestoreService';
import {
  findStaleDocuments, indexPending, CURRENT_EMBED_MODEL, CURRENT_EMBED_DIM, CURRENT_EMBED_SCHEMA, sha256Hex,
} from '../../utils/embeddingIndexer';
import { setIndexingConsent } from '../../../../core/ai/indexingConsent';
import { invalidateMiniSearchCache, keywordSearch } from '../../utils/retrieval/indexCache';
import { searchNotes } from '../../utils/retrieval/searchNotes';

const UID = 'guest';
const DONE = 'local_cv_done';
const RAW = 'local_cv_raw';
const TEXT: Record<string, string> = {
  [DONE]: 'Суббота, дача, красили забор. Разобранная запись.',
  [RAW]: 'Воскресенье, дача, привезли доски. Запись без разбора.',
};
// Запрос совпадает с вектором НЕРАЗОБРАННОЙ: участвуй он в поиске — был бы первым.
const QUERY = Array.from({ length: CURRENT_EMBED_DIM }, (_, i) => (i % 7) / 10);
const OTHER = Array.from({ length: CURRENT_EMBED_DIM }, (_, i) => (i % 5) / 10 + 0.05);

let embedCalls = 0;

beforeEach(async () => {
  vi.restoreAllMocks();
  vi.clearAllMocks();
  localStorage.clear();
  setIndexingConsent(UID, 'granted');
  invalidateMiniSearchCache();
  embedCalls = 0;
  vi.spyOn(AIService, 'embed').mockImplementation(async () => {
    embedCalls += 1;
    return { ok: true, vectors: [QUERY], chunks: ['кусок'], model: CURRENT_EMBED_MODEL, dim: CURRENT_EMBED_DIM } as never;
  });
  const db = await getLocalDb();
  for (const s of ['documents', 'versions', 'aiEmbeddings', 'aiSummaries'] as const) await db.clear(s);
  let n = 0;
  for (const id of [DONE, RAW]) {
    n++;
    await db.put('documents', {
      id, uuid: `uuid-${id}`, guestId: UID, title: `Запись ${n}`, currentVersion: 1, totalWords: 8,
      totalDuration: 0, sessionsCount: 1, firstSessionAt: 1000 + n, lastSessionAt: 1000 + n, tags: [],
    } as never);
    await db.put('versions', {
      id: `${id}_v1`, documentId: id, guestId: UID, version: 1, content: TEXT[id]!,
      wordCount: 8, wordsAdded: 8, charsAdded: 55, duration: 0, wpm: 0, createdAt: 1000,
    } as never);
  }
  await db.put('aiSummaries', {
    documentId: DONE, summary: '', tone: '', frequentWords: [], insights: [], themes: [], extractedFacts: [], processedAt: 1,
  } as never);
  // В облаке — векторы обеих заметок, как их записала версия до 0.11.13.
  const items: Record<string, unknown>[] = [];
  for (const id of [DONE, RAW]) {
    items.push({
      id: `uuid-${id}`, documentId: id, documentUuid: `uuid-${id}`,
      vectorsJson: JSON.stringify([id === RAW ? QUERY : OTHER]), chunkTextsJson: JSON.stringify([TEXT[id]]),
      model: CURRENT_EMBED_MODEL, dim: CURRENT_EMBED_DIM,
      contentHash: await sha256Hex(TEXT[id]!), processedAt: 5000, schemaV: CURRENT_EMBED_SCHEMA, updatedAt: 5000,
    });
  }
  getUserEmbeddingsPaginated.mockImplementation(async () => ({ items: items as never, nextCursorId: undefined, readCount: items.length }));
});

const ids = (notes: { documentId: string }[]) => notes.map(n => n.documentId);

describe('TR-9: облачный вектор неразобранной заметки безвреден', () => {
  it('догрузка его привозит, но поиск не берёт и пересчёт не запускается; после разбора работает сразу', async () => {
    const res = await restoreAIDataFromCloud(UID);
    const db = await getLocalDb();
    // Контроль: вектор неразобранной действительно доехал — иначе тест ничего не проверяет.
    expect(res.embeddings).toBe(2);
    expect(await db.get('aiEmbeddings', RAW), 'вектор неразобранной не доехал из облака').toBeDefined();

    // Поиск по смыслу: не занимает место (единственный слот — у разобранной)…
    expect(ids(await searchNotes('qqqwww', 1, { queryVector: QUERY, skipRerank: true })), 'не занимает место').toEqual([DONE]);
    // …и в выдаче только разобранная.
    expect(ids(await searchNotes('qqqwww', 5, { queryVector: QUERY, skipRerank: true })), 'в выдаче только разобранная').toEqual([DONE]);
    // Поиск по словам.
    expect((await keywordSearch('дача', 10, UID)).map(r => r.id), 'поиск по словам').toEqual([DONE]);

    // Пересчёт: неразобранная не «ждёт вектора», ИИ не вызывается.
    expect(await findStaleDocuments()).toEqual([]);
    await indexPending();
    expect(embedCalls).toBe(0);

    // Человек разобрал заметку — старый вектор работает сразу, без нового вызова ИИ.
    await db.put('aiSummaries', { documentId: RAW, summary: '', processedAt: 2 } as never);
    expect(ids(await searchNotes('qqqwww', 1, { queryVector: QUERY, skipRerank: true }))).toEqual([RAW]);
    expect(embedCalls).toBe(0);
  });
});
