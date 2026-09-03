import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';

/**
 * Состояние синхронизации обязано говорить правду.
 *
 * Оно говорило «Все данные синхронизированы» человеку, у которого четырнадцать
 * заметок на двадцать тысяч слов лежали ровно в одном браузере. Причина в трёх
 * строках: при выключенной автоотправке статус назначался `synced` СРАЗУ, не
 * глядя на данные, а счётчики принудительно обнулялись. Автоотправка при этом
 * выключена по умолчанию.
 *
 * «Мы не проверяем» — не то же самое, что «всё хорошо». Это тот же класс, что
 * неудачное чтение, показанное как ответ о данных.
 */

const getUnsyncedCount = vi.fn(async () => 0);
const getPendingCount = vi.fn(async () => 0);

vi.mock('../../services/SyncService', () => ({
  SyncService: { getUnsyncedCount, getPendingCount },
}));
vi.mock('../useOnlineStatus', () => ({ useOnlineStatus: () => true }));

const { useSyncStatus } = await import('../useSyncStatus');

describe('состояние синхронизации не выдаёт незнание за порядок', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    getPendingCount.mockResolvedValue(0);
  });

  it('при выключенной автоотправке незалитые заметки всё равно посчитаны и названы', async () => {
    localStorage.setItem('auto_sync_enabled', 'false');
    getUnsyncedCount.mockResolvedValue(14);

    const { result } = renderHook(() => useSyncStatus('user-1'));

    await waitFor(() => expect(result.current.unsyncedCount).toBe(14));
    expect(result.current.status, 'четырнадцать заметок вне облака — это не «синхронизировано»').toBe('unsynced');
  });

  it('«синхронизировано» говорится только когда в облаке действительно всё', async () => {
    localStorage.setItem('auto_sync_enabled', 'true');
    getUnsyncedCount.mockResolvedValue(0);

    const { result } = renderHook(() => useSyncStatus('user-1'));

    await waitFor(() => expect(result.current.status).toBe('synced'));
  });

  /**
   * Отдельное состояние: в облаке всё, но новое туда само не поедет. Называть
   * это «синхронизировано» — обещать больше, чем есть.
   */
  it('выключенная автоотправка при полном облаке — своё состояние, не «синхронизировано»', async () => {
    localStorage.setItem('auto_sync_enabled', 'false');
    getUnsyncedCount.mockResolvedValue(0);

    const { result } = renderHook(() => useSyncStatus('user-1'));

    await waitFor(() => expect(result.current.status).toBe('sync_off'));
  });
});
