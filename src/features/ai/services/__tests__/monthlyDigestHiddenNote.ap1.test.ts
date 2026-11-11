import { describe, it, expect, vi, beforeEach } from 'vitest';
import 'fake-indexeddb/auto';
import { getLocalDb } from '../../../../core/storage/localDb';
import { AISummaryService } from '../AISummaryService';
import { AIEmbeddingService } from '../AIEmbeddingService';
import { AIService } from '../AIService';
import { AIMonthlyDigestService } from '../AIMonthlyDigestService';
import { LocalStoreSyncService } from '../../../../core/services/LocalStoreSyncService';
import { emitDomainEvent, _resetDomainEventHandlersForTests } from '../../../../core/events/domainEvents';
import { initAiDomainEvents } from '../../subscribeDomainEvents';
import { buildProactiveBlock } from '../chatContext/proactive';
import { buildTemporalBlocks } from '../chatContext/temporalBlocks';

vi.mock('../../../../shared/errors/reportError', () => ({ reportError: vi.fn() }));
vi.mock('../../../../core/auth', () => ({ getCurrentUser: vi.fn(() => null) }));

// AP-1: месячный дайджест пересказывает записи месяца. Заметка, скрытая от ИИ
// или выброшенная в корзину, уходила из хронологии, но оставалась в дайджесте —
// и он ехал модели первым ходом, в «напомни» и в «что я писал в <месяце>».
// Маркеры выдуманные, живых формулировок здесь нет.

const DOC_HIDDEN = 'doc_hidden_ap1';
const DOC_OK = 'doc_ok_ap1';
const DOC_OK_2 = 'doc_ok_2_ap1';
const MARKER = 'МАРКЕР-ДАЙДЖЕСТА-AP1';

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

const timelineEntry = (documentId: string, date: string) => ({
  documentId,
  date,
  month: '2026-09',
  facts: [`факт ${documentId}`],
});

const digest = (noteCount: number, generatedAt = Date.now()) => ({
  month: '2026-09',
  narrative: `Сводка месяца. ${MARKER}`,
  tones: ['спокойный'],
  themes: ['тема'],
  noteCount,
  generatedAt,
});

async function waitUntil(cond: () => Promise<boolean>, ms = 1000): Promise<void> {
  const until = Date.now() + ms;
  for (;;) {
    if (await cond()) return;
    if (Date.now() >= until) throw new Error('waitUntil: условие не наступило за отведённое время');
    await new Promise(r => setTimeout(r, 5));
  }
}

describe('AP-1: скрытая заметка не остаётся в месячном дайджесте', () => {
  beforeEach(async () => {
    localStorage.clear();
    _resetDomainEventHandlersForTests();
    vi.restoreAllMocks();
    vi.spyOn(AISummaryService, 'delete').mockResolvedValue(undefined as never);
    vi.spyOn(AIEmbeddingService, 'delete').mockResolvedValue(undefined as never);
    vi.spyOn(LocalStoreSyncService, 'scheduleStoreDelete').mockImplementation(() => {});
    vi.spyOn(LocalStoreSyncService, 'scheduleStoreSync').mockImplementation(() => {});

    const db = await getLocalDb();
    for (const store of [
      'documents', 'versions', 'aiSummaries', 'aiEmbeddings', 'aiTimeline',
      'aiThemeLedger', 'aiThreads', 'aiCommitments', 'aiMonthlyDigest', 'lifeStory', 'aiBeliefs',
    ] as const) {
      await db.clear(store);
    }

    await db.put('documents', doc(DOC_OK));
    await db.put('documents', doc(DOC_OK_2));
    await db.put('documents', doc(DOC_HIDDEN, { excludedFromAI: true }));
    await db.put('aiTimeline', timelineEntry(DOC_OK, '2026-09-10'));
    await db.put('aiTimeline', timelineEntry(DOC_OK_2, '2026-09-12'));
    await db.put('aiTimeline', timelineEntry(DOC_HIDDEN, '2026-09-11'));
    await db.put('aiMonthlyDigest', digest(2));
  });

  it('скрытие удаляет дайджест месяца и он не доходит ни до одного блока контекста', async () => {
    const db = await getLocalDb();
    const del = vi.mocked(LocalStoreSyncService.scheduleStoreDelete);

    initAiDomainEvents();
    emitDomainEvent({ type: 'note.excludedFromAI', documentId: DOC_HIDDEN, excluded: true });
    await waitUntil(async () => (await db.get('aiMonthlyDigest', '2026-09')) === undefined);

    expect(del).toHaveBeenCalledWith('aiMonthlyDigest', '2026-09');

    const proactive = await buildProactiveBlock({ personaId: 'editor' });
    expect(proactive).not.toContain(MARKER);

    const recent = await buildTemporalBlocks({
      text: 'напомни',
      effectiveQuery: 'напомни',
      explicitSearch: false,
      lastSearchQuery: '',
      db,
    });
    expect(recent.appended).not.toContain(MARKER);

    const month = await buildTemporalBlocks({
      text: 'что я писал в сентябре 2026?',
      effectiveQuery: 'что я писал в сентябре 2026?',
      explicitSearch: false,
      lastSearchQuery: '',
      db,
    });
    expect(month.appended).not.toContain(MARKER);
  });

  it('пересборка месяца без живых записей удаляет устаревший дайджест, а не ждёт 24 часа', async () => {
    const db = await getLocalDb();
    await db.delete('aiTimeline', DOC_OK);
    await db.delete('aiTimeline', DOC_OK_2);
    const ai = vi.spyOn(AIService, 'summarizeFacet');

    await AIMonthlyDigestService.generateForMonth('2026-09');

    expect(await db.get('aiMonthlyDigest', '2026-09')).toBeUndefined();
    expect(ai).not.toHaveBeenCalled();
  });

  it('пересборка обходит 24-часовой страж, если в дайджесте больше заметок, чем живых', async () => {
    const db = await getLocalDb();
    await db.put('aiMonthlyDigest', digest(5));
    const ai = vi.spyOn(AIService, 'summarizeFacet').mockResolvedValue({ ok: true, label: 'месяц', summary: 'новая сводка' });

    await AIMonthlyDigestService.generateForMonth('2026-09');

    expect(ai).toHaveBeenCalledTimes(1);
    expect((await db.get('aiMonthlyDigest', '2026-09'))?.noteCount).toBe(2);
  });
});
