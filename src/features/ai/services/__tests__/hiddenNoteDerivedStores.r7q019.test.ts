import { describe, it, expect, vi, beforeEach } from 'vitest';
import 'fake-indexeddb/auto';
import { getLocalDb } from '../../../../core/storage/localDb';
import { AITimelineService } from '../AITimelineService';
import { NoteAnalysisService } from '../NoteAnalysisService';
import { buildTemporalBlocks } from '../chatContext/temporalBlocks';
import { AISummaryService } from '../AISummaryService';
import { AIEmbeddingService } from '../AIEmbeddingService';
import { AIProfileFacetService } from '../AIProfileFacetService';
import { AIProfileService } from '../AIProfileService';
import { AIService } from '../AIService';
import { cloudVectorMatchesNote } from '../AIRestoreService';
import { LocalStoreSyncService } from '../../../../core/services/LocalStoreSyncService';
import { writeFacetStore } from '../../../../core/services/facetLock';
import { emitDomainEvent, _resetDomainEventHandlersForTests } from '../../../../core/events/domainEvents';
import { initAiDomainEvents } from '../../subscribeDomainEvents';
import { markAllAnalysed } from '../../../../test/utils/markAnalysed';

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
    await markAllAnalysed(db);
    await db.put('documents', doc(DOC_HIDDEN, { excludedFromAI: true }));
    await markAllAnalysed(db);
    await db.put('documents', doc(DOC_TRASHED, { trashedAt: Date.UTC(2026, 8, 11) }));
    await markAllAnalysed(db);

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

// AP-3: грань профиля и портрет — такие же производные заметки, как хронология.
// Скрытие чистило только сводку и хронологию, а грань с её формулировкой
// продолжала уходить в промпт портрета; портрет — в каждый не-редакторский ход.
// Маркеры выдуманные.
describe('AP-3: скрытие чистит грани профиля и портрет', () => {
  const DOC_TO_HIDE = 'doc_ap3_hidden';
  const DOC_KEEP = 'doc_ap3_keep';
  const FACET_MARKER = 'МАРКЕР-ГРАНИ-AP3';
  const PORTRAIT_MARKER = 'МАРКЕР-ПОРТРЕТА-AP3';

  const facet = (id: string, noteIds: string[], summary: string) => ({
    id,
    label: id,
    summary,
    centroid: [1, 0],
    noteIds,
    noteCount: noteIds.length,
    firstAt: 1,
    lastAt: 2,
    updatedAt: 1,
    buildId: 'b_ap3',
  });

  beforeEach(async () => {
    localStorage.clear();
    vi.restoreAllMocks();
    const db = await getLocalDb();
    for (const store of [
      'documents', 'aiSummaries', 'aiTimeline', 'aiMonthlyDigest', 'aiProfileFacets', 'aiPortrait', 'aiChatMemory',
    ] as const) {
      await db.clear(store);
    }

    await db.put('documents', doc(DOC_KEEP));
    await markAllAnalysed(db);
    await db.put('documents', doc(DOC_TO_HIDE, { excludedFromAI: true }));
    await markAllAnalysed(db);
    await db.put('aiTimeline', timelineEntry(DOC_TO_HIDE, 'факт скрытой', '2026-09-20'));
    await db.put('aiMonthlyDigest', {
      month: '2026-09',
      narrative: 'МАРКЕР-ДАЙДЖЕСТА-AP3',
      tones: [],
      themes: [],
      noteCount: 2,
      generatedAt: Date.now(),
    });

    await writeFacetStore(async store => {
      await store.put(facet('f_only_hidden_ap3', [DOC_TO_HIDE], FACET_MARKER) as never);
      await store.put({ ...facet('f_mixed_ap3', [DOC_TO_HIDE, DOC_KEEP], `${FACET_MARKER}-смешанная`), label: `${FACET_MARKER}-название`, _excerptSeed: [`${FACET_MARKER}-выдержка`] } as never);
      await store.put(facet('f_ok_ap3', [DOC_KEEP], 'видимая грань') as never);
    });

    await db.put('aiPortrait', { id: 'singleton', portrait: PORTRAIT_MARKER, updatedAt: 1, generatedAtDelta: 0 });
    localStorage.setItem('ai_user_portrait', PORTRAIT_MARKER);
    localStorage.setItem('ai_portrait_sections', '{"themes":{"content":"' + PORTRAIT_MARKER + '"}}');
    localStorage.setItem('ai_portrait_sections_guest', '{"themes":{"content":"' + PORTRAIT_MARKER + '"}}');
  });

  // Приёмка ai-privacy (security-review, Vuln 4): заметку скрыли ДО AP-1 — её
  // месяц не чистился, дайджест остался. Читатели его не отдают, пока он
  // пересказывает больше заметок, чем живо в хронологии. Без вызовов ИИ.
  // Мутация: убрать coversOnlyLiveNotes из getRecent/get — красный.
  it('старый дайджест месяца со скрытой заметкой не отдаётся читателям', async () => {
    const { AIMonthlyDigestService } = await import('../AIMonthlyDigestService');
    expect((await AIMonthlyDigestService.getRecent(3)).map(d => d.narrative).join('\n')).not.toContain('МАРКЕР-ДАЙДЖЕСТА-AP3');
    expect(await AIMonthlyDigestService.get('2026-09')).toBeUndefined();
  });

  // Проверка коммита 0784810a: сверка по количеству пропускала «одну скрыли, одну
  // добавили». Теперь — по номерам заметок дайджеста. Мутация: вернуть сверку по
  // noteCount — красный второй случай.
  it('дайджест отдаётся, только если живы именно его заметки', async () => {
    const { AIMonthlyDigestService } = await import('../AIMonthlyDigestService');
    const db = await getLocalDb();
    await db.put('documents', doc('doc_ap3_new'));
    await markAllAnalysed(db);
    await db.put('aiTimeline', timelineEntry(DOC_KEEP, 'факт видимой', '2026-09-21'));
    await db.put('aiTimeline', timelineEntry('doc_ap3_new', 'факт новой', '2026-09-22'));
    // Собран по скрытой и видимой; сейчас живы видимая и новая — 2 = 2, но не те.
    await db.put('aiMonthlyDigest', { month: '2026-09', narrative: 'МАРКЕР-ДАЙДЖЕСТА-AP3', tones: [], themes: [], noteCount: 2, noteIds: [DOC_TO_HIDE, DOC_KEEP], generatedAt: Date.now() });
    expect(await AIMonthlyDigestService.get('2026-09'), 'скрыли одну, добавили другую').toBeUndefined();
    // Собран по живым — отдаётся.
    await db.put('aiMonthlyDigest', { month: '2026-09', narrative: 'видимый пересказ', tones: [], themes: [], noteCount: 2, noteIds: [DOC_KEEP, 'doc_ap3_new'], generatedAt: Date.now() });
    expect((await AIMonthlyDigestService.get('2026-09'))?.narrative).toBe('видимый пересказ');
  });

  it('скрыли → грани без noteId и dirty, портрет и дайджест удалены', async () => {
    vi.spyOn(AISummaryService, 'delete').mockResolvedValue(undefined as never);
    vi.spyOn(AIEmbeddingService, 'delete').mockResolvedValue(undefined as never);
    const del = vi.spyOn(LocalStoreSyncService, 'scheduleStoreDelete').mockImplementation(() => {});
    vi.spyOn(LocalStoreSyncService, 'scheduleStoreSync').mockImplementation(() => {});
    const db = await getLocalDb();

    await NoteAnalysisService.clear(DOC_TO_HIDE);

    expect(await db.get('aiProfileFacets', 'f_only_hidden_ap3')).toBeUndefined();
    const mixed = await db.get('aiProfileFacets', 'f_mixed_ap3');
    expect(mixed?.noteIds).toEqual([DOC_KEEP]);
    expect(mixed?.dirty).toBe(true);
    // Приёмка ai-privacy (Vuln 1): пересказ смешанной грани стёрт вместе с номером.
    expect(JSON.stringify(mixed), 'ни пересказа, ни выдержек, ни придуманного названия').not.toContain(FACET_MARKER);
    expect(mixed?.pendingSummary, 'пересказ — заново, по действию человека').toBe(true);
    expect(await db.get('aiMonthlyDigest', '2026-09')).toBeUndefined();
    expect(del).toHaveBeenCalledWith('aiMonthlyDigest', '2026-09');
    expect(localStorage.getItem('ai_user_portrait')).toBeNull();
    expect(localStorage.getItem('ai_portrait_sections')).toBeNull();
    expect(localStorage.getItem('ai_portrait_sections_guest')).toBeNull();
  });

  // Приёмка ai-privacy (security-review, Vuln 1): номер скрытой заметки ушёл из
  // смешанной грани, а пересказ оставался — и стражи на чтении (ищут скрытые
  // номера в noteIds) пропускали её в промпт и в интерфейс. Мутация: не стирать
  // summary в purgeNoteDerivatives — красный.
  it('скрыли → смешанная грань не несёт пересказ ни в generate(), ни в интерфейс', async () => {
    vi.spyOn(AISummaryService, 'delete').mockResolvedValue(undefined as never);
    vi.spyOn(AIEmbeddingService, 'delete').mockResolvedValue(undefined as never);
    vi.spyOn(LocalStoreSyncService, 'scheduleStoreDelete').mockImplementation(() => {});
    vi.spyOn(LocalStoreSyncService, 'scheduleStoreSync').mockImplementation(() => {});
    await NoteAnalysisService.clear(DOC_TO_HIDE);
    await writeFacetStore(async store => {
      await store.put(facet('f_2b_ap3', [DOC_KEEP], 'вторая видимая') as never);
      await store.put(facet('f_3b_ap3', [DOC_KEEP], 'третья видимая') as never);
    });

    const all = await AIProfileFacetService.getAll();
    expect(all.map(f => f.summary).join('\n')).not.toContain(FACET_MARKER);

    const chat = vi.spyOn(AIService, 'chat').mockResolvedValue({ ok: true, text: 'раздел портрета' } as never);
    await AIProfileService.generate();
    expect(chat.mock.calls.map(c => JSON.stringify(c[0])).join('\n')).not.toContain(FACET_MARKER);
  });

  it('generate() не отправляет модели сводку грани со скрытой заметкой', async () => {
    // Строка могла остаться от прежней версии или приехать из облака: грань всё
    // ещё перечисляет скрытую заметку. Промпт портрета её не получает.
    await writeFacetStore(async store => {
      await store.put(facet('f_stale_ap3', [DOC_TO_HIDE], FACET_MARKER) as never);
      await store.put(facet('f_2_ap3', [DOC_KEEP], 'вторая видимая') as never);
      await store.put(facet('f_3_ap3', [DOC_KEEP], 'третья видимая') as never);
    });
    const chat = vi.spyOn(AIService, 'chat').mockResolvedValue({ ok: true, text: 'раздел портрета' } as never);

    await AIProfileService.generate();

    const sent = chat.mock.calls.map(c => JSON.stringify(c[0])).join('\n');
    expect(sent).not.toContain(FACET_MARKER);
  });

  // Приёмка ai-privacy: портрет читал всю память напрямую. Теперь — тот же фильтр,
  // что и разговор: старая непросмотренная (решение владельца, «в») и память со
  // скрытым источником в промпт не идут. Мутация: снять usableMemories — красный.
  it('generate() не отправляет модели старую непросмотренную память и память скрытой', async () => {
    const db = await getLocalDb();
    await db.put('aiChatMemory', { id: 'm_legacy_ap', kind: 'preference', text: 'МАРКЕР-ПАМЯТИ-СТАРАЯ', sourceDialogueId: 'd1', createdAt: 1, updatedAt: 1 });
    await db.put('aiChatMemory', { id: 'm_hidden_ap', kind: 'preference', text: 'МАРКЕР-ПАМЯТИ-СКРЫТАЯ', sourceDialogueId: 'd2', createdAt: 1, updatedAt: 1, sourceDocumentIds: [DOC_TO_HIDE] });
    await db.put('aiChatMemory', { id: 'm_ok_ap', kind: 'preference', text: 'видимое предпочтение', sourceDialogueId: 'd3', createdAt: 1, updatedAt: 1, sourceDocumentIds: [] });
    await writeFacetStore(async store => {
      await store.put(facet('f_2c_ap3', [DOC_KEEP], 'вторая видимая') as never);
      await store.put(facet('f_3c_ap3', [DOC_KEEP], 'третья видимая') as never);
    });
    const chat = vi.spyOn(AIService, 'chat').mockResolvedValue({ ok: true, text: 'раздел портрета' } as never);

    await AIProfileService.generate();

    const sent = chat.mock.calls.map(c => JSON.stringify(c[0])).join('\n');
    expect(sent).not.toContain('МАРКЕР-ПАМЯТИ');
  });

  // Проверка коммита 8b1994ee: getAll читают и пути к ИИ — номер, который на
  // устройстве не нашёлся, грань не пропускает; найденная по uuid — пропускает.
  // Мутация: «нет документа — видима» — красный.
  it('грань с ненайденным номером скрыта, найденная по uuid — видна', async () => {
    await writeFacetStore(async store => {
      await store.put(facet('f_foreign_ap3', ['doc_from_other_device'], 'МАРКЕР-ЧУЖАЯ') as never);
      await store.put(facet('f_by_uuid_ap3', [`uuid_${DOC_KEEP}`], 'по постоянному номеру') as never);
    });
    const ids = (await AIProfileFacetService.getAll()).map(f => f.id);
    expect(ids).not.toContain('f_foreign_ap3');
    expect(ids).toContain('f_by_uuid_ap3');
  });

  it('интерфейс граней не показывает грань со скрытой заметкой', async () => {
    const db = await getLocalDb();
    expect(await db.get('documents', DOC_TO_HIDE)).toBeTruthy();
    await writeFacetStore(async store => {
      await store.put(facet('f_cloud_stale_ap3', [DOC_TO_HIDE], FACET_MARKER) as never);
    });

    const all = await AIProfileFacetService.getAll();

    expect(all.some(f => f.summary.includes(FACET_MARKER))).toBe(false);
  });
});
