// TR-9 (владелец 13.11): неразобранная заметка не попадает в разговор ни одним
// путём. «Разобрана» = есть строка в aiSummaries. Приложенная вручную заметка —
// исключение и идёт мимо этих путей (блоки хода), здесь не проверяется.
//
// Фикстура: DONE — разобрана; RAW — без разбора, но со СТАРЫМ вектором (построен
// до 0.11.13 или доехал из облака); RAW_NOVEC — без разбора и без вектора. У всех
// трёх в тексте одни и те же слова, имя и близкий вектор — отличает их только разбор.
//
// Мутации (каждая прогнана, красная — см. отчёт пакета):
//  1. docSnapshot.loadVisibleNoteKeys: убрать `!analysed.has(d.id)`        → (1), (2б), (6);
//  2. searchNotes: убрать `!analysed.has(doc.id)` из отбора векторов        → (2а);
//  3. searchNotesMulti: то же                                               → (2а, мульти);
//  4. fusion.loadNotes: убрать `!analysed.has(doc.id)`                      → (3);
//  5. liteRetrieval: убрать `!analysed.has(d.id)`                           → (4);
//  6. topicChronicle: убрать `!analysed.has(d.id)`                          → (5);
//  7. AIProfileFacetService.getAll: убрать `analysed.has(doc.id)`           → (7).
// Поиск по имени в ходе чата — nameUnanalysed.tr9.test.ts.
import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getLocalDb } from '../../../../core/storage/localDb';
import { writeFacetStore } from '../../../../core/services/facetLock';
import { setIndexingConsent } from '../../../../core/ai/indexingConsent';
import { LocalVersionService } from '../../../../core/services/LocalVersionService';
import { AIService } from '../../services/AIService';
import { AIEmbeddingService } from '../../services/AIEmbeddingService';
import { AIProfileFacetService } from '../../services/AIProfileFacetService';
import { buildLiteRetrievalBlock } from '../../services/chatContext/liteRetrieval';
import { buildTopicChronicleBlock } from '../../services/chatContext/topicChronicle';
import { invalidateMiniSearchCache, keywordSearch } from '../retrieval/indexCache';
import { loadNotes } from '../retrieval/fusion';
import { loadVisibleNoteKeys } from '../retrieval/docSnapshot';
import { searchNotes } from '../retrieval/searchNotes';
import { searchNotesMulti } from '../retrieval/searchNotesMulti';

vi.mock('../../../../shared/errors/reportError', () => ({ reportError: vi.fn() }));

const DONE = 'local_tr9_done';
const RAW = 'local_tr9_raw';
const RAW_NOVEC = 'local_tr9_raw_novec';
const TEXT: Record<string, string> = {
  [DONE]: 'Суббота, дача. Красили забор с Антоном. РАЗОБРАНА.',
  [RAW]: 'Воскресенье, дача. Антон привёз доски. НЕРАЗОБРАНА_С_ВЕКТОРОМ.',
  [RAW_NOVEC]: 'Понедельник, дача. Антон уехал. НЕРАЗОБРАНА_БЕЗ_ВЕКТОРА.',
};
const TURN = [1, 0, 0];
const near = [0.9, Math.sqrt(1 - 0.81), 0];
const day = (iso: string) => new Date(`${iso}T12:00:00`).getTime();
// Вектор неразобранной ближе к запросу, чем у разобранной: если бы он участвовал
// в поиске, он занял бы первое место (и единственный слот при maxResults = 1).
const EMB = [DONE, RAW].map(id => ({
  documentId: id, vectors: [id === RAW ? TURN : near], chunkTexts: [TEXT[id]!], contentHash: id, processedAt: 1, model: 'm', dim: 3,
}));

let contentReads: string[] = [];

beforeEach(async () => {
  vi.restoreAllMocks();
  setIndexingConsent('guest', 'granted');
  invalidateMiniSearchCache();
  contentReads = [];
  const db = await getLocalDb();
  for (const s of ['documents', 'versions', 'aiSummaries', 'aiEmbeddings', 'aiProfileFacets'] as const) await db.clear(s);
  let n = 0;
  for (const id of [DONE, RAW, RAW_NOVEC]) {
    n++;
    await db.put('documents', {
      id, guestId: 'u1', title: `Запись ${id}`, currentVersion: 1, totalWords: 9, totalDuration: 0, sessionsCount: 1,
      firstSessionAt: day(`2026-03-0${n}`), lastSessionAt: day(`2026-03-0${n}`), tags: [],
    } as never);
  }
  for (const e of EMB) await db.put('aiEmbeddings', e as never);
  await db.put('aiSummaries', {
    documentId: DONE, summary: '', tone: '', frequentWords: [], insights: [], themes: [], extractedFacts: [], processedAt: 1,
  } as never);
  vi.spyOn(LocalVersionService, 'getLatestContent').mockImplementation(async (id: string) => {
    contentReads.push(id);
    return TEXT[id] ?? '';
  });
  vi.spyOn(AIEmbeddingService, 'getAll').mockResolvedValue(EMB as never);
  vi.spyOn(AIEmbeddingService, 'get').mockImplementation(async (id: string) => EMB.find(e => e.documentId === id) as never);
  vi.spyOn(AIService, 'embed').mockResolvedValue({ ok: true, vectors: [TURN] } as never);
  vi.spyOn(AIService, 'rerank').mockResolvedValue({ ok: false, error: 'HARNESS_NO_RERANK' } as never);
});

const ids = (notes: { documentId: string }[]) => notes.map(n => n.documentId);

describe('TR-9: в разговор — только разобранные заметки', () => {
  it('(1) поиск по словам находит разобранную и не находит неразобранные', async () => {
    const found = (await keywordSearch('дача', 10)).map(r => r.id);
    expect(found).toContain(DONE);
    expect(found).not.toContain(RAW);
    expect(found).not.toContain(RAW_NOVEC);
  });

  // Запрос без общих слов с заметками: остаётся только путь «по смыслу».
  it.each([
    ['одиночный', () => searchNotes('qqqwww', 1, { queryVector: TURN, skipRerank: true })],
    ['мульти', async () => (await searchNotesMulti(['qqqwww', 'zzzxxx'], 1, { queryVector: TURN, skipRerank: true })).notes],
  ] as const)('(2а) поиск по смыслу (%s): старый вектор неразобранной не участвует и не занимает место', async (_name, run) => {
    const notes = await run();
    // Единственное место выдачи — у разобранной, хотя вектор неразобранной ближе.
    // skipRerank: без него слот на этом шаге не виден — карточки переранжирования
    // отсеивает другой рубеж (`loadVisibleNoteKeys`).
    expect(ids(notes)).toEqual([DONE]);
    const sent = JSON.stringify(vi.mocked(AIService.rerank).mock.calls);
    expect(sent).not.toContain('НЕРАЗОБРАНА');
  });

  it('(2б) без согласия на поиск по смыслу путь по словам тоже отдаёт только разобранную', async () => {
    setIndexingConsent('guest', 'refused');
    const notes = await searchNotes('дача Антон', 5);
    expect(ids(notes)).toEqual([DONE]);
    expect(JSON.stringify(notes)).not.toContain('НЕРАЗОБРАНА');
  });

  it('(3) загрузка выдачи не читает текст неразобранной, даже если её id пришёл', async () => {
    const notes = await loadNotes([RAW, RAW_NOVEC, DONE], new Map([[RAW, 1], [RAW_NOVEC, 1], [DONE, 1]]));
    expect(ids(notes)).toEqual([DONE]);
    expect(contentReads).toEqual([DONE]);
  });

  it('(4) лёгкий поиск: кусок неразобранной заметки в блок не идёт', async () => {
    const injected: string[] = [];
    const block = await buildLiteRetrievalBlock({ turnEmb: TURN, db: await getLocalDb(), minTime: undefined, maxTime: undefined, injectedDocumentIds: injected });
    expect(injected).toEqual([DONE]);
    expect(block).toContain('РАЗОБРАНА');
    expect(block).not.toContain('НЕРАЗОБРАНА');
  });

  it('(5) подборка по вопросу: неразобранная не попадает ни по вектору, ни по имени', async () => {
    const injected: string[] = [];
    const r = await buildTopicChronicleBlock({
      text: 'что я писала про Антона', turnEmb: TURN, db: await getLocalDb(), minTime: undefined, maxTime: undefined,
      performedFullSearch: false, injectedDocumentIds: injected, nameRegexes: [/Антон/],
    });
    expect(injected).toEqual([DONE]);
    expect(r!.block).not.toContain('НЕРАЗОБРАНА');
  });

  it('(6) «видимые ИИ» заметки — только разобранные (отсюда читают грани и производные)', async () => {
    const keys = await loadVisibleNoteKeys();
    expect(keys.has(DONE)).toBe(true);
    expect(keys.has(RAW)).toBe(false);
    expect(keys.has(RAW_NOVEC)).toBe(false);
  });

  it('(7) грань, собранная когда-то и по неразобранной заметке, не отдаётся', async () => {
    const facet = (id: string, noteIds: string[]) => ({
      id, label: id, summary: `пересказ ${id}`, centroid: TURN, noteIds, noteCount: noteIds.length, firstAt: 1, lastAt: 2,
    });
    await writeFacetStore(async store => {
      await store.put(facet('clean', [DONE]) as never);
      await store.put(facet('mixed', [DONE, RAW]) as never);
    });
    expect((await AIProfileFacetService.getAll()).map(f => f.id)).toEqual(['clean']);
  });

  it('разбор появился — заметка сразу участвует; разбор удалили — снова нет', async () => {
    const db = await getLocalDb();
    await db.put('aiSummaries', { documentId: RAW, summary: '', processedAt: 1 } as never);
    expect((await keywordSearch('дача', 10)).map(r => r.id)).toContain(RAW);
    expect(ids(await searchNotes('qqqwww', 5, { queryVector: TURN }))).toContain(RAW);
    await db.delete('aiSummaries', RAW);
    expect((await keywordSearch('дача', 10)).map(r => r.id)).not.toContain(RAW);
    expect(ids(await searchNotes('qqqwww', 5, { queryVector: TURN }))).not.toContain(RAW);
  });
});
