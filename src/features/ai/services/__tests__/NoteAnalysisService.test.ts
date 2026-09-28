import { describe, it, expect, vi, beforeEach } from 'vitest';

const summarize = vi.fn();
const saveSummary = vi.fn();
const deleteSummary = vi.fn().mockResolvedValue(undefined);
const deleteEmbedding = vi.fn().mockResolvedValue(undefined);
const indexDocument = vi.fn().mockResolvedValue('ok');
const dbPut = vi.fn().mockResolvedValue(undefined);
const dbDelete = vi.fn().mockResolvedValue(undefined);

let versions: { version: number; content: string }[] = [];

/** Строки `documents`: их читает и пишет и обычный get, и транзакция. */
let docRows = new Map<string, Record<string, unknown>>([['doc_1', { id: 'doc_1', aiProcessed: true }]]);

vi.mock('../../../../core/storage/localDb', () => ({
  getLocalDb: vi.fn(async () => ({
    get: vi.fn(async (store: string, id?: string) =>
      store === 'documents' ? (id ? docRows.get(id) : undefined) ?? docRows.get('doc_1') : undefined),
    getAll: vi.fn(async () => []),
    getAllFromIndex: vi.fn(async () => versions),
    put: dbPut,
    delete: dbDelete,
    transaction: vi.fn((storeName: string) => {
      const store = {
        get: async (id: string) => (storeName === 'documents' ? docRows.get(id) : undefined),
        put: async (row: { id: string }) => {
          if (storeName === 'documents') docRows.set(row.id, row as Record<string, unknown>);
          await dbPut(row);
        },
      };
      return { store, objectStore: () => store, done: Promise.resolve() };
    }),
  })),
}));
vi.mock('../../../../core/auth', () => ({ getCurrentUser: () => ({ uid: 'user_1' }) }));
vi.mock('../../../../core/data', () => ({ DataProvider: { deleteSummary, deleteEmbedding } }));
vi.mock('../AIService', () => ({ AIService: { summarize } }));
vi.mock('../AISummaryService', () => ({ AISummaryService: { save: saveSummary, delete: dbDelete } }));
vi.mock('../AIEmbeddingService', () => ({ AIEmbeddingService: { delete: dbDelete } }));
vi.mock('../../utils/embeddingIndexer', () => ({
  indexDocument,
  sha256Hex: vi.fn(async () => 'hash'),
}));

const { NoteAnalysisService } = await import('../NoteAnalysisService');

describe('NoteAnalysisService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    docRows = new Map([['doc_1', { id: 'doc_1', aiProcessed: true }]]);
    indexDocument.mockResolvedValue('ok');
  });

  /**
   * Разбор идёт только по нажатию, и короткая заметка не должна тратить на себя
   * ни запроса: до появления кнопки этот отсев жил внутри фонового прохода.
   */
  it('sends nothing to the provider for a note below the length floor', async () => {
    versions = [{ version: 1, content: 'коротко' }];

    const res = await NoteAnalysisService.analyze('doc_1');

    expect(res).toEqual({ ok: false, error: 'TOO_SHORT' });
    expect(summarize).not.toHaveBeenCalled();
    expect(indexDocument).not.toHaveBeenCalled();
  });

  it('saves the summary and computes the vector for a real note', async () => {
    versions = [{ version: 1, content: 'а'.repeat(200) }];
    summarize.mockResolvedValue({
      ok: true,
      summary: { tone: 'спокойный', frequentWords: [], insights: [], themes: [], extractedFacts: [] },
    });

    const res = await NoteAnalysisService.analyze('doc_1');

    expect(res).toEqual({ ok: true, indexed: 'ok' });
    expect(saveSummary).toHaveBeenCalledOnce();
    expect(indexDocument).toHaveBeenCalledWith('doc_1', true);
  });

  /**
   * «Удалить разбор» обязано доставать и облачные копии. Локального удаления
   * мало: сводка и вектор остались бы лежать в базе, и кнопка врала бы.
   */
  it('clears the cloud copies, not only the local ones', async () => {
    await NoteAnalysisService.clear('doc_1');

    expect(deleteSummary).toHaveBeenCalledWith('user_1', 'doc_1');
    expect(deleteEmbedding).toHaveBeenCalledWith('user_1', 'doc_1');
  });

  it('survives a failing vector without losing the summary', async () => {
    versions = [{ version: 1, content: 'б'.repeat(200) }];
    summarize.mockResolvedValue({
      ok: true,
      summary: { tone: 'ровный', frequentWords: [], insights: [], themes: [], extractedFacts: [] },
    });
    indexDocument.mockRejectedValue(new Error('провайдер недоступен'));

    const res = await NoteAnalysisService.analyze('doc_1');

    // Сводка сохранена, но провал вектора назван провалом: проход по архиву
    // принимает решение остановиться именно по этому полю.
    expect(res).toEqual({ ok: true, indexed: 'error' });
    expect(saveSummary).toHaveBeenCalledOnce();
  });
});
