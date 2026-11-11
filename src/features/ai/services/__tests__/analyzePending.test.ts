import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

/**
 * Проход по архиву — единственный способ добрать корпус после того, как
 * фоновый разбор убран (D4.23). Ему нельзя ни тратить лимит на заметки, до
 * которых дело не дойдёт, ни отчитываться успехом за половину работы.
 */

const summarize = vi.fn();
const saveSummary = vi.fn();
const indexDocument = vi.fn();

let documents: { id: string; excludedFromAI?: boolean }[] = [];
let summaries: { documentId: string; contentHash: string }[] = [];
let contentByDoc: Record<string, string> = {};

vi.mock('../../../../core/storage/localDb', () => ({
  getLocalDb: vi.fn(async () => ({
    get: vi.fn(async (store: string, id: string) =>
      store === 'documents' ? documents.find(d => d.id === id) : undefined),
    getAll: vi.fn(async (store: string) => (store === 'aiSummaries' ? summaries : documents)),
    getAllFromIndex: vi.fn(async (_store: string, _index: string, docId: string) =>
      (contentByDoc[docId] != null ? [{ version: 1, content: contentByDoc[docId] }] : [])),
    put: vi.fn(async () => undefined),
    delete: vi.fn(async () => undefined),
    transaction: vi.fn((storeName: string) => {
      const store = {
        get: async (id: string) => (storeName === 'documents' ? documents.find(d => d.id === id) : undefined),
        put: async (row: { id: string }) => {
          if (storeName === 'documents') {
            const at = documents.findIndex(d => d.id === row.id);
            if (at >= 0) documents[at] = row as { id: string; excludedFromAI?: boolean };
            else documents.push(row as { id: string; excludedFromAI?: boolean });
          }
        },
      };
      return { store, objectStore: () => store, done: Promise.resolve() };
    }),
  })),
}));
vi.mock('../../../../core/auth', () => ({ getCurrentUser: () => ({ uid: 'user_1' }) }));
vi.mock('../../../../core/data', () => ({ DataProvider: { deleteSummary: vi.fn(), deleteEmbedding: vi.fn() } }));
vi.mock('../AIService', () => ({ AIService: { summarize } }));
vi.mock('../AISummaryService', () => ({ AISummaryService: { save: saveSummary, delete: vi.fn() } }));
vi.mock('../AIEmbeddingService', () => ({ AIEmbeddingService: { delete: vi.fn() } }));
const indexPending = vi.fn(async () => ({ ok: 0, skipped: 0, failed: 0, stopped: null }));
vi.mock('../../utils/embeddingIndexer', () => ({
  indexDocument,
  indexPending,
  sha256Hex: vi.fn(async (text: string) => `hash:${text.length}`),
}));

const { NoteAnalysisService } = await import('../NoteAnalysisService');

const LONG = 'а'.repeat(200);

function okSummary() {
  return {
    ok: true,
    summary: { tone: 'ровный', frequentWords: [], insights: [], themes: [], extractedFacts: [] },
  };
}

describe('NoteAnalysisService.analyzePending', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    indexDocument.mockResolvedValue('ok');
    indexPending.mockResolvedValue({ ok: 0, skipped: 0, failed: 0, stopped: null });
    summarize.mockResolvedValue(okSummary());
    documents = [];
    summaries = [];
    contentByDoc = {};
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  /** Прогоняет проход, проматывая паузы между заметками. */
  async function run(opts?: Parameters<typeof NoteAnalysisService.analyzePending>[0]) {
    const promise = NoteAnalysisService.analyzePending(opts);
    await vi.runAllTimersAsync();
    return promise;
  }

  it('leaves out notes that would cost nothing but a refusal', async () => {
    documents = [
      { id: 'doc_ok' },
      { id: 'doc_excluded', excludedFromAI: true },
      { id: 'doc_short' },
      { id: 'doc_empty' },
    ];
    contentByDoc = {
      doc_ok: LONG,
      doc_excluded: LONG,
      doc_short: 'коротко',
      doc_empty: '   ',
    };

    const survey = await NoteAnalysisService.findPending();

    expect(survey.ids).toEqual(['doc_ok']);
    // Разбивка отвечает на вопрос «почему в очереди так мало»: без неё
    // отсеянные заметки просто исчезают из счётчика.
    expect(survey).toMatchObject({ totalDocuments: 4, excluded: 1, tooShort: 1, noContent: 1 });
  });

  it('skips a note whose text has not changed since its summary', async () => {
    documents = [{ id: 'doc_fresh' }, { id: 'doc_edited' }];
    contentByDoc = { doc_fresh: LONG, doc_edited: LONG };
    summaries = [
      { documentId: 'doc_fresh', contentHash: `hash:${LONG.length}` },
      { documentId: 'doc_edited', contentHash: 'hash:older' },
    ];

    const survey = await NoteAnalysisService.findPending();
    expect(survey.ids).toEqual(['doc_edited']);
    expect(survey.alreadyAnalyzed).toBe(1);
  });

  /**
   * Дневной лимит общий на сводки и векторы. Раньше indexDocument сообщал об
   * упёршемся лимите возвратом, а analyze этот возврат терял — проход добрал бы
   * остаток дня сводками без векторов и назвал это успехом.
   */
  it('stops when the vector half of the note hits the daily limit', async () => {
    documents = [{ id: 'doc_1' }, { id: 'doc_2' }, { id: 'doc_3' }];
    contentByDoc = { doc_1: LONG, doc_2: LONG, doc_3: LONG };
    indexDocument.mockResolvedValueOnce('ok').mockResolvedValueOnce('daily');

    const result = await run();

    expect(result).toEqual({ analyzed: 2, skipped: 0, failed: 0, missingVectors: 1, stopped: 'daily' });
    expect(summarize).toHaveBeenCalledTimes(2);
  });

  it('stops on the daily limit instead of walking the rest of the queue', async () => {
    documents = [{ id: 'doc_1' }, { id: 'doc_2' }, { id: 'doc_3' }];
    contentByDoc = { doc_1: LONG, doc_2: LONG, doc_3: LONG };
    summarize
      .mockResolvedValueOnce(okSummary())
      .mockResolvedValue({ ok: false, error: 'DAILY_LIMIT' });

    const result = await run();

    expect(result).toEqual({ analyzed: 1, skipped: 0, failed: 0, missingVectors: 0, stopped: 'daily' });
    expect(summarize).toHaveBeenCalledTimes(2);
  });

  it('gives up after three refusals in a row rather than burning the whole queue', async () => {
    documents = Array.from({ length: 10 }, (_, i) => ({ id: `doc_${i}` }));
    contentByDoc = Object.fromEntries(documents.map(d => [d.id, LONG]));
    summarize.mockResolvedValue({ ok: false, error: 'UPSTREAM' });

    const result = await run();

    expect(result).toEqual({ analyzed: 0, skipped: 0, failed: 3, missingVectors: 0, stopped: 'errors' });
    expect(summarize).toHaveBeenCalledTimes(3);
  });

  it('honours the limit so a run can be split across days', async () => {
    documents = [{ id: 'doc_1' }, { id: 'doc_2' }, { id: 'doc_3' }];
    contentByDoc = { doc_1: LONG, doc_2: LONG, doc_3: LONG };

    const result = await run({ limit: 2 });

    expect(result).toEqual({ analyzed: 2, skipped: 0, failed: 0, missingVectors: 0, stopped: null });
    expect(summarize).toHaveBeenCalledTimes(2);
  });

  /**
   * Цена заметки заранее неизвестна: каждое обязательство из неё векторизуется
   * отдельным вызовом, и на живом архиве вышло около восьми обращений на
   * заметку вместо двух. Значит попасть в минутное окно расчётом нельзя — можно
   * только пережить его ожиданием. Раньше первый же отказ обрывал проход.
   */
  it('waits out a rate refusal and retries the same note instead of stopping', async () => {
    documents = [{ id: 'doc_1' }, { id: 'doc_2' }];
    contentByDoc = { doc_1: LONG, doc_2: LONG };
    summarize
      .mockResolvedValueOnce({ ok: false, error: 'RATE_LIMIT' })
      .mockResolvedValue(okSummary());

    const result = await run();

    expect(result).toMatchObject({ analyzed: 2, stopped: null });
    // Три вызова на две заметки: отказавшая повторена, а не пропущена.
    expect(summarize).toHaveBeenCalledTimes(3);
  });

  it('gives up on rate only after waiting it out several times', async () => {
    documents = [{ id: 'doc_1' }];
    contentByDoc = { doc_1: LONG };
    summarize.mockResolvedValue({ ok: false, error: 'RATE_LIMIT' });

    const result = await run();

    expect(result).toMatchObject({ analyzed: 0, stopped: 'rate' });
    expect(summarize).toHaveBeenCalledTimes(4);
  });

  /**
   * Сводка сохранена и оплачена, а вектор не дался. Повторять заметку нельзя —
   * заплатим за сводку дважды; бросать тоже нельзя — очередь разбора смотрит на
   * сводки и второй раз эту заметку не предложит, вектора у неё не будет никогда.
   */
  it('does not re-pay for a note whose summary landed but vector was throttled', async () => {
    documents = [{ id: 'doc_1' }, { id: 'doc_2' }];
    contentByDoc = { doc_1: LONG, doc_2: LONG };
    indexDocument.mockResolvedValueOnce('rate').mockResolvedValue('ok');
    indexPending.mockResolvedValue({ ok: 1, skipped: 0, failed: 0, stopped: null });

    const result = await run();

    expect(summarize).toHaveBeenCalledTimes(2);
    expect(indexPending).toHaveBeenCalledOnce();
    // Догоняющий проход посчитал недостающий вектор — долг закрыт.
    expect(result).toMatchObject({ analyzed: 2, missingVectors: 0, stopped: null });
  });

  it('stops with auth when session is expired (AUTH_REQUIRED), not consent (S-18)', async () => {
    documents = [{ id: 'doc_1' }];
    contentByDoc = { doc_1: LONG };
    summarize.mockResolvedValue({ ok: false, error: 'AUTH_REQUIRED' });

    const result = await run();

    expect(result.stopped).not.toBe('consent');
    expect(result.stopped).toBe('auth');
  });
});

