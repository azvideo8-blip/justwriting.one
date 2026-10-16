import { describe, it, expect, vi, beforeEach } from 'vitest';
import 'fake-indexeddb/auto';
import { getLocalDb } from '../../../../core/storage/localDb';
import { AITimelineService } from '../AITimelineService';
import { AIThemeLedgerService } from '../AIThemeLedgerService';
import { AIThreadService } from '../AIThreadService';
import { AIMemoryAssembler } from '../AIMemoryAssembler';
import { buildTemporalBlocks } from '../chatContext/temporalBlocks';
import { buildAggregateThemeBlock } from '../chatContext/aggregateStats';
import { AISummaryService } from '../AISummaryService';
import { AIEmbeddingService } from '../AIEmbeddingService';
import { cloudVectorMatchesNote } from '../AIRestoreService';
import { LocalStoreSyncService } from '../../../../core/services/LocalStoreSyncService';
import { emitDomainEvent, _resetDomainEventHandlersForTests } from '../../../../core/events/domainEvents';
import { initAiDomainEvents } from '../../subscribeDomainEvents';

vi.mock('../../../../shared/errors/reportError', () => ({ reportError: vi.fn() }));
vi.mock('../../../../core/auth', () => ({ getCurrentUser: vi.fn(() => null) }));

// R7Q-019 + R7F-010: производные скрытой или выброшенной в корзину заметки
// (хронология, реестр тем, сюжетные линии, облачные векторы) доезжают до модели,
// потому что чистит их только то устройство, где флаг поставили. Фильтр стоит в
// сервисном слое и закрывает сразу всех читателей.
//
// Маркеры — выдуманные, живых формулировок здесь нет.

const DOC_HIDDEN = 'doc_hidden_r7q019';
const DOC_TRASHED = 'doc_trashed_r7q019';
const DOC_OK = 'doc_ok_r7q019';

const FACT_HIDDEN = 'ФАКТ-СКРЫТАЯ';
const FACT_TRASHED = 'ФАКТ-КОРЗИНА';
const FACT_OK = 'ФАКТ-ВИДИМАЯ';
const SENTENCE_HIDDEN = 'ЦИТАТА-СКРЫТАЯ';
const SENTENCE_OK = 'ЦИТАТА-ВИДИМАЯ';
const THEME_HIDDEN = 'тема-с-доказательством-из-скрытой';
const THEME_OK = 'тема-видимая';
const THREAD_HIDDEN = 'СЮЖЕТ-С-СКРЫТОЙ';
const THREAD_OK = 'СЮЖЕТ-ВИДИМЫЙ';

const doc = (id: string, extra: Record<string, unknown> = {}) => ({
  id,
  uuid: `uuid_${id}`,
  guestId: 'guest',
  title: id,
  currentVersion: 1,
  totalWords: 10,
  totalDuration: 100,
  sessionsCount: 1,
  firstSessionAt: Date.UTC(2026, 8, 10),
  lastSessionAt: Date.UTC(2026, 8, 10),
  tags: [],
  ...extra,
});

const timelineEntry = (documentId: string, fact: string, date: string) => ({
  documentId,
  date,
  month: '2026-09',
  facts: [fact],
});

const theme = (id: string, name: string, lastReinforcedAt: string, evidence: Array<[string, string]>) => ({
  id,
  theme: name,
  themeVector: [1, 0],
  firstSeenAt: '2026-09-01',
  evidence: evidence.map(([noteId, sentence]) => ({ noteId, eventDate: '2026-09-01', sentence })),
  count: evidence.length,
  lastReinforcedAt,
  lastReinforcedAtMs: Date.parse(lastReinforcedAt),
  emotionalWeight: 0.5,
  tier: 'active' as const,
});

/** Ждём асинхронного обработчика шины: без ожидания «не почистилось» было бы пустой проверкой. */
async function waitUntil(cond: () => Promise<boolean>, ms = 500): Promise<void> {
  const until = Date.now() + ms;
  for (;;) {
    if (await cond()) return;
    if (Date.now() >= until) throw new Error('waitUntil: условие не наступило за отведённое время');
    await new Promise(r => setTimeout(r, 5));
  }
}

describe('R7Q-019/R7F-010: производные скрытой или корзинной заметки не доходят до модели', () => {
  beforeEach(async () => {
    localStorage.clear();
    _resetDomainEventHandlersForTests();
    vi.restoreAllMocks();
    const db = await getLocalDb();
    for (const store of [
      'documents', 'versions', 'aiSummaries', 'aiEmbeddings', 'aiTimeline',
      'aiThemeLedger', 'aiThreads', 'aiCommitments', 'aiMonthlyDigest', 'lifeStory', 'aiBeliefs',
    ] as const) {
      await db.clear(store);
    }

    await db.put('documents', doc(DOC_OK));
    await db.put('documents', doc(DOC_HIDDEN, { excludedFromAI: true }));
    await db.put('documents', doc(DOC_TRASHED, { trashedAt: Date.UTC(2026, 8, 11) }));

    await db.put('aiTimeline', timelineEntry(DOC_OK, FACT_OK, '2026-09-10'));
    await db.put('aiTimeline', timelineEntry(DOC_HIDDEN, FACT_HIDDEN, '2026-09-11'));
    await db.put('aiTimeline', timelineEntry(DOC_TRASHED, FACT_TRASHED, '2026-09-12'));

    // У темы со скрытым доказательством оно первое по счёту и подкрепление самое
    // свежее — значит без фильтра печатается именно оно.
    await db.put('aiThemeLedger', theme('t_hidden', THEME_HIDDEN, '2026-09-12', [[DOC_HIDDEN, SENTENCE_HIDDEN], [DOC_OK, SENTENCE_OK]]));
    await db.put('aiThemeLedger', theme('t_ok', THEME_OK, '2026-09-10', [[DOC_OK, SENTENCE_OK]]));

    await db.put('aiThreads', {
      id: 'th_ok', noteIds: [DOC_OK], summary: THREAD_OK, centroid: [1, 0],
      lastNoteAt: Date.UTC(2026, 8, 10), memberHash: 'a', updatedAt: 1,
    });
    await db.put('aiThreads', {
      id: 'th_hidden', noteIds: [DOC_HIDDEN, DOC_OK], summary: THREAD_HIDDEN, centroid: [1, 0],
      lastNoteAt: Date.UTC(2026, 8, 11), memberHash: 'b', updatedAt: 1,
    });
  });

  it('контроль фикстуры: строки в хранилищах лежат', async () => {
    const db = await getLocalDb();
    expect((await db.getAll('aiTimeline')).length).toBe(3);
    expect((await db.getAll('aiThemeLedger')).length).toBe(2);
    expect((await db.getAll('aiThreads')).length).toBe(2);
  });

  it('хронология: читатели отдают только видимые заметки', async () => {
    expect((await AITimelineService.getByMonth('2026-09')).map(e => e.documentId)).toEqual([DOC_OK]);
    expect((await AITimelineService.getByDateRange('2026-09-01', '2026-09-30')).map(e => e.documentId)).toEqual([DOC_OK]);
    expect((await AITimelineService.getMostRecent(3)).map(e => e.documentId)).toEqual([DOC_OK]);
  });

  it('P3: buildTemporalBlocks не несёт ни скрытую, ни корзинную метку', async () => {
    const res = await buildTemporalBlocks({
      text: 'что я писал в сентябре 2026?',
      effectiveQuery: 'что я писал в сентябре 2026?',
      explicitSearch: false,
      lastSearchQuery: '',
      db: await getLocalDb(),
    });
    expect(res.outcome.handledByTemporal).toBe(true);
    expect(res.appended).toContain(FACT_OK);
    expect(res.appended).not.toContain(FACT_HIDDEN);
    expect(res.appended).not.toContain(FACT_TRASHED);
  });

  it('реестр тем: тема с доказательством из скрытой заметки не отдаётся', async () => {
    expect((await AIThemeLedgerService.getActive()).map(t => t.theme)).toEqual([THEME_OK]);
  });

  it('блок точной статистики: дословной фразы скрытой заметки нет', async () => {
    const block = await buildAggregateThemeBlock({
      effectiveQuery: 'сколько раз я писал про работу',
      queryEmb: [1, 0],
      uid: 'u_r7q019',
      onDailyLimitError: () => {},
    });
    expect(block).not.toBeNull();
    expect(block).toContain(SENTENCE_OK);
    expect(block).not.toContain(SENTENCE_HIDDEN);
    expect(block).not.toContain(THEME_HIDDEN);
  });

  it('сборщик памяти: «Дословная цитата» не из скрытой заметки', async () => {
    const text = await AIMemoryAssembler.assembleMemoryContext();
    expect(text).toContain('Дословная цитата');
    expect(text).toContain(SENTENCE_OK);
    expect(text).not.toContain(SENTENCE_HIDDEN);
    expect(text).not.toContain(THEME_HIDDEN);
  });

  it('сюжетные линии: линия со скрытой заметкой не отдаётся', async () => {
    expect((await AIThreadService.getRelevant([1, 0], 3)).map(t => t.id)).toEqual(['th_ok']);
  });

  it('облачный вектор скрытой заметки не принимается, если текст уже не совпадает', async () => {
    const db = await getLocalDb();
    await db.put('versions', {
      id: 'v_hidden_r7q019', documentId: DOC_HIDDEN, guestId: 'guest', version: 1,
      content: 'нынешний текст', wordCount: 2, savedAt: 1,
    } as never);
    expect(await cloudVectorMatchesNote({
      documentId: DOC_HIDDEN, vectors: [[1, 0]], contentHash: 'nesushchestvuet',
    } as never)).toBe(false);
  });

  it('заметки ещё нет на устройстве — вектор по-прежнему принимается', async () => {
    expect(await cloudVectorMatchesNote({
      documentId: 'doc_ne_local_r7q019', contentHash: 'lyuboy',
    } as never)).toBe(true);
  });

  it('корзина чистит производные так же, как «скрыть от ИИ»', async () => {
    const del = vi.spyOn(LocalStoreSyncService, 'scheduleStoreDelete').mockImplementation(() => {});
    vi.spyOn(LocalStoreSyncService, 'scheduleStoreSync').mockImplementation(() => {});
    vi.spyOn(AISummaryService, 'delete').mockResolvedValue(undefined as never);
    vi.spyOn(AIEmbeddingService, 'delete').mockResolvedValue(undefined as never);

    const db = await getLocalDb();
    initAiDomainEvents();
    emitDomainEvent({ type: 'note.trashed', documentId: DOC_HIDDEN });
    await waitUntil(async () => (await db.get('aiTimeline', DOC_HIDDEN)) === undefined);

    expect(del).toHaveBeenCalledWith('aiTimeline', DOC_HIDDEN);
    _resetDomainEventHandlersForTests();
  });
});
