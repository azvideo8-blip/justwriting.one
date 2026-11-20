import { describe, it, expect, vi, beforeEach } from 'vitest';
import 'fake-indexeddb/auto';

/**
 * Заметка, снятая с облака, держит номер, который в облаке принадлежит могиле.
 * С 0035 база отвергает разборы и векторы под надгробием — навсегда. Без
 * пропуска на клиенте каждый пересчёт писал бы `ai_summary_cloud_save`, вектор
 * висел бы в очереди выгрузки, а ручной проход считал бы их сбоями.
 *
 * Здесь все три пути: запись при разборе, фоновая очередь векторов, ручной
 * проход выгрузки — плюс панель расхождения, которая обязана решать как они.
 * Живая заметка рядом — чтобы пропуск не оказался «выгрузка сломана целиком».
 */

const saveSummary = vi.fn().mockResolvedValue(undefined);
const saveEmbedding = vi.fn().mockResolvedValue(undefined);

vi.mock('../../../../shared/errors/reportError', () => ({ reportError: vi.fn() }));
vi.mock('../../../../core/auth', () => ({ getCurrentUser: () => ({ uid: 'u1' }) }));
vi.mock('../../../../core/sync/cloudSyncEnabled', () => ({ cloudSyncEnabled: () => true }));
vi.mock('../../../../core/crypto/cryptoHelpers', () => ({
  maybeEncrypt: async (p: Record<string, unknown>) => p,
  maybeDecrypt: async (p: Record<string, unknown>) => p,
  getEncryptionEnabled: () => false,
  DecryptionError: class extends Error {},
}));
vi.mock('../../../../core/crypto/encrypt', () => ({ getSessionKey: () => null }));
vi.mock('../../../../core/data', () => ({
  DataProvider: {
    saveSummary: (...a: unknown[]) => saveSummary(...a),
    saveEmbedding: (...a: unknown[]) => saveEmbedding(...a),
    countSummaries: async () => 0,
    countEmbeddings: async () => 0,
    countLocalStoreRecords: async () => 0,
    // S-47: проход выгрузки сверяет облачные хвосты под надгробиями.
    getUserDocuments: async () => [{ uuid: LIVE }],
    listSummaryDocumentIds: async () => [],
    listEmbeddingDocumentIds: async () => [],
    listTombstonedDocumentUuids: async () => [],
  },
}));
vi.mock('../../../../core/services/LocalStoreSyncService', () => ({
  LocalStoreSyncService: {
    syncAllLocalStores: async () => ({ synced: 0, failed: 0, skippedLocked: false, skippedOversized: 0 }),
    scheduleStoreSync: vi.fn(),
  },
  SUPPORTED_LOCAL_STORES: [],
  getLocalStoreRecordCounts: async () => 0,
}));

const localDb = await import('../../../../core/storage/localDb');
const { AISummaryService } = await import('../AISummaryService');
const { AIEmbeddingService } = await import('../AIEmbeddingService');
const { AIDerivedDataSyncService } = await import('../AIDerivedDataSyncService');
const { reportError } = await import('../../../../shared/errors/reportError');

const LIVE = 'aaaaaaaa-bbbb-4ccc-8ddd-000000000001';
const BURIED = 'aaaaaaaa-bbbb-4ccc-8ddd-000000000002';
const MINE = 'aaaaaaaa-bbbb-4ccc-8ddd-000000000003';

const note = (id: string, extra: Record<string, unknown> = {}) => ({
  id, guestId: 'u1', title: '', currentVersion: 1, totalWords: 1, totalDuration: 0,
  sessionsCount: 1, firstSessionAt: 1, lastSessionAt: 1, tags: [], ...extra,
});
const summary = (documentId: string, documentUuid: string) => ({
  documentId, documentUuid, tone: 'ровный', frequentWords: [], insights: [], themes: [],
  extractedFacts: [], processedAt: 1, contentHash: 'h',
});
const embedding = (documentId: string, documentUuid: string) => ({
  documentId, documentUuid, vectors: [[0.1]], chunkTexts: [], model: 'm', dim: 1,
  contentHash: 'h', processedAt: 1, schemaV: 3,
});

// Ровно то, что оставляет `LocalDocumentService.unlinkFromCloud`.
const buriedUnlink = { linkedCloudId: '', localOnly: true, unlinkedByTombstone: true };
const userUnlink = { linkedCloudId: '', localOnly: true, unlinkedByTombstone: false };

const uploadedIds = (fn: typeof saveSummary) => fn.mock.calls.map(c => c[1] as string).sort();

beforeEach(async () => {
  vi.clearAllMocks();
  localStorage.clear();
  const db = await localDb.getLocalDb('u1');
  for (const store of ['documents', 'aiSummaries', 'aiEmbeddings', 'aiTimeline'] as const) await db.clear(store);
  await db.put('documents', note('local_live', { uuid: LIVE, linkedCloudId: LIVE }) as never);
  await db.put('documents', note('local_buried', { uuid: BURIED, ...buriedUnlink }) as never);
  await db.put('documents', note('local_mine', { uuid: MINE, ...userUnlink }) as never);
});

describe('derivatives of notes unlinked from the cloud stay local', () => {
  it('analysis write: summary of an unlinked note is not uploaded and not reported', async () => {
    await AISummaryService.save(summary('local_live', LIVE) as never);
    await AISummaryService.save(summary('local_buried', BURIED) as never);
    await AISummaryService.save(summary('local_mine', MINE) as never);

    expect(uploadedIds(saveSummary)).toEqual([LIVE]);
    expect(reportError).not.toHaveBeenCalled();
    // Локальный разбор никуда не делся.
    const db = await localDb.getLocalDb('u1');
    expect(await db.get('aiSummaries', 'local_buried')).toBeTruthy();
  });

  it('embedding write + pending queue: unlinked note is not uploaded, not queued, not marked', async () => {
    await AIEmbeddingService.save(embedding('local_live', LIVE) as never);
    await AIEmbeddingService.save(embedding('local_buried', BURIED) as never);
    await AIEmbeddingService.save(embedding('local_mine', MINE) as never);

    expect(uploadedIds(saveEmbedding)).toEqual([LIVE]);
    expect(reportError).not.toHaveBeenCalled();

    saveEmbedding.mockClear();
    const res = await AIEmbeddingService.syncPendingToCloud();
    expect(res).toEqual({ synced: 0, pending: 0, locked: false, failed: 0, waiting: 0 });
    expect(saveEmbedding).not.toHaveBeenCalled();

    // Запись на месте и без пометок: вернётся заметка в облако — уедет.
    const db = await localDb.getLocalDb('u1');
    const kept = await db.get('aiEmbeddings', 'local_buried');
    expect(kept).toBeTruthy();
    expect(kept?.cloudSyncedAt).toBeUndefined();
    expect(kept?.cloudSkipped).toBeUndefined();

    await db.put('documents', note('local_buried', { uuid: BURIED, linkedCloudId: BURIED }) as never);
    const relinked = await AIEmbeddingService.syncPendingToCloud();
    expect(relinked.synced).toBe(1);
    expect(uploadedIds(saveEmbedding)).toEqual([BURIED]);
  });

  it('manual backfill: unlinked notes are neither uploaded nor counted as failures', async () => {
    const db = await localDb.getLocalDb('u1');
    for (const [id, uuid] of [['local_live', LIVE], ['local_buried', BURIED], ['local_mine', MINE]] as const) {
      await db.put('aiSummaries', summary(id, uuid) as never);
      await db.put('aiEmbeddings', embedding(id, uuid) as never);
    }

    const res = await AIDerivedDataSyncService.syncAllDerivedData('u1');

    expect(uploadedIds(saveSummary)).toEqual([LIVE]);
    expect(uploadedIds(saveEmbedding)).toEqual([LIVE]);
    expect(res.summaries).toEqual({ synced: 1, failed: 0, orphaned: 0 });
    expect(res.embeddings).toEqual({ synced: 1, failed: 0, orphaned: 0 });
    expect(reportError).not.toHaveBeenCalled();

    // Панель решает как выгрузка: местные не отправляемые и не сироты.
    const drift = await AIDerivedDataSyncService.getDerivedDrift('u1');
    expect(drift.summaries).toMatchObject({ local: 1, orphaned: 0 });
    expect(drift.embeddings).toMatchObject({ local: 1, orphaned: 0 });
  });
});
