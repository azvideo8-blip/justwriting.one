import { describe, it, expect, vi } from 'vitest';
import 'fake-indexeddb/auto';
import { LocalStoreSyncService } from '../LocalStoreSyncService';
import { DataProvider } from '../../data';
import { getLocalDb } from '../../storage/localDb';

vi.mock('../../sync/cloudSyncEnabled', () => ({ cloudSyncEnabled: () => true }));
vi.mock('../../crypto/cryptoHelpers', async (orig) => ({ ...(await orig<object>()), maybeEncrypt: async (x: unknown) => x, getEncryptionEnabled: () => false }));

const USER = 'u_ls_upsert_retry';
vi.mock('../../auth', () => ({
  getCurrentUser: () => ({ uid: USER }),
  getCurrentUserId: () => USER,
}));

// R3-8: при сетевой ошибке повторно ставились только удаления — изменённый
// диалог не доезжал до других устройств, пока его не изменят снова.
describe('R3-8: a failed upsert stays queued', () => {
  it('retries on the next flush, and gives up after the cap', async () => {
    const db = await getLocalDb();
    await db.put('aiDialogues' as never, { id: 'dlg1', userId: USER, messages: [] } as never);

    if (DataProvider.deleteLocalStorePagedRecords) vi.spyOn(DataProvider, 'deleteLocalStorePagedRecords').mockResolvedValue(undefined as never);
    const save = vi.spyOn(DataProvider, 'saveLocalStoreRecord').mockResolvedValue(undefined as never).mockRejectedValueOnce(new Error('Failed to fetch'));
    // S-34: диалог читает облачную строку (пусто) и уходит условной вставкой —
    // та же сетевая ошибка и те же счётчики, что у saveLocalStoreRecord.
    vi.spyOn(DataProvider, 'getLocalStoreRecord').mockResolvedValue(null);
    vi.spyOn(DataProvider as Required<typeof DataProvider>, 'getLocalStoreRecordPages').mockResolvedValue([]);
    vi.spyOn(DataProvider, 'deleteLocalStoreRecordsByKeys').mockResolvedValue(undefined as never);
    vi.spyOn(DataProvider, 'getLocalStoreRecordsByKeyPrefix').mockResolvedValue([]);
    vi.spyOn(DataProvider, 'saveLocalStoreRecordIfUnchanged').mockImplementation(async (u, s, k, p) => {
      await DataProvider.saveLocalStoreRecord(u, s, k, p);
      return true;
    });
    LocalStoreSyncService.scheduleStoreSync('aiDialogues', 'dlg1');

    const r1 = await LocalStoreSyncService.flushPending(true);
    expect(r1.failed).toBe(1);
    expect((await LocalStoreSyncService.flushPending(true)).synced).toBe(1);
    expect(save).toHaveBeenCalledTimes(2);

    // Н-4: потолок — для отказа сервера; сетевой сбой попыток не тратит.
    save.mockReset().mockRejectedValue(new Error('22P02 invalid input syntax'));
    LocalStoreSyncService.scheduleStoreSync('aiDialogues', 'dlg1');
    for (let i = 0; i < 8; i++) await LocalStoreSyncService.flushPending(true);
    expect(save).toHaveBeenCalledTimes(5);
  });
});
