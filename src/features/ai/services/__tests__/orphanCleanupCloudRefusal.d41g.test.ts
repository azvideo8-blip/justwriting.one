// d41g (Н-7): deleteOrphanedDerivatives делает повторную опись; при отказе облака
// findOrphanedDerivatives возвращает cloudChecked:false, а уборка отвечает
// {summaries:0, embeddings:0, failed:0} (AIDerivedDataSyncService.ts:353-355) —
// без признака отказа. SyncSettingsSection:184-190 показывает зелёное
// «Убрано: 0/0», хотя сверка не состоялась (первая опись в том же обработчике
// cloudChecked проверяет — асимметрия внутри одного потока).
// Настоящий сервис поверх fake-indexeddb; мок только край (облачные списки).
import { describe, it, expect, vi, beforeEach } from 'vitest';
import 'fake-indexeddb/auto';

const getUserDocuments = vi.hoisted(() => vi.fn());

vi.mock('@/core/data', () => ({
  DataProvider: {
    getUserDocuments,
    listSummaryDocumentIds: vi.fn(async () => []),
    listEmbeddingDocumentIds: vi.fn(async () => []),
    deleteSummary: vi.fn(async () => {}),
    deleteEmbedding: vi.fn(async () => {}),
  },
}));
vi.mock('@/core/services/LocalStoreSyncService', () => ({
  LocalStoreSyncService: { scheduleStoreSync: vi.fn() },
  SUPPORTED_LOCAL_STORES: [],
  getLocalStoreRecordCounts: vi.fn(async () => ({})),
}));
vi.mock('@/features/ai/services/AISummaryService', () => ({ saveSummaryToCloud: vi.fn(async () => {}) }));
vi.mock('@/features/ai/services/AIEmbeddingService', () => ({ saveEmbeddingToCloud: vi.fn(async () => {}) }));
vi.mock('@/shared/errors/reportError', () => ({ reportError: vi.fn() }));
// FN-7: край локального хранилища — удаление записи может отказать (квота/сбой IDB).
const failLocalDelete = vi.hoisted(() => ({ on: false }));
vi.mock('@/core/storage/localDb', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/core/storage/localDb')>();
  return {
    ...actual,
    getLocalDb: async (uid?: string) => {
      const db = await actual.getLocalDb(uid);
      if (!failLocalDelete.on) return db;
      return new Proxy(db, {
        get(target, prop) {
          if (prop === 'delete') return async () => { throw new Error('MARKER_IDB_DOWN'); };
          const v = Reflect.get(target, prop) as unknown;
          return typeof v === 'function' ? v.bind(target) : v;
        },
      });
    },
  };
});

import { AIDerivedDataSyncService } from '@/features/ai/services/AIDerivedDataSyncService';
import { getLocalDb } from '@/core/storage/localDb';

const USER = 'u-d41g';

beforeEach(async () => {
  vi.clearAllMocks();
  const db = await getLocalDb(USER);
  await db.clear('aiSummaries');
  await db.clear('aiEmbeddings');
  await db.clear('documents');
});

describe('d41g: отказ облачной сверки при уборке сирот назван в итоге', () => {
  it('облако не прочиталось — итог несёт признак отказа, а не «убрано 0, ошибок 0»', async () => {
    getUserDocuments.mockRejectedValue(new Error('MARKER_DAILY_CLOUD_DOWN'));
    const res = await AIDerivedDataSyncService.deleteOrphanedDerivatives(USER);
    expect(getUserDocuments, 'край не вызван — тест ничего не проверяет').toHaveBeenCalled();
    const named = res.failed > 0 || (res as { cloudChecked?: boolean }).cloudChecked === false;
    expect(
      named,
      'сверка с облаком не состоялась, а возврат {0,0,0} неотличим от успешной уборки — UI покажет зелёное «Убрано: 0/0»',
    ).toBe(true);
  });

  it('КОНТРОЛЬ: облако ответило, сирота есть — удалена, failed=0', async () => {
    getUserDocuments.mockResolvedValue([]);
    const db = await getLocalDb(USER);
    await db.put('aiSummaries', { documentId: 'orphan_d41g', summary: 'MARKER_DAILY_ORPHAN' } as never);
    const res = await AIDerivedDataSyncService.deleteOrphanedDerivatives(USER);
    expect(res.summaries).toBe(1);
    expect(res.failed).toBe(0);
    expect(await db.getAll('aiSummaries')).toHaveLength(0);
  });

  // FN-7: отказ локального удаления сироты — в failed, а не молчаливый остаток.
  it('FN-7: локальное удаление отказало — failed>0, не «убрано, ошибок 0»', async () => {
    getUserDocuments.mockResolvedValue([]);
    const db = await getLocalDb(USER);
    await db.put('aiSummaries', { documentId: 'orphan_fn7', summary: 'MARKER_ORPHAN' } as never);
    failLocalDelete.on = true;
    let res: Awaited<ReturnType<typeof AIDerivedDataSyncService.deleteOrphanedDerivatives>>;
    try { res = await AIDerivedDataSyncService.deleteOrphanedDerivatives(USER); } finally { failLocalDelete.on = false; }
    expect(res.summaries).toBe(0);
    expect(res.failed).toBeGreaterThan(0);
    expect(res.cloudChecked).toBe(true);
  });
});
