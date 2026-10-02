import { describe, it, expect, vi, beforeEach } from 'vitest';
import 'fake-indexeddb/auto';

/**
 * S-47: облачная производная удаляется только под ПОДТВЕРЖДЁННЫМ надгробием.
 * «Нет в списке живых заметок» доказательством не было: postgrest отдаёт 200 с
 * пустым телом как `[]`, страница из 1000 обрезается при параллельных
 * удалениях, заметка создаётся между двумя чтениями — и по такому списку
 * сиротой выглядит разбор живой заметки.
 */

const getUserDocuments = vi.fn();
const listSummaryDocumentIds = vi.fn(async () => [] as string[]);
const listEmbeddingDocumentIds = vi.fn(async () => [] as string[]);
const listTombstonedDocumentUuids = vi.fn<(u: string, ids: string[]) => Promise<string[]>>(async () => []);
const deleteSummary = vi.fn<(u: string, id: string) => Promise<void>>(async () => {});
const deleteEmbedding = vi.fn<(u: string, id: string) => Promise<void>>(async () => {});
const saveSummaryToCloud = vi.fn(async () => {});
const reportError = vi.fn();

vi.mock('../../../../core/data', () => ({
  DataProvider: { getUserDocuments, listSummaryDocumentIds, listEmbeddingDocumentIds, listTombstonedDocumentUuids, deleteSummary, deleteEmbedding },
}));
vi.mock('../../../../core/crypto/cryptoHelpers', () => ({ getEncryptionEnabled: () => false }));
vi.mock('../../../../core/crypto/encrypt', () => ({ getSessionKey: () => null }));
vi.mock('../../../../core/services/LocalStoreSyncService', () => ({
  LocalStoreSyncService: { syncAllLocalStores: vi.fn() },
  getLocalStoreRecordCounts: vi.fn(async () => 0),
}));
vi.mock('../AISummaryService', () => ({ saveSummaryToCloud }));
vi.mock('../AIEmbeddingService', () => ({ saveEmbeddingToCloud: vi.fn() }));
vi.mock('../../../../shared/errors/reportError', () => ({ reportError }));

const { AIDerivedDataSyncService } = await import('../AIDerivedDataSyncService');
const { getLocalDb } = await import('../../../../core/storage/localDb');

const UID = 'user-s47';
const LOCAL_LIVE = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';   // заметка на устройстве
const CLOUD_LIVE = 'cccccccc-1111-4222-8333-444444444444';   // живая только в облаке
const TOMBSTONED = 'dddddddd-2222-4333-8444-555555555555';   // в облаке под надгробием
const UNKNOWN = 'eeeeeeee-3333-4444-8555-666666666666';      // строки заметки в облаке нет вовсе

async function seed() {
  const db = await getLocalDb(UID);
  for (const store of ['documents', 'aiSummaries', 'aiEmbeddings'] as const) await db.clear(store);
  await db.put('documents', {
    id: 'local_1', uuid: LOCAL_LIVE, guestId: UID, title: 'Живая',
    currentVersion: 1, totalWords: 1, totalDuration: 0, sessionsCount: 1,
    firstSessionAt: 1, lastSessionAt: 1, tags: [],
  } as never);
  await db.put('aiSummaries', {
    documentId: 'local_1', documentUuid: LOCAL_LIVE,
    tone: 'ровный', frequentWords: [], insights: [], themes: [], extractedFacts: [], processedAt: 1, contentHash: 'h',
  } as never);
}

const ALL_CLOUD = [LOCAL_LIVE, CLOUD_LIVE, TOMBSTONED, UNKNOWN];

beforeEach(async () => {
  vi.clearAllMocks();
  listSummaryDocumentIds.mockResolvedValue(ALL_CLOUD);
  listEmbeddingDocumentIds.mockResolvedValue(ALL_CLOUD);
  listTombstonedDocumentUuids.mockImplementation(async (_u, ids) => ids.filter(id => id === TOMBSTONED));
  await seed();
});

describe('S-47: cloud derivative cleanup deletes only under a confirmed tombstone', () => {
  it('an empty notes listing while cloud derivatives exist aborts the survey: nothing is a candidate', async () => {
    getUserDocuments.mockResolvedValue([]);

    const survey = await AIDerivedDataSyncService.findOrphanedDerivatives(UID);
    expect(survey.cloudChecked).toBe(false);
    expect(survey.cloudSummaries).toEqual([]);
    expect(survey.summaries).toEqual([]);
    expect(reportError).toHaveBeenCalledWith(expect.objectContaining({ message: expect.stringContaining('EMPTY_NOTES_LISTING') }), expect.anything(), 'warning');

    const removed = await AIDerivedDataSyncService.deleteOrphanedDerivatives(UID);
    expect(removed).toEqual({ summaries: 0, embeddings: 0, failed: 0 });
    expect(deleteSummary).not.toHaveBeenCalled();
    expect(deleteEmbedding).not.toHaveBeenCalled();
    expect(await (await getLocalDb(UID)).count('aiSummaries')).toBe(1);
  });

  it('a truncated listing: only ids confirmed tombstoned are deleted, never a locally known note or an unconfirmed id', async () => {
    // Список живых обрезан: в нём нет ни LOCAL_LIVE, ни CLOUD_LIVE.
    getUserDocuments.mockResolvedValue([{ uuid: 'ffffffff-0000-4000-8000-000000000000' }]);

    const survey = await AIDerivedDataSyncService.findOrphanedDerivatives(UID);
    expect(survey.cloudChecked).toBe(true);
    expect(survey.cloudSummaries).toEqual([TOMBSTONED]);
    expect(survey.cloudEmbeddings).toEqual([TOMBSTONED]);
    // Заметка, известная устройству, в проверку надгробий не попадает вовсе.
    for (const call of listTombstonedDocumentUuids.mock.calls) expect(call[1]).not.toContain(LOCAL_LIVE);

    const removed = await AIDerivedDataSyncService.deleteOrphanedDerivatives(UID);
    expect(deleteSummary.mock.calls.map(c => c[1])).toEqual([TOMBSTONED]);
    expect(deleteEmbedding.mock.calls.map(c => c[1])).toEqual([TOMBSTONED]);
    expect(removed).toEqual({ summaries: 1, embeddings: 1, failed: 0 });
  });

  it('a rejected cloud summary delete is counted as a failure, not as removed', async () => {
    getUserDocuments.mockResolvedValue([{ uuid: LOCAL_LIVE }, { uuid: CLOUD_LIVE }]);
    deleteSummary.mockRejectedValueOnce(new Error('Failed to fetch'));

    const removed = await AIDerivedDataSyncService.deleteOrphanedDerivatives(UID);
    expect(removed).toEqual({ summaries: 0, embeddings: 1, failed: 1 });
  });

  it('the tombstone query failing means no cloud check — nothing is deleted', async () => {
    getUserDocuments.mockResolvedValue([{ uuid: LOCAL_LIVE }, { uuid: CLOUD_LIVE }]);
    listTombstonedDocumentUuids.mockRejectedValue(new Error('network'));

    const survey = await AIDerivedDataSyncService.findOrphanedDerivatives(UID);
    expect(survey.cloudChecked).toBe(false);
    expect(await AIDerivedDataSyncService.deleteOrphanedDerivatives(UID)).toEqual({ summaries: 0, embeddings: 0, failed: 0 });
  });

  it('R6Q-043: the summaries upload pass also sweeps confirmed-tombstoned cloud summaries, and only those', async () => {
    getUserDocuments.mockResolvedValue([{ uuid: LOCAL_LIVE }, { uuid: CLOUD_LIVE }]);

    await AIDerivedDataSyncService.syncAllSummaries(UID);

    expect(saveSummaryToCloud).toHaveBeenCalledTimes(1);
    expect(deleteSummary.mock.calls.map(c => c[1])).toEqual([TOMBSTONED]);
    expect(deleteEmbedding).not.toHaveBeenCalled();
  });
});
