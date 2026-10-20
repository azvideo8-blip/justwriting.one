import { describe, it, expect, vi, beforeEach } from 'vitest';
import { configure, renderHook, waitFor } from '@testing-library/react';

// Приёмка SYNC0 (L-1): drafts.ts тянет dateUtils → date-fns, и первый динамический
// импорт LocalStoreSyncService под vitest вырос со 135 до ~665 мс; 1 с по умолчанию
// под нагрузкой не хватало. Продукт не задет (dateUtils и так в стартовом куске).
configure({ asyncUtilTimeout: 5_000 });

/**
 * SA-1: бейдж должен говорить правду про два хвоста.
 *
 * 1. Производные ИИ (диалоги, разбор, темы) для него вообще не считались:
 *    «все данные синхронизированы» показывалось человеку с десятью неотправленными
 *    диалогами.
 * 2. Ошибка чтения очереди глоталась (`catch` с пустым телом), и бейдж держал
 *    прошлый снимок — то есть «0 в очереди», «синхронизировано».
 *
 * Фальсификация: вернуть пустой `catch` — тест про «неизвестно» краснеет;
 * убрать учёт ИИ-сторов из pollSyncStatus — краснеет тест про pending.
 */

const getPendingCount = vi.fn(async () => 0);
const getUnsyncedSummary = vi.fn(async () => ({
  unsyncedCount: 0, behindCount: 0, unlinkedCount: 0, deviceOnlyCount: 0, hasUnknown: false, deadCount: 0,
}));
const getPendingDeletionsCount = vi.fn(async () => 0);

vi.mock('../../services/SyncService', () => ({
  SyncService: { getPendingCount, getUnsyncedSummary, getPendingDeletionsCount },
}));
vi.mock('../useOnlineStatus', () => ({ useOnlineStatus: () => true }));

const { useSyncStatus } = await import('../useSyncStatus');

const UID = 'user-sa1';

describe('бейдж учитывает состояние ИИ-сторов', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    localStorage.setItem('auto_sync_enabled', 'true');
    getPendingCount.mockResolvedValue(0);
    getUnsyncedSummary.mockResolvedValue({
      unsyncedCount: 0, behindCount: 0, unlinkedCount: 0, deviceOnlyCount: 0, hasUnknown: false, deadCount: 0,
    });
  });

  it('неотправленная запись ИИ — это не «синхронизировано», и она посчитана', async () => {
    localStorage.setItem('ai_sync_pending_upserts', JSON.stringify([
      { uid: UID, store: 'aiDialogues', key: 'd1' },
      { uid: UID, store: 'aiThemeLedger', key: 't1' },
    ]));

    const { result } = renderHook(() => useSyncStatus(UID));

    await waitFor(() => expect(result.current.aiStorePendingCount).toBe(2));
    expect(result.current.status, 'заметки в порядке, но разборы не доехали').toBe('ai_store_unsynced');
    expect(result.current.status).not.toBe('synced');
  });

  it('отвергнутая облаком запись ИИ видна отдельным числом', async () => {
    localStorage.setItem('ai_sync_dead_upserts', JSON.stringify([
      { uid: UID, store: 'aiPortrait', key: 'singleton', lastError: '413', attempts: 5, timestamp: Date.now() },
    ]));

    const { result } = renderHook(() => useSyncStatus(UID));

    await waitFor(() => expect(result.current.aiStoreDeadCount).toBe(1));
    expect(result.current.status).toBe('ai_store_unsynced');
  });

  it('чужие аккаунты в счёт не идут', async () => {
    localStorage.setItem('ai_sync_pending_upserts', JSON.stringify([
      { uid: 'other-user', store: 'aiDialogues', key: 'd1' },
    ]));

    const { result } = renderHook(() => useSyncStatus(UID));

    await waitFor(() => expect(result.current.status).toBe('synced'));
    expect(result.current.aiStorePendingCount).toBe(0);
  });
});

describe('ошибка чтения очереди — «неизвестно», а не прошлый снимок', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    localStorage.setItem('auto_sync_enabled', 'true');
  });

  it('отказ чтения не оставляет бейдж на «всё синхронизировано»', async () => {
    getPendingCount.mockResolvedValueOnce(0);
    getPendingDeletionsCount.mockResolvedValue(0);
    getUnsyncedSummary.mockResolvedValue({
      unsyncedCount: 0, behindCount: 0, unlinkedCount: 0, deviceOnlyCount: 0, hasUnknown: false, deadCount: 0,
    });

    const { result } = renderHook(() => useSyncStatus(UID));
    await waitFor(() => expect(result.current.status).toBe('synced'));

    // Сломанное чтение очереди (закрытая вкладка IDB, quota) — второй перечёт.
    getPendingCount.mockRejectedValueOnce(new Error('db.getAll failed: UnknownError'));
    window.dispatchEvent(new CustomEvent('sync-queue-changed'));

    await waitFor(() => expect(result.current.hasUnknown).toBe(true), { timeout: 3000 });
    expect(result.current.status).toBe('cloud_unavailable');
    expect(result.current.status, 'незнание не выглядит как порядок').not.toBe('synced');
  });
});
