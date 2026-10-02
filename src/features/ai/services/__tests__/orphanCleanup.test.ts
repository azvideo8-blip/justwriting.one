import { describe, it, expect, vi, beforeEach } from 'vitest';
import 'fake-indexeddb/auto';

/**
 * Уборка производных, за которыми не осталось заметки.
 *
 * Главное свойство здесь не «удаляет», а «не удаляет лишнего». «Заметки нет на
 * устройстве» и «заметки нет вообще» — разные вещи: на втором устройстве
 * локально лежит только часть архива. Уборка по одному локальному признаку
 * снесла бы разборы живых заметок, и восстановить их было бы неоткуда.
 */

const getUserDocuments = vi.fn();
const listSummaryDocumentIds = vi.fn(async () => [] as string[]);
const listEmbeddingDocumentIds = vi.fn(async () => [] as string[]);
const deleteSummary = vi.fn(async () => {});
const deleteEmbedding = vi.fn(async () => {});
// S-47: надгробие подтверждается отдельным чтением; здесь — всё, о чём спросили.
const listTombstonedDocumentUuids = vi.fn(async (_u: string, ids: string[]) => ids);

vi.mock('../../../../core/data', () => ({
  DataProvider: { getUserDocuments, listSummaryDocumentIds, listEmbeddingDocumentIds, listTombstonedDocumentUuids, deleteSummary, deleteEmbedding },
}));
vi.mock('../../../../core/crypto/cryptoHelpers', () => ({ getEncryptionEnabled: () => false }));
vi.mock('../../../../core/crypto/encrypt', () => ({ getSessionKey: () => null }));
vi.mock('../../../../core/services/LocalStoreSyncService', () => ({
  LocalStoreSyncService: { syncAllLocalStores: vi.fn() },
  getLocalStoreRecordCounts: vi.fn(async () => 0),
}));
vi.mock('../AISummaryService', () => ({ saveSummaryToCloud: vi.fn() }));
vi.mock('../AIEmbeddingService', () => ({ saveEmbeddingToCloud: vi.fn() }));
vi.mock('../../../../shared/errors/reportError', () => ({ reportError: vi.fn() }));

const { AIDerivedDataSyncService } = await import('../AIDerivedDataSyncService');
const { getLocalDb } = await import('../../../../core/storage/localDb');

const CLOUD_ONLY = 'cccccccc-1111-4222-8333-444444444444';
const LOCAL_AND_CLOUD = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
const GHOST = 'ffffffff-9999-4888-8777-666666666666';
/** S-46/S-47: заметки нет на устройстве, в облаке она под надгробием. */
const TOMBSTONED = 'dddddddd-2222-4333-8444-555555555555';

async function seed() {
  const db = await getLocalDb('user-1');
  for (const store of ['documents', 'aiSummaries', 'aiEmbeddings'] as const) {
    for (const r of await db.getAll(store)) {
      await db.delete(store, (r as { id?: string; documentId?: string }).id
        ?? (r as { documentId: string }).documentId);
    }
  }
  await db.put('documents', {
    id: 'local_1', uuid: LOCAL_AND_CLOUD, guestId: 'u1', title: 'Живая',
    currentVersion: 1, totalWords: 1, totalDuration: 0, sessionsCount: 1,
    firstSessionAt: 1, lastSessionAt: 1, tags: [],
  } as never);

  const summary = (documentId: string, documentUuid?: string) => ({
    documentId, ...(documentUuid ? { documentUuid } : {}),
    tone: 'ровный', frequentWords: [], insights: [], themes: [],
    extractedFacts: [], processedAt: 1, contentHash: 'h',
  });
  await db.put('aiSummaries', summary('local_1', LOCAL_AND_CLOUD) as never);
  await db.put('aiSummaries', summary(CLOUD_ONLY) as never);
  await db.put('aiSummaries', summary(GHOST) as never);
  await db.put('aiEmbeddings', {
    documentId: GHOST, vectors: [[0.1]], chunkTexts: [], model: 'm', dim: 1,
    contentHash: 'h', processedAt: 1, schemaV: 3,
  } as never);
}

describe('уборка производных без заметки', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    await seed();
  });

  /**
   * CLOUD_ONLY — заметка, которой нет на этом устройстве, но она жива в облаке.
   * Её разбор трогать нельзя.
   */
  it('сиротой считается только то, чего нет ни здесь, ни в облаке', async () => {
    getUserDocuments.mockResolvedValue([{ uuid: LOCAL_AND_CLOUD }, { uuid: CLOUD_ONLY }]);

    const survey = await AIDerivedDataSyncService.findOrphanedDerivatives('user-1');

    expect(survey.cloudChecked).toBe(true);
    expect(survey.summaries).toEqual([GHOST]);
    expect(survey.embeddings).toEqual([GHOST]);
  });

  it('при недоступном облаке не находит ничего — вывод о сиротстве делать не на чем', async () => {
    getUserDocuments.mockRejectedValue(new Error('network'));

    const survey = await AIDerivedDataSyncService.findOrphanedDerivatives('user-1');

    expect(survey).toEqual({ summaries: [], embeddings: [], cloudSummaries: [], cloudEmbeddings: [], cloudChecked: false });
  });

  /**
   * S-46 (R6Q-043): облачная строка под надгробием. TOMBSTONED снята в облаке
   * (`deleted_at` стоит, в списке живых её нет) и на устройстве её нет — её
   * разбор и вектор в облаке лежат хвостом. CLOUD_ONLY жива — её строки
   * трогать нельзя. S-47: заметка, известная устройству (LOCAL_AND_CLOUD),
   * из облачной уборки исключена, даже если список живых её не содержит.
   */
  it('S-46: облачные разборы и векторы под надгробием находятся и удаляются из облака', async () => {
    getUserDocuments.mockResolvedValue([{ uuid: CLOUD_ONLY }]);
    const summaryIds = [CLOUD_ONLY, LOCAL_AND_CLOUD, TOMBSTONED];
    listSummaryDocumentIds.mockResolvedValueOnce(summaryIds).mockResolvedValueOnce(summaryIds);
    listEmbeddingDocumentIds.mockResolvedValueOnce([LOCAL_AND_CLOUD, TOMBSTONED]).mockResolvedValueOnce([LOCAL_AND_CLOUD, TOMBSTONED]);

    const survey = await AIDerivedDataSyncService.findOrphanedDerivatives('user-1');
    expect(survey.cloudSummaries).toEqual([TOMBSTONED]);
    expect(survey.cloudEmbeddings).toEqual([TOMBSTONED]);

    // Отказ облачного DELETE не считается удалённым.
    deleteEmbedding.mockRejectedValueOnce(new Error('Failed to fetch'));
    const removed = await AIDerivedDataSyncService.deleteOrphanedDerivatives('user-1');
    expect(deleteSummary).toHaveBeenCalledWith('user-1', TOMBSTONED);
    expect(deleteEmbedding).toHaveBeenCalledWith('user-1', TOMBSTONED);
    expect(deleteSummary).not.toHaveBeenCalledWith('user-1', CLOUD_ONLY);
    expect(deleteSummary).not.toHaveBeenCalledWith('user-1', LOCAL_AND_CLOUD);
    // GHOST локально (разбор + вектор) + облачный разбор; облачный вектор отказал.
    expect(removed).toEqual({ summaries: 2, embeddings: 1, failed: 1 });
  });

  it('S-46: отказ списка облачных строк — сверки не было, ничего не удаляется', async () => {
    getUserDocuments.mockResolvedValue([{ uuid: LOCAL_AND_CLOUD }, { uuid: CLOUD_ONLY }]);
    listEmbeddingDocumentIds.mockRejectedValueOnce(new Error('network'));

    const survey = await AIDerivedDataSyncService.findOrphanedDerivatives('user-1');

    expect(survey.cloudChecked).toBe(false);
    expect(survey.summaries).toEqual([]);
  });

  it('убирает только сирот, живые разборы остаются', async () => {
    getUserDocuments.mockResolvedValue([{ uuid: LOCAL_AND_CLOUD }, { uuid: CLOUD_ONLY }]);

    const removed = await AIDerivedDataSyncService.deleteOrphanedDerivatives('user-1');

    expect(removed).toEqual({ summaries: 1, embeddings: 1, failed: 0 });

    const db = await getLocalDb('user-1');
    const left = (await db.getAll('aiSummaries')).map(r => r.documentId).sort();
    expect(left).toEqual(['local_1', CLOUD_ONLY].sort());
  });

  it('при недоступном облаке не удаляет ничего', async () => {
    getUserDocuments.mockRejectedValue(new Error('network'));

    const removed = await AIDerivedDataSyncService.deleteOrphanedDerivatives('user-1');

    expect(removed).toEqual({ summaries: 0, embeddings: 0, failed: 0 });
    const db = await getLocalDb('user-1');
    expect(await db.count('aiSummaries')).toBe(3);
  });

  /**
   * Отдельная проверка самой защиты в удалении, а не её следствия. Сейчас
   * опись при недоступном облаке и так возвращает пустоту, поэтому снятие
   * этой ветки ничего не ломало — то есть защита не проверялась ничем. Здесь
   * опись подменена: она отдаёт кандидатов и говорит, что сверки не было.
   */
  it('не удаляет по неподтверждённой описи, даже если та принесла кандидатов', async () => {
    const spy = vi.spyOn(AIDerivedDataSyncService, 'findOrphanedDerivatives')
      .mockResolvedValue({ summaries: [GHOST], embeddings: [GHOST], cloudSummaries: [], cloudEmbeddings: [], cloudChecked: false });

    const removed = await AIDerivedDataSyncService.deleteOrphanedDerivatives('user-1');

    expect(removed).toEqual({ summaries: 0, embeddings: 0, failed: 0 });
    const db = await getLocalDb('user-1');
    expect(await db.count('aiSummaries')).toBe(3);
    spy.mockRestore();
  });

  it('гостю уборка недоступна: у него нет облака, с которым сверяться', async () => {
    const survey = await AIDerivedDataSyncService.findOrphanedDerivatives('guest_abc');

    expect(survey.cloudChecked).toBe(false);
    expect(getUserDocuments).not.toHaveBeenCalled();
  });
});
