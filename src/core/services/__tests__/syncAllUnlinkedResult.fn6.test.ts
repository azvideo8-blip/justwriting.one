// FN-6 (дейлик 20.11, Н-6): итог «Отправить все заметки» — отказ постановки в очередь
// назван, исключённые из выгрузки заметки посчитаны, причина паузы дренажа пробрасывается.
// Настоящий SyncService поверх fake-indexeddb; моки только края (облако, список документов).
import { describe, it, expect, vi, beforeEach } from 'vitest';
import 'fake-indexeddb/auto';

const addCloudCopy = vi.hoisted(() => vi.fn());
const getDocumentsByOwner = vi.hoisted(() => vi.fn());
const isVaultLockedMock = vi.hoisted(() => vi.fn(() => false));
const USER = 'u-fn6';

vi.mock('@/core/services/CloudSyncService', () => ({
  CloudSyncService: {
    relinkOrphanedDocuments: vi.fn(async () => ({ skippedIds: [], relinked: 0 })),
    removeCloudCopy: vi.fn(async () => {}),
  },
  CLOUD_COPY_LOCAL_ONLY: 'LOCAL_ONLY',
  CLOUD_COPY_TOMBSTONE: 'TOMBSTONE',
}));
vi.mock('@/core/services/LocalDocumentService', () => ({
  LocalDocumentService: { getDocumentsByOwner },
}));
vi.mock('@/core/services/DocumentService', () => ({
  DocumentService: { getCloudDocumentVersions: vi.fn(async () => new Map()) },
}));
vi.mock('@/core/services/StorageService', () => ({
  StorageService: { addCloudCopy },
}));
vi.mock('@/core/utils/streakFreeze', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/core/utils/streakFreeze')>();
  return { ...actual, syncStreakFreezesWithCloud: vi.fn(async () => new Set<string>()) };
});
vi.mock('@/core/crypto/cryptoHelpers', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/core/crypto/cryptoHelpers')>();
  return { ...actual, isVaultLocked: isVaultLockedMock };
});
vi.mock('@/shared/errors/reportError', () => ({ reportError: vi.fn() }));

import { SyncService } from '@/core/services/SyncService';
import { getLocalDb } from '@/core/storage/localDb';

const doc = (id: string, extra: Record<string, unknown> = {}) => ({
  id, ownerId: USER, title: id, currentVersion: 1, lastSyncedCloudVersion: 0, ...extra,
});

beforeEach(async () => {
  vi.restoreAllMocks();
  vi.clearAllMocks();
  isVaultLockedMock.mockReturnValue(false);
  const db = await getLocalDb(USER);
  await db.clear('syncQueue');
});

describe('FN-6: итог syncAllUnlinked', () => {
  it('выгрузка отказала и в очередь не встала — failed считает её, а не «0 ошибок» (б)', async () => {
    getDocumentsByOwner.mockResolvedValue([doc('d1')]);
    addCloudCopy.mockRejectedValue(new Error('MARKER_CLOUD_DOWN'));
    vi.spyOn(SyncService, 'addToQueue').mockRejectedValue(new Error('MARKER_IDB_QUOTA'));
    const res = await SyncService.syncAllUnlinked(USER);
    expect(addCloudCopy).toHaveBeenCalledTimes(1);
    expect(res.failed).toBe(1);
    expect(res.queued).toBe(0);
  });

  it('КОНТРОЛЬ: выгрузка отказала, но встала в очередь и дренаж её повторил удачно — synced 1, failed 0', async () => {
    getDocumentsByOwner.mockResolvedValue([doc('d1')]);
    addCloudCopy.mockRejectedValueOnce(new Error('MARKER_CLOUD_DOWN')).mockResolvedValue('cloud_d1');
    const res = await SyncService.syncAllUnlinked(USER);
    expect(res.failed).toBe(0);
    expect(res.synced).toBe(1);
  });

  it('заперты, нечитаемы и «только на устройстве» — в skipped, не в выгрузку (в)', async () => {
    getDocumentsByOwner.mockResolvedValue([
      doc('a', { _locked: true }), doc('b', { _decryptionError: true }), doc('c', { localOnly: true }), doc('ok'),
    ]);
    addCloudCopy.mockResolvedValue('cloud_ok');
    const res = await SyncService.syncAllUnlinked(USER);
    expect(res.skipped).toBe(3);
    expect(res.skippedIds).toHaveLength(3);
    expect(addCloudCopy).toHaveBeenCalledTimes(1);
    expect(res.synced).toBe(1);
  });

  it('сейф заперт — причина паузы дренажа в ответе, поставленная задача — ошибка, не «0»', async () => {
    getDocumentsByOwner.mockResolvedValue([doc('d1')]);
    addCloudCopy.mockRejectedValue(new Error('MARKER_VAULT_LOCKED'));
    isVaultLockedMock.mockReturnValue(true);
    const res = await SyncService.syncAllUnlinked(USER);
    expect(res.skippedReason).toBe('vault_locked');
    expect(res.failed).toBe(1);
    expect(res.queued).toBe(1);
  });

  // Ревью exec-2026-11-20: итог дренажа — по заметкам. Удаление из очереди — не «отправленная
  // заметка», а заметка с двумя задачами (документ + версия) — одна.
  it('в очереди только удаление — synced 0, не «Синхронизировано: 1»', async () => {
    getDocumentsByOwner.mockResolvedValue([]);
    const db = await getLocalDb(USER);
    await db.put('syncQueue', { id: 'sync_del_fn6', type: 'delete', revocable: true, documentId: 'cloud_x', ownerId: USER, attempts: 0, createdAt: Date.now() } as never);
    const res = await SyncService.syncAllUnlinked(USER);
    expect(await db.getAll('syncQueue'), 'удаление не снято — тест ничего не проверяет').toHaveLength(0);
    expect(res.synced).toBe(0);
    expect(res.failed).toBe(0);
  });

  it('заметка с двумя задачами в очереди — отправлена одна заметка', async () => {
    getDocumentsByOwner.mockResolvedValue([]);
    addCloudCopy.mockResolvedValue('cloud_q1');
    const db = await getLocalDb(USER);
    await db.put('syncQueue', { id: 'sync_q1', type: 'document', documentId: 'q1', ownerId: USER, attempts: 0, createdAt: Date.now() } as never);
    await db.put('syncQueue', { id: 'sync_v_q1', type: 'version', documentId: 'q1', ownerId: USER, attempts: 0, createdAt: Date.now() } as never);
    const res = await SyncService.syncAllUnlinked(USER);
    expect(res.synced).toBe(1);
    expect(res.failed).toBe(0);
  });

  // Ревью выпуска 0.11.23: карантинные задачи дренаж не берёт — они не «ошибка этого нажатия».
  it('карантинные задачи (удаление и документ) не считаются ни ошибкой, ни ожиданием', async () => {
    getDocumentsByOwner.mockResolvedValue([]);
    const db = await getLocalDb(USER);
    await db.put('syncQueue', { id: 'sync_dead_del', type: 'delete', revocable: true, documentId: 'cloud_dead', ownerId: USER, attempts: 5, dead: true, createdAt: Date.now() } as never);
    await db.put('syncQueue', { id: 'sync_dead_doc', type: 'document', documentId: 'dead_doc', ownerId: USER, attempts: 5, dead: true, createdAt: Date.now() } as never);
    const res = await SyncService.syncAllUnlinked(USER);
    expect(await db.getAll('syncQueue'), 'карантин должен остаться в очереди — иначе тест ничего не проверяет').toHaveLength(2);
    expect(res.failed).toBe(0);
    expect(res.queued).toBe(0);
  });
});

