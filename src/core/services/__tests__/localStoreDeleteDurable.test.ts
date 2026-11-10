import { describe, it, expect, vi, beforeEach } from 'vitest';
import 'fake-indexeddb/auto';
import { LocalStoreSyncService, getPendingStoreDeleteKeys } from '../LocalStoreSyncService';
import { DataProvider } from '../../data';

let syncOn = false;
vi.mock('../../sync/cloudSyncEnabled', () => ({ cloudSyncEnabled: () => syncOn }));

const USER = 'u_ls_delete_durable';
vi.mock('../../auth', () => ({
  getCurrentUser: () => ({ uid: USER }),
  getCurrentUserId: () => USER,
}));

// EA-5: облачное удаление разбора удалённой заметки нельзя вывести заново из
// IndexedDB. Раньше оно жило только в памяти — закрытие вкладки (или
// выключенная синхронизация всю сессию) теряло его, и восстановление из облака
// возвращало удалённое.
describe('LocalStoreSyncService: cloud deletes survive closing the tab (EA-5)', () => {
  beforeEach(() => {
    vi.spyOn(DataProvider, 'syncPush').mockImplementation(async items => items.map(() => ({ status: 'ok' as const })));
    vi.clearAllMocks();
    localStorage.clear();
    syncOn = false;
  });

  it('keeps the delete on disk while sync is off and sends it after the tab is reopened', async () => {
    const del = vi.spyOn(DataProvider, 'deleteLocalStoreRecord').mockResolvedValue(undefined);

    LocalStoreSyncService.scheduleStoreDelete('aiDialogues', 'dialog_of_deleted_note');
    await LocalStoreSyncService.flushPending(); // синхронизация выключена — ничего не уходит
    expect(del).not.toHaveBeenCalled();
    expect(getPendingStoreDeleteKeys(USER)?.has('aiDialogues:dialog_of_deleted_note')).toBe(true);

    // «Закрыли вкладку»: очередь в памяти пропала.
    (LocalStoreSyncService as unknown as { pending: Map<string, unknown> }).pending.clear();

    syncOn = true;
    await LocalStoreSyncService.flushPending();
    expect(del).toHaveBeenCalledWith(USER, 'aiDialogues', 'dialog_of_deleted_note');
    expect(getPendingStoreDeleteKeys(USER)?.size).toBe(0);
  });
});
