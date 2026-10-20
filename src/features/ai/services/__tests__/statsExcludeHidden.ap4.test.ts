import { describe, it, expect, vi, beforeEach } from 'vitest';
import 'fake-indexeddb/auto';
import { getLocalDb } from '../../../../core/storage/localDb';
import { getCorpusStats } from '../chatContext/corpusStats';
import { buildTemporalBlocks } from '../chatContext/temporalBlocks';
import { AIProfileService } from '../AIProfileService';
import { AIService } from '../AIService';

vi.mock('../../../../shared/errors/reportError', () => ({ reportError: vi.fn() }));
vi.mock('../../../../core/auth', () => ({ getCurrentUser: vi.fn(() => null) }));

// AP-4: счётчики и средние считали скрытые и корзинные заметки. Текста в них
// нет, но количество и даты — тоже данные человека. Маркеры выдуманные.

const DAY = 86_400_000;
const SEP1 = Date.UTC(2026, 8, 1);
const SEP10 = Date.UTC(2026, 8, 10);
const SEP15 = Date.UTC(2026, 8, 15);
const SEP20 = Date.UTC(2026, 8, 20);

const doc = (id: string, lastSessionAt: number, extra: Record<string, unknown> = {}) => ({
  id,
  uuid: `uuid_${id}`,
  guestId: 'guest',
  title: id,
  currentVersion: 1,
  totalWords: 10,
  totalDuration: 100,
  sessionsCount: 1,
  firstSessionAt: lastSessionAt,
  lastSessionAt,
  tags: [],
  ...extra,
});

describe('AP-4: скрытые и корзинные заметки не попадают в счётчики', () => {
  beforeEach(async () => {
    localStorage.clear();
    vi.restoreAllMocks();
    const db = await getLocalDb();
    for (const store of [
      'documents', 'versions', 'aiSummaries', 'aiProfileFacets', 'aiPortrait', 'aiChatMemory',
      'aiTimeline', 'aiMonthlyDigest', 'aiDialogues',
    ] as const) {
      await db.clear(store);
    }

    await db.put('documents', doc('doc_ok_a_ap4', SEP1));
    await db.put('documents', doc('doc_ok_b_ap4', SEP20));
    await db.put('documents', doc('doc_hidden_ap4', SEP10, { excludedFromAI: true }));
    await db.put('documents', doc('doc_trashed_ap4', SEP15, { trashedAt: DAY }));
  });

  it('корпус: количество и диапазон дат — только по видимым заметкам', async () => {
    const stats = await getCorpusStats(await getLocalDb());

    expect(stats.total).toBe(2);
    expect(stats.from).toBe('2026-09-01');
    expect(stats.to).toBe('2026-09-20');
  });

  it('окно периода: «было N заметок» не считает скрытые и корзину', async () => {
    const res = await buildTemporalBlocks({
      text: 'что я писал в сентябре 2026?',
      effectiveQuery: 'что я писал в сентябре 2026?',
      explicitSearch: false,
      lastSearchQuery: '',
      db: await getLocalDb(),
    });

    expect(res.appended).toContain('мало записей (2)');

    const range = await buildTemporalBlocks({
      text: 'что я писал в этом году',
      effectiveQuery: 'что я писал в этом году',
      explicitSearch: false,
      lastSearchQuery: '',
      db: await getLocalDb(),
    });
    expect(range.appended).toContain('Было 2 заметок');
  });

  it('метрики стиля портрета собираются без текстов скрытых заметок', async () => {
    const db = await getLocalDb();
    const visibleWord = 'длинноеслово';
    const contents = [
      `${visibleWord} ${visibleWord}.`,
      `${visibleWord} ${visibleWord}.`,
      `${visibleWord} ${visibleWord}.`,
    ];
    const docs = ['doc_ok_a_ap4', 'doc_ok_b_ap4'];
    for (let i = 0; i < docs.length; i++) {
      await db.put('versions', {
        id: `v_ap4_${i}`,
        documentId: docs[i]!,
        guestId: 'guest',
        version: 1,
        content: contents[i]!,
        wordCount: 2,
        wordsAdded: 2,
        charsAdded: 10,
        duration: 10,
        wpm: 10,
        savedAt: 1,
        sessionStartedAt: 1,
      });
      await db.put('aiSummaries', {
        documentId: docs[i]!,
        tone: 'спокойный',
        frequentWords: [],
        insights: [],
        themes: ['тема'],
        extractedFacts: [],
        processedAt: 1,
        contentHash: 'h',
        summary: `сводка ${i}`,
      });
    }
    // Третья видимая заметка — чтобы generate пошёл по сводкам.
    await db.put('documents', doc('doc_ok_c_ap4', SEP15));
    await db.put('versions', {
      id: 'v_ap4_2', documentId: 'doc_ok_c_ap4', guestId: 'guest', version: 1,
      content: contents[0]!, wordCount: 2, wordsAdded: 2, charsAdded: 10, duration: 10, wpm: 10, savedAt: 1, sessionStartedAt: 1,
    });
    await db.put('aiSummaries', {
      documentId: 'doc_ok_c_ap4', tone: 'спокойный', frequentWords: [], insights: [],
      themes: ['тема'], extractedFacts: [], processedAt: 1, contentHash: 'h3', summary: 'сводка 3',
    });
    // Скрытая заметка с коротким текстом: без фильтра она тянет среднюю вниз.
    await db.put('versions', {
      id: 'v_ap4_hidden', documentId: 'doc_hidden_ap4', guestId: 'guest', version: 1,
      content: 'я я я я я я.', wordCount: 6, wordsAdded: 6, charsAdded: 6, duration: 10, wpm: 10, savedAt: 1, sessionStartedAt: 1,
    });

    const chat = vi.spyOn(AIService, 'chat').mockResolvedValue({ ok: true, text: 'раздел портрета' } as never);

    await AIProfileService.generate();

    const sent = chat.mock.calls.map(c => JSON.stringify(c[0])).join('\n');
    const visibleAvg = visibleWord.length.toFixed(1);
    expect(sent).toContain(`средняя длина слова ${visibleAvg} симв`);
    expect(sent).not.toContain('средняя длина слова 6.5 симв');
  });
});
