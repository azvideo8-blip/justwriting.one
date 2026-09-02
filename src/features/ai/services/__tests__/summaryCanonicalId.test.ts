import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Сводка уезжает в облако под ПОСТОЯННЫМ номером заметки.
 *
 * Политика доступа в базе проверяет
 *   exists (select 1 from documents d where d.uuid = document_id and d.user_id = auth.uid())
 * — под локальным номером строка отклоняется. Наверху стоит `.catch`, который
 * только пишет в журнал, а повтора нет ни на записи при разборе, ни в ручном
 * проходе выгрузки: сводка навсегда остаётся в одном браузере. Для векторов это
 * было починено в 0.8.22, для сводок — нет.
 */

const saveSummary = vi.fn();
const dbPut = vi.fn(async () => undefined);
let documents: { id: string; uuid?: string }[] = [];

vi.mock('../../../../core/storage/localDb', () => ({
  getLocalDb: vi.fn(async () => ({
    get: vi.fn(async (store: string, id: string) =>
      (store === 'documents' ? documents.find(d => d.id === id) : undefined)),
    put: dbPut,
    getAll: vi.fn(async () => []),
  })),
}));
vi.mock('../../../../core/auth', () => ({ getCurrentUser: () => ({ uid: 'user_1' }) }));
vi.mock('../../../../core/data', () => ({ DataProvider: { saveSummary } }));
vi.mock('../../../../core/crypto/cryptoHelpers', () => ({
  maybeEncrypt: vi.fn(async (o: unknown) => o),
  maybeDecrypt: vi.fn(async (o: unknown) => o),
}));
vi.mock('../../../../shared/errors/reportError', () => ({ reportError: vi.fn() }));
vi.mock('../../../../core/services/LocalStoreSyncService', () => ({
  LocalStoreSyncService: { scheduleStoreSync: vi.fn() },
}));
vi.mock('../../../../core/sync/cloudSyncEnabled', () => ({ cloudSyncEnabled: () => true }));

const { saveSummaryToCloud } = await import('../AISummaryService');

const summary = (extra: Record<string, unknown> = {}) => ({
  documentId: 'local_123',
  tone: 'ровный',
  frequentWords: [],
  insights: [],
  themes: [],
  extractedFacts: [],
  processedAt: 1,
  contentHash: 'h',
  ...extra,
}) as never;

describe('saveSummaryToCloud', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    documents = [{ id: 'local_123', uuid: 'uuid-abc' }];
  });

  it('uploads under the permanent id the access policy checks, not the local one', async () => {
    await saveSummaryToCloud('user_1', summary({ documentUuid: 'uuid-abc' }));

    expect(saveSummary).toHaveBeenCalledWith('user_1', 'uuid-abc', expect.anything());
  });

  it('recovers the permanent id from the note when an old row has none', async () => {
    await saveSummaryToCloud('user_1', summary());

    expect(saveSummary).toHaveBeenCalledWith('user_1', 'uuid-abc', expect.anything());
    // И запоминает найденное, чтобы следующий проход не искал заново.
    expect(dbPut).toHaveBeenCalledWith('aiSummaries', expect.objectContaining({ documentUuid: 'uuid-abc' }));
  });

  /**
   * Без постоянного номера выгружать нечего: база откажет. Молчаливый успех
   * здесь хуже отказа — проход выгрузки отчитается за строки, которых в облаке
   * не появилось.
   */
  it('refuses loudly instead of uploading under an id the policy will reject', async () => {
    documents = [{ id: 'local_123' }];

    await expect(saveSummaryToCloud('user_1', summary())).rejects.toThrow(/NO_CANONICAL_ID/);
    expect(saveSummary).not.toHaveBeenCalled();
  });
});
