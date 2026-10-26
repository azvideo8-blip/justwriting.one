// RA1-2: офлайн-финиш не ждёт облако. Раньше кнопка «Сохранить» висела на
// DataProvider.deleteDraft и SyncService.syncOne (5–10 с без связи), хотя
// локальная запись уже произошла. Теперь без сети ждём только локальное
// удаление черновика и постановку в очередь, а «в облако отправится позже»
// говорит строка save_local_only_queued по итогу cloudSynced=false.
// Фальсификация: убрать ранний выход по navigator.onLine — тест красный.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import 'fake-indexeddb/auto';

const mockDeleteDraftCloud = vi.fn().mockResolvedValue(undefined);
vi.mock('../../../../core/data', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../../core/data')>();
  return {
    ...actual,
    DataProvider: { ...actual.DataProvider, deleteDraft: (...a: unknown[]) => mockDeleteDraftCloud(...a) },
  };
});

vi.mock('../../../../core/services/SyncService', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../../core/services/SyncService')>();
  return {
    SyncService: {
      ...actual.SyncService,
      syncOne: vi.fn().mockRejectedValue(new Error('Not connected to cloud. Changes saved locally.')),
    },
  };
});

import { cleanupDraftsAfterSave } from '../sessionActions';
import { LocalStorageService } from '../../../../core/services/LocalStorageService';
import { LocalDocumentService } from '../../../../core/services/LocalDocumentService';
import { SyncService } from '../../../../core/services/SyncService';

const onlineDescriptor = Object.getOwnPropertyDescriptor(Navigator.prototype, 'onLine');

function setOnline(value: boolean) {
  Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => value });
}

describe('RA1-2: офлайн-финиш завершается без ожидания облака', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setOnline(false);
  });

  afterEach(() => {
    if (onlineDescriptor) Object.defineProperty(Navigator.prototype, 'onLine', onlineDescriptor);
  });

  it('без сети: облако не зовём, задача в очереди, заметка на устройстве', async () => {
    const userId = `u_ra12_${Date.now()}`;
    const { localId } = await LocalStorageService.saveNew(userId, {
      title: 'Без сети',
      content: 'Сохранено на устройстве',
      wordCount: 3,
      duration: 5,
      wpm: 10,
      tags: [],
      sessionStartedAt: new Date(),
    });

    const startedAt = Date.now();
    const res = await cleanupDraftsAfterSave(userId, false, localId);
    const elapsed = Date.now() - startedAt;

    expect(res.cloudSynced).toBe(false);
    expect(elapsed, 'офлайн-финиш не должен ждать сетевые таймауты').toBeLessThan(1000);
    expect(SyncService.syncOne).not.toHaveBeenCalled();
    expect(mockDeleteDraftCloud, 'облачное удаление черновика догонит надгробие').not.toHaveBeenCalled();

    expect(await LocalDocumentService.getDocument(localId, userId)).toBeTruthy();
    const db = await (await import('../../../../core/storage/localDb')).getLocalDb(userId);
    const tasks = (await db.getAll('syncQueue')).filter(t => t.documentId === localId && !t.id.startsWith('lock_cloud_'));
    expect(tasks).toHaveLength(1);
  });

  it('при связи облачный путь остаётся: syncOne зовётся, тост — прежний cloudSynced', async () => {
    setOnline(true);
    vi.mocked(SyncService.syncOne).mockResolvedValueOnce('cloud_1');
    const userId = `u_ra12_on_${Date.now()}`;
    const { localId } = await LocalStorageService.saveNew(userId, {
      title: 'С сетью',
      content: 'Сохранено в облако',
      wordCount: 3,
      duration: 5,
      wpm: 10,
      tags: [],
      sessionStartedAt: new Date(),
    });

    const res = await cleanupDraftsAfterSave(userId, false, localId);

    expect(SyncService.syncOne).toHaveBeenCalledWith(userId, localId);
    expect(mockDeleteDraftCloud).toHaveBeenCalled();
    expect(res.cloudSynced).toBe(true);
  });
});
