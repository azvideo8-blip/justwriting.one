// d41f (Н-6): syncAllUnlinked выбрасывает результат _drainPendingQueue
// (SyncService.ts:341): {drained, failed} не читается, возврат считает только
// выгрузки (:348). Очередь не дренировалась (N отказов), toUpload пуст —
// {synced:0, failed:0}, и SyncSettingsSection:133 показывает зелёное
// «Синхронизировано: 0», а uDD:327 — «Все локальные заметки выгружены в облако».
// Настоящий SyncService поверх fake-indexeddb; моки только края (облако, список
// локальных документов, заморозки стрика).
import { describe, it, expect, vi, beforeEach } from 'vitest';
import 'fake-indexeddb/auto';

const removeCloudCopy = vi.hoisted(() => vi.fn());
const USER = 'u-d41f';

vi.mock('@/core/services/CloudSyncService', () => ({
  CloudSyncService: {
    relinkOrphanedDocuments: vi.fn(async () => ({ skippedIds: [], relinked: 0 })),
    removeCloudCopy,
  },
  CLOUD_COPY_LOCAL_ONLY: 'LOCAL_ONLY',
  CLOUD_COPY_TOMBSTONE: 'TOMBSTONE',
}));
vi.mock('@/core/services/LocalDocumentService', () => ({
  LocalDocumentService: { getDocumentsByOwner: vi.fn(async () => []) },
}));
vi.mock('@/core/services/DocumentService', () => ({
  DocumentService: { getCloudDocumentVersions: vi.fn(async () => new Map()) },
}));
vi.mock('@/core/services/StorageService', () => ({
  StorageService: { addCloudCopy: vi.fn(async () => 'cloud_x') },
}));
vi.mock('@/core/utils/streakFreeze', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/core/utils/streakFreeze')>();
  return { ...actual, syncStreakFreezesWithCloud: vi.fn(async () => new Set<string>()) };
});
vi.mock('@/shared/errors/reportError', () => ({ reportError: vi.fn() }));

import { SyncService } from '@/core/services/SyncService';
import { getLocalDb } from '@/core/storage/localDb';

beforeEach(async () => {
  vi.clearAllMocks();
  const db = await getLocalDb(USER);
  await db.clear('syncQueue');
  await db.put('syncQueue', {
    id: 'sync_del_d41f', type: 'delete', revocable: true, documentId: 'cloud_d41f',
    ownerId: USER, attempts: 0, createdAt: Date.now(),
  } as never);
});

describe('d41f: отказ дренажа очереди назван в итоге «Отправить все заметки»', () => {
  it('облако отказало удалению из очереди — итог не «0 ошибок»', async () => {
    removeCloudCopy.mockRejectedValue(new Error('MARKER_DAILY_CLOUD_DOWN'));
    const res = await SyncService.syncAllUnlinked(USER);
    expect(removeCloudCopy, 'край не вызван — тест ничего не проверяет').toHaveBeenCalled();
    expect(
      res.failed,
      'дренаж очереди отказал, а syncAllUnlinked вернул failed=0 — UI покажет зелёное «Синхронизировано: 0»',
    ).toBeGreaterThan(0);
  });

  it('КОНТРОЛЬ: облако ответило — задача снята с очереди, failed=0', async () => {
    removeCloudCopy.mockResolvedValue(undefined);
    const res = await SyncService.syncAllUnlinked(USER);
    expect(removeCloudCopy).toHaveBeenCalled();
    expect(res.failed).toBe(0);
    const db = await getLocalDb(USER);
    expect(await db.getAll('syncQueue')).toHaveLength(0);
  });
});
