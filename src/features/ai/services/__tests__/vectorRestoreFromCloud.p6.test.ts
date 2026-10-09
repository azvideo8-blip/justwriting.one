// П-6 (замер 08.10.2026): новое устройство догружает векторы из облака, а не
// пересчитывает весь архив через ИИ.
//
// Воспроизведение `harness/c8.harness.ts` (подозрение 6 / C-8) на продуктовых
// модулях: AIRestoreService, embeddingIndexer, NoteAnalysisService — с настоящей
// IndexedDB (fake-indexeddb); замокано только облако.
//
// На базе (до П-6) красные: а), в), г), д) и тест про занятый чат — без
// флага-кнопки векторы не приезжали вовсе, `indexPending` пересчитывал архив, а
// разбор заметки всегда переписывал свежий вектор.
//
// Мутация из тикета — вернуть условие флага (`if (isEmbeddingRestoreRequested…)`
// вместо `forced || await shouldAutoDownloadVectors(…)`): а) красный.
//
// В-2 (ревью 08.10.2026): курсор переступает только обработанную страницу.
// Мутация — вернуть `setEmbeddingRestoreCursor` до `consumeEmbeddingPage`:
// «В-2» и д) красные.
//
// В-1 (ревью 08.10.2026): догрузка продолжается каждым фоновым проходом, потолок
// 300 страницами по 50, и закрывается через сутки «в пути» либо три прохода без
// продвижения курсора. Красные на 08d10343: б), в) и четыре теста В-1.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import 'fake-indexeddb/auto';

vi.mock('../../../../shared/errors/reportError', () => ({ reportError: vi.fn() }));

const getUserEmbeddingsPaginated = vi.fn();
const fallback = vi.fn(async () => undefined);
const getUserSummaries = vi.fn();
const getLocalStoreRecords = vi.fn();

// Облако в этих тестах — три метода, остальное не вызывается; прокладка на
// неизвестные нужна потому, что модуль `core/data` импортируют и сервисы, и
// сам AIEmbeddingService (выгрузка векторов).
vi.mock('../../../../core/data', () => ({
  DataProvider: new Proxy({
    getUserSummaries: (...a: unknown[]) => getUserSummaries(...a),
    getLocalStoreRecords: (...a: unknown[]) => getLocalStoreRecords(...a),
    getUserEmbeddingsPaginated: (...a: unknown[]) => getUserEmbeddingsPaginated(...a),
  } as Record<string, unknown>, {
    get: (target, prop: string) => (prop in target ? target[prop] : fallback),
  }),
}));

import { getLocalDb } from '../../../../core/storage/localDb';
import { LocalVersionService } from '../../../../core/services/LocalVersionService';
import { AIService } from '../AIService';
import { NoteAnalysisService } from '../NoteAnalysisService';
import { restoreAIDataFromCloud, requestEmbeddingRestore, continueEmbeddingDownload } from '../AIRestoreService';
import {
  findStaleDocuments, indexPending, isEmbeddingFresh,
  CURRENT_EMBED_MODEL, CURRENT_EMBED_DIM, CURRENT_EMBED_SCHEMA, sha256Hex,
} from '../../utils/embeddingIndexer';
import { setIndexingConsent } from '../../../../core/ai/indexingConsent';
import {
  isEmbeddingRestoreDone, getEmbeddingRestoreCursor, setEmbeddingRestoreCursor,
  markEmbeddingRestoreStarted, isEmbeddingDownloadPending,
} from '../embeddingRestoreState';
import { useAIStageStore } from '../../store/useAIStageStore';

const UID = 'guest'; // getCurrentUser() в тесте = null → все пути берут 'guest' и одну базу
const PAGE = 50;     // страница догрузки внутри AIRestoreService (В-1)
const MAX_RUN = 300; // потолок записей на проход (В-1)

const textOf = (i: number) => `Текст заметки номер ${i}, достаточно длинный для индексации.`;
const vec = () => Array.from({ length: CURRENT_EMBED_DIM }, (_, i) => (i % 7) / 10);

async function seedNotes(n: number) {
  const db = await getLocalDb();
  for (const s of ['documents', 'versions', 'aiEmbeddings', 'aiSummaries'] as const) await db.clear(s);
  for (let i = 0; i < n; i++) {
    const id = `local_n${i}`;
    await db.put('documents', {
      id, uuid: `uuid-${i}`, guestId: UID, title: `Заметка ${i}`, currentVersion: 1, totalWords: 8,
      totalDuration: 0, sessionsCount: 1, firstSessionAt: 1000 + i, lastSessionAt: 1000 + i, tags: [],
    } as never);
    await db.put('versions', {
      id: `${id}_v1`, documentId: id, guestId: UID, version: 1, content: textOf(i),
      wordCount: 8, wordsAdded: 8, charsAdded: 55, duration: 0, wpm: 0, createdAt: 1000,
    } as never);
  }
}

/** Облачный индекс: запись на заметку, хэш — от того же текста, что лежит здесь. */
async function cloudEmbeddings(count: number) {
  const items: Record<string, unknown>[] = [];
  for (let i = 0; i < count; i++) {
    items.push({
      id: `uuid-${i}`, documentId: `local_n${i}`, documentUuid: `uuid-${i}`,
      vectorsJson: JSON.stringify([vec()]), chunkTextsJson: JSON.stringify(['кусок']),
      model: CURRENT_EMBED_MODEL, dim: CURRENT_EMBED_DIM,
      contentHash: await sha256Hex(textOf(i)), processedAt: 5000, schemaV: CURRENT_EMBED_SCHEMA, updatedAt: 5000,
    });
  }
  return items;
}

/** Постраничная выдача: курсор = смещение в списке. `failOnPage` роняет страницу. */
function mockCloud(items: Record<string, unknown>[], failOnPage?: number) {
  getUserSummaries.mockResolvedValue([] as never);
  getLocalStoreRecords.mockResolvedValue([] as never);
  let served = 0;
  getUserEmbeddingsPaginated.mockImplementation(async (_uid: string, limit: number, cursor?: string) => {
    served += 1;
    if (failOnPage === served) throw new Error('OFFLINE');
    const from = cursor ? Number(cursor) : 0;
    const slice = items.slice(from, from + limit);
    return {
      items: slice as never,
      nextCursorId: from + limit < items.length ? String(from + limit) : undefined,
      readCount: slice.length,
    };
  });
}

/** Добавить заметок, не трогая уже привезённые векторы. */
async function seedNotesKeepingVectors(total: number) {
  const db = await getLocalDb();
  for (let i = (await db.count('documents')); i < total; i++) {
    const id = `local_n${i}`;
    await db.put('documents', {
      id, uuid: `uuid-${i}`, guestId: UID, title: `Заметка ${i}`, currentVersion: 1, totalWords: 8,
      totalDuration: 0, sessionsCount: 1, firstSessionAt: 1000 + i, lastSessionAt: 1000 + i, tags: [],
    } as never);
    await db.put('versions', {
      id: `${id}_v1`, documentId: id, guestId: UID, version: 1, content: textOf(i),
      wordCount: 8, wordsAdded: 8, charsAdded: 55, duration: 0, wpm: 0, createdAt: 1000,
    } as never);
  }
}

const cursors = () => getUserEmbeddingsPaginated.mock.calls.map(c => c[2] as string | undefined);

describe('П-6: догрузка векторов из облака', () => {
  let embedCalls = 0;

  beforeEach(async () => {
    vi.restoreAllMocks();
    vi.clearAllMocks();
    localStorage.clear();
    setIndexingConsent(UID, 'granted');
    useAIStageStore.getState().setStage(null);
    embedCalls = 0;
    vi.spyOn(AIService, 'embed').mockImplementation(async () => {
      embedCalls += 1;
      return { ok: true, vectors: [vec()], chunks: ['кусок'], model: CURRENT_EMBED_MODEL, dim: CURRENT_EMBED_DIM } as never;
    });
  });

  it('а) полное восстановление без флага-кнопки приносит векторы, и они не считаются устаревшими', async () => {
    mockCloud(await cloudEmbeddings(12));
    await seedNotes(12);

    const res = await restoreAIDataFromCloud(UID);

    expect(res.embeddings).toBe(12);
    expect(await findStaleDocuments()).toEqual([]);
    expect(embedCalls, 'векторизация через ИИ не нужна, если вектор лежит в облаке').toBe(0);
  });

  it('б) проход упирается в потолок, фоновое продолжение догружает остаток, после «готово» догрузка не повторяется', async () => {
    mockCloud(await cloudEmbeddings(MAX_RUN + 105));
    await seedNotes(MAX_RUN + 105);

    const first = await restoreAIDataFromCloud(UID);
    expect(first.embeddings, 'потолок за проход').toBe(MAX_RUN);
    expect(cursors().slice(0, 2)).toEqual([undefined, String(PAGE)]);

    const mark = getUserEmbeddingsPaginated.mock.calls.length;
    const second = await continueEmbeddingDownload(UID);
    expect(second.embeddings).toBe(105);
    expect(cursors()[mark], 'продолжение началось бы с нуля').toBe(String(MAX_RUN));
    expect(isEmbeddingRestoreDone(UID), 'исчерпанный курсор обязан закрыть догрузку').toBe(true);

    const before = getUserEmbeddingsPaginated.mock.calls.length;
    await continueEmbeddingDownload(UID);
    await restoreAIDataFromCloud(UID);
    expect(getUserEmbeddingsPaginated.mock.calls.length, 'после «готово» догрузка не повторяется').toBe(before);
  });

  it('в) пока догрузка не закончена, indexPending не пересчитывает заметки без локального вектора', async () => {
    mockCloud([]);
    await seedNotes(12);
    // Догрузка начата и не дошла: векторы этих заметок ещё не привезены.
    markEmbeddingRestoreStarted(UID);
    expect(isEmbeddingDownloadPending(UID)).toBe(true);

    const run = await indexPending();
    expect(run.ok).toBe(0);
    expect(embedCalls, 'ждущие догрузки заметки не должны векторизоваться').toBe(0);

    // …а когда догрузка дошла до конца, остаток пересчитывается: в облаке его нет.
    await continueEmbeddingDownload(UID);
    expect(isEmbeddingRestoreDone(UID)).toBe(true);
    const after = await indexPending();
    expect(after.ok).toBe(12);
    expect(embedCalls).toBe(12);
  });

  it('г) разбор заметки со свежим вектором не вызывает векторизацию', async () => {
    await seedNotes(1);
    const db = await getLocalDb();
    await db.put('aiEmbeddings', {
      documentId: 'local_n0', vectors: [vec()], chunkTexts: ['кусок'], model: CURRENT_EMBED_MODEL,
      dim: CURRENT_EMBED_DIM, contentHash: await sha256Hex(textOf(0)), processedAt: 5000, schemaV: CURRENT_EMBED_SCHEMA,
    } as never);
    expect(isEmbeddingFresh(await db.get('aiEmbeddings', 'local_n0') as never)).toBe(true);
    vi.spyOn(AIService, 'summarize').mockResolvedValue({
      ok: true,
      summary: { tone: 'спокойный', themes: [], insights: [], extractedFacts: [], frequentWords: [] },
    } as never);

    const res = await NoteAnalysisService.analyze('local_n0');

    expect(res, 'свежий вектор нельзя переписывать').toMatchObject({ ok: true, indexed: 'skip' });
    expect(embedCalls).toBe(0);
  });

  it('д) обрыв на второй странице не сбрасывает курсор: следующий проход идёт с той же страницы', async () => {
    const items = await cloudEmbeddings(3 * PAGE);
    mockCloud(items, 2);
    await seedNotes(3 * PAGE);

    const broken = await restoreAIDataFromCloud(UID);
    expect(broken.sectionFailed).toBe(true);
    expect(broken.embeddings).toBe(PAGE);

    mockCloud(items);                                   // сеть вернулась
    const mark = getUserEmbeddingsPaginated.mock.calls.length;
    const resumed = await restoreAIDataFromCloud(UID);

    expect(cursors()[mark], 'догрузка после обрыва началась бы с нуля').toBe(String(PAGE));
    expect(resumed.embeddings).toBe(2 * PAGE);
  });

  it('В-2: упавшая на расшифровке страница остаётся за курсором и докачивается следующим проходом', async () => {
    const items = await cloudEmbeddings(3 * PAGE);
    mockCloud(items);
    await seedNotes(3 * PAGE);
    // Страница 2 (заметки local_n10…local_n19) падает: сейф заперт посреди
    // догрузки. На базе эта страница уже за курсором — её записи потеряны
    // навсегда, и `indexPending` пересчитывает их через ИИ.
    const secondPage = new Set(Array.from({ length: PAGE }, (_, i) => `local_n${PAGE + i}`));
    let sealed = true;
    const content = vi.spyOn(LocalVersionService, 'getLatestContent').mockImplementation(async (id: string) => {
      if (sealed && secondPage.has(id)) throw new Error('сейф заперт');
      const db = await getLocalDb();
      return (await db.get('versions', `${id}_v1`))?.content ?? '';
    });

    const broken = await restoreAIDataFromCloud(UID);
    sealed = false;

    expect(broken.embeddings, 'страница до упавшей обязана быть сохранена').toBe(PAGE);
    expect(broken.failed).toBe(PAGE);
    expect(getEmbeddingRestoreCursor(UID), 'курсор перепрыгнул упавшую страницу').toBe(String(PAGE));
    expect(isEmbeddingRestoreDone(UID), 'упавшая страница не исчерпывает список').toBe(false);

    const mark = getUserEmbeddingsPaginated.mock.calls.length;
    const resumed = await restoreAIDataFromCloud(UID);

    expect(cursors()[mark], 'повтор начал бы не с упавшей страницы').toBe(String(PAGE));
    expect(resumed.embeddings).toBe(2 * PAGE);
    expect(await findStaleDocuments()).toEqual([]);
    expect(embedCalls, 'векторы доехали из облака — пересчёт через ИИ не нужен').toBe(0);
    content.mockRestore();
  });

  it('во время хода чата догрузка не идёт', async () => {
    mockCloud(await cloudEmbeddings(12));
    await seedNotes(12);

    useAIStageStore.getState().setStage('answer');
    const res = await restoreAIDataFromCloud(UID);
    useAIStageStore.getState().setStage(null);

    expect(getUserEmbeddingsPaginated).not.toHaveBeenCalled();
    expect(res.embeddings).toBe(0);
  });

  it('облачный вектор с другим хэшем заметку не закрывает: ждём пересчёт, а не чужой текст', async () => {
    const items = await cloudEmbeddings(3);
    items[1] = { ...items[1], contentHash: 'хэш-старого-текста' };
    mockCloud(items);
    await seedNotes(3);

    const res = await restoreAIDataFromCloud(UID);

    expect(res.embeddings).toBe(2);
    expect(await findStaleDocuments()).toEqual(['local_n1']);
  });

  it('после «готово» автоматический проход не повторяется, а кнопка его развязывает', async () => {
    mockCloud(await cloudEmbeddings(24));
    await seedNotes(4);
    await restoreAIDataFromCloud(UID);
    expect(isEmbeddingRestoreDone(UID)).toBe(true);

    // Архив вырос, покрытие упало ниже половины — но автоматический проход уже
    // завершался и заново не начинается: иначе он ходил бы по облаку на каждом
    // фоновом проходе.
    await seedNotesKeepingVectors(24);
    const before = getUserEmbeddingsPaginated.mock.calls.length;
    await restoreAIDataFromCloud(UID);
    expect(getUserEmbeddingsPaginated.mock.calls.length).toBe(before);

    // Кнопка в диагностике — ручной способ сказать «проверь ещё раз».
    requestEmbeddingRestore(UID);
    expect(isEmbeddingRestoreDone(UID), 'ручной запрос обязан снимать «готово»').toBe(false);
    await restoreAIDataFromCloud(UID);
    expect(getUserEmbeddingsPaginated.mock.calls.length).toBeGreaterThan(before);
  });

  it('кнопка в диагностике по-прежнему форсирует: догрузка идёт и при целом индексе', async () => {
    mockCloud(await cloudEmbeddings(4));
    await seedNotes(4);
    await restoreAIDataFromCloud(UID);
    expect(await findStaleDocuments()).toEqual([]);

    const before = getUserEmbeddingsPaginated.mock.calls.length;
    requestEmbeddingRestore(UID);
    await restoreAIDataFromCloud(UID);

    expect(getUserEmbeddingsPaginated.mock.calls.length, 'ручной запрос обязан качать снова').toBeGreaterThan(before);
  });

  it('В-1: архив в 250 заметок догружается за один полный и одно продолжение, ИИ не зовём', async () => {
    mockCloud(await cloudEmbeddings(250));
    await seedNotes(250);

    await restoreAIDataFromCloud(UID);
    await continueEmbeddingDownload(UID);          // если полный проход упёрся в потолок

    expect(await findStaleDocuments(), 'векторы обязаны приехать из облака').toEqual([]);
    expect(embedCalls, 'пересчёт через ИИ не нужен, пока догрузка не закрыта').toBe(0);
    expect(getUserEmbeddingsPaginated.mock.calls.length, 'страниц по 50 на 250 записей — пять плюс пустая').toBeLessThanOrEqual(6);
  });

  it('В-1: сутки «в пути» закрывают догрузку, и indexPending пересчитывает то, чего в облаке нет', async () => {
    mockCloud([]);
    await seedNotes(6);
    vi.useFakeTimers({ now: Date.now() - 25 * 60 * 60_000 });
    markEmbeddingRestoreStarted(UID);
    vi.useRealTimers();
    expect(isEmbeddingDownloadPending(UID), 'застарелая догрузка не может считаться «в пути»').toBe(false);

    const run = await continueEmbeddingDownload(UID);
    expect(run.finished).toBe(true);
    expect(isEmbeddingRestoreDone(UID)).toBe(true);

    const after = await indexPending();
    expect(after.ok).toBe(6);
    expect(embedCalls, 'заметки без вектора перестали ждать облако').toBe(6);
  });

  it('В-1: занятый чат — продолжение не начинается и курсор не трогает', async () => {
    mockCloud(await cloudEmbeddings(PAGE));
    await seedNotes(PAGE);
    markEmbeddingRestoreStarted(UID);
    setEmbeddingRestoreCursor(UID, String(PAGE));

    useAIStageStore.getState().setStage('answer');
    const run = await continueEmbeddingDownload(UID);
    useAIStageStore.getState().setStage(null);

    expect(run.embeddings).toBe(0);
    expect(getUserEmbeddingsPaginated).not.toHaveBeenCalled();
    expect(getEmbeddingRestoreCursor(UID), 'занятый чат сдвинул курсор').toBe(String(PAGE));

    // контроль: свободный чат продолжает с того же курсора
    const before = getUserEmbeddingsPaginated.mock.calls.length;
    await continueEmbeddingDownload(UID);
    expect(getUserEmbeddingsPaginated.mock.calls.length).toBeGreaterThan(before);
    expect(cursors()[before]).toBe(String(PAGE));
  });

  it('В-1: три прохода без продвижения курсора закрывают догрузку', async () => {
    const items = await cloudEmbeddings(3 * PAGE);
    mockCloud(items);
    await seedNotes(3 * PAGE);
    // Вторая страница не расшифровывается никогда: без страховки догрузка стояла
    // бы на ней столько, сколько открыто приложение, а `indexPending` ждал бы.
    const secondPage = new Set(Array.from({ length: PAGE }, (_, i) => `local_n${PAGE + i}`));
    const content = vi.spyOn(LocalVersionService, 'getLatestContent').mockImplementation(async (id: string) => {
      if (secondPage.has(id)) throw new Error('страница не расшифровывается');
      const db = await getLocalDb();
      return (await db.get('versions', `${id}_v1`))?.content ?? '';
    });

    const first = await restoreAIDataFromCloud(UID);
    expect(first.embeddings).toBe(PAGE);
    expect(isEmbeddingRestoreDone(UID)).toBe(false);

    await continueEmbeddingDownload(UID);
    expect(isEmbeddingRestoreDone(UID), 'один стоячий проход — не повод сдаваться').toBe(false);
    await continueEmbeddingDownload(UID);
    expect(isEmbeddingRestoreDone(UID), 'два стоячих прохода — ещё нет').toBe(false);
    await continueEmbeddingDownload(UID);
    expect(isEmbeddingRestoreDone(UID), 'три прохода без движения не могут длиться вечно').toBe(true);
    expect(isEmbeddingDownloadPending(UID)).toBe(false);
    content.mockRestore();
  });
});
